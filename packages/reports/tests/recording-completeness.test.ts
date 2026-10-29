import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { ReportStatusSchema, parseLayerDocument } from '../../schema/src/layer';
import { PublishResultSchema } from '../../schema/src/cli-results';
import { combineBackends } from '../src/compose';
import { publishChecks } from '../src/publish-checks';
import { reportMain } from '../src/report-cli';
import { formatStatusText, reportStatus } from '../src/report-status';
import { memoryStore } from './memory-store';

const base = { producer: 'web-e2e', recordedAtMs: 100, sha: 'a'.repeat(40), branch: 'main' };
const video = (name: string, bytes = 8) => ({ name, role: 'video', contentType: 'video/webm', data: new Uint8Array(bytes).fill(7) });
const ui = (id: string, extra: object = {}) => ({ id, title: id, status: 'passed' as const, recordingExpectation: 'required', ...extra });

async function status(store: ReturnType<typeof memoryStore>) {
  return reportStatus(await combineBackends([{ id: 'ci', store }]));
}

describe('recording completeness', () => {
  test('three required recordings that all upload give a 3/3 receipt with hashes and bytes, and the report exposes it', async () => {
    const store = memoryStore();
    const layer = await publishChecks(store, { ...base, checks: ['a', 'b', 'c'].map((id, index) => ui(id, { attachments: [video(`${id}.webm`, 8 + index)] })) });
    expect(layer.recordings).toMatchObject({ expected: 3, uploaded: 3, referenced: 0, skipped: 0, unresolved: 0, notApplicable: 0 });
    expect(layer.recordings!.items.map(item => [item.check, item.state, item.files?.[0]?.bytes])).toEqual([['a', 'uploaded', 8], ['b', 'uploaded', 9], ['c', 'uploaded', 10]]);
    for (const item of layer.recordings!.items) expect(item.files![0]!.sha256).toMatch(/^[0-9a-f]{64}$/);

    const result = ReportStatusSchema.parse(await status(store));
    expect(result.ok).toBe(true);
    expect(result.recordings).toMatchObject({ state: 'complete', expected: 3, uploaded: 3, gaps: [], layersWithoutReceipt: 0 });
    expect(formatStatusText(result)).toContain('recordings: complete — 3 of 3 expected published');
  });

  test('an absent or oversized video is a gap with a reason; the test result is not rewritten', async () => {
    const store = memoryStore();
    const layer = await publishChecks(store, {
      ...base,
      checks: [ui('present', { attachments: [video('present.webm')] }), ui('absent'), ui('huge', { status: 'failed', attachments: [video('huge.webm', 64)] })]
    }, { maxAttachmentBytes: 32 });
    expect(layer.recordings).toMatchObject({ expected: 3, uploaded: 1, skipped: 1, unresolved: 1 });
    const huge = layer.recordings!.items.find(item => item.check === 'huge')!;
    expect(huge).toMatchObject({ state: 'skipped', reason: 'too-large' });
    expect(huge.files![0]).toMatchObject({ bytes: 64, reason: 'too-large' });
    expect(layer.recordings!.items.find(item => item.check === 'absent')).toMatchObject({ state: 'unresolved', reason: 'no-video-attached' });

    const result = await status(store);
    expect(result.checks).toMatchObject({ passed: 2, failed: 1, total: 3 });
    expect(result.recordings!.state).toBe('incomplete');
    expect(result.recordings!.gaps.map(gap => [gap.check, gap.state])).toEqual([['absent', 'unresolved'], ['huge', 'skipped']]);
    // The gate is about the checks: only the failed one is in `reasons`.
    expect(result.reasons).toEqual(['1 check failed']);
  });

  test('an oversized attachment that is not an expected recording still fails the publish as before', async () => {
    await expect(publishChecks(memoryStore(), { ...base, checks: [{ id: 'x', title: 'x', status: 'passed', attachments: [video('x.webm', 64)] }] }, { maxAttachmentBytes: 32 })).rejects.toThrow('over the limit');
  });

  test('API-only checks are shown apart, and are neither missing videos nor recorded passes', async () => {
    const store = memoryStore();
    const layer = await publishChecks(store, { ...base, checks: [ui('ui', { attachments: [video('ui.webm')] }), { id: 'api', title: 'api', status: 'passed', recordingExpectation: 'not-applicable' }, { id: 'plain', title: 'plain', status: 'passed' }] });
    expect(layer.recordings).toMatchObject({ expected: 1, uploaded: 1, notApplicable: 1 });
    const result = await status(store);
    expect(result.recordings).toMatchObject({ state: 'complete', expected: 1, uploaded: 1, notApplicable: 1, gaps: [] });
  });

  test('a layer with no expectations is Unknown, not Complete, and so is an empty report', async () => {
    const store = memoryStore();
    const layer = await publishChecks(store, { ...base, checks: [{ id: 'old', title: 'old', status: 'passed', attachments: [video('old.webm')] }] });
    expect(layer.recordings).toBeUndefined();
    expect((await status(store)).recordings).toMatchObject({ state: 'unknown', expected: 0, layersWithoutReceipt: 1 });
    expect(formatStatusText(await status(store))).not.toContain('recordings');
    expect((await status(memoryStore())).recordings!.state).toBe('unknown');
  });

  test('a layer that mixes with an old one is Unknown unless a gap is known; a gap is always visible', async () => {
    const store = memoryStore();
    await publishChecks(store, { ...base, producer: 'old', checks: [{ id: 'old', title: 'old', status: 'passed' }] });
    await publishChecks(store, { ...base, checks: [ui('ok', { attachments: [video('ok.webm')] })] });
    expect((await status(store)).recordings).toMatchObject({ state: 'unknown', uploaded: 1, layersWithoutReceipt: 1 });
    await publishChecks(store, { ...base, producer: 'gap', checks: [ui('gap')] });
    expect((await status(store)).recordings!.state).toBe('incomplete');
  });

  test('publishing again is the same layer and the same receipt; a newer run that supplies the video closes the gap', async () => {
    const input = { ...base, checks: [ui('a', { attachments: [video('a.webm')] }), ui('b')] };
    const store = memoryStore();
    const first = await publishChecks(store, input);
    const again = await publishChecks(store, input);
    expect(again.id).toBe(first.id);
    expect(again.recordings).toEqual(first.recordings);
    await publishChecks(store, { ...base, recordedAtMs: 200, checks: [ui('a', { attachments: [video('a.webm')] }), ui('b', { attachments: [video('b.webm')] })] });
    expect((await status(store)).recordings).toMatchObject({ state: 'complete', expected: 2, uploaded: 2 });
  });

  test('a reference by uri is counted apart from an upload, and never as missing', async () => {
    const layer = await publishChecks(memoryStore(), { ...base, checks: [ui('a', { attachments: [{ name: 'a.webm', role: 'video', uri: 'https://example.test/a.webm' }] })] });
    expect(layer.recordings).toMatchObject({ expected: 1, uploaded: 0, referenced: 1 });
  });

  test('a receipt a reader cannot read is dropped and the layer is kept', () => {
    const parsed = parseLayerDocument({ id: 'a'.repeat(64), producer: 'p', recordedAtMs: 1, sha: null, branch: null, runUrl: null, parts: [], recordings: { expected: 'many' } });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.layer.recordings).toBeUndefined();
  });
});

