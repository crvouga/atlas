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

/** How one shard collects. Give `capture` (one unit at a time) or `captureBatch` (a whole claim at once). */
export type CollectOptions = {
  /** The Atlas server, as `httpStore` opens it, with a token that may publish. */
  readonly store: HttpStore;
  /** The definition, as the project wrote it (resolved here) or already resolved. */
  readonly catalog: CatalogDefinition | { readonly version: string; readonly document: UiCatalogDefinitionDocument };
  /** This shard: a name for people, and optionally the dimension values it can collect (`{ deployment: 'development' }`). */
  readonly shard: { readonly id: string; readonly where?: Readonly<Record<string, string | readonly string[]>> };
  /** Units per claim. Default 25. Small batches keep the priority sharp; large ones keep a warm collector busy. */
  readonly batchSize?: number;
  /** The lease of a claim, in seconds; renewed every third of it. Default 120. */
  readonly leaseSeconds?: number;
  /** What retry limits are counted in (a CI run id). Default: the definition version. */
  readonly collection?: string;
  /** Also collect captured items whose result was recorded before this time, oldest first. */
  readonly staleBeforeMs?: number;
  /** Stop claiming after this many units. */
  readonly maxUnits?: number;
  /** Stop claiming after this many milliseconds; a claim still held then is released. */
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
  /** Told what happens, for a log line. */
  readonly onEvent?: (event: CollectEvent) => void;
  readonly now?: () => number;
};

/** What `collectCatalog` tells `onEvent`. */
export type CollectEvent =
  | { readonly type: 'definition'; readonly version: string; readonly created: boolean }
  | { readonly type: 'claim'; readonly claimId: string; readonly units: number }
  | { readonly type: 'published'; readonly claimId: string; readonly items: number; readonly failed: number }
  | { readonly type: 'lost'; readonly claimId: string; readonly units: number }
  | { readonly type: 'released'; readonly claimId: string; readonly units: number };

/** Why a shard stopped: the queue had nothing left for it, a bound, a stop signal, or the server stopped answering. */
export type CollectStop = 'empty' | 'max-units' | 'max-minutes' | 'signal' | 'unreachable';

/** What one shard did. */
export type CollectResult = {
  readonly ok: boolean;
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

function anySignal(signals: readonly (AbortSignal | undefined)[]): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (!signal) continue;
    if (signal.aborted) { controller.abort(signal.reason); break; }
    signal.addEventListener('abort', () => controller.abort(signal.reason), { once: true });
  }
  return controller.signal;
}

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
 * collection goes on; an item the collector returned nothing for is failed too. Throws a `CatalogDefinitionError` for a
 * `where` naming an unknown dimension or value, and an `AtlasHttpError` when the server cannot be reached or refuses
 * the definition, before anything is collected.
 *
 * @example
 * ```ts
 * const result = await collectCatalog({
 *   store: httpStore({ url: process.env.ATLAS_SERVER_URL!, token: process.env.ATLAS_TOKEN }),
 *   catalog, shard: { id: `ci-${process.env.GITHUB_JOB}`, where: { deployment: 'development' } }, batchSize: 25,
 *   capture: async (unit, signal) => Promise.all(unit.items.map(async item => ({ item: item.key, ...(await captureUiState(page, { id: item.state.id, ready })) })))
 * });
 * ```
 */
