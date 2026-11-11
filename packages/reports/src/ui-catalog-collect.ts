/**
 * @module Collecting a UI catalog from a shared queue
 *
 * `collectCatalog` is one shard of a collection: it publishes the catalog's definition (idempotent: the same definition is
 * the same version), claims the most urgent work units from an Atlas server, hands them to the project's collector,
 * publishes each capture as an ordinary `ui-state` layer labelled with its claim, renews the claim while the collector works
 * and claims again, until the queue is empty or a bound is reached. Any number of shards (local processes, CI jobs, a device
 * lab) can run it at once; they coordinate only through the server, so none needs to know how many others there are.
 *
 * The collector is the project's own (a Playwright page, a device, a script): Atlas never drives the product. When the claim
 * is lost (it expired, or the server took it back), the `signal` given to the collector aborts, and what it captured for that
 * claim is not published: a shard never publishes work it no longer holds. On a stop (`signal`, a bound) the claim is
 * released, so its unfinished units go back to the queue at once instead of waiting for the lease to expire.
 *
 * There is no mode without a server: a guessed order other shards cannot see would defeat the point.
 *
 * @see docs/ui-catalog.md#collecting-with-a-queue
 */
import { randomUUID } from 'node:crypto';

import type { UiCatalogDefinitionDocument, UiClaim } from '../../schema/src/ui-catalog-queue';
import { AtlasHttpError, type HttpStore } from './http-store';
import { publishChecks } from './publish-checks';
import type { CatalogJournal, JournalEntry } from './ui-catalog-bundle';
import { checkWhere, resolveCatalog, type CatalogDefinition } from './ui-catalog-definition';
import { uiStateLayer, type UiStateCapture } from './ui-catalog-publish';
import { UI_CLAIM_LABEL } from './ui-catalog-queue';

/** One claimed work unit: its key, the tier it was handed out from, and its items (a state in a profile each). */
export type CollectUnit = UiClaim['units'][number];
/** One item of a claimed unit. */
export type CollectItem = CollectUnit['items'][number];

/** What a collector returns for one item: a capture as `uiStateLayer` takes it, naming the item by its key instead of an id. */
export type CapturedItem = Omit<UiStateCapture, 'id'> & {
  /** The item's `key`, from the unit. */
  readonly item: string;
};

/** Explicit collector infrastructure failure; ordinary exceptions retain their historical item-failure behavior. */
export class CollectorInfrastructureError extends Error {
  constructor(message: string, readonly diagnostic: { readonly phase: string; readonly retryable?: boolean; readonly fingerprint?: string }) {
    super(message);
    this.name = 'CollectorInfrastructureError';
  }
}

/** One infrastructure incident, separate from product-state failures. */
export type CollectorDiagnostic = { readonly message: string; readonly phase: string; readonly retryable: boolean; readonly fingerprint?: string; readonly attempt: number };

