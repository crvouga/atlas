import { describe, expect, test } from 'bun:test';

import { isVideoAttachment, summarizeEvidence, summarizeStoredEvidence, unstoredKeys, videoCounts } from '../src/evidence-detail';
import { ReportIndex } from '../src/report-index';
import { publishChecks } from '../src/publish-checks';
import { hasVideo, runDetail, runList, runsMarkdown } from '../src/test-catalog';
import { memoryStore } from './memory-store';

const bytes = (text: string) => new TextEncoder().encode(text);
const video = (name: string, text: string, extra: Record<string, unknown> = {}) => ({ name, contentType: 'video/webm', data: bytes(text), ...extra });
const RUN = (n: number) => `https://ci.example/runs/${n}`;

/** One run with videos at every level, a screenshot-only run, a log-only run, and a run whose only video is on a failed retry's step. */
async function fixture() {
  const store = memoryStore();
  const base = { producer: 'web', environment: 'desktop-web' };
  await publishChecks(store, {
    ...base, runUrl: RUN(1), recordedAtMs: 1_000, branch: 'main',
    attachments: [video('review.webm', 'movie', { role: 'demo' })],
    checks: [
      { id: 'a', title: 'A', status: 'passed', attachments: [video('a.webm', 'same')] },
      { id: 'b', title: 'B', status: 'passed', attachments: [video('b.webm', 'same'), video('c.webm', 'other')] },
    ],
  });
  await publishChecks(store, {
    ...base, runUrl: RUN(2), recordedAtMs: 2_000,
    checks: [{ id: 'a', title: 'A', status: 'passed', attachments: [{ name: 'shot.png', data: bytes('png'), contentType: 'image/png', role: 'video' }] }],
  });
  await publishChecks(store, {
    ...base, runUrl: RUN(3), recordedAtMs: 3_000,
    checks: [{ id: 'a', title: 'A', status: 'passed', attachments: [{ name: 'run.log', data: bytes('log') }] }],
  });
  await publishChecks(store, {
    ...base, runUrl: RUN(4), recordedAtMs: 4_000,
    checks: [{
      id: 'a', title: 'A', status: 'passed',
      attempts: [
        { index: 0, status: 'failed', steps: [{ name: 'Pay', attachments: [video('retry.mp4', 'retry', { contentType: undefined })] }] },
        { index: 1, status: 'passed' },
      ],
    }],
  });
  const index = new ReportIndex([{ id: 'one', store }]);
  await index.refresh();
  return index;
}

describe('which attachments are videos', () => {
  test('is decided by the effective media type, not the role', () => {
    expect(isVideoAttachment({ name: 'x.bin', role: 'demo', contentType: 'video/mp4' })).toBe(true);
    expect(isVideoAttachment({ name: 'x.mov' })).toBe(true);
    expect(isVideoAttachment({ name: 'x.png', role: 'video', contentType: 'image/png' })).toBe(false);
    expect(isVideoAttachment({ name: 'x.bin', role: 'video' })).toBe(true);
    expect(isVideoAttachment({ name: 'x.log' })).toBe(false);
  });

  test('a summary names who holds each video, and a reference with no bytes is unavailable', () => {
    const summary = summarizeEvidence({
      attachments: [{ name: 'a.webm', sha256: 'aa' }, { name: 'gone.webm' }],
      attempts: [{ index: 1, status: 'failed', attachments: [{ name: 'b.webm', uri: 'https://x/b.webm' }], steps: [{ name: 'Pay', attachments: [{ name: 'c.webm', bundleKey: 'attachments/cc' }] }] }],
    });
    expect(summary!.videos!.map(item => [item.name, item.owner, item.attempt, item.step, item.available])).toEqual([
      ['a.webm', 'check', undefined, undefined, true],
      ['gone.webm', 'check', undefined, undefined, false],
      ['b.webm', 'attempt', 1, undefined, true],
      ['c.webm', 'step', 1, 'Pay', true],
    ]);
    expect(videoCounts(summary!.videos)).toEqual({ references: 4, recordings: 3, unavailable: 1 });
    expect(videoCounts(undefined)).toBeUndefined();
    expect(summarizeEvidence({ attachments: [{ name: 'a.png' }] })!.videos).toBeUndefined();
  });
});

