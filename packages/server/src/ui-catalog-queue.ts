/**
 * @module UI catalog collection queue
 *
 * The server side of a claimable priority queue for collecting a UI catalog across shards that know nothing about each
 * other. A project publishes a definition (`PUT /api/ui-catalog/definitions/{version}`): it is stored, content-addressed,
 * and written as ordinary `ui-plan` layers, so the catalog expects every item. A shard asks for work
 * (`POST /api/ui-catalog/claims`) and receives the most urgent units ({@link ../../reports/src/ui-catalog-queue}) under a
 * lease it renews by heartbeat and releases when done. Results still arrive as ordinary `ui-state` layers; a capture
 * labelled with its claim id closes that unit of the claim.
 *
 * Claims live in this process and in one JSON document in the server's store (`server/ui-catalog/queue.json`, in S3 like
 * every other piece of server state), written before a claim is answered. Every change is made under one lock, so no
 * unit is ever held by two live claims. After a restart the claims are restored with their leases; those that lapsed
 * meanwhile expire, and their units go back to the queue. One node serves a project's queue.
 *
 * @see docs/ui-catalog.md#collecting-with-a-queue
 */
import { createHash, randomUUID } from 'node:crypto';

import type { Context, Hono } from 'hono';
import { z } from 'zod/v4';

import type { EffectiveEvidence } from '../../reports/src/report-index';
import type { ObjectStore } from '../../reports/src/object-store';
import { readUtf8, writeUtf8 } from '../../reports/src/object-io';
import type { PublishChecksInput } from '../../schema/src/layer';
import { catalogPlanLayers, catalogVersion, CatalogDefinitionError, checkWhere, expandCatalog, type ExpandedCatalog } from '../../reports/src/ui-catalog-definition';
import { claimedItem, latestUiResults, pickUnits, rankUnits, tierOf, unitFingerprint, type RankedUnit, type UiItemResult } from '../../reports/src/ui-catalog-queue';
import { UiCatalogDefinitionSchema, UiClaimRequestSchema, UI_CATALOG_QUEUE_VERSION, type UiCatalogDefinitionDocument, type UiClaim, type UiQueueSummary, type UiQueueTier } from '../../schema/src/ui-catalog-queue';
import type { Auth } from './auth';
import { problemResponse } from './problem';
import { readLimited } from './store-api';
import { Refusal } from './validate';

const PREFIX = 'server/ui-catalog/';
const STATE_KEY = `${PREFIX}queue.json`;
const definitionKey = (version: string) => `${PREFIX}definitions/${version}.json`;
const MAX_CLAIMS = 10_000;
const MAX_ENDED = 1000;
const MAX_SHARDS = 1000;
const MAX_COLLECTIONS = 16;
const THROUGHPUT_MS = 10 * 60_000;

/** A refused queue request: 403 another shard's claim, 404 an unknown definition, 410 a claim that ended, 422 a bad request, 429 too many claims. */
export class CatalogQueueError extends Error {
  constructor(readonly status: 403 | 404 | 409 | 410 | 422 | 429, message: string) { super(message); }
}

type Claim = {
  id: string; owner: string; shard: string; definition: string; collection: string; createdAtMs: number; expiresAtMs: number; leaseSeconds: number;
  units: string[]; done: string[]; tiers: Record<string, UiQueueTier>; idempotencyKey?: string;
};
type Ended = { id: string; owner: string; idempotencyKey?: string; reason: 'completed' | 'released' | 'expired'; endedAtMs: number };
type Shard = { lastSeenAtMs: number; units: number; done: number; failed: number; lastOutcome: 'claimed' | 'completed' | 'released' | 'expired' };
type Persisted = {
  schemaVersion: 1; latest: string | null; claims: Claim[]; ended: Ended[];
  attempts: Record<string, Record<string, number>>; abandoned: Record<string, string>; shards: Record<string, Shard>; finished: number[];
};

/** What the queue needs from the server around it. */
export type CatalogQueueOptions = {
  /** Where definitions and the queue document are kept: the server's store, scoped to the project. */
  readonly store: ObjectStore;
  /** The report as it stands, to read results from. */
  readonly snapshot: () => EffectiveEvidence;
  /** Publish a definition's plan layers into the report. */
  readonly publishPlan: (layers: readonly PublishChecksInput[]) => Promise<void>;
  readonly now?: () => number;
};

