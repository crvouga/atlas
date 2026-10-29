/**
 * @module Review collection routes
 *
 * `/api/reports/review-collections`: publish an immutable, named, ordered collection of references to recorded results
 * (with notes and gaps), read it back with how every source stands now, add reviewers' notes and "reviewed" marks, and
 * export a portable manifest. A collection is curation kept beside the report under `curation/`: it is never a layer, a
 * check or a run, changes no status, slot or winner, and never alters what is uploaded. Reading needs a reader (the
 * same as the rest of the report, so nothing becomes public by sharing a link); publishing and noting need a Bearer
 * token with the `publish` role, recorded under that token's name. Recordings are still served only by the attachment
 * routes, under their own access control.
 *
 * @see docs/server.md#review-collections
 */
import type { Context, Hono } from 'hono';

import { eachLimited } from '../../reports/src/completion-order';
import { layerKey } from '../../reports/src/layer-store';
import type { ObjectStore } from '../../reports/src/object-store';
import type { ReportIndex } from '../../reports/src/report-index';
import { availabilityOf, foldReviewed, manifestOf } from '../../reports/src/review-collection';
import {
  listReviewCollections,
  readReviewCollection,
  readReviewNotes,
  recordReviewCollection,
  recordReviewNote,
  ReviewCollectionError
} from '../../reports/src/review-collection-store';
import type { ArtifactResult } from '../../reports/src/test-catalog';
import type { Auth } from './auth';
import { problemResponse } from './problem';
import { readLimited } from './store-api';
import { Refusal } from './validate';

/** What the review collection routes need from the server around them. */
export type ReviewCollectionDeps = {
  /** Where collections and notes are kept: the write backend's store. */
  readonly store: ObjectStore;
  /** Every backend's store, to tell whether a layer is still held anywhere. */
  readonly stores: readonly ObjectStore[];
  readonly auth: Auth;
  readonly index: ReportIndex;
  readonly now: () => number;
  /** The largest request body, in bytes. */
  readonly maxBytes: number;
  readonly unauthorized: (verdict: Extract<ReturnType<Auth['check']>, { ok: false }>) => Response;
};

const NO_STORE = { 'cache-control': 'no-store' };
const HELD_MS = 30_000;
const LIST_MS = 5_000;

/**
 * Registers the review collection routes on `app`:
 * `GET /api/reports/review-collections`, `POST /api/reports/review-collections`,
 * `GET /api/reports/review-collections/detail`, `POST /api/reports/review-collections/reviews` and
 * `GET /api/reports/review-collections/export`.
 */