describe('runs and videos', () => {
  test('a run counts references and distinct recordings apart, including layer-level ones', async () => {
    const index = await fixture();
    const list = runList(index.history, 'v', 100);
    const first = list.runs.find(run => run.key === RUN(1))!;
    // Three check-level references to two recordings (a.webm and b.webm are the same bytes), plus the layer's review movie.
    expect(first.videos).toEqual({ references: 4, recordings: 3, unavailable: 0 });
    expect(runsMarkdown(list)).toContain('3 (4 references)');
  });

  test('Has video matches by effective media type, and finds a video held only by a failed retry step', async () => {
    const index = await fixture();
    const list = runList(index.history, 'v', 100, { video: true });
    expect(list.runs.map(run => run.key).sort()).toEqual([RUN(1), RUN(4)]);
    const retry = runDetail(index.history, 'v', RUN(4))!;
    expect(retry.results[0]!.videos).toEqual([{ name: 'retry.mp4', owner: 'step', attempt: 0, step: 'Pay', recording: expect.any(String), available: true }]);
    // The screenshot-only run (even with a mistaken `video` role) and the log-only run have none.
    expect(runList(index.history, 'v').runs.filter(run => run.videos).length).toBe(2);
  });

  test('the filter and the counts apply to every run before the limit', async () => {
    const index = await fixture();
    const list = runList(index.history, 'v', 1, { video: true });
    expect(list.total).toBe(2);
    expect(list.withVideo).toBe(2);
    expect(list.runs.map(run => run.key)).toEqual([RUN(4)]);
    // Without the filter the count is still the whole dataset's.
    const all = runList(index.history, 'v', 1);
    expect(all.total).toBe(4);
    expect(all.withVideo).toBe(2);
  });

  test('a reference that names no bytes is unavailable, never playable, and does not make a run "Has video"', () => {
    expect(hasVideo({ videos: { references: 1, recordings: 0, unavailable: 1 } })).toBe(false);
    expect(hasVideo({ videos: { references: 2, recordings: 1, unavailable: 1 } })).toBe(true);
    expect(hasVideo({})).toBe(false);
    expect(videoCounts([{ name: 'gone.webm', owner: 'check', available: false }])).toEqual({ references: 1, recordings: 0, unavailable: 1 });
  });

  test('a report with no video information stays readable', async () => {
    const store = memoryStore();
    await publishChecks(store, { producer: 'web', runUrl: RUN(1), recordedAtMs: 1, checks: [{ id: 'a', title: 'A', status: 'passed' }] });
    const index = new ReportIndex([{ id: 'one', store }]);
    await index.refresh();
    const list = runList(index.history, 'v', 100);
    expect(list.runs[0]!.videos).toBeUndefined();
    expect(list.withVideo).toBe(0);
    expect(runList(index.history, 'v', 100, { video: true }).total).toBe(0);
  });
});

describe('a video whose file the layer does not hold', () => {
  test('names the bundle keys no file backs, from the index alone', () => {
    const check = { attachments: [{ name: 'here.webm', bundleKey: 'attachments/here' }, { name: 'gone.webm', bundleKey: 'attachments/gone' }], steps: [{ name: 'Pay', attachments: [{ name: 'also-gone.webm', bundleKey: 'attachments/also' }] }] };
    expect(unstoredKeys({ parts: [{ checks: [check] }], bundle: { 'attachments/here': {} } }).sort()).toEqual(['attachments/also', 'attachments/gone']);
    expect(unstoredKeys({ attachments: [{ name: 'run.webm', bundleKey: 'attachments/run' }], parts: [], bundle: {} })).toEqual(['attachments/run']);
    expect(unstoredKeys({ parts: [{ checks: [check] }], bundle: { 'attachments/here': {}, 'attachments/gone': {}, 'attachments/also': {} } })).toEqual([]);
  });

  test('is unavailable, not a recording, unless an address or inline text also carries the bytes', () => {
    const lost = new Set(['attachments/gone']);
    const summary = summarizeStoredEvidence(undefined, lost, {
      attachments: [
        { name: 'here.webm', bundleKey: 'attachments/here' },
        { name: 'gone.webm', bundleKey: 'attachments/gone', sha256: 'aa' },
        { name: 'mirrored.webm', bundleKey: 'attachments/gone', uri: 'https://x/m.webm' },
      ],
    });
    expect(summary!.videos!.map(item => [item.name, item.available, item.recording])).toEqual([
      ['here.webm', true, 'attachments/here'],
      ['gone.webm', false, undefined],
      ['mirrored.webm', true, 'https://x/m.webm'],
    ]);
    expect(videoCounts(summary!.videos)).toEqual({ references: 3, recordings: 2, unavailable: 1 });
    // Without knowing what the layer lacks, the summary is what it always was.
    expect(summarizeStoredEvidence(undefined, undefined, { attachments: [{ name: 'gone.webm', bundleKey: 'attachments/gone' }] })!.videos![0]!.available).toBe(true);
  });

  test('a run whose only video was never stored is unavailable, does not make a run "Has video", and old runs are unchanged', async () => {
    const store = memoryStore();
    const base = { producer: 'web', environment: 'desktop-web' };
    await publishChecks(store, { ...base, runUrl: RUN(1), recordedAtMs: 1_000, checks: [{ id: 'a', title: 'A', status: 'passed', attachments: [video('ok.webm', 'ok')] }] });
    await publishChecks(store, {
      ...base, runUrl: RUN(2), recordedAtMs: 2_000,
      attachments: [{ name: 'review.webm', contentType: 'video/webm', bundleKey: 'attachments/never-uploaded' }],
      checks: [{ id: 'a', title: 'A', status: 'passed', attachments: [{ name: 'gone.webm', contentType: 'video/webm', bundleKey: 'attachments/never-uploaded-either', sha256: 'f'.repeat(64) }] }],
    });
    const index = new ReportIndex([{ id: 'one', store }]);
    await index.refresh();
    const list = runList(index.history, 'v', 100, { video: true });
    expect(list.runs.map(run => run.key)).toEqual([RUN(1)]);
    const all = runList(index.history, 'v', 100);
    expect(all.runs.find(run => run.key === RUN(2))!.videos).toEqual({ references: 2, recordings: 0, unavailable: 2 });
    expect(all.runs.find(run => run.key === RUN(1))!.videos).toEqual({ references: 1, recordings: 1, unavailable: 0 });
    expect(all.withVideo).toBe(1);
    const detail = runDetail(index.history, 'v', RUN(2))!;
    expect(detail.results[0]!.videos).toEqual([{ name: 'gone.webm', owner: 'check', available: false }]);
  });
});
