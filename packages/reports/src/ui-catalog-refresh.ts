/**
 * @module Refreshing a UI catalog: begin, join, status, finalize
 *
 * A shard's `collectCatalog` result is only that shard's view: `stoppedBy: empty` says the queue had nothing left *for it*,
 * not that the catalog is complete. A **refresh** is the whole run: `beginRefresh` pins it on the server to a definition
 * version, an optional source (commit, branch), the profiles in scope (`where`), a freshness cutoff and a collection id;
 * `joinRefresh` records an attempt (a CI job, its rerun) and returns the options its `collectCatalog` call takes;
 * `finalizeRefresh` judges every unit in scope against that policy and says `complete`, `incomplete` (naming what is
 * outstanding and why), `failed` (what is left will not be handed out again) or `unknown` (something could not be read),
 * with worker health reported apart from capture completeness.
 *
 * Nothing here is a scheduler: shards still coordinate only through the server's queue. A status that cannot be read (the
 * server is down, the refresh was never begun, an older server without refreshes) is `unknown`, never complete.
 *
 * @see docs/ui-catalog.md#refreshes-finalizing-a-collection
 */
import { UiRefreshStatusSchema, UI_CATALOG_REFRESH_VERSION, type UiRefreshReceipt, type UiRefreshRequest, type UiRefreshStatus } from '../../schema/src/ui-catalog-refresh';
import type { HttpStore } from './http-store';
import { publishCatalogDefinition, type CollectOptions } from './ui-catalog-collect';

/** What a refresh is pinned to. The definition is published first (idempotent), so its version is what the refresh names. */
export type BeginRefreshOptions = Omit<UiRefreshRequest, 'definition'> & {
  /** The refresh id: a CI run id fits. Beginning it again joins it. */
  readonly id: string;
  /** The definition, as the project wrote it or resolved. */
  readonly catalog: CollectOptions['catalog'];
};

/** The shard id an attempt claims and publishes as: `<participant>#<attempt>`, so a rerun's work stays distinguishable. */
export function refreshShard(participant: string, attempt: string): string {
  return `${participant}#${attempt}`;
}

async function problemOf(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  try { return (JSON.parse(text) as { detail?: string }).detail ?? `HTTP ${response.status}`; } catch { return text.trim() || `HTTP ${response.status}`; }
}

/**
 * Begin a refresh on a server, or join the one that has this id with the same values. Publishes the definition first.
 * Throws an `AtlasHttpError` when the server refuses (409: the id exists with other values) or cannot be reached.
 *
 * @example
 * ```ts
 * const { receipt } = await beginRefresh(store, { id: process.env.GITHUB_RUN_ID!, catalog, source: { sha, branch }, participants: plan.participants });
 * ```
 */
export async function beginRefresh(store: HttpStore, options: BeginRefreshOptions): Promise<{ readonly receipt: UiRefreshReceipt; readonly created: boolean; readonly definition: { readonly version: string; readonly name: string } }> {
  const { id, catalog, ...request } = options;
  const published = await publishCatalogDefinition(store, catalog);
  const response = await store.call('PUT', `/ui-catalog/refreshes/${encodeURIComponent(id)}`, { json: { ...request, definition: published.version } });
  const body = await response.json() as { receipt: UiRefreshReceipt; created: boolean };
  return { ...body, definition: { version: published.version, name: published.document.name } };
}

/**
 * Record that an attempt joined a refresh, and return the receipt with the options its shard passes to `collectCatalog`
 * (`collection`, `staleBeforeMs`, `shard`, `origin`). Throws an `AtlasHttpError` for an unknown refresh (404) or a server
 * that cannot be reached.
 *
 * @example
 * ```ts
 * const joined = await joinRefresh(store, runId, { participant: 'capture-mobile', attempt: process.env.GITHUB_RUN_ATTEMPT ?? '1' });
 * await collectCatalog({ store, catalog, ...joined.collect, capture });
 * ```
 */