/** How one shard collects. Per-unit callbacks publish before taking another unit; stream yields wait for publication. With a buffer budget, returned captures are bounded by concurrency × maxBufferedBytes. Producers must bound their own allocation. Legacy array batches retain whole-claim buffering. */
export type CollectOptions = {
  /** The Atlas server, as `httpStore` opens it, with a token that may publish. */
  readonly store: HttpStore;
  /** The definition, as the project wrote it (resolved here) or already resolved. */
  readonly catalog: CatalogDefinition | { readonly version: string; readonly document: UiCatalogDefinitionDocument };
  /** This shard: a name for people, and optionally the dimension values it can collect (`{ deployment: 'development' }`). */
  readonly shard: { readonly id: string; readonly where?: Readonly<Record<string, string | readonly string[]>> };
  /** Units per claim. Default 25. Small batches keep the priority sharp; large ones keep a warm collector busy. */
  readonly batchSize?: number;
  /** Concurrent units for `capture`; default 1. Each call must own its browser page or other mutable resources. Not used with `captureBatch`. */
  readonly concurrency?: number;
  /** The lease of a claim, in seconds; renewed every third of it. Default 120. */
  readonly leaseSeconds?: number;
  /** What retry limits are counted in (a CI run id). Default: the definition version. */
  readonly collection?: string;
  /** Also collect captured items whose result was recorded before this time, oldest first. */
  readonly staleBeforeMs?: number;
  /** Stop claiming after this many units. */
  readonly maxUnits?: number;
  /** Stop at this deadline, abort active callbacks and release unfinished work. JavaScript callbacks must cooperate to stop their own resources; late results are ignored. Completed uploads have no grace past the deadline. */
  readonly maxMs?: number;
  /** Stop at once: publish what is captured, release the claim. */
  readonly signal?: AbortSignal;
  /** The producer of the capture layers. Default `ui-catalog:<name>`, the producer of the plan. */
  readonly producer?: string;
  /** Provenance written on every capture layer. */
  readonly origin?: { readonly sha?: string | null; readonly branch?: string | null; readonly runUrl?: string | null; readonly run?: { readonly id: string; readonly title?: string } };
  /** Capture one unit. Abort when `signal` aborts: the claim was lost or the shard is stopping. */
  readonly capture?: (unit: CollectUnit, signal: AbortSignal) => Promise<readonly CapturedItem[]>;
  /** Capture every unit of a claim at once (one process for a batch). */
  readonly captureBatch?: (units: readonly CollectUnit[], context: { readonly claimId: string; readonly signal: AbortSignal }) => Promise<readonly CapturedItem[]>;
  /** Stream completed units with backpressure: each yield is published before requesting the next. Never yield a unit twice. Array callbacks remain supported. */
  readonly captureStream?: (units: readonly CollectUnit[], context: { readonly claimId: string; readonly signal: AbortSignal }) => AsyncIterable<{ readonly unit: string; readonly captures: readonly CapturedItem[] }>;
  /** Maximum bytes returned per unit. Streaming defaults to 64 MiB. Existing per-unit/array callbacks retain their limits unless this is supplied; array batches retain whole-claim buffering. */
  readonly maxBufferedBytes?: number;
  /** Initialize consumer resources before any work is claimed. A failure is infrastructure failure, never an item result. */
  readonly preflight?: (signal: AbortSignal) => Promise<void>;
  /** Retries for explicitly retryable infrastructure errors; default 0. No failed product result is emitted for these errors. */
  readonly infrastructureRetries?: number;
  /** Stop the shard after this many unrecovered infrastructure incidents; default 1. */
  readonly infrastructureFailureLimit?: number;
  /** Write every capture layer here before publishing it, with whether the publish succeeded ({@link ./ui-catalog-bundle}). A journal that cannot be written stops the shard with that error. */
  readonly journal?: CatalogJournal;
  /** Told what happens, for a log line. */
  readonly onEvent?: (event: CollectEvent) => void;
  readonly now?: () => number;
};

/** What `collectCatalog` tells `onEvent`. Published item/failure counters describe only that publication, so events can be summed. */
export type CollectEvent =
  | { readonly type: 'infrastructure'; readonly diagnostic: CollectorDiagnostic }
  | { readonly type: 'definition'; readonly version: string; readonly created: boolean }
  | { readonly type: 'claim'; readonly claimId: string; readonly units: number }
  | { readonly type: 'published'; readonly claimId: string; readonly items: number; readonly failed: number }
  | { readonly type: 'lost'; readonly claimId: string; readonly units: number }
  | { readonly type: 'released'; readonly claimId: string; readonly units: number };

/** Why a shard stopped: the queue had nothing left for it, a bound, a stop signal, or the server stopped answering. */
export type CollectStop = 'empty' | 'max-units' | 'max-minutes' | 'signal' | 'unreachable' | 'infrastructure';

