import { afterEach, describe, expect, test } from 'bun:test';

import { createNode } from '../../server/tests/node-compat';
import { attachmentIdentity, partsEvidence } from '../src/evidence-detail';
import { publishChecks } from '../src/publish-checks';
import { ReportIndex } from '../src/report-index';
import { runDetail, runList } from '../src/test-catalog';
import { memoryStore } from './memory-store';

const bytes = (text: string) => new TextEncoder().encode(text);
const movie = (name: string, text: string) => ({ name, contentType: 'video/webm', data: bytes(text) });
const RUN = 'https://ci.example/runs/1';

/** One run: a layer with checks that share a recording, and a layer of review files with no checks at all. */
async function fixture() {
  const store = memoryStore();
  await publishChecks(store, {
    producer: 'web', environment: 'desktop-web', runUrl: RUN, recordedAtMs: 1_000, branch: 'main',
    attachments: [movie('review.webm', 'same'), { name: 'review.zip', contentType: 'application/zip', data: bytes('zip') }],
    checks: [
      { id: 'a', title: 'A', status: 'passed', attachments: [movie('a.webm', 'same')] },
      { id: 'b', title: 'B', status: 'passed', attachments: [movie('b.webm', 'same')] },
    ],
  });
  await publishChecks(store, {
    producer: 'review', runUrl: RUN, recordedAtMs: 2_000, branch: 'main',
    attachments: [{ name: 'summary.html', contentType: 'text/html', data: bytes('<script>1</script>') }],
    checks: [],
  });
  const index = new ReportIndex([{ id: 'one', store }]);
  await index.refresh();
  return { index, store };
}

describe('the layers of a run', () => {
  test('lists every layer with its checks and files, so a layer of no checks is found and is not a pass', async () => {
    const { index } = await fixture();
    const found = runDetail(index.history, 'v', RUN)!;
    expect(found.layers!.map(layer => [layer.producer, layer.backend, layer.checks, layer.attachments])).toEqual([
      ['web', 'one', 2, 2],
      ['review', 'one', 0, 1],
    ]);
    expect(found.layers![0]!.videos).toEqual({ references: 1, recordings: 1, unavailable: 0 });
    expect(found.layers![1]!.videos).toBeUndefined();
    // The run says how many files it carries itself, and its counts are those of its checks only.
    expect(found.run.attachments).toBe(3);
    expect(found.run.tests).toBe(2);
    expect(found.run.layers).toBe(2);
  });

  test('a run of only files has no tests and no results, and is still a run', async () => {
    const store = memoryStore();
    await publishChecks(store, { producer: 'review', runUrl: RUN, recordedAtMs: 1, attachments: [movie('review.webm', 'x')], checks: [] });
    const index = new ReportIndex([{ id: 'one', store }]);
    await index.refresh();
    const list = runList(index.history, 'v');
    expect(list.runs.map(run => [run.tests, run.counts.passed, run.attachments])).toEqual([[0, 0, 1]]);
    expect(runDetail(index.history, 'v', RUN)!.results).toEqual([]);
  });

  test('a run without files claims none', async () => {
    const store = memoryStore();
    await publishChecks(store, { producer: 'web', runUrl: RUN, recordedAtMs: 1, checks: [{ id: 'a', title: 'A', status: 'passed' }] });
    const index = new ReportIndex([{ id: 'one', store }]);
    await index.refresh();
    expect(runList(index.history, 'v').runs[0]!.attachments).toBeUndefined();
    expect(runDetail(index.history, 'v', RUN)!.layers![0]).toMatchObject({ checks: 1, attachments: 0 });
  });

  test('identical bytes have one identity however many checks reference them', async () => {
    const { index } = await fixture();
    const found = runDetail(index.history, 'v', RUN)!;
    const identities = new Set(found.results.flatMap(result => (result.videos ?? []).map(video => video.recording)));
    expect(identities.size).toBe(1);
    expect(attachmentIdentity({ name: 'x', sha256: 'ab' })).toBe('sha256:ab');
    expect(attachmentIdentity({ name: 'x', bundleKey: 'attachments/ab' })).toBe('attachments/ab');
    expect(attachmentIdentity({ name: 'x' })).toBeUndefined();
  });
});

describe('what the parts of a layer carry', () => {
  test('only a part with evidence of its own is named, with that evidence', () => {
    const parts = partsEvidence({
      parts: [
        { kind: 'behavior', id: 'p1', title: 'Behavior', attachments: [{ name: 'a.webm' }] },
        { kind: 'performance', id: 'p2', title: 'Perf' },
      ],
    });
    expect(parts).toEqual([{ kind: 'behavior', id: 'p1', title: 'Behavior', attachments: [{ name: 'a.webm' }] }]);
  });
});

describe('the run-level evidence route', () => {
  const nodes: { close(): void }[] = [];
  afterEach(() => nodes.splice(0).forEach(node => node.close()));

  test('answers a layer of no checks with the files it carries, and adds no `parts` when its parts carry none', async () => {
    const { store, index } = await fixture();
    const node = createNode({ stores: [{ id: 'one', store }], refreshMs: 60_000 });
    nodes.push(node);
    await node.ready;
    const review = runDetail(index.history, 'v', RUN)!.layers![1]!;
    const response = await node.fetch(new Request(`http://atlas/api/reports/evidence/detail/${review.backend}/${review.id}`));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { layer: string; run: { attachments: { name: string; bundleKey?: string }[] }; parts?: unknown };
    expect(body.run.attachments.map(item => item.name)).toEqual(['summary.html']);
    expect(body.run.attachments[0]!.bundleKey).toBeTruthy();
    expect(body.parts).toBeUndefined();
  });
});