export async function joinRefresh(store: HttpStore, id: string, attempt: { readonly participant: string; readonly attempt?: string; readonly where?: Readonly<Record<string, readonly string[]>> }): Promise<{
  readonly receipt: UiRefreshReceipt;
  readonly collect: Required<Pick<CollectOptions, 'collection' | 'staleBeforeMs' | 'shard'>> & { readonly origin: { readonly sha: string | null; readonly branch: string | null } };
}> {
  const number = attempt.attempt ?? '1';
  const response = await store.call('POST', `/ui-catalog/refreshes/${encodeURIComponent(id)}/attempts`, { json: { participant: attempt.participant, attempt: number } });
  const receipt = await response.json() as UiRefreshReceipt;
  const where = attempt.where && Object.keys(attempt.where).length ? attempt.where : receipt.where ?? undefined;
  return {
    receipt,
    collect: {
      collection: receipt.collection, staleBeforeMs: receipt.staleBeforeMs,
      shard: { id: refreshShard(attempt.participant, number), ...(where ? { where } : {}) },
      origin: { sha: receipt.source.sha, branch: receipt.source.branch }
    }
  };
}

/** A status for a refresh that could not be read: `unknown`, never complete. */
export function unknownRefresh(reason: string, now = Date.now()): UiRefreshStatus {
  return {
    schemaVersion: UI_CATALOG_REFRESH_VERSION, ok: false, outcome: 'unknown', refresh: null,
    capture: { units: 0, satisfied: 0, held: 0, pending: 0, failed: 0, stale: 0, source: 0, exhausted: 0, unknown: 0 }, outstanding: [],
    health: { status: 'unknown', expected: [], missing: [], attempts: [], lost: [], notices: [reason] }, reasons: [reason], time: now
  };
}

async function judged(store: HttpStore, method: 'GET' | 'POST', id: string, body?: unknown): Promise<UiRefreshStatus> {
  let response: Response;
  try {
    response = await store.call(method, `/ui-catalog/refreshes/${encodeURIComponent(id)}${method === 'POST' ? '/finalize' : ''}`, { accept: [404, 410, 422, 503], ...(body !== undefined ? { json: body } : {}) });
  } catch (error) {
    return unknownRefresh(`The refresh could not be read: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (response.status === 404) return unknownRefresh(`The refresh receipt ${id} could not be found: ${await problemOf(response)} Begin it first (atlas ui-catalog refresh begin), or use a server that keeps refreshes.`);
  if (response.status !== 200) return unknownRefresh(`The refresh ${id} could not be read: ${await problemOf(response)}`);
  let json: unknown;
  try { json = await response.json(); } catch { return unknownRefresh(`The server's answer for the refresh ${id} is not JSON`); }
  const parsed = UiRefreshStatusSchema.safeParse(json);
  return parsed.success ? parsed.data : unknownRefresh(`The server's answer for the refresh ${id} is not a refresh status: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
}

/**
 * Judge a refresh without recording anything. Never throws for a server or receipt that cannot be read: that is an
 * `unknown` status with the reason, whose `ok` is false.
 */
export function refreshStatus(store: HttpStore, id: string): Promise<UiRefreshStatus> {
  return judged(store, 'GET', id);
}

/**
 * Judge a refresh and record the finalization on its receipt (with the attempt that asked, so repeated finalizations of
 * rerun attempts stay distinguishable). `ok` is true only when `outcome` is `complete`. Never throws for a server or
 * receipt that cannot be read: that is an `unknown` status.
 *
 * @example
 * ```ts
 * const status = await finalizeRefresh(store, runId, { attempt: process.env.GITHUB_RUN_ATTEMPT });
 * if (!status.ok) process.exitCode = 1;
 * ```
 */
export function finalizeRefresh(store: HttpStore, id: string, options: { readonly attempt?: string } = {}): Promise<UiRefreshStatus> {
  return judged(store, 'POST', id, options.attempt ? { attempt: options.attempt } : {});
}