/**
 * One project's collection queue. Every method waits for the stored state to be restored, and every change is made under
 * one lock and stored before it is answered.
 *
 * @example
 * ```ts
 * const queue = new CatalogQueue({ store, snapshot: () => index.snapshot(), publishPlan: async layers => { ... } });
 * const claim = await queue.claim({ shard: 'ci-1', definition: version, batchSize: 25 }, owner);
 * ```
 */
export class CatalogQueue {
  /** Resolves once the stored state is read; rejects when the store cannot be read (each request then retries). */
  readonly ready: Promise<void>;
  private readonly now: () => number;
  private state: Persisted = { schemaVersion: 1, latest: null, claims: [], ended: [], attempts: {}, abandoned: {}, shards: {}, finished: [] };
  private readonly claims = new Map<string, Claim>();
  private readonly held = new Map<string, string>();
  private readonly definitions = new Map<string, Promise<ExpandedCatalog | null>>();
  private readonly unitIndex = new WeakMap<ExpandedCatalog, Map<string, number>>();
  private results: { version: string; map: Map<string, UiItemResult>; incomplete: boolean; notices: readonly string[] } | null = null;
  private ranked: { key: string; value: RankedUnit[] } | null = null;
  private abandonedRev = 0;
  private lock: Promise<unknown> = Promise.resolve();
  private revision = 0;
  private persisted = 0;
  private writing: Promise<void> | null = null;

  constructor(private readonly options: CatalogQueueOptions) {
    this.now = options.now ?? Date.now;
    this.ready = this.restore();
    void this.ready.catch(() => undefined);
  }

