/**
 * @module UI catalog refreshes
 *
 * The server side of a refresh receipt ({@link ../../schema/src/ui-catalog-refresh}): one run of collecting a UI catalog,
 * pinned to a definition version, an optional source, the profiles in scope, a freshness cutoff and a collection id. A
 * receipt is one JSON document in the server's store (`server/ui-catalog/refreshes/<id>.json`, in S3 like every other piece
 * of server state). Beginning the same refresh again joins it; attempts (a CI job and its rerun) join under their own names.
 *
 * Its status is computed, never stored: it reads the queue's own view ({@link CatalogQueue.progress}): which units live
 * claims hold, how often each failed within the refresh's collection, and the newest result of every item. It then judges
 * every unit in scope against the refresh's policy. Capture completeness (`outcome`) is kept apart from worker health
 * (`health`): a refresh can be complete with a lost worker, and incomplete with every worker healthy.
 *
 * @see docs/ui-catalog.md#refreshes-finalizing-a-collection
 */
import type { Context, Hono } from 'hono';

import type { ObjectStore } from '../../reports/src/object-store';
import { readUtf8, writeUtf8 } from '../../reports/src/object-io';
import { unitMatches } from '../../reports/src/ui-catalog-definition';
import { refreshShard } from '../../reports/src/ui-catalog-refresh';
import {
  UiRefreshIdSchema, UiRefreshJoinSchema, UiRefreshReceiptSchema, UiRefreshRequestSchema, UI_CATALOG_REFRESH_VERSION,
  type UiRefreshOutcome, type UiRefreshReceipt, type UiRefreshStatus
} from '../../schema/src/ui-catalog-refresh';
import type { Auth } from './auth';
import { problemResponse } from './problem';
import { readLimited } from './store-api';
import { CatalogQueueError, type CatalogQueue } from './ui-catalog-queue';
import { Refusal } from './validate';

const PREFIX = 'server/ui-catalog/refreshes/';
const MAX_ATTEMPTS = 1000;
const MAX_FINALIZATIONS = 100;
const MAX_OUTSTANDING = 200;

type Reason = UiRefreshStatus['outstanding'][number]['reason'];
/** Outstanding units, most in need of a person first. */
const ORDER: readonly Reason[] = ['exhausted', 'source', 'unknown', 'failed', 'held', 'pending', 'stale'];

const equalJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const sortedWhere = (where: Readonly<Record<string, readonly string[]>> | undefined | null) =>
  where && Object.keys(where).length ? Object.fromEntries(Object.entries(where).sort(([a], [b]) => (a < b ? -1 : 1)).map(([name, values]) => [name, [...values].sort()])) : null;

/**
 * One project's refresh receipts. Every change is made under one lock and stored before it is answered.
 *
 * @example
 * ```ts
 * const refreshes = new CatalogRefreshes({ store, queue });
 * await refreshes.begin('run-42', { definition: version, staleBeforeMs: Date.now() });
 * const status = await refreshes.status('run-42');
 * ```
 */
export class CatalogRefreshes {
  private lock: Promise<unknown> = Promise.resolve();
  private readonly now: () => number;