export function mountReviewCollections(app: Hono, deps: ReviewCollectionDeps): void {
  const { store, stores, auth, index, now } = deps;
  // One publisher at a time in this process, so the check that a revision is free and the write of it are one step.
  let queue: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(work: () => Promise<T>): Promise<T> => {
    const run = queue.then(work, work);
    queue = run.catch(() => undefined);
    return run;
  };
  let lastAt = 0;
  const stamp = () => (lastAt = Math.max(now(), lastAt + 1));

  // The report's recorded results by layer and check, rebuilt only when the history changes.
  let located: { rev: number; map: Map<string, ArtifactResult[]> } | null = null;
  const find = (layer: string, check: string, kind: string | undefined): readonly ArtifactResult[] => {
    if (!located || located.rev !== index.history.rev) {
      const map = new Map<string, ArtifactResult[]>();
      for (const { result } of index.history.evidenceResults()) {
        const key = `${result.layer}\u0000${result.id}`;
        const list = map.get(key);
        if (list) list.push(result); else map.set(key, [result]);
      }
      located = { rev: index.history.rev, map };
    }
    const all = located.map.get(`${layer}\u0000${check}`) ?? [];
    return kind === undefined ? all : all.filter(result => result.kind === kind);
  };

  const held = new Map<string, { at: number; value: boolean }>();
  const holdsLayers = async (layers: readonly string[]): Promise<Set<string>> => {
    const out = new Set<string>();
    const ask = layers.filter(layer => {
      const known = held.get(layer);
      if (known && now() - known.at < HELD_MS) { if (known.value) out.add(layer); return false; }
      return true;
    });
    await eachLimited(ask, 8, async layer => {
      let value = false;
      for (const each of stores) { if (await each.head(layerKey(layer)).catch(() => false)) { value = true; break; } }
      if (held.size >= 4096) held.delete(held.keys().next().value!);
      held.set(layer, { at: now(), value });
      if (value) out.add(layer);
    });
    return out;
  };

  let listing: { at: number; value: Awaited<ReturnType<typeof listReviewCollections>> } | null = null;
  const list = async () => {
    if (!listing || now() - listing.at > LIST_MS) listing = { at: now(), value: await listReviewCollections(store) };
    return listing.value;
  };

  const problem = (error: unknown): Response | null => {
    if (error instanceof ReviewCollectionError || error instanceof Refusal) return problemResponse(error.status, error.message);
    return null;
  };

  const standing = async (id: string, revision: number | undefined) => {
    const found = await readReviewCollection(store, id, revision);
    if (!found) return null;
    const notes = (await readReviewNotes(store, id)).filter(note => note.revision === found.collection.revision);
    const present = await holdsLayers([...new Set(found.collection.entries.map(entry => entry.source.layer))]);
    const availability = availabilityOf(found.collection, layer => present.has(layer), find);
    return { ...found, notes, availability, reviewed: foldReviewed(notes) };
  };
  const wanted = (c: Context): { id: string; revision: number | undefined } | Response => {
    const id = c.req.query('id');
    if (!id) return problemResponse(400, 'Name the collection with ?id=, an id from GET /api/reports/review-collections.');
    const raw = c.req.query('revision');
    if (raw !== undefined && !/^[1-9]\d{0,5}$/.test(raw)) return problemResponse(400, '?revision= is a whole number of 1 or more.');
    return { id, revision: raw === undefined ? undefined : Number(raw) };
  };

  app.get('/api/reports/review-collections', async c => {
    const collections = (await list()).map(({ collection, revisions }) => ({
      id: collection.id, revision: collection.revision, revisions, title: collection.title,
      ...(collection.purpose === undefined ? {} : { purpose: collection.purpose }), ...(collection.audience === undefined ? {} : { audience: collection.audience }),
      tags: collection.tags, entries: collection.entries.length, gaps: collection.gaps.length, createdBy: collection.createdBy, createdAtMs: collection.createdAtMs
    }));
    return c.json({ schemaVersion: 1, collections }, 200, NO_STORE);
  });

  app.post('/api/reports/review-collections', async c => {
    const verdict = auth.check(c.req.raw, 'publish');
    if (!verdict.ok) return deps.unauthorized(verdict);
    try {
      const bytes = await readLimited(c.req.raw, Math.min(deps.maxBytes, 2 * 1024 * 1024));
      let input: unknown;
      try { input = JSON.parse(new TextDecoder().decode(bytes)); } catch { return problemResponse(422, 'The body is not JSON.'); }
      if (!index.ready) return problemResponse(503, 'Atlas is still reading its backends; try again in a moment.', { 'retry-after': '1' });
      const collection = await exclusive(() => recordReviewCollection(store, input, verdict.identity.name, stamp(), find));
      listing = null;
      return c.json(collection, 201, NO_STORE);
    } catch (error) {
      const answered = problem(error);
      if (answered) return answered;
      throw error;
    }
  });

  app.get('/api/reports/review-collections/detail', async c => {
    const asked = wanted(c);
    if (asked instanceof Response) return asked;
    const found = await standing(asked.id, asked.revision);
    if (!found) return problemResponse(404, 'No such collection or revision.');
    return c.json({ schemaVersion: 1, collection: found.collection, revisions: found.revisions, availability: found.availability, reviews: found.notes, reviewed: found.reviewed }, 200, NO_STORE);
  });

  app.post('/api/reports/review-collections/reviews', async c => {
    const verdict = auth.check(c.req.raw, 'publish');
    if (!verdict.ok) return deps.unauthorized(verdict);
    try {
      const bytes = await readLimited(c.req.raw, Math.min(deps.maxBytes, 64 * 1024));
      let input: unknown;
      try { input = JSON.parse(new TextDecoder().decode(bytes)); } catch { return problemResponse(422, 'The body is not JSON.'); }
      const note = await recordReviewNote(store, input, verdict.identity.name, stamp());
      return c.json(note, 201, NO_STORE);
    } catch (error) {
      const answered = problem(error);
      if (answered) return answered;
      throw error;
    }
  });

  app.get('/api/reports/review-collections/export', async c => {
    const asked = wanted(c);
    if (asked instanceof Response) return asked;
    const found = await standing(asked.id, asked.revision);
    if (!found) return problemResponse(404, 'No such collection or revision.');
    const manifest = manifestOf(found.collection, found.availability, found.reviewed, now());
    return c.json(manifest, 200, { ...NO_STORE, 'content-disposition': `attachment; filename="review-${found.collection.id}-r${found.collection.revision}.json"` });
  });
}