  private async restore(): Promise<void> {
    const text = await readUtf8(this.options.store, STATE_KEY);
    if (text === null) return;
    const stored = JSON.parse(text) as Partial<Persisted>;
    this.state = { ...this.state, ...stored, claims: [], ended: stored.ended ?? [] };
    for (const claim of stored.claims ?? []) {
      this.claims.set(claim.id, claim);
      for (const unit of claim.units) if (!claim.done.includes(unit)) this.held.set(unit, claim.id);
    }
  }

  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const run = this.lock.then(work, work);
    this.lock = run.catch(() => undefined);
    return run;
  }

  /** Make a change under the lock, then store it (whether or not the change was refused, since reconciling may have changed something). */
  private async change<T>(work: () => Promise<T>): Promise<T> {
    try { return await this.exclusive(work); } finally { await this.persist(); }
  }

  /** Resolves once a write that includes every change made so far is stored. Writes in flight are shared. */
  private async persist(): Promise<void> {
    const wanted = ++this.revision;
    while (this.persisted < wanted) {
      this.writing ??= (async () => {
        const at = this.revision;
        try {
          const document: Persisted = { ...this.state, claims: [...this.claims.values()] };
          await writeUtf8(this.options.store, STATE_KEY, JSON.stringify(document), 'application/json');
          this.persisted = at;
        } finally { this.writing = null; }
      })();
      await this.writing;
    }
  }

  /** A stored definition, expanded, or null when none has that version. */
  private expanded(version: string): Promise<ExpandedCatalog | null> {
    let found = this.definitions.get(version);
    if (!found) {
      found = (async () => {
        const text = await readUtf8(this.options.store, definitionKey(version));
        return text === null ? null : expandCatalog(UiCatalogDefinitionSchema.parse(JSON.parse(text)), version);
      })();
      found.catch(() => this.definitions.delete(version));
      this.definitions.set(version, found);
      if (this.definitions.size > 4) this.definitions.delete(this.definitions.keys().next().value!);
    }
    return found;
  }

  private indexOf(expanded: ExpandedCatalog, unit: string): number | undefined {
    let map = this.unitIndex.get(expanded);
    if (!map) { map = new Map(expanded.units.map((item, i) => [item.key, i])); this.unitIndex.set(expanded, map); }
    return map.get(unit);
  }

  private currentResults() {
    const snapshot = this.options.snapshot();
    if (this.results?.version !== snapshot.version) {
      this.results = { version: snapshot.version, map: latestUiResults(snapshot.layers), incomplete: snapshot.notices.length > 0 || snapshot.backends.some(backend => !backend.available), notices: snapshot.notices };
    }
    return this.results;
  }

  private rankOf(expanded: ExpandedCatalog): RankedUnit[] {
    const results = this.currentResults();
    const key = `${expanded.version}|${results.version}|${this.abandonedRev}`;
    if (this.ranked?.key !== key) {
      this.ranked = { key, value: rankUnits(expanded, results.map, { incomplete: results.incomplete, abandoned: new Map(Object.entries(this.state.abandoned)) }) };
    }
    return this.ranked.value;
  }

  private shard(name: string): Shard {
    let shard = this.state.shards[name];
    if (!shard) {
      shard = this.state.shards[name] = { lastSeenAtMs: this.now(), units: 0, done: 0, failed: 0, lastOutcome: 'claimed' };
      const names = Object.keys(this.state.shards);
      if (names.length > MAX_SHARDS) {
        const oldest = names.filter(item => item !== name).sort((a, b) => this.state.shards[a]!.lastSeenAtMs - this.state.shards[b]!.lastSeenAtMs)[0]!;
        delete this.state.shards[oldest];
      }
    }
    return shard;
  }

  private attemptsOf(collection: string): Record<string, number> {
    if (!this.state.attempts[collection]) {
      this.state.attempts[collection] = {};
      const names = Object.keys(this.state.attempts);
      if (names.length > MAX_COLLECTIONS) delete this.state.attempts[names[0]!];
    }
    return this.state.attempts[collection]!;
  }

  private end(claim: Claim, reason: Ended['reason'], expanded: ExpandedCatalog | null): number {
    let released = 0;
    const results = this.currentResults().map;
    for (const unit of claim.units) {
      if (claim.done.includes(unit)) continue;
      if (this.held.get(unit) === claim.id) this.held.delete(unit);
      released++;
      // A unit let go of without a result goes back as empty, until any of its items records something new.
      const index = expanded ? this.indexOf(expanded, unit) : undefined;
      if (expanded && index !== undefined) { this.state.abandoned[unit] = unitFingerprint(expanded, index, results); this.abandonedRev++; }
    }
    this.claims.delete(claim.id);
    this.state.ended.push({ id: claim.id, owner: claim.owner, ...(claim.idempotencyKey ? { idempotencyKey: claim.idempotencyKey } : {}), reason, endedAtMs: this.now() });
    if (this.state.ended.length > MAX_ENDED) this.state.ended.splice(0, this.state.ended.length - MAX_ENDED);
    const shard = this.shard(claim.shard);
    shard.lastOutcome = reason;
    if (reason !== 'expired') shard.lastSeenAtMs = this.now();
    return released;
  }

  /** Close the units whose every item has a result labelled with the claim, count failures, and expire lapsed claims. Returns whether anything changed. */
  private async reconcile(): Promise<boolean> {
    // Without a claim there is nothing to close, so the results are not read at all.
    if (!this.claims.size) return false;
    let changed = false;
    const results = this.currentResults().map;
    const now = this.now();
    for (const claim of [...this.claims.values()]) {
      const expanded = await this.expanded(claim.definition).catch(() => null);
      if (claim.expiresAtMs <= now) { this.end(claim, 'expired', expanded); changed = true; continue; }
      if (!expanded) continue;
      const shard = this.shard(claim.shard);
      for (const unit of claim.units) {
        if (claim.done.includes(unit)) continue;
        const index = this.indexOf(expanded, unit);
        if (index === undefined) continue;
        const items = expanded.units[index]!.items.map(i => results.get(expanded.items[i]!.key));
        if (!items.every(result => result?.claim === claim.id)) continue;
        claim.done.push(unit);
        if (this.held.get(unit) === claim.id) this.held.delete(unit);
        const attempts = this.attemptsOf(claim.collection);
        if (items.some(result => result!.status === 'failed')) { attempts[unit] = (attempts[unit] ?? 0) + 1; shard.failed++; } else delete attempts[unit];
        shard.done++;
        this.state.finished.push(now);
        changed = true;
      }
      if (claim.done.length === claim.units.length) { this.end(claim, 'completed', expanded); changed = true; }
    }
    const horizon = now - THROUGHPUT_MS;
    const stale = this.state.finished.findIndex(at => at >= horizon);
    if (stale !== 0) { this.state.finished.splice(0, stale < 0 ? this.state.finished.length : stale); }
    if (this.state.finished.length > 100_000) this.state.finished.splice(0, this.state.finished.length - 100_000);
    return changed;
  }

  /**
   * Store a definition and publish it as plan layers. The version must be the SHA-256 of the canonical document. Publishing
   * the definition that is already the latest changes nothing; publishing another stored one makes it the latest again and
   * publishes its plan anew. Throws a {@link CatalogQueueError} (422) for a document that cannot be used.
   */
  async publish(input: unknown, version: string): Promise<{ readonly version: string; readonly created: boolean; readonly latest: boolean; readonly profiles: number; readonly items: number; readonly units: number; readonly layers: number }> {
    await this.ready;
    const parsed = UiCatalogDefinitionSchema.safeParse(input);
    if (!parsed.success) throw new CatalogQueueError(422, `The definition is not valid: ${parsed.error.issues.slice(0, 3).map(issue => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ')}`);
    const computed = await catalogVersion(parsed.data);
    if (computed !== version) throw new CatalogQueueError(422, `The version of a definition is the SHA-256 of its canonical JSON: this one is ${computed}, not ${version}`);
    let expanded: ExpandedCatalog;
    try { expanded = expandCatalog(parsed.data, version); } catch (error) {
      if (error instanceof CatalogDefinitionError) throw new CatalogQueueError(422, error.message);
      throw error;
    }
    return this.exclusive(async () => {
      const counts = { version, profiles: expanded.profiles.length, items: expanded.items.length, units: expanded.units.length };
      if (this.state.latest === version) return { ...counts, created: false, latest: true, layers: 0 };
      const stored = await this.options.store.head(definitionKey(version));
      if (!stored) await writeUtf8(this.options.store, definitionKey(version), JSON.stringify(parsed.data), 'application/json');
      this.definitions.set(version, Promise.resolve(expanded));
      const layers = catalogPlanLayers(expanded, this.now());
      await this.options.publishPlan(layers);
      this.state.latest = version;
      await this.persist();
      return { ...counts, created: !stored, latest: true, layers: layers.length };
    });
  }

  /** A stored definition document, or null. */
  async definition(version: string): Promise<UiCatalogDefinitionDocument | null> {
    await this.ready;
    return (await this.expanded(version))?.document ?? null;
  }

  /**
   * Hand out the most urgent units of a definition that no live claim holds, match `where` and are below the retry limit,
   * or null when there are none. A request repeated with the same idempotency key answers the same claim; once that claim
   * has ended, a {@link CatalogQueueError} 410. Throws 404 for an unknown definition and 422 for an unknown dimension or value.
   */
  async claim(input: z.input<typeof UiClaimRequestSchema>, owner: string): Promise<UiClaim | null> {
    await this.ready;
    const request = UiClaimRequestSchema.parse(input);
    const expanded = await this.expanded(request.definition);
    if (!expanded) throw new CatalogQueueError(404, `No definition ${request.definition} has been published. Publish it first (PUT /api/ui-catalog/definitions/{version}).`);
    if (request.where) {
      try { checkWhere(expanded.document, request.where, 'where'); } catch (error) {
        if (error instanceof CatalogDefinitionError) throw new CatalogQueueError(422, error.message);
        throw error;
      }
    }
    const answer = await this.change(async () => {
      if (request.idempotencyKey) {
        const live = [...this.claims.values()].find(claim => claim.owner === owner && claim.idempotencyKey === request.idempotencyKey);
        if (live) return { claim: live, fresh: false };
        const ended = this.state.ended.find(claim => claim.owner === owner && claim.idempotencyKey === request.idempotencyKey);
        if (ended) throw new CatalogQueueError(410, `The claim ${ended.id} made with this idempotency key has ended (${ended.reason}). Claim again with a new key.`);
      }
      await this.reconcile();
      if (this.claims.size >= MAX_CLAIMS) throw new CatalogQueueError(429, `There are ${MAX_CLAIMS} live claims; retry when some end.`);
      const collection = request.collection ?? request.definition;
      const attempts = this.state.attempts[collection] ?? {};
      const max = expanded.document.options.maxAttempts;
      const staleAfter = expanded.document.options.staleAfterMs;
      const staleBeforeMs = request.staleBeforeMs ?? (staleAfter !== undefined ? this.now() - staleAfter : undefined);
      const picked = pickUnits(expanded, this.rankOf(expanded), {
        batchSize: request.batchSize, ...(staleBeforeMs !== undefined ? { staleBeforeMs } : {}), ...(request.where ? { where: request.where } : {}),
        skip: unit => { const key = expanded.units[unit]!.key; return this.held.has(key) || (attempts[key] ?? 0) >= max; }
      });
      const shard = this.shard(request.shard);
      shard.lastSeenAtMs = this.now();
      if (!picked.length) return null;
      const now = this.now();
      const claim: Claim = {
        id: randomUUID(), owner, shard: request.shard, definition: request.definition, collection, createdAtMs: now, expiresAtMs: now + request.leaseSeconds * 1000, leaseSeconds: request.leaseSeconds,
        units: picked.map(entry => expanded.units[entry.unit]!.key), done: [], tiers: Object.fromEntries(picked.map(entry => [expanded.units[entry.unit]!.key, entry.tier])),
        ...(request.idempotencyKey ? { idempotencyKey: request.idempotencyKey } : {})
      };
      for (const unit of claim.units) {
        this.held.set(unit, claim.id);
        if (unit in this.state.abandoned) { delete this.state.abandoned[unit]; this.abandonedRev++; }
      }
      this.claims.set(claim.id, claim);
      shard.units += claim.units.length;
      shard.lastOutcome = 'claimed';
      return { claim, fresh: true };
    });
    if (!answer) return null;
    return this.document(answer.claim, expanded);
  }

  private document(claim: Claim, expanded: ExpandedCatalog): UiClaim {
    return {
      schemaVersion: UI_CATALOG_QUEUE_VERSION, claimId: claim.id, shard: claim.shard, definition: claim.definition, collection: claim.collection,
      createdAtMs: claim.createdAtMs, expiresAtMs: claim.expiresAtMs, leaseSeconds: claim.leaseSeconds,
      units: claim.units.map(key => {
        const index = this.indexOf(expanded, key)!;
        return { key, tier: claim.tiers[key] ?? 'empty', items: expanded.units[index]!.items.map(i => claimedItem(expanded, i)) };
      })
    };
  }

  private live(id: string, owner: string): Claim {
    const claim = this.claims.get(id);
    if (!claim) {
      const ended = this.state.ended.find(item => item.id === id);
      throw new CatalogQueueError(410, ended ? `The claim ended (${ended.reason}); its unfinished units are back in the queue.` : 'No live claim has that id; it may have expired. Claim again.');
    }
    if (claim.owner !== owner) throw new CatalogQueueError(403, 'This claim belongs to another publisher.');
    return claim;
  }

  /** Extend a live claim's lease by its length. Throws {@link CatalogQueueError} 410 once it expired or ended, 403 for another publisher's claim. */
  async heartbeat(id: string, owner: string): Promise<{ readonly expiresAtMs: number; readonly done: number; readonly units: number }> {
    await this.ready;
    const claim = await this.change(async () => {
      await this.reconcile();
      const found = this.live(id, owner);
      found.expiresAtMs = this.now() + found.leaseSeconds * 1000;
      this.shard(found.shard).lastSeenAtMs = this.now();
      return found;
    });
    return { expiresAtMs: claim.expiresAtMs, done: claim.done.length, units: claim.units.length };
  }

  /** Release a claim: units without a result go back to the queue at once, as empty. Throws {@link CatalogQueueError} 410 when it already ended. */
  async release(id: string, owner: string): Promise<{ readonly released: number; readonly done: number }> {
    await this.ready;
    return this.change(async () => {
      await this.reconcile();
      const claim = this.live(id, owner);
      const done = claim.done.length;
      return { released: this.end(claim, 'released', await this.expanded(claim.definition).catch(() => null)), done };
    });
  }

  /** Whether any claim is live: without one, a change to the report has nothing to close. */
  get active(): boolean {
    return this.claims.size > 0;
  }

  /** Expire lapsed claims and close answered units. Called on a timer and when the report changes. */
  async sweep(): Promise<void> {
    await this.ready;
    const changed = await this.exclusive(() => this.reconcile());
    if (changed) await this.persist();
  }

  /** What is left to collect of a definition (default the latest published), who holds what, and how fast it goes. */
  async summary(version?: string): Promise<UiQueueSummary> {
    await this.ready;
    await this.sweep();
    const now = this.now();
    const chosen = version ?? this.state.latest;
    const expanded = chosen ? await this.expanded(chosen) : null;
    if (version && !expanded) throw new CatalogQueueError(404, `No definition ${version} has been published.`);
    const tiers: Record<UiQueueTier, number> = { failed: 0, empty: 0, unknown: 0, stale: 0, fresh: 0 };
    const unknown: string[] = [];
    let held = 0, requeued = 0, unknownCount = 0;
    const exhausted: UiQueueSummary['exhausted'] = [];
    if (expanded) {
      const staleAfter = expanded.document.options.staleAfterMs;
      const max = expanded.document.options.maxAttempts;
      const isExhausted = (key: string) => Object.values(this.state.attempts).some(attempts => (attempts[key] ?? 0) >= max);
      for (const entry of this.rankOf(expanded)) {
        const key = expanded.units[entry.unit]!.key;
        if (this.held.has(key)) { held++; continue; }
        const tier = tierOf(entry, staleAfter !== undefined ? now - staleAfter : undefined);
        tiers[tier]++;
        if (tier === 'unknown') { unknownCount++; if (unknown.length < 50) unknown.push(key); }
        if (tier === 'failed' && !isExhausted(key)) requeued++;
      }
      for (const [collection, attempts] of Object.entries(this.state.attempts)) {
        for (const [unit, count] of Object.entries(attempts)) if (count >= max && exhausted.length < 100 && this.indexOf(expanded, unit) !== undefined) exhausted.push({ unit, attempts: count, collection });
      }
    }
    const live = [...this.claims.values()];
    const due = tiers.failed + tiers.empty + tiers.unknown + tiers.stale;
    const unitsPerMinute = this.state.finished.filter(at => at >= now - THROUGHPUT_MS).length / (THROUGHPUT_MS / 60_000);
    return {
      schemaVersion: UI_CATALOG_QUEUE_VERSION,
      definition: expanded ? { version: expanded.version, name: expanded.document.name, states: expanded.document.states.length, profiles: expanded.profiles.length, items: expanded.items.length, units: expanded.units.length } : null,
      tiers, held, exhausted, requeued,
      unknown: { count: unknownCount, units: unknown, notices: [...(this.results?.notices ?? [])] },
      claims: live.sort((a, b) => a.createdAtMs - b.createdAtMs || (a.id < b.id ? -1 : 1)).slice(0, 500).map(claim => ({ claimId: claim.id, shard: claim.shard, units: claim.units.length, done: claim.done.length, createdAtMs: claim.createdAtMs, expiresAtMs: claim.expiresAtMs, ageMs: now - claim.createdAtMs })),
      shards: Object.entries(this.state.shards).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([shard, info]) => {
        const holding = live.filter(claim => claim.shard === shard);
        return { shard, status: holding.length ? 'active' as const : info.lastOutcome === 'expired' ? 'lost' as const : 'idle' as const, claims: holding.length, units: info.units, done: info.done, failed: info.failed, lastSeenAtMs: info.lastSeenAtMs };
      }),
      throughput: { unitsPerMinute, etaMs: unitsPerMinute > 0 ? Math.round((due / unitsPerMinute) * 60_000) : null },
      time: now
    };
  }
}