describe('atlas report publish --require-recordings', () => {
  let root: string;
  beforeAll(async () => { root = await mkdtemp(path.join(tmpdir(), 'atlas-rec-')); });
  afterAll(async () => { await rm(root, { recursive: true, force: true }); });
  const run = async (args: string[]) => {
    let output = '';
    const code = await reportMain(args, { out: text => { output += text; }, env: {}, cwd: root, git: () => null, clock: () => 1_700_000_000_000 });
    return { code, output };
  };

  test('exits nonzero naming the gap, still writes the layer and the passing result, and a retry with the file succeeds', async () => {
    await mkdir(path.join(root, 'out'), { recursive: true });
    await writeFile(path.join(root, 'out/one.webm'), 'one-video');
    const checks = (second: object[]) => JSON.stringify({ producer: 'demo', recordedAtMs: 5, checks: [
      { id: 'one', title: 'one', status: 'passed', recordingExpectation: 'required', attachments: [{ name: 'one.webm', role: 'video', path: 'out/one.webm' }] },
      { id: 'two', title: 'two', status: 'passed', recordingExpectation: 'required', attachments: second },
      { id: 'api', title: 'api', status: 'passed', recordingExpectation: 'not-applicable' }
    ] });
    await writeFile(path.join(root, 'checks.json'), checks([{ name: 'two.webm', role: 'video', path: 'out/missing.webm' }]));
    const failed = await run(['publish', '--store', 'store', '--checks', 'checks.json', '--require-recordings', '--format', 'json']);
    expect(failed.code).toBe(1);
    const result = PublishResultSchema.parse(JSON.parse(failed.output));
    expect(result.ok).toBe(false);
    expect(result.recordings).toMatchObject({ strict: true, complete: false, expected: 2, uploaded: 1, gaps: [{ check: 'two', state: 'skipped', reason: 'not-found' }] });
    expect(result.layer.recordings).toMatchObject({ expected: 2, uploaded: 1, skipped: 1, notApplicable: 1 });
    // No path, token or payload in the receipt.
    expect(JSON.stringify(result.layer.recordings)).not.toContain('missing.webm');
    // The test results were published, unchanged.
    const gate = JSON.parse((await run(['status', '--store', 'store', '--format', 'json'])).output);
    expect(gate).toMatchObject({ ok: true, checks: { passed: 3 }, recordings: { state: 'incomplete', gaps: [{ check: 'two' }] } });

    // Without the flag the same gap is reported but the command succeeds.
    const lenient = await run(['publish', '--store', 'store', '--checks', 'checks.json']);
    expect(lenient.code).toBe(0);
    expect(lenient.output).toContain('! recording skipped: two (not-found)');

    // The retry has the file: complete, exit 0, and the earlier gap is replaced.
    await writeFile(path.join(root, 'out/two.webm'), 'two-video');
    await writeFile(path.join(root, 'checks.json'), checks([{ name: 'two.webm', role: 'video', path: 'out/two.webm' }]).replace('"recordedAtMs":5', '"recordedAtMs":6'));
    const retried = await run(['publish', '--store', 'store', '--checks', 'checks.json', '--require-recordings']);
    expect(retried.code).toBe(0);
    expect(retried.output).toContain('Recordings: 2 of 2 expected published, 1 not applicable');
    expect(JSON.parse((await run(['status', '--store', 'store', '--format', 'json'])).output).recordings).toMatchObject({ state: 'complete', gaps: [] });
  });

  test('--require-recordings on checks that expect nothing succeeds', async () => {
    await writeFile(path.join(root, 'plain.json'), JSON.stringify({ producer: 'plain', recordedAtMs: 5, checks: [{ id: 'x', title: 'x', status: 'passed' }] }));
    expect((await run(['publish', '--store', 'plain-store', '--checks', 'plain.json', '--require-recordings'])).code).toBe(0);
  });
});