export async function collectCatalog(options: CollectOptions): Promise<CollectResult> {
  if (!options.capture && !options.captureBatch) throw new Error('collectCatalog needs capture (one unit at a time) or captureBatch (a claim at once)');
  const now = options.now ?? Date.now;
  const started = now();
  const where = options.shard.where ? Object.fromEntries(Object.entries(options.shard.where).map(([name, value]) => [name, typeof value === 'string' ? [value] : [...value]])) : undefined;
  const resolved = 'document' in options.catalog && 'version' in options.catalog ? options.catalog : await resolveCatalog(options.catalog as CatalogDefinition);
  if (where) checkWhere(resolved.document, where);
  const published = await publishCatalogDefinition(options.store, resolved);
  options.onEvent?.({ type: 'definition', version: published.version, created: published.created });
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
    if (options.maxUnits !== undefined && units.claimed >= options.maxUnits) return 'max-units' as const;
    if (options.maxMs !== undefined && now() - started >= options.maxMs) return 'max-minutes' as const;
    return null;
  };

  let error: string | undefined;
  while (!(stoppedBy = due())) {
    let held: string | null = null;
    try {
    const size = Math.min(batchSize, options.maxUnits !== undefined ? options.maxUnits - units.claimed : batchSize);
    const idempotencyKey = randomUUID();
    const response = await options.store.call('POST', '/ui-catalog/claims', {
      accept: [204],
      json: {
        shard: options.shard.id, definition: published.version, batchSize: size, leaseSeconds, idempotencyKey,
        ...(where ? { where } : {}), ...(options.collection ? { collection: options.collection } : {}), ...(options.staleBeforeMs !== undefined ? { staleBeforeMs: options.staleBeforeMs } : {})
      }
    });
    if (response.status === 204) { await response.body?.cancel(); stoppedBy = 'empty'; break; }
    const claim = await response.json() as UiClaim;
    held = claim.claimId;
    claims++;
    units.claimed += claim.units.length;
    options.onEvent?.({ type: 'claim', claimId: claim.claimId, units: claim.units.length });

    // The claim is held while the collector works: renewed every third of its lease, and lost on a 410.
    const lost = new AbortController();
    const beat = setInterval(() => {
      void options.store.call('POST', `/ui-catalog/claims/${claim.claimId}/heartbeat`, { accept: [410] }).then(async answer => {
        if (answer.status === 410) { await answer.body?.cancel(); lost.abort(new Error('The claim was lost: its lease expired or the server took it back')); } else await answer.body?.cancel();
      }, () => { /* the next beat tries again; the server expires the claim if none arrives */ });
    }, Math.max(1000, (leaseSeconds * 1000) / 3));
    const signal = anySignal([lost.signal, options.signal]);
    const captured: CapturedItem[] = [];
    let collected = 0;
    try {
      const failAll = (list: readonly CollectUnit[], reason: string) => list.flatMap(unit => unit.items.map(item => ({ item: item.key, status: 'failed' as const, detail: reason })));
      // A collector stopped by the shard's own stop signal did not fail: its unit goes back to the queue instead.
      const stopped = () => lost.signal.aborted || options.signal?.aborted === true;
      if (options.captureBatch) {
        try { captured.push(...await options.captureBatch(claim.units, { claimId: claim.claimId, signal })); collected = claim.units.length; }
        catch (error) { if (!stopped()) { captured.push(...failAll(claim.units, `The collector failed: ${sentence(error)}`)); collected = claim.units.length; } }
      } else {
        for (const unit of claim.units) {
          if (lost.signal.aborted || due()) break;
          try { captured.push(...await options.capture!(unit, signal)); }
          catch (error) {
            if (stopped()) break;
            captured.push(...failAll([unit], `The collector failed: ${sentence(error)}`));
          }
          collected++;
        }
      }
    } finally { clearInterval(beat); }

    if (lost.signal.aborted) {
      units.lost += claim.units.length;
      lostClaims.push(claim.claimId);
      options.onEvent?.({ type: 'lost', claimId: claim.claimId, units: claim.units.length });
      continue;
    }

    // Every item of a collected unit gets a result: what the collector returned, or a failure saying it returned nothing.
    const byKey = new Map(captured.map(capture => [capture.item, capture]));
    const done = claim.units.slice(0, collected);
    const perProfile = new Map<string, { item: CollectItem; capture: UiStateCapture }[]>();
    for (const unit of done) for (const item of unit.items) {
      const given = byKey.get(item.key);
      const { item: _key, ...rest } = given ?? { item: item.key, status: 'failed' as const, detail: 'The collector returned no capture for this item' };
      const capture: UiStateCapture = { title: item.state.title ?? item.state.id, ...stateFacts(item), ...rest, id: item.state.id, labels: { ...rest.labels, [UI_CLAIM_LABEL]: claim.claimId } };
      const status = capture.status ?? 'passed';
      if (status === 'passed') items.captured++; else if (status === 'failed') items.failed++; else items.other++;
      const list = perProfile.get(item.profile.key);
      if (list) list.push({ item, capture }); else perProfile.set(item.profile.key, [{ item, capture }]);
    }
    for (const entries of perProfile.values()) {
      const profile = entries[0]!.item.profile;
      await publishChecks(options.store, uiStateLayer({
        producer, recordedAtMs: now(), ...(profile.environment ? { environment: profile.environment } : {}), profile: profile.parameters, shard: options.shard.id,
        ...(options.origin?.sha !== undefined ? { sha: options.origin.sha } : {}), ...(options.origin?.branch !== undefined ? { branch: options.origin.branch } : {}),
        ...(options.origin?.runUrl !== undefined ? { runUrl: options.origin.runUrl } : {}), ...(options.origin?.run ? { run: options.origin.run } : {}),
        states: entries.map(entry => entry.capture)
      }));
      layers++;
    }
    units.collected += done.length;
    options.onEvent?.({ type: 'published', claimId: claim.claimId, items: [...perProfile.values()].reduce((sum, list) => sum + list.length, 0), failed: items.failed });

    // Whatever is left of the claim (a stop, a bound) goes back to the queue now, not when the lease expires.
    const release = await options.store.call('DELETE', `/ui-catalog/claims/${claim.claimId}`, { accept: [410] }).catch(() => null);
    if (release?.status === 200) {
      const body = await release.json() as { released?: number };
      units.released += body.released ?? 0;
      if (body.released) options.onEvent?.({ type: 'released', claimId: claim.claimId, units: body.released });
    } else await release?.body?.cancel();
    held = null;
    } catch (failure) {
      // A server that stops answering mid-collection ends it with what was done; a held claim is let go of if it can be.
      if (!(failure instanceof AtlasHttpError)) throw failure;
      error = failure.message;
      if (held) await options.store.call('DELETE', `/ui-catalog/claims/${held}`, { accept: [410] }).then(answer => answer.body?.cancel(), () => undefined);
      stoppedBy = 'unreachable';
      break;
    }
  }

  return { ok: items.failed === 0 && error === undefined, definition: published.version, shard: options.shard.id, stoppedBy, claims, units, items, lostClaims, layers, ...(error ? { error } : {}) };
}

function stateFacts(item: CollectItem): Partial<UiStateCapture> {
  const { id: _id, title: _title, ...facts } = item.state;
  return facts;
}

