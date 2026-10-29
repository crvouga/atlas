/**
 * @module Layer garbage collection tests
 *
 * The properties that make deleting from a deletion-free format safe: only layers that no longer decide any result are
 * touched, the newest are always kept, a disabled policy deletes nothing, shared files outlive the layer that stopped
 * needing them, and an unreadable layer is never mistaken for an unused one.
 */
import { describe, expect, test } from 'bun:test';

import type { GcPolicy } from '../../schema/src/user-state';
import { collectGarbage, planGarbage } from '../src/garbage';
import { publishChecks } from '../src/publish-checks';
import { ReportIndex } from '../src/report-index';
import { memoryStore } from './memory-store';

const DAY = 86_400_000;
const NOW = 1000 * DAY;
const policy = (over: Partial<GcPolicy> = {}): GcPolicy => ({ enabled: true, maxAgeDays: 30, keepLatest: 1, intervalHours: 24, ...over });
const shared = 'a long log line that is stored once and shared by two layers '.repeat(300);

/** Layers of one producer, one per day, all about the same check: each newer one supersedes the older. */
async function seed(days: number[], attach: (day: number) => string = () => shared) {
  const store = memoryStore();
  for (const day of days) {
    await publishChecks(store, { producer: 'suite', recordedAtMs: day * DAY, checks: [{ id: 'login', title: 'login', status: day % 2 ? 'passed' : 'failed', attachments: [{ name: 'log.txt', text: attach(day) }] }] });
  }
  const index = new ReportIndex([{ id: 's3', store }], { now: () => NOW });
  await index.refresh();
  return { store, index };
}

describe('garbage collection', () => {
  test('a disabled policy plans nothing, however old everything is', async () => {
    const { store, index } = await seed([1, 2, 3]);
    const plan = await planGarbage(store, { policy: policy({ enabled: false }), nowMs: NOW, eligible: index.superseded() });
    expect(plan.candidates).toEqual([]);
    expect(plan.kept).toBe(3);
  });

  test('only superseded layers older than the policy allows, beyond the newest kept, are deleted: the winner is never touched', async () => {
    const { store, index } = await seed([1, 2, 3, 990, 995]);
    expect(index.superseded().size).toBe(4);
    const plan = await planGarbage(store, { policy: policy({ keepLatest: 1 }), nowMs: NOW, eligible: index.superseded() });
    // 995 is the winner and the newest; 990 is superseded but only 10 days old; 1, 2, 3 are old and superseded.
    expect(plan.candidates.map(candidate => candidate.recordedAtMs / DAY)).toEqual([1, 2, 3]);
    const outcome = await collectGarbage(store, plan);
    expect(outcome.deletedLayers).toBe(3);
    expect((await store.listKeys('layers/index/')).length).toBe(2);
    expect((await store.listKeys('layers/manifests/')).length).toBe(2);
    // The report from what is left equals the report before: the same winner for the same check.
    const after = new ReportIndex([{ id: 's3', store }], { now: () => NOW });
    await after.refresh();
    expect(after.snapshot().layers.map(layer => layer.id)).toEqual(index.snapshot().layers.map(layer => layer.id));
  });

  test('keepLatest protects the newest layers even when they are old and superseded', async () => {
    const { store, index } = await seed([1, 2, 3, 4]);
    const plan = await planGarbage(store, { policy: policy({ keepLatest: 3 }), nowMs: NOW, eligible: index.superseded() });
    expect(plan.candidates.map(candidate => candidate.recordedAtMs / DAY)).toEqual([1]);
  });

  test('a layer the report has not read, or one that still decides a result, is never a candidate', async () => {
    const { store, index } = await seed([1, 2, 3]);
    const none = await planGarbage(store, { policy: policy({ keepLatest: 0 }), nowMs: NOW, eligible: new Set() });
    expect(none.candidates).toEqual([]);
    const all = await planGarbage(store, { policy: policy({ keepLatest: 0 }), nowMs: NOW, eligible: index.superseded() });
    expect(all.candidates.map(candidate => candidate.recordedAtMs / DAY)).toEqual([1, 2]);
  });

  test('a file two layers share stays until the last layer that uses it goes; a file only the deleted layers used is removed', async () => {
    const { store, index } = await seed([1, 2, 3], day => (day === 1 ? 'only layer one has this log. '.repeat(600) : shared));
    const blobs = async () => (await store.listKeys('layers/blobs/')).length;
    expect(await blobs()).toBe(2);
    const plan = await planGarbage(store, { policy: policy({ keepLatest: 1 }), nowMs: NOW, eligible: index.superseded() });
    expect(plan.candidates.length).toBe(2);
    const outcome = await collectGarbage(store, plan);
    // Layer 1's own file goes; layer 2 shared its file with layer 3, which stays, so that file stays.
    expect(outcome).toEqual({ deletedLayers: 2, deletedBlobs: 1 });
    expect(await blobs()).toBe(1);
    const after = new ReportIndex([{ id: 's3', store }], { now: () => NOW });
    await after.refresh();
    expect(after.stats().failed).toBe(0);
  });

  test('if a remaining layer cannot be read, no file is deleted: unknown is not unused', async () => {
    const { store, index } = await seed([1, 2, 3]);
    const plan = await planGarbage(store, { policy: policy({ keepLatest: 1 }), nowMs: NOW, eligible: index.superseded() });
    const newest = plan.candidates.length ? (await store.listKeys('layers/manifests/')).find(key => !plan.candidates.some(candidate => key.includes(candidate.id)))! : '';
    await store.put(newest, new TextEncoder().encode('{ broken'), 'application/json');
    const blobsBefore = (await store.listKeys('layers/blobs/')).length;
    const outcome = await collectGarbage(store, plan);
    expect(outcome.deletedLayers).toBe(2);
    expect(outcome.deletedBlobs).toBe(0);
    expect((await store.listKeys('layers/blobs/')).length).toBe(blobsBefore);
  });

  test('a layer whose manifest cannot be read is left alone', async () => {
    const { store, index } = await seed([1, 2, 3]);
    const plan = await planGarbage(store, { policy: policy({ keepLatest: 1 }), nowMs: NOW, eligible: index.superseded() });
    const first = plan.candidates[0]!;
    await store.delete(`layers/manifests/${first.id}.json`);
    const outcome = await collectGarbage(store, plan);
    expect(outcome.deletedLayers).toBe(1);
    expect(await store.head(first.catalogKey)).toBe(true);
  });

  test('running a plan twice is harmless', async () => {
    const { store, index } = await seed([1, 2, 3]);
    const plan = await planGarbage(store, { policy: policy({ keepLatest: 1 }), nowMs: NOW, eligible: index.superseded() });
    await collectGarbage(store, plan);
    expect(await collectGarbage(store, plan)).toEqual({ deletedLayers: 0, deletedBlobs: 0 });
  });
});
