import { describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { readBackendLayers } from '../src/compose';
import { publishChecks } from '../src/publish-checks';
import { readLayerFile } from '../src/layer-store';
import { uiCatalog, uiScreenMarkdown } from '../src/ui-catalog';
import { uiCatalogMain } from '../src/ui-catalog-cli';
import { gatherUiPictures, uiCatalogHtml, uiExportEvidence, uiPicturesWanted } from '../src/ui-catalog-export';
import { uiStateLayer, type UiStateCapture } from '../src/ui-catalog-publish';
import { memoryStore } from './memory-store';

const PNG = (tail: string) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new TextEncoder().encode(tail)]);
const profile = { environment: 'desktop-web', profile: { scheme: 'light' } } as const;

async function build(states: UiStateCapture[]) {
  const store = memoryStore();
  await publishChecks(store, uiStateLayer({ producer: 'capture', recordedAtMs: 2, ...profile, states }));
  const read = await readBackendLayers([{ id: 'ci', store }]);
  const catalog = uiCatalog(read.loaded.map(item => item.evidence), { backends: read.backends, notices: read.notices });
  const readPicture = async (want: { layer: string; bundleKey: string }) => (await readLayerFile(store, want.layer, want.bundleKey))?.bytes ?? null;
  return { store, catalog, readPicture };
}