/** What one shard did. */
export type CollectResult = {
  readonly ok: boolean;
  /** Infrastructure incidents, including recovered retries; absent in older collectors. */
  readonly diagnostics?: readonly CollectorDiagnostic[];
  readonly definition: string;
  readonly shard: string;
  readonly stoppedBy: CollectStop;
  readonly claims: number;
  readonly units: { readonly claimed: number; readonly collected: number; readonly lost: number; readonly released: number };
  readonly items: { readonly captured: number; readonly failed: number; readonly other: number };
  /** Claims the server took back (expired) while this shard held them. Their captures were not published. */
  readonly lostClaims: readonly string[];
  readonly layers: number;
  /** Why the server stopped answering, when `stoppedBy` is `unreachable`. */
  readonly error?: string;
};

const sentence = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/\s+/g, ' ').trim();

/**
 * Publish a definition to a server: stored once, and written as plan layers so the catalog expects every item. Returns its
 * version and whether this call stored it. Throws an `AtlasHttpError` when the server refuses it or cannot be reached.
 */
export async function publishCatalogDefinition(store: HttpStore, catalog: CollectOptions['catalog']): Promise<{ readonly version: string; readonly document: UiCatalogDefinitionDocument; readonly created: boolean }> {
  const resolved = 'document' in catalog && 'version' in catalog ? catalog : await resolveCatalog(catalog as CatalogDefinition);
  const response = await store.call('PUT', `/ui-catalog/definitions/${resolved.version}`, { json: resolved.document });
  const body = await response.json() as { created?: boolean };
  return { version: resolved.version, document: resolved.document, created: body.created === true };
}

/**
 * Collect a UI catalog as one shard of any number: claim, capture, publish, claim again, until nothing is left for this
 * shard or a bound is reached. A capture that throws records every item of its unit as failed with the reason, and the
 * collection goes on; an item the collector returned nothing for is failed too. A unit cannot answer another unit's items.
 * Throws for invalid concurrency before contacting the server, a `CatalogDefinitionError` for a
 * `where` naming an unknown dimension or value, and an `AtlasHttpError` when the server cannot be reached or refuses
 * the definition, before anything is collected.
 *
 * @example
 * ```ts
 * const result = await collectCatalog({
 *   store: httpStore({ url: process.env.ATLAS_SERVER_URL!, token: process.env.ATLAS_TOKEN }),
 *   catalog, shard: { id: `ci-${process.env.GITHUB_JOB}`, where: { deployment: 'development' } }, batchSize: 25,
 *   capture: async (unit, signal) => captureWithIsolatedPage(unit, signal)
 * });
 * ```
 */
