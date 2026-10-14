import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import { eachLimited } from './completion-order';
import { contentTypeOf } from './media-types';
import { readUtf8, writeUtf8 } from './object-io';
import { isPaged, type ObjectStore, type StoredObject } from './object-store';

const RUN_PREFIX = 'layers/runs/';
const INDEX_PREFIX = 'layers/runs/index/';

type Count = { total: number; passed: number; failed: number; flaky: number; notReached: number };
const object = (value: unknown): Record<string, unknown> => (value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {});
const count = (value: unknown): Count | undefined => {
  const found = object(value);
  if (!Object.keys(found).length) return undefined;
  const n = (key: string) => (typeof found[key] === 'number' ? found[key] as number : 0);
  return { total: n('total'), passed: n('passed'), failed: n('failed'), flaky: n('flaky'), notReached: n('notReached') };
};

/** The row the viewer lists for a finished run (a `RunSummary`). */
export function summarizeManifest(id: string, manifest: unknown) {
  const root = object(manifest);
  const run = object(root.run);
  const coverage = object(object(root.coverage).overall);
  const paths = (Array.isArray(root.journeys) ? root.journeys : Array.isArray(root.paths) ? root.paths.filter(item => object(item).kind === 'journey') : []).map(object);
  const journeys: Count = { total: paths.length, passed: 0, failed: 0, flaky: 0, notReached: 0 };
  for (const item of paths) {
    if (item.status === 'passed') journeys.passed++;
    else if (item.status === 'failed') journeys.failed++;
    else if (item.status === 'flaky') journeys.flaky++;
    else journeys.notReached++;
  }
  const fromId = id.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/);
  return {
    id,
    startedAt: typeof run.startedAt === 'string' ? run.startedAt : fromId ? `${fromId[1]}T${fromId[2]}:${fromId[3]}:${fromId[4]}.${fromId[5]}Z` : new Date(0).toISOString(),
    mode: typeof run.mode === 'string' ? run.mode : id.endsWith('showcase') ? 'showcase' : 'fast',
    commit: typeof run.commit === 'string' ? run.commit : null,
    branch: typeof run.branch === 'string' ? run.branch : null,
    ...(typeof run.durationMs === 'number' ? { durationMs: run.durationMs } : {}),
    ...(typeof run.specVersion === 'string' ? { specVersion: run.specVersion } : {}),
    progress: 'complete' as const,
    hasManifest: true,
    ...(Object.keys(coverage).length ? { coverage: { ...(count(coverage.states) ? { states: count(coverage.states)! } : {}), ...(count(coverage.transitions) ? { transitions: count(coverage.transitions)! } : {}) } } : {}),
    journeys
  };
}

async function walk(dir: string, root = dir): Promise<string[]> {
  const nested = await Promise.all((await readdir(dir, { withFileTypes: true })).map(async entry => {
    if (entry.name.startsWith('.')) return [];
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full, root) : entry.isFile() ? [path.relative(root, full).split(path.sep).join('/')] : [];
  }));
  return nested.flat();
}

/** A run is safe to share only once its privacy scan passed: the same rule the static viewer applies. */
export class RunNotShareableError extends Error {}

/**
 * Upload a finished run directory so the viewer can browse it from the store. Files go first and
 * `manifest.json` after them, then the catalog entry, so a half-uploaded run is never listed. Running it
 * again after a failure finishes the job; a run that is already complete is left alone.
 */
export async function publishRunBundle(store: ObjectStore, directory: string): Promise<{ readonly id: string; readonly files: number; readonly bytes: number; readonly alreadyPublished: boolean }> {
  const id = path.basename(path.resolve(directory));
  if (!/^[\w.-]+$/.test(id) || id.startsWith('.')) throw new Error(`A run directory is named like 2026-10-09T12-00-00-000Z-fast; "${id}" is not.`);
  let manifest: unknown;
  try {
    manifest = JSON.parse(await readFile(path.join(directory, 'manifest.json'), 'utf8'));
  } catch {
    throw new Error(`${directory} has no readable manifest.json: is the run finished?`);
  }
  if (object(object(manifest).privacy).passed !== true) throw new RunNotShareableError(`Run ${id} is not shared: its privacy scan did not pass (or never ran). Fix what it found and run it again.`);
  const summary = summarizeManifest(id, manifest);
  const inverse = String(Number.MAX_SAFE_INTEGER - Math.max(0, Date.parse(summary.startedAt) || 0)).padStart(16, '0');
  const catalog = `${INDEX_PREFIX}${inverse}-${id}.json`;
  if (await store.head(`${RUN_PREFIX}${id}/manifest.json`)) {
    // The manifest is written before the catalog entry: an upload that died in between is finished here.
    if (!(await store.head(catalog))) await writeUtf8(store, catalog, JSON.stringify(summary), 'application/json');
    return { id, files: 0, bytes: 0, alreadyPublished: true };
  }
  const files = await walk(directory);
  let bytes = 0;
  await eachLimited(files.filter(file => file !== 'manifest.json'), 16, async file => {
    const body = new Uint8Array(await readFile(path.join(directory, file)));
    bytes += body.length;
    await store.put(`${RUN_PREFIX}${id}/${file}`, body, contentTypeOf(file));
  });
  const text = await readFile(path.join(directory, 'manifest.json'), 'utf8');
  bytes += text.length;
  await writeUtf8(store, `${RUN_PREFIX}${id}/manifest.json`, text, 'application/json');
  await writeUtf8(store, catalog, JSON.stringify(summary), 'application/json');
  return { id, files: files.length, bytes, alreadyPublished: false };
}

/**
 * The newest runs in the store. The catalog is newest first, so one page of it is enough; entries never
 * change, so `cache` (key to summary) lets a long-lived reader open each only once.
 */
export async function listRunSummaries(store: ObjectStore, limit = 100, cache: Map<string, ReturnType<typeof summarizeManifest>> = new Map()): Promise<ReturnType<typeof summarizeManifest>[]> {
  const keys = isPaged(store) ? (await store.listPage(INDEX_PREFIX, { limit })).keys : (await store.listKeys(INDEX_PREFIX)).slice(0, limit);
  const rows: ReturnType<typeof summarizeManifest>[] = [];
  await eachLimited(keys, 16, async key => {
    const known = cache.get(key);
    if (known) { rows.push(known); return; }
    const raw = await readUtf8(store, key);
    if (!raw) return;
    try {
      const row = JSON.parse(raw) as ReturnType<typeof summarizeManifest>;
      cache.set(key, row);
      rows.push(row);
    } catch { /* an unreadable marker is skipped */ }
  });
  return rows.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt) || (a.id < b.id ? -1 : 1));
}

/** One file of a run, or null. The path may not leave the run. */
export async function readRunFile(store: ObjectStore, id: string, relative: string): Promise<StoredObject | null> {
  const parts = relative.split('/');
  if (!/^[\w.-]+$/.test(id) || id.startsWith('.') || parts.some(part => !part || part === '.' || part === '..' || part.includes('\\'))) return null;
  return store.get(`${RUN_PREFIX}${id}/${relative}`);
}