  constructor(private readonly options: { readonly store: ObjectStore; readonly queue: CatalogQueue; readonly now?: () => number }) {
    this.now = options.now ?? Date.now;
  }

  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const run = this.lock.then(work, work);
    this.lock = run.catch(() => undefined);
    return run;
  }

  private key(id: string): string {
    const parsed = UiRefreshIdSchema.safeParse(id);
    if (!parsed.success) throw new CatalogQueueError(422, parsed.error.issues[0]!.message);
    return `${PREFIX}${id}.json`;
  }

  /** The stored receipt, or null when none has that id. Throws when the store cannot be read or the receipt is not one. */
  async receipt(id: string): Promise<UiRefreshReceipt | null> {
    const text = await readUtf8(this.options.store, this.key(id));
    return text === null ? null : UiRefreshReceiptSchema.parse(JSON.parse(text));
  }

  private async save(receipt: UiRefreshReceipt): Promise<void> {
    await writeUtf8(this.options.store, this.key(receipt.id), JSON.stringify(receipt), 'application/json');
  }

  /**
   * Begin a refresh, or join it when it exists. A repeated begin may leave fields out (they keep their stored values) but
   * may not change one: a different definition, collection, source, scope, cutoff or participant list is a
   * {@link CatalogQueueError} 409, since it would be another refresh. 404 for a definition that was never published.
   */
  async begin(id: string, input: unknown): Promise<{ readonly receipt: UiRefreshReceipt; readonly created: boolean }> {
    const parsed = UiRefreshRequestSchema.safeParse(input);
    if (!parsed.success) throw new CatalogQueueError(422, parsed.error.issues.slice(0, 3).map(issue => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; '));
    const request = parsed.data;
    this.key(id);
    return this.exclusive(async () => {
      const stored = await this.receipt(id);
      if (stored) {
        const conflicts: string[] = [];
        if (stored.definition !== request.definition) conflicts.push('definition');
        if (request.collection !== undefined && request.collection !== stored.collection) conflicts.push('collection');
        if (request.source?.sha !== undefined && request.source.sha !== stored.source.sha) conflicts.push('source.sha');
        if (request.source?.branch !== undefined && request.source.branch !== stored.source.branch) conflicts.push('source.branch');
        if (request.source?.require !== undefined && request.source.require !== stored.source.require) conflicts.push('source.require');
        if (request.where !== undefined && !equalJson(sortedWhere(request.where), stored.where)) conflicts.push('where');
        if (request.staleBeforeMs !== undefined && request.staleBeforeMs !== stored.staleBeforeMs) conflicts.push('staleBeforeMs');
        if (request.participants !== undefined && !equalJson([...new Set(request.participants)].sort(), stored.participants)) conflicts.push('participants');
        if (conflicts.length) throw new CatalogQueueError(409, `The refresh ${id} exists with another ${conflicts.join(', ')}. Use a new refresh id, or begin it with the same values.`);
        return { receipt: stored, created: false };
      }
      if (!(await this.options.queue.definition(request.definition))) throw new CatalogQueueError(404, `No definition ${request.definition} has been published. Publish it first (PUT /api/ui-catalog/definitions/{version}).`);
      const now = this.now();
      const receipt: UiRefreshReceipt = {
        schemaVersion: UI_CATALOG_REFRESH_VERSION, id, definition: request.definition, collection: request.collection ?? id,
        source: { sha: request.source?.sha ?? null, branch: request.source?.branch ?? null, require: request.source?.require ?? false },
        where: sortedWhere(request.where), staleBeforeMs: request.staleBeforeMs ?? now, participants: [...new Set(request.participants ?? [])].sort(),
        createdAtMs: now, attempts: [], finalizations: []
      };
      await this.save(receipt);
      return { receipt, created: true };
    });
  }

  /** Record that an attempt joined (again). Throws {@link CatalogQueueError} 404 for an unknown refresh. */
  async join(id: string, input: unknown): Promise<UiRefreshReceipt> {
    const parsed = UiRefreshJoinSchema.safeParse(input);
    if (!parsed.success) throw new CatalogQueueError(422, parsed.error.issues.slice(0, 3).map(issue => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; '));
    return this.exclusive(async () => {
      const receipt = await this.receipt(id);
      if (!receipt) throw new CatalogQueueError(404, `No refresh ${id} has begun.`);
      const now = this.now();
      const found = receipt.attempts.find(item => item.participant === parsed.data.participant && item.attempt === parsed.data.attempt);
      if (found) found.lastSeenAtMs = now;
      else {
        receipt.attempts.push({ participant: parsed.data.participant, attempt: parsed.data.attempt, shard: refreshShard(parsed.data.participant, parsed.data.attempt), joinedAtMs: now, lastSeenAtMs: now });
        if (receipt.attempts.length > MAX_ATTEMPTS) receipt.attempts.splice(0, receipt.attempts.length - MAX_ATTEMPTS);
      }
      await this.save(receipt);
      return receipt;
    });
  }

  /** Judge a refresh. Throws {@link CatalogQueueError} 404 for an unknown refresh. */
  async status(id: string): Promise<UiRefreshStatus> {
    const receipt = await this.receipt(id);
    if (!receipt) throw new CatalogQueueError(404, `No refresh ${id} has begun.`);
    return this.judge(receipt);
  }

  /** Judge a refresh and record the finalization (its outcome, and the attempt that asked). */
  async finalize(id: string, attempt: string | null): Promise<UiRefreshStatus> {
    return this.exclusive(async () => {
      const receipt = await this.receipt(id);
      if (!receipt) throw new CatalogQueueError(404, `No refresh ${id} has begun.`);
      const status = await this.judge(receipt);
      receipt.finalizations.push({ atMs: this.now(), outcome: status.outcome, attempt });
      if (receipt.finalizations.length > MAX_FINALIZATIONS) receipt.finalizations.splice(0, receipt.finalizations.length - MAX_FINALIZATIONS);
      await this.save(receipt);
      return { ...status, refresh: receipt };
    });
  }

  private async judge(receipt: UiRefreshReceipt): Promise<UiRefreshStatus> {
    const now = this.now();
    const progress = await this.options.queue.progress(receipt.definition, receipt.collection);
    const capture = { units: 0, satisfied: 0, held: 0, pending: 0, failed: 0, stale: 0, source: 0, exhausted: 0, unknown: 0 };
    const outstanding: UiRefreshStatus['outstanding'] = [];
    const reasons: string[] = [];
    if (!progress) {
      return {
        schemaVersion: UI_CATALOG_REFRESH_VERSION, ok: false, outcome: 'unknown', refresh: receipt, capture, outstanding,
        health: { status: 'unknown', expected: receipt.participants, missing: receipt.participants.filter(name => !receipt.attempts.some(item => item.participant === name)), attempts: receipt.attempts.map(item => ({ ...item, status: 'unseen' as const })), lost: [], notices: [] },
        reasons: [`The definition ${receipt.definition} of this refresh is not stored on this server, so nothing can be judged.`], time: now
      };
    }
    const { expanded, results, held, attempts } = progress;
    const max = expanded.document.options.maxAttempts;
    const where = receipt.where ?? undefined;
    for (const unit of expanded.units) {
      if (!unitMatches(expanded, unit, where)) continue;
      capture.units++;
      const found = unit.items.map(i => results.get(expanded.items[i]!.key));
      const fresh = (result: (typeof found)[number]) => result !== undefined && result.recordedAtMs >= receipt.staleBeforeMs;
      const sourced = (result: (typeof found)[number]) => !receipt.source.require || receipt.source.sha === null || result?.sha === receipt.source.sha;
      if (found.every(result => result?.status === 'passed' && fresh(result) && sourced(result))) { capture.satisfied++; continue; }
      const claim = held.get(unit.key);
      const count = attempts[unit.key] ?? 0;
      const reason: Reason = claim ? 'held'
        : count >= max ? 'exhausted'
        : progress.incomplete && found.some(result => result === undefined) ? 'unknown'
        : found.some(result => result?.status === 'failed') ? 'failed'
        : found.some(result => result === undefined || result.status !== 'passed') ? 'pending'
        : found.some(result => !fresh(result)) ? 'stale'
        : 'source';
      capture[reason]++;
      outstanding.push({ unit: unit.key, reason, items: unit.items.length, ...(claim ? { claimId: claim.claimId, shard: claim.shard, expiresAtMs: claim.expiresAtMs } : {}), ...(count ? { attempts: count } : {}) });
    }
    outstanding.sort((a, b) => ORDER.indexOf(a.reason) - ORDER.indexOf(b.reason) || (a.unit < b.unit ? -1 : a.unit > b.unit ? 1 : 0));

    let outcome: UiRefreshOutcome;
    if (progress.incomplete) {
      outcome = 'unknown';
      reasons.push(`A backend or layer could not be read, so whether the refresh is complete is unknown: ${progress.notices.slice(0, 3).join('; ') || 'see the server\'s notices'}.`);
    } else if (capture.units === 0) {
      outcome = 'failed';
      reasons.push('No unit of the definition is in this refresh\'s scope (`where`), so it can never be complete.');
    } else if (!outstanding.length) {
      outcome = 'complete';
      reasons.push(`Every one of ${capture.units} units in scope has evidence recorded since the cutoff${receipt.source.require && receipt.source.sha ? ` at ${receipt.source.sha.slice(0, 12)}` : ''}.`);
    } else if (outstanding.every(entry => entry.reason === 'exhausted' || entry.reason === 'source')) {
      outcome = 'failed';
      reasons.push(`${outstanding.length} unit${outstanding.length === 1 ? '' : 's'} cannot be completed by this refresh: ${capture.exhausted} failed ${max} times within its collection${capture.source ? `, ${capture.source} were captured at another commit` : ''}. The queue will not hand them out again.`);
    } else {
      outcome = 'incomplete';
      reasons.push(`${outstanding.length} of ${capture.units} units in scope are outstanding: ${ORDER.filter(reason => capture[reason]).map(reason => `${capture[reason]} ${reason}`).join(', ')}.`);
      if (capture.held) reasons.push(`${capture.held} are held by live claims; another shard is still working.`);
    }

    const live = new Set([...held.values()].map(claim => claim.shard));
    const healthAttempts = receipt.attempts.map(item => ({
      ...item, status: live.has(item.shard) ? 'active' as const : progress.shards[item.shard]?.lastOutcome === 'expired' ? 'lost' as const : progress.shards[item.shard] ? 'idle' as const : 'unseen' as const
    }));
    const missing = receipt.participants.filter(name => !receipt.attempts.some(item => item.participant === name));
    const lost = healthAttempts.filter(item => item.status === 'lost').map(item => item.shard);
    if (missing.length) reasons.push(`${missing.length} expected participant${missing.length === 1 ? '' : 's'} never joined: ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ', …' : ''}.`);
    if (lost.length) reasons.push(`${lost.length} attempt${lost.length === 1 ? '' : 's'} lost a claim to an expired lease: ${lost.slice(0, 10).join(', ')}.`);
    return {
      schemaVersion: UI_CATALOG_REFRESH_VERSION, ok: outcome === 'complete', outcome, refresh: receipt, capture, outstanding: outstanding.slice(0, MAX_OUTSTANDING),
      health: { status: progress.incomplete ? 'unknown' : missing.length || lost.length ? 'degraded' : 'healthy', expected: receipt.participants, missing, attempts: healthAttempts, lost, notices: [...progress.notices] },
      reasons, time: now
    };
  }
}

/** What the refresh routes need from the server around them. */
export type CatalogRefreshDeps = {
  readonly refreshes: CatalogRefreshes;
  readonly auth: Auth;
  /** Is the report read yet? A status before it would judge an empty report. */
  readonly ready: () => boolean;
  readonly maxBytes: number;
  readonly unauthorized: (verdict: Extract<ReturnType<Auth['check']>, { ok: false }>) => Response;
};

const NO_STORE = { 'cache-control': 'no-store' };

/**
 * Registers the refresh routes on `app`: `PUT /api/ui-catalog/refreshes/:id` (begin or join), `POST …/:id/attempts` (an
 * attempt joins), `GET …/:id` (status) and `POST …/:id/finalize`. Changes need a Bearer token with the `publish` role;
 * reading needs a reader.
 */
export function mountCatalogRefresh(app: Hono, deps: CatalogRefreshDeps): void {
  const { refreshes, auth } = deps;
  const notReady = () => problemResponse(503, 'Atlas is still reading its backends; try again in a moment.', { 'retry-after': '1' });
  const failed = (error: unknown) => {
    if (error instanceof CatalogQueueError || error instanceof Refusal) return problemResponse(error.status, error.message);
    throw error;
  };
  const body = async (c: Context): Promise<unknown> => {
    const bytes = await readLimited(c.req.raw, deps.maxBytes);
    const text = new TextDecoder().decode(bytes).trim();
    if (!text) return {};
    try { return JSON.parse(text); } catch { throw new CatalogQueueError(422, 'The body is not JSON.'); }
  };
  app.put('/api/ui-catalog/refreshes/:id', async c => {
    const verdict = auth.check(c.req.raw, 'publish');
    if (!verdict.ok) return deps.unauthorized(verdict);
    try {
      const begun = await refreshes.begin(c.req.param('id'), await body(c));
      return c.json(begun, begun.created ? 201 : 200, NO_STORE);
    } catch (error) { return failed(error); }
  });
  app.post('/api/ui-catalog/refreshes/:id/attempts', async c => {
    const verdict = auth.check(c.req.raw, 'publish');
    if (!verdict.ok) return deps.unauthorized(verdict);
    try { return c.json(await refreshes.join(c.req.param('id'), await body(c)), 200, NO_STORE); } catch (error) { return failed(error); }
  });
  app.get('/api/ui-catalog/refreshes/:id', async c => {
    if (!deps.ready()) return notReady();
    try { return c.json(await refreshes.status(c.req.param('id')), 200, NO_STORE); } catch (error) { return failed(error); }
  });
  app.post('/api/ui-catalog/refreshes/:id/finalize', async c => {
    const verdict = auth.check(c.req.raw, 'publish');
    if (!verdict.ok) return deps.unauthorized(verdict);
    if (!deps.ready()) return notReady();
    try {
      const given = await body(c) as { attempt?: unknown };
      const attempt = typeof given?.attempt === 'string' && given.attempt.length <= 100 ? given.attempt : null;
      return c.json(await refreshes.finalize(c.req.param('id'), attempt), 200, NO_STORE);
    } catch (error) { return failed(error); }
  });
}