export async function collectCatalog(options: CollectOptions): Promise<CollectResult> {
  if (!options.capture && !options.captureBatch && !options.captureStream) throw new Error('collectCatalog needs capture, captureBatch or captureStream');
  const concurrency = options.concurrency ?? 1;
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new Error('concurrency must be a positive safe integer');
  if (options.maxMs !== undefined && (!Number.isFinite(options.maxMs) || options.maxMs < 0)) throw new Error('maxMs must be finite and nonnegative');
  const maxBufferedBytes = options.maxBufferedBytes ?? 64 * 1024 * 1024;
  if (!Number.isSafeInteger(maxBufferedBytes) || maxBufferedBytes < 1) throw new Error('maxBufferedBytes must be a positive safe integer');
  const infrastructureRetries = options.infrastructureRetries ?? 0;
  const infrastructureFailureLimit = options.infrastructureFailureLimit ?? 1;
  if (!Number.isSafeInteger(infrastructureRetries) || infrastructureRetries < 0 || !Number.isSafeInteger(infrastructureFailureLimit) || infrastructureFailureLimit < 1) throw new Error('Invalid infrastructure retry/limit settings');
  const diagnostics: CollectorDiagnostic[] = [];
  let infrastructureFailures = 0;
  const infrastructure = new AbortController();
  const incident = (failure: CollectorInfrastructureError, attempt: number) => {
    const diagnostic = { message: sentence(failure), ...failure.diagnostic, retryable: failure.diagnostic.retryable === true, attempt };
    diagnostics.push(diagnostic);
    options.onEvent?.({ type: 'infrastructure', diagnostic });
  };
  const retry = async <T>(work: () => Promise<T>, signal: AbortSignal): Promise<T> => {
    for (let attempt = 0; ; attempt++) {
      try { return await untilStopped(work(), signal); }
      catch (failure) {
        if (signal.aborted || !(failure instanceof CollectorInfrastructureError)) throw failure;
        incident(failure, attempt + 1);
        if (!failure.diagnostic.retryable || attempt >= infrastructureRetries) throw failure;
      }
    }
  };
  const now = options.now ?? Date.now;
  const started = now();
  const where = options.shard.where ? Object.fromEntries(Object.entries(options.shard.where).map(([name, value]) => [name, typeof value === 'string' ? [value] : [...value]])) : undefined;
  const resolved = 'document' in options.catalog && 'version' in options.catalog ? options.catalog : await resolveCatalog(options.catalog as CatalogDefinition);
  if (where) checkWhere(resolved.document, where);
  const published = await publishCatalogDefinition(options.store, resolved);
  options.onEvent?.({ type: 'definition', version: published.version, created: published.created });
  await options.journal?.open(resolved);
  const producer = options.producer ?? `ui-catalog:${resolved.document.name}`;
  const leaseSeconds = options.leaseSeconds ?? 120;
  const batchSize = options.batchSize ?? 25;

  const units = { claimed: 0, collected: 0, lost: 0, released: 0 };
  const items = { captured: 0, failed: 0, other: 0 };
  const lostClaims: string[] = [];
  let claims = 0, layers = 0;
  let stoppedBy: CollectStop | null = null;
  const due = () => {
    if (options.signal?.aborted) return 'signal' as const;
    if (infrastructure.signal.aborted) return 'infrastructure' as const;
    if (options.maxMs !== undefined && now() - started >= options.maxMs) return 'max-minutes' as const;
    return null;
  };

  const releaseHeld = async (id: string, count = true) => {
    const body = await untilStopped(options.store.call('DELETE', `/ui-catalog/claims/${id}`, { accept: [410] }).then(async response => {
      if (response.status === 200) return await response.json() as { released?: number };
      await response.body?.cancel();
      return {};
    }), AbortSignal.timeout(1000)).catch(() => ({} as { released?: number }));
    if (!count) return;
    units.released += body.released ?? 0;
    if (body.released) options.onEvent?.({ type: 'released', claimId: id, units: body.released });
  };
  let error: string | undefined;
  if (options.preflight) {
    const signal = AbortSignal.any([...(options.signal ? [options.signal] : []), ...(options.maxMs !== undefined ? [AbortSignal.timeout(Math.max(0, Math.ceil(options.maxMs - (now() - started))))] : [])]);
    try { await retry(async () => {
      try { await options.preflight!(signal); }
      catch (failure) { throw failure instanceof CollectorInfrastructureError ? failure : new CollectorInfrastructureError(sentence(failure), { phase: 'preflight' }); }
    }, signal); }
    catch { if (!signal.aborted) infrastructure.abort(); else stoppedBy = due() ?? 'signal'; }
  }
  while (!stoppedBy && !(stoppedBy = due() ?? (options.maxUnits !== undefined && units.claimed >= options.maxUnits ? 'max-units' : null))) {
    let held: string | null = null;
    let activeClaim: UiClaim | undefined;
    let collectedInClaim = 0;
    const lost = new AbortController();
    let beat: ReturnType<typeof setInterval> | undefined;
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new AbortController();
    const lifetime = new AbortController();
    if (options.maxMs !== undefined) deadlineTimer = setTimeout(() => deadline.abort(new Error('Collection deadline reached')), Math.max(0, options.maxMs - (now() - started)));
    try {
      const size = Math.min(batchSize, options.maxUnits !== undefined ? options.maxUnits - units.claimed : batchSize);
      const idempotencyKey = randomUUID();
      const claiming = options.store.call('POST', '/ui-catalog/claims', {
        accept: [204],
        json: {
          shard: options.shard.id, definition: published.version, batchSize: size, leaseSeconds, idempotencyKey,
          ...(where ? { where } : {}), ...(options.collection ? { collection: options.collection } : {}), ...(options.staleBeforeMs !== undefined ? { staleBeforeMs: options.staleBeforeMs } : {})
        }
      }).then(async response => {
        if (response.status === 204) { await response.body?.cancel(); return null; }
        return await response.json() as UiClaim;
      });
      // A request already accepted by the server can finish after our deadline. Release
      // that late claim instead of leaving it held until its lease expires.
      const claim = await untilStopped(claiming, AbortSignal.any([deadline.signal, ...(options.signal ? [options.signal] : [])])).catch(failure => {
        void claiming.then(async claim => { if (claim) await releaseHeld(claim.claimId, false); }).catch(() => undefined);
        throw failure;
      });
      if (!claim) { stoppedBy = 'empty'; break; }
      activeClaim = claim;
      held = claim.claimId;
      claims++;
      units.claimed += claim.units.length;
      options.onEvent?.({ type: 'claim', claimId: claim.claimId, units: claim.units.length });

      // The claim is held while the collector works: renewed every third of its lease, and lost on a 410.
      beat = setInterval(() => {
        void options.store.call('POST', `/ui-catalog/claims/${claim.claimId}/heartbeat`, { accept: [410] }).then(async answer => {
          if (answer.status === 410) { await answer.body?.cancel(); lost.abort(new Error('The claim was lost: its lease expired or the server took it back')); } else await answer.body?.cancel();
        }, () => { /* the next beat tries again; the server expires the claim if none arrives */ });
      }, Math.max(1000, (leaseSeconds * 1000) / 3));
      const signal = AbortSignal.any([lost.signal, deadline.signal, lifetime.signal, infrastructure.signal, ...(options.signal ? [options.signal] : [])]);
      const publishSignal = AbortSignal.any([lost.signal, deadline.signal, lifetime.signal]);
      // Guard every write as well as the overall publish. A blocked write may finish, but
      // subsequent writes (especially the visible layer index) cannot start after cancellation.
      const publishingStore = { ...options.store, put: async (...args: Parameters<HttpStore['put']>) => {
        publishSignal.throwIfAborted();
        await untilStopped(options.store.put(...args), publishSignal);
      } };
      const flush = async (finished: readonly CollectUnit[], captures: readonly CapturedItem[]) => {
        // Every item of a collected unit gets a result: what the collector returned, or a failure saying it returned nothing.
        const byKey = new Map(captures.map(capture => [capture.item, capture]));
        const perProfile = new Map<string, { item: CollectItem; capture: UiStateCapture }[]>();
        for (const unit of finished) for (const item of unit.items) {
          const given = byKey.get(item.key);
          const { item: _key, ...rest } = given ?? { item: item.key, status: 'failed' as const, detail: 'The collector returned no capture for this item' };
          const capture: UiStateCapture = { title: item.state.title ?? item.state.id, ...stateFacts(item), ...rest, id: item.state.id, labels: { ...rest.labels, [UI_CLAIM_LABEL]: claim.claimId } };
          const list = perProfile.get(item.profile.key);
          if (list) list.push({ item, capture }); else perProfile.set(item.profile.key, [{ item, capture }]);
        }
        const publishedProfiles = new Set<string>();
        let publishedFailures = 0;
        // Each layer's input is made once, so a journal holds exactly the layer the server receives (the same id).
        const inputs = new Map([...perProfile].map(([key, entries]) => {
          const profile = entries[0]!.item.profile;
          return [key, uiStateLayer({
            producer, recordedAtMs: now(), ...(profile.environment ? { environment: profile.environment } : {}), profile: profile.parameters, shard: options.shard.id,
            ...(options.origin?.sha !== undefined ? { sha: options.origin.sha } : {}), ...(options.origin?.branch !== undefined ? { branch: options.origin.branch } : {}),
            ...(options.origin?.runUrl !== undefined ? { runUrl: options.origin.runUrl } : {}), ...(options.origin?.run ? { run: options.origin.run } : {}),
            states: entries.map(entry => entry.capture)
          })] as const;
        }));
        // Journaled before anything is published: what was captured survives a server that stops answering or a lost claim.
        const journaled = new Map<string, JournalEntry>();
        if (options.journal) {
          for (const [key, input] of inputs) {
            const units = [...new Set(finished.filter(unit => unit.items.some(item => item.profile.key === key)).map(unit => unit.key))];
            journaled.set(key, await options.journal.record(input, { claimId: claim.claimId, units }));
          }
        }
        for (const entries of perProfile.values()) {
          if (lost.signal.aborted || deadline.signal.aborted) break;
          const profile = entries[0]!.item.profile;
          try { await untilStopped(publishChecks(publishingStore, inputs.get(profile.key)!), publishSignal); }
          catch (failure) { await journaled.get(profile.key)?.settle('failed', sentence(failure)); throw failure; }
          await journaled.get(profile.key)?.settle('published');
          layers++;
          publishedProfiles.add(profile.key);
          for (const { capture } of entries) {
            const status = capture.status ?? 'passed';
            if (status === 'passed') items.captured++; else if (status === 'failed') { items.failed++; publishedFailures++; } else items.other++;
          }
        }
        const completed = finished.filter(unit => unit.items.every(item => publishedProfiles.has(item.profile.key))).length;
        units.collected += completed;
        collectedInClaim += completed;
        options.onEvent?.({ type: 'published', claimId: claim.claimId, items: [...perProfile.values()].filter(entries => publishedProfiles.has(entries[0]!.item.profile.key)).reduce((sum, list) => sum + list.length, 0), failed: publishedFailures });
      };
      {
        const failAll = (list: readonly CollectUnit[], reason: string) => list.flatMap(unit => unit.items.map(item => ({ item: item.key, status: 'failed' as const, detail: reason })));
        // A collector stopped by the shard's own stop signal did not fail: its unit goes back to the queue instead.
        const stopped = () => signal.aborted;
        const checkBytes = (captures: readonly CapturedItem[]) => withinBudget(captures, maxBufferedBytes);
        if (options.captureStream) {
          const iterator = options.captureStream(claim.units, { claimId: claim.claimId, signal })[Symbol.asyncIterator]();
          const remaining = new Map(claim.units.map(unit => [unit.key, unit]));
          try {
            while (!signal.aborted) {
              const next = await untilStopped(iterator.next(), signal);
              if (next.done) break;
              const unit = remaining.get(next.value.unit);
              if (!unit) throw new Error('captureStream returned an unknown or duplicate unit');
              await flush([unit], checkBytes(next.value.captures));
              remaining.delete(unit.key);
            }
            if (!signal.aborted && remaining.size) await flush([...remaining.values()], failAll([...remaining.values()], 'The collector returned no capture for this unit'));
          } finally {
            // Do not wait for a non-cooperative generator to unwind.
            try { void iterator.return?.().catch(() => undefined); } catch { /* a producer's cleanup cannot override the collection result */ }
          }
        } else if (options.captureBatch) {
          let captures: readonly CapturedItem[] = [];
          try { captures = await retry(() => options.captureBatch!(claim.units, { claimId: claim.claimId, signal }), signal); }
          catch (error) { if (error instanceof CollectorInfrastructureError) throw error; if (!stopped()) captures = failAll(claim.units, `The collector failed: ${sentence(error)}`); }
          if (!signal.aborted) await flush(claim.units, captures);
        } else {
          let next = 0;
          await Promise.all(Array.from({ length: Math.min(concurrency, claim.units.length) }, async () => {
            while (next < claim.units.length) {
              if (lost.signal.aborted || due()) break;
              const unit = claim.units[next++]!;
              let captures: readonly CapturedItem[];
              try {
                captures = await retry(() => options.capture!(unit, signal), signal);
                if (options.maxBufferedBytes !== undefined) captures = checkBytes(captures);
              } catch (error) {
                if (error instanceof CollectorInfrastructureError) throw error;
                if (stopped()) break;
                captures = failAll([unit], `The collector failed: ${sentence(error)}`);
              }
              const keys = new Set(unit.items.map(item => item.key));
              await flush([unit], captures.filter(capture => keys.has(capture.item)));
            }
          }));
        }
      }

      if (lost.signal.aborted) {
        held = null;
        units.lost += claim.units.length - collectedInClaim;
        lostClaims.push(claim.claimId);
        options.onEvent?.({ type: 'lost', claimId: claim.claimId, units: claim.units.length - collectedInClaim });
        continue;
      }

      // Whatever is left of the claim (a stop, a bound) goes back to the queue now, not when the lease expires.
      await releaseHeld(claim.claimId);
      held = null;
    } catch (failure) {
      lifetime.abort(failure);
      // A server that stops answering mid-collection ends it with what was done; a held claim is let go of if it can be.
      if (lost.signal.aborted && activeClaim) {
        const count = activeClaim.units.length - collectedInClaim;
        units.lost += count;
        lostClaims.push(activeClaim.claimId);
        options.onEvent?.({ type: 'lost', claimId: activeClaim.claimId, units: count });
        continue;
      }
      if (held) await releaseHeld(held);
      if (failure instanceof CollectorInfrastructureError) {
        if (++infrastructureFailures >= infrastructureFailureLimit) infrastructure.abort(failure);
        continue;
      }
      if (deadline.signal.aborted) { stoppedBy = 'max-minutes'; break; }
      if (options.signal?.aborted) { stoppedBy = 'signal'; break; }
      if (!(failure instanceof AtlasHttpError)) throw failure;
      error = failure.message;
      stoppedBy = 'unreachable';
      break;
    } finally { lifetime.abort(); if (beat !== undefined) clearInterval(beat); if (deadlineTimer !== undefined) clearTimeout(deadlineTimer); }
  }

  return { ok: items.failed === 0 && error === undefined && infrastructureFailures === 0 && !infrastructure.signal.aborted, definition: published.version, shard: options.shard.id, stoppedBy, claims, units, items, lostClaims, layers, ...(diagnostics.length ? { diagnostics } : {}), ...(error ? { error } : {}) };
}

