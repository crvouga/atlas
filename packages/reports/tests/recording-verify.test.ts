import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { VerifyRecordingsResultSchema } from '../../schema/src/cli-results';
import { combineBackends } from '../src/compose';
import { videoCounts } from '../src/evidence-detail';
import { layerEvidence } from '../src/layer-merge';
import { LAYER_INDEX, layerSummary, publishLayerBundle, readLayer } from '../src/layer-store';
import { publishChecks } from '../src/publish-checks';
import { containerProblem, verifyLayerRecordings, verifyStoreRecordings } from '../src/recording-verify';
import { reportMain } from '../src/report-cli';
import { reportStatus } from '../src/report-status';
import { memoryStore } from './memory-store';

const base = { producer: 'web-e2e', recordedAtMs: 100, sha: 'a'.repeat(40), branch: 'main' };
/** The first bytes of a WebM file (EBML), then filler of the given length: it passes the container check. */
const webm = (fill: number, length = 16) => { const bytes = new Uint8Array(length).fill(fill); bytes.set([0x1a, 0x45, 0xdf, 0xa3]); return bytes; };
const video = (name: string, data: Uint8Array = webm(1)) => ({ name, role: 'video', contentType: 'video/webm', data });
const ui = (id: string, extra: object = {}) => ({ id, title: id, status: 'passed' as const, recordingExpectation: 'required', ...extra });

async function published(store = memoryStore()) {
  const layer = await publishChecks(store, { ...base, checks: [ui('a', { attachments: [video('a.webm', webm(1))] }), ui('b', { attachments: [video('b.webm', webm(2, 40))] })] });
  return { store, layer: (await readLayer(store, layer.id))! };
}

describe('container check', () => {
  test('recognizes the header of the container a media type names, and claims nothing for a type it has no signature for', () => {
    expect(containerProblem(webm(0), 'video/webm')).toBeNull();
    expect(containerProblem(new TextEncoder().encode('not a movie'), 'video/webm')).toContain('not video/webm');
    expect(containerProblem(new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0, 0]), 'video/mp4')).toBeNull();
    expect(containerProblem(new TextEncoder().encode('OggS....'), 'video/ogg')).toBeNull();
    expect(containerProblem(new Uint8Array(), 'video/webm')).toBe('the file is empty');
    expect(containerProblem(new Uint8Array([1, 2, 3]), 'video/x-custom')).toBeNull();
  });
});