describe('#90: a capture carries more than one picture and its diagnostics', () => {
  test('1: one primary and two supplemental views stay with the same state and profile, in order and with their labels', async () => {
    const { catalog } = await build([{
      id: 'checkout', screenshot: { data: PNG('main'), width: 10, height: 20 },
      attachments: [
        { label: 'Order summary, scrolled', order: 2, data: PNG('summary'), width: 10, height: 40 },
        { label: 'Payment panel', order: 1, data: PNG('payment') }
      ]
    }]);
    expect(catalog.states).toHaveLength(1);
    const [cell] = catalog.states[0]!.cells;
    expect(catalog.states[0]!.cells).toHaveLength(1);
    expect(cell!.coverage).toBe('captured');
    expect(cell!.capture!.image).toMatchObject({ name: 'checkout.png', width: 10, height: 20 });
    expect(cell!.capture!.attachments!.map(item => [item.label, item.role, item.order])).toEqual([['Payment panel', 'view', 0], ['Order summary, scrolled', 'view', 1]]);
    expect(cell!.capture!.attachments!.every(item => item.path?.startsWith('/layers/') && item.sha256)).toBe(true);
    expect(cell!.capture!.attachments![1]).toMatchObject({ width: 10, height: 40, name: 'checkout-Order-summary-scrolled.png' });
  });

  test('2: a trace and a video on a failed capture are reachable, and the capture stays failed', async () => {
    const { catalog } = await build([{
      id: 'pay', status: 'failed', detail: 'never stabilised', screenshot: { data: PNG('what it showed') },
      attachments: [{ role: 'trace', contentType: 'application/zip', data: new Uint8Array([80, 75, 3, 4]) }, { role: 'video', contentType: 'video/webm', uri: 'https://ci.example/v.webm' }]
    }]);
    const cell = catalog.states[0]!.cells[0]!;
    expect(cell.coverage).toBe('failed');
    expect(cell.capture!.status).toBe('failed');
    expect(cell.capture!.attachments!.map(item => item.role)).toEqual(['trace', 'video']);
    expect(cell.capture!.attachments![0]!.path).toContain('/blobs/');
    expect(cell.capture!.attachments![1]!.uri).toBe('https://ci.example/v.webm');
    // The primary picture is still the screenshot, never a supplemental view.
    expect(cell.capture!.image!.name).toBe('pay.png');
    expect(uiScreenMarkdown(catalog.states[0]!)).toContain('More evidence: ` pay-trace.zip ` (` trace `)');
  });

  test('3: an older producer with only a screenshot publishes, reads and renders exactly as before', async () => {
    const input = uiStateLayer({ producer: 'capture', recordedAtMs: 2, ...profile, states: [{ id: 'home', screenshot: { data: PNG('home') } }] });
    expect(input.checks[0]!.attachments).toEqual([{ name: 'home.png', role: 'screenshot', contentType: 'image/png', data: PNG('home') }]);
    const { catalog, readPicture } = await build([{ id: 'home', screenshot: { data: PNG('home') } }]);
    const capture = catalog.states[0]!.cells[0]!.capture!;
    expect('attachments' in capture).toBe(false);
    const { pictures, left } = await gatherUiPictures(uiPicturesWanted(catalog), readPicture, { maxBytes: 1 << 20 });
    const html = uiCatalogHtml(catalog, { pictures, left, generatedAtMs: 0 });
    expect(html).not.toContain('ui-catalog-evidence');
    expect(html).not.toContain('More evidence');
    expect(uiExportEvidence(catalog)).toEqual([]);
  });

  test('3: a supplemental picture never becomes the primary one, even when the capture has no screenshot', async () => {
    const { catalog } = await build([{ id: 'blind', status: 'failed', detail: 'no picture', attachments: [{ label: 'Sidebar', data: PNG('side') }] }]);
    const capture = catalog.states[0]!.cells[0]!.capture!;
    expect(capture.image).toBeNull();
    expect(capture.attachments).toHaveLength(1);
  });

  test('4: an attachment without bytes is published as omitted, and never turns a failure into a success', async () => {
    const { catalog } = await build([
      { id: 'a', status: 'failed', detail: 'boom', screenshot: { data: PNG('a') }, attachments: [{ role: 'trace', name: 'trace.zip' }, { role: 'log', omitted: 'policy' }] },
      { id: 'b', screenshot: { data: PNG('b') }, attachments: [{ label: 'Missing view' }] }
    ]);
    const [a, b] = catalog.states.map(state => state.cells[0]!);
    expect(a!.coverage).toBe('failed');
    expect(a!.capture!.attachments!.map(item => item.omitted)).toEqual(['not-found', 'policy']);
    expect(a!.capture!.attachments!.every(item => item.path === undefined)).toBe(true);
    expect(b!.coverage).toBe('captured');
    expect(b!.capture!.attachments![0]!.omitted).toBe('not-found');
  });

  test('4: the CLI reads attachment files by the picture rules, and records one it cannot read as omitted', async () => {
    const outer = await mkdtemp(path.join(tmpdir(), 'atlas-ui-attachments-'));
    const dir = path.join(outer, 'run');
    await mkdir(dir);
    await writeFile(path.join(outer, 'outside.png'), PNG('outside'));
    await writeFile(path.join(dir, 'main.png'), PNG('main'));
    await writeFile(path.join(dir, 'side.png'), PNG('side'));
    await writeFile(path.join(dir, 'captures.json'), JSON.stringify({ states: [
      { id: 'home', screenshot: 'main.png', attachments: [{ path: 'side.png', label: 'Side', order: 1 }, { path: 'gone.zip', role: 'trace' }, { path: '../outside.png', label: 'Escape' }] },
      { id: 'pay', status: 'failed', detail: 'boom', screenshot: 'main.png', attachments: [{ path: 'gone.webm', role: 'video' }] }
    ] }));
    const store = path.join(dir, 'store');
    let out = '';
    const code = await uiCatalogMain(['publish', '--captures', 'captures.json', '--store', store, '--producer', 'cli', '--format', 'json'], { out: text => { out += text; }, cwd: dir, env: {} });
    expect(code).toBe(0);
    const result = JSON.parse(out) as { layer: { captured: number; failed: number }; warnings: string[] };
    expect(result.layer).toMatchObject({ captured: 1, failed: 1 });
    expect(result.warnings.some(warning => warning.includes('gone.zip'))).toBe(true);
    let status = '';
    await uiCatalogMain(['export', '--store', store, '--out', 'out.html', '--manifest', 'manifest.json', '--format', 'json'], { out: text => { status += text; }, cwd: dir, env: {} });
    const manifest = JSON.parse(await Bun.file(path.join(dir, 'manifest.json')).text()) as { states: { id: string; cells: { coverage: string; capture: { attachments: { label?: string; name: string; omitted?: string }[] } }[] }[]; exportEvidence: { name: string; embedded: boolean; reason?: string }[] };
    const home = manifest.states.find(state => state.id === 'home')!.cells[0]!;
    expect(home.coverage).toBe('captured');
    expect(home.capture.attachments.map(item => [item.label ?? item.name, item.omitted ?? null])).toEqual([['Side', null], ['gone.zip', 'not-found'], ['Escape', 'not-allowed']]);
    expect(manifest.states.find(state => state.id === 'pay')!.cells[0]!.coverage).toBe('failed');
    expect(manifest.exportEvidence.find(item => item.name === 'side.png')).toMatchObject({ embedded: true });
    expect(manifest.exportEvidence.find(item => item.name === 'gone.zip')!.reason).toContain('not-found');
  });

  test('5: an export that leaves media out by policy still lists it, and why, in its manifest', async () => {
    const { catalog, readPicture } = await build([{
      id: 'home', screenshot: { data: PNG('main') },
      attachments: [{ label: 'Detail', data: PNG('a much larger supplemental picture than the budget allows') }, { role: 'trace', contentType: 'application/zip', data: new Uint8Array([1, 2, 3]) }, { role: 'video', omitted: 'too-large' }]
    }]);
    const wanted = uiPicturesWanted(catalog);
    expect(wanted).toHaveLength(2);
    // Room for the primary picture only: the supplemental one is left out by the budget, after it.
    const { pictures, left } = await gatherUiPictures(wanted, readPicture, { maxBytes: PNG('main').length + 4 });
    expect(pictures.size).toBe(1);
    const html = uiCatalogHtml(catalog, { pictures, left, generatedAtMs: 0 });
    const evidence = JSON.parse(/<script type="application\/json" id="ui-catalog-evidence">([\s\S]*?)<\/script>/.exec(html)![1]!) as { label: string | null; role: string; embedded: boolean; reason: string }[];
    expect(evidence.map(item => [item.label ?? item.role, item.embedded])).toEqual([['Detail', false], ['trace', false], ['video', false]]);
    expect(evidence[0]!.reason).toContain("size limit");
    expect(evidence[1]!.reason).toContain('only pictures');
    expect(evidence[2]!.reason).toContain('too-large');
    expect(html).toContain('More evidence');
  });
});