const sizeOf = (picture: { readonly data?: Uint8Array; readonly base64?: string; readonly text?: string } | undefined) =>
  (picture?.data?.byteLength ?? 0) + Math.ceil((picture?.base64?.length ?? 0) * 3 / 4) + (picture?.text?.length ?? 0);

/**
 * Holds a unit's captures to the byte budget. The primary pictures count first, and a unit whose pictures alone pass the
 * budget fails as before. Supplemental attachments are then kept in order while they fit; one that would pass the budget is
 * kept as metadata, omitted `over-budget`, so its absence is explicit and never changes the capture's status.
 */
function withinBudget(captures: readonly CapturedItem[], maxBytes: number): readonly CapturedItem[] {
  let bytes = captures.reduce((sum, capture) => sum + sizeOf(capture.screenshot), 0);
  if (bytes > maxBytes) throw new Error(`Captured unit exceeds maxBufferedBytes (${bytes} > ${maxBytes})`);
  if (!captures.some(capture => capture.attachments?.length)) return captures;
  return captures.map(capture => {
    if (!capture.attachments?.length) return capture;
    const attachments = capture.attachments.map(item => {
      const size = sizeOf(item);
      if (size === 0 || bytes + size <= maxBytes) { bytes += size; return item; }
      const { data: _data, base64: _base64, text: _text, ...kept } = item;
      return { ...kept, omitted: 'over-budget' };
    });
    return { ...capture, attachments };
  });
}

function stateFacts(item: CollectItem): Partial<UiStateCapture> {
  const { id: _id, title: _title, ...facts } = item.state;
  return facts;
}


// Observe late rejections and remove the listener on every path. A callback can keep running,
// but it cannot hand late values back to the collector after cancellation.
async function untilStopped<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  let stop: (() => void) | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      stop = () => { queueMicrotask(() => reject(signal.reason)); };
      if (signal.aborted) stop(); else signal.addEventListener('abort', stop, { once: true });
    })]);
  } finally { if (stop) signal.removeEventListener('abort', stop); }
}