describe('verifying stored recordings', () => {
  test('videos that are still stored as published verify clean', async () => {
    const { store, layer } = await published();
    const result = await verifyLayerRecordings(store, layer);
    expect(result).toMatchObject({ layer: layer.id, checked: 2, ok: 2, referenced: 0, gaps: [] });
  });

  test('a blob that now returns 404 is a gap naming the check, and the test results do not change', async () => {
    const { store, layer } = await published();
    const before = reportStatus(await combineBackends([{ id: 'ci', store }]));
    for (const entry of Object.values(layer.bundle)) for (const part of entry.parts) await store.delete(part.blob);
    const result = await verifyLayerRecordings(store, layer);
    expect(result.ok).toBe(0);
    expect(result.gaps.map(gap => [gap.check, gap.problem])).toEqual([['a', 'blob-missing'], ['b', 'blob-missing']]);
    const after = reportStatus(await combineBackends([{ id: 'ci', store }]));
    // The layer's outcomes are exactly what they were; only the status's recording receipt (publication) is as published.
    expect({ ok: after.ok, checks: after.checks, reasons: after.reasons }).toEqual({ ok: before.ok, checks: before.checks, reasons: before.reasons });
  });

  test('a file whose bytes changed is a size or checksum mismatch, and one that is not a webm is undecodable', async () => {
    const store = memoryStore();
    const garbage = new TextEncoder().encode('this is plain text, not a movie at all');
    const layer = await publishChecks(store, { ...base, checks: [ui('text', { attachments: [video('text.webm', garbage)] })] });
    const read = (await readLayer(store, layer.id))!;
    expect((await verifyLayerRecordings(store, read)).gaps).toMatchObject([{ check: 'text', problem: 'undecodable' }]);

    const { store: other, layer: stored } = await published();
    const tampered = structuredClone(stored);
    const attachment = (tampered.parts[0]!.checks[0]!.attachments as { bytes: number; sha256: string }[])[0]!;
    attachment.bytes += 1;
    expect((await verifyLayerRecordings(other, tampered)).gaps).toMatchObject([{ check: 'a', problem: 'size-mismatch' }]);
    attachment.bytes -= 1;
    attachment.sha256 = 'f'.repeat(64);
    expect((await verifyLayerRecordings(other, tampered)).gaps).toMatchObject([{ check: 'a', problem: 'checksum-mismatch' }]);
  });

  test('a store that cannot answer is unreadable, never verified; a reference by address is counted, not checked', async () => {
    const { store, layer } = await published();
    store.down = true;
    expect((await verifyLayerRecordings(store, layer)).gaps.map(gap => gap.problem)).toEqual(['unreadable', 'unreadable']);
    store.down = false;
    const referenced = await publishChecks(store, { ...base, producer: 'ref', checks: [ui('r', { attachments: [{ name: 'r.webm', role: 'video', uri: 'https://example.test/r.webm' }] })] });
    expect(await verifyLayerRecordings(store, (await readLayer(store, referenced.id))!)).toMatchObject({ checked: 0, referenced: 1, gaps: [] });
  });

  test('verifies every layer of a store, narrows by id, and names a layer it cannot read as a notice', async () => {
    const { store, layer } = await published();
    const second = await publishChecks(store, { ...base, producer: 'two', recordedAtMs: 200, checks: [ui('c', { attachments: [video('c.webm', webm(3, 50))] })] });
    const all = await verifyStoreRecordings(store);
    expect(all.layers.map(entry => entry.checked)).toEqual([1, 2]);
    expect((await verifyStoreRecordings(store, { ids: [layer.id.slice(0, 10)] })).layers.map(entry => entry.layer)).toEqual([layer.id]);
    expect((await verifyStoreRecordings(store, { limit: 1 })).layers.map(entry => entry.layer)).toEqual([second.id]);
    await store.delete(`layers/manifests/${second.id}.json`);
    const lost = await verifyStoreRecordings(store);
    expect(lost.layers).toHaveLength(1);
    expect(lost.notices[0]).toContain(second.id.slice(0, 12));
    expect(await store.listKeys(LAYER_INDEX)).toHaveLength(2);
  });
});

describe('a video whose bundle key is missing from the layer', () => {
  test('is unavailable, counted apart, and does not count as a playable recording', async () => {
    const store = memoryStore();
    const kept = await publishChecks(store, { ...base, checks: [ui('kept', { attachments: [video('kept.webm')] })] });
    const key = Object.keys((await readLayer(store, kept.id))!.bundle)[0]!;
    // A layer whose attachments name two files, but whose bundle holds only one of them.
    const layer = await publishLayerBundle(store, {
      producer: 'lost', recordedAtMs: 300, sha: null, branch: null, runUrl: null, parameters: {}, specs: [], source: null, recording: { type: 'layer' },
      parts: [{ kind: 'checks', id: 'lost', title: 'lost', recordedAtMs: 300, checks: [
        { id: 'here', title: 'here', status: 'passed', attachments: [{ name: 'here.webm', role: 'video', contentType: 'video/webm', bundleKey: key, sha256: key.split('/')[1]! }] },
        { id: 'gone', title: 'gone', status: 'passed', attachments: [{ name: 'gone.webm', role: 'video', contentType: 'video/webm', bundleKey: `attachments/${'9'.repeat(64)}`, sha256: '9'.repeat(64) }] }
      ] } as never]
    }, (await readLayer(store, kept.id))!.bundle);
    const summary = layerSummary((await readLayer(store, layer.id))!);
    expect(summary.unstored).toEqual([`attachments/${'9'.repeat(64)}`]);
    const rows = layerEvidence(summary, 'ci').rows;
    const gone = rows.find(row => row.id === 'gone')!.evidence!.videos!;
    expect(gone).toMatchObject([{ name: 'gone.webm', available: false, reason: 'not-in-bundle' }]);
    expect(gone[0]!.recording).toBeUndefined();
    expect(videoCounts(gone)).toEqual({ references: 1, recordings: 0, unavailable: 1, missing: 1 });
    expect(videoCounts(rows.find(row => row.id === 'here')!.evidence!.videos)).toEqual({ references: 1, recordings: 1, unavailable: 0 });
    expect(layerEvidence(summary, 'ci').rows.map(row => row.status)).toEqual(['passed', 'passed']);
    expect((await verifyLayerRecordings(store, (await readLayer(store, layer.id))!)).gaps).toMatchObject([{ check: 'gone', problem: 'not-in-bundle' }]);
  });

  test('a layer whose bundle holds every named file is unchanged', async () => {
    const { layer } = await published();
    expect(layerSummary(layer).unstored).toBeUndefined();
  });
});