/** What the queue routes need from the server around them. */
export type CatalogQueueDeps = {
  readonly queue: CatalogQueue;
  readonly auth: Auth;
  /** Is the report read yet? Claims wait for it, because the order depends on it. */
  readonly ready: () => boolean;
  readonly maxBytes: number;
  readonly unauthorized: (verdict: Extract<ReturnType<Auth['check']>, { ok: false }>) => Response;
};

const NO_STORE = { 'cache-control': 'no-store' };
const VERSION = /^[a-f0-9]{64}$/;

/**
 * Registers the collection queue routes on `app`: `PUT` and `GET /api/ui-catalog/definitions/:version`,
 * `POST /api/ui-catalog/claims`, `POST /api/ui-catalog/claims/:id/heartbeat`, `DELETE /api/ui-catalog/claims/:id` and
 * `GET /api/ui-catalog/queue`. Changes need a Bearer token with the `publish` role; reading needs a reader.
 */
export function mountCatalogQueue(app: Hono, deps: CatalogQueueDeps): void {
  const { queue, auth } = deps;
  const ownerOf = (c: Context) => createHash('sha256').update(c.req.header('authorization') ?? 'open').digest('hex');
  const notReady = () => problemResponse(503, 'Atlas is still reading its backends; try again in a moment.', { 'retry-after': '1' });
  const failed = (error: unknown) => {
    if (error instanceof CatalogQueueError || error instanceof Refusal) return problemResponse(error.status, error.message);
    throw error;
  };
  const body = async (c: Context): Promise<unknown> => {
    const bytes = await readLimited(c.req.raw, deps.maxBytes);
    try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new CatalogQueueError(422, 'The body is not JSON.'); }
  };

  app.put('/api/ui-catalog/definitions/:version', async c => {
    const verdict = auth.check(c.req.raw, 'publish');
    if (!verdict.ok) return deps.unauthorized(verdict);
    const version = c.req.param('version');
    if (!VERSION.test(version)) return problemResponse(422, 'A definition version is 64 lowercase hex digits: the SHA-256 of its canonical JSON.');
    if (!deps.ready()) return notReady();
    try {
      const published = await queue.publish(await body(c), version);
      return c.json(published, published.created ? 201 : 200, NO_STORE);
    } catch (error) { return failed(error); }
  });
  app.get('/api/ui-catalog/definitions/:version', async c => {
    const version = c.req.param('version');
    if (!VERSION.test(version)) return problemResponse(422, 'A definition version is 64 lowercase hex digits.');
    const document = await queue.definition(version);
    if (!document) return problemResponse(404, 'No definition has that version.');
    return c.json(document, 200, { 'cache-control': 'private, max-age=31536000, immutable' });
  });
  app.post('/api/ui-catalog/claims', async c => {
    const verdict = auth.check(c.req.raw, 'publish');
    if (!verdict.ok) return deps.unauthorized(verdict);
    if (!deps.ready()) return notReady();
    try {
      const input = await body(c);
      const header = c.req.header('idempotency-key');
      const parsed = UiClaimRequestSchema.safeParse(header && input && typeof input === 'object' && !('idempotencyKey' in input) ? { ...input, idempotencyKey: header } : input);
      if (!parsed.success) return problemResponse(422, parsed.error.issues.slice(0, 3).map(issue => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; '));
      const claim = await queue.claim(parsed.data, ownerOf(c));
      return claim ? c.json(claim, 200, NO_STORE) : new Response(null, { status: 204, headers: NO_STORE });
    } catch (error) { return failed(error); }
  });
  app.post('/api/ui-catalog/claims/:id/heartbeat', async c => {
    const verdict = auth.check(c.req.raw, 'publish');
    if (!verdict.ok) return deps.unauthorized(verdict);
    try { return c.json(await queue.heartbeat(c.req.param('id'), ownerOf(c)), 200, NO_STORE); } catch (error) { return failed(error); }
  });
  app.delete('/api/ui-catalog/claims/:id', async c => {
    const verdict = auth.check(c.req.raw, 'publish');
    if (!verdict.ok) return deps.unauthorized(verdict);
    try { return c.json(await queue.release(c.req.param('id'), ownerOf(c)), 200, NO_STORE); } catch (error) { return failed(error); }
  });
  app.get('/api/ui-catalog/queue', async c => {
    if (!deps.ready()) return notReady();
    const version = c.req.query('definition');
    if (version !== undefined && !VERSION.test(version)) return problemResponse(422, 'A definition version is 64 lowercase hex digits.');
    try { return c.json(await queue.summary(version), 200, NO_STORE); } catch (error) { return failed(error); }
  });
}
