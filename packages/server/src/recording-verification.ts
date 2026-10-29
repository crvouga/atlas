/**
 * @module Recording verification routes
 *
 * `/api/reports/recordings/verification`: whether the videos a run published can still be read back from storage as
 * they were published, apart from whether the run's tests passed. A viewer reads the newest result with a read token
 * (`GET`, which never touches a blob). A publish token starts a read-back (`POST`), which does read blobs and so is
 * bounded: the newest 20 layers unless asked for more, at most 200, one pass at a time. The result is kept in this
 * process only (it is derived, not state: a restart means "not verified yet", never "fine"), and only for layers the
 * store still holds. It adds nothing to any layer and changes no status, slot or winner. This is the same check as
 * `atlas report verify-recordings`, and as that command it checks stored bytes, not browser playback.
 *
 * @see docs/rich-evidence.md#recording-completeness
 */
import type { Context, Hono } from 'hono';

import { RecordingVerifyRequestSchema } from '../../schema/src/api';
import { eachLimited } from '../../reports/src/completion-order';
import { layerKey } from '../../reports/src/layer-store';
import type { LayerRecordingVerification } from '../../reports/src/recording-verify';
import { verifyStoreRecordings } from '../../reports/src/recording-verify';
import type { ObjectStore } from '../../reports/src/object-store';
import type { ReportIndex } from '../../reports/src/report-index';
import { runKey } from '../../reports/src/test-catalog';
import type { Auth } from './auth';
import { problemResponse } from './problem';
import { readLimited } from './store-api';
import { Refusal } from './validate';

/** What the verification routes need from the server around them. */
export type RecordingVerificationDeps = {
  /** Every backend's store: a layer is read back from the store that holds it. */
  readonly stores: readonly ObjectStore[];
  readonly auth: Auth;
  readonly index: ReportIndex;
  readonly now: () => number;
  readonly unauthorized: (verdict: Extract<ReturnType<Auth['check']>, { ok: false }>) => Response;
};

const NO_STORE = { 'cache-control': 'no-store' };
const HELD_MS = 30_000;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 200;

type Held = LayerRecordingVerification & { readonly run: string; readonly verifiedAtMs: number };

/**
 * Registers `GET` and `POST /api/reports/recordings/verification` on `app`. The result of the last read-back of each
 * layer is held in memory, replaced by a newer one, and served only for layers a store still holds. A layer held by
 * two backends keeps the reading with more gaps, so a copy that lost its blobs is never hidden by one that did not.
 */
export function mountRecordingVerification(app: Hono, deps: RecordingVerificationDeps): void {
  const { stores, auth, index, now } = deps;
  const held = new Map<string, Held>();
  let notices: string[] = [];
  let running = false;

  // Whether a layer's manifest is still in some store (garbage collection removes superseded layers), asked at most every
  // HELD_MS. Only a `head` of the manifest: no recording is read.
  const present = new Map<string, { at: number; value: boolean }>();
  const holds = async (ids: readonly string[]): Promise<Set<string>> => {
    const out = new Set<string>();
    await eachLimited(ids, 8, async id => {
      const known = present.get(id);
      let value = known !== undefined && now() - known.at < HELD_MS ? known.value : undefined;
      if (value === undefined) {
        value = false;
        for (const store of stores) { if (await store.head(layerKey(id)).catch(() => false)) { value = true; break; } }
        present.set(id, { at: now(), value });
      }
      if (value) out.add(id);
    });
    return out;
  };

  const document = async (request: Request, extra: { verified?: number } = {}) => {
    const search = new URL(request.url).searchParams;
    const run = search.get('run');
    const prefixes = search.getAll('layer').flatMap(value => value.split(',')).map(value => value.trim().toLowerCase()).filter(Boolean);
    const wanted = [...held.values()].filter(entry => (!run || entry.run === run) && (!prefixes.length || prefixes.some(prefix => entry.layer.startsWith(prefix))));
    const still = await holds(wanted.map(entry => entry.layer));
    const layers = wanted.filter(entry => still.has(entry.layer))
      .sort((a, b) => b.verifiedAtMs - a.verifiedAtMs || (a.layer < b.layer ? -1 : 1));
    return { schemaVersion: 1 as const, layers, notices, ...extra };
  };

  app.get('/api/reports/recordings/verification', async c => c.json(await document(c.req.raw), 200, NO_STORE));

  app.post('/api/reports/recordings/verification', async (c: Context) => {
    const verdict = auth.check(c.req.raw, 'publish');
    if (!verdict.ok) return deps.unauthorized(verdict);
    if (!index.ready) return problemResponse(503, 'The report is still loading. Try again in a moment.', { 'retry-after': '2' });
    let input: unknown = {};
    try {
      const bytes = await readLimited(c.req.raw, 16 * 1024);
      if (bytes.length) {
        try { input = JSON.parse(new TextDecoder().decode(bytes)); } catch { return problemResponse(422, 'The body is not JSON.'); }
      }
    } catch (error) {
      if (error instanceof Refusal) return problemResponse(error.status, error.message);
      throw error;
    }
    const parsed = RecordingVerifyRequestSchema.safeParse(input);
    if (!parsed.success) return problemResponse(422, `Not a verification request: ${parsed.error.issues[0]?.message ?? 'invalid'}.`);
    if (running) return problemResponse(409, 'A read-back is already running. Read the result with GET when it finishes.', { 'retry-after': '5' });
    running = true;
    try {
      const limit = Math.min(MAX_LIMIT, parsed.data.limit ?? DEFAULT_LIMIT);
      const runs = new Map<string, string>();
      const found: Held[] = [];
      const lost: string[] = [];
      const at = now();
      for (const store of stores) {
        const result = await verifyStoreRecordings(store, {
          ...(parsed.data.layers?.length ? { ids: parsed.data.layers } : {}), limit,
          include: layer => { runs.set(layer.id, runKey(layer)); return true; }
        });
        lost.push(...result.notices);
        for (const layer of result.layers) found.push({ ...layer, run: runs.get(layer.layer) ?? '', verifiedAtMs: at });
      }
      // A layer held by two backends keeps the copy with more gaps; a newer pass replaces an older one.
      const fresh = new Map<string, Held>();
      for (const entry of found) if ((fresh.get(entry.layer)?.gaps.length ?? -1) < entry.gaps.length || !fresh.has(entry.layer)) fresh.set(entry.layer, entry);
      for (const [layer, entry] of fresh) held.set(layer, entry);
      notices = [...new Set(lost)];
      return c.json(await document(c.req.raw, { verified: fresh.size }), 200, NO_STORE);
    } catch (error) {
      return problemResponse(502, `The store could not be read: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
    } finally {
      running = false;
    }
  });
}