describe('atlas report verify-recordings', () => {
  let root: string;
  beforeAll(async () => { root = await mkdtemp(path.join(tmpdir(), 'atlas-verify-')); });
  afterAll(async () => { await rm(root, { recursive: true, force: true }); });
  const run = async (args: string[]) => {
    let output = '';
    const code = await reportMain(args, { out: text => { output += text; }, env: {}, cwd: root, git: () => null, clock: () => 1_700_000_000_000 });
    return { code, output };
  };

  test('exits 0 while every video is retrievable; exits 1 naming the check once a blob is gone, and the gate is untouched', async () => {
    await mkdir(path.join(root, 'out'), { recursive: true });
    await writeFile(path.join(root, 'out/one.webm'), webm(5, 64));
    await writeFile(path.join(root, 'checks.json'), JSON.stringify({ producer: 'demo', recordedAtMs: 5, checks: [
      { id: 'one', title: 'one', status: 'passed', recordingExpectation: 'required', attachments: [{ name: 'one.webm', role: 'video', path: 'out/one.webm' }] }
    ] }));
    expect((await run(['publish', '--store', 'store', '--checks', 'checks.json'])).code).toBe(0);

    const clean = await run(['verify-recordings', '--store', 'store', '--format', 'json']);
    expect(clean.code).toBe(0);
    expect(VerifyRecordingsResultSchema.parse(JSON.parse(clean.output))).toMatchObject({ ok: true, layers: 1, checked: 1, verified: 1, gaps: [], notices: [] });
    expect((await run(['verify-recordings', '--store', 'store'])).output).toContain('1 of 1 stored video verified');

    for (const file of await readdir(path.join(root, 'store/layers/blobs'))) await unlink(path.join(root, 'store/layers/blobs', file));
    const broken = await run(['verify-recordings', '--store', 'store', '--format', 'json']);
    expect(broken.code).toBe(1);
    const result = VerifyRecordingsResultSchema.parse(JSON.parse(broken.output));
    expect(result).toMatchObject({ ok: false, checked: 1, verified: 0, gaps: [{ check: 'one', name: 'one.webm', problem: 'blob-missing' }] });
    expect(JSON.stringify(result)).not.toContain('out/one.webm');
    const text = await run(['verify-recordings', '--store', 'store']);
    expect(text.output).toContain('! blob-missing: one / one.webm');
    expect(text.output).toContain('Test results are unchanged');
    // The report still passes: verification is about stored bytes, not results.
    expect(JSON.parse((await run(['status', '--store', 'store', '--format', 'json'])).output)).toMatchObject({ ok: true, checks: { passed: 1 } });
  });

  test('refuses a short layer id and a bad limit as a mistake in the command', async () => {
    await expect(run(['verify-recordings', '--store', 'store', '--layer', 'abc'])).rejects.toThrow('at least 7');
    await expect(run(['verify-recordings', '--store', 'store', '--limit', 'few'])).rejects.toThrow('whole number');
  });
});
