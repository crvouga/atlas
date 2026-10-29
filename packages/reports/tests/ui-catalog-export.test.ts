import { describe, expect, test } from 'bun:test';

import { readBackendLayers } from '../src/compose';
import { publishChecks } from '../src/publish-checks';
import { readLayerFile } from '../src/layer-store';
import { uiCatalog } from '../src/ui-catalog';
import { gatherUiPictures, sniffImage, uiCatalogHtml, uiPicturesWanted } from '../src/ui-catalog-export';
import { uiPlanLayer, uiStateLayer, type UiStateCapture } from '../src/ui-catalog-publish';
import { memoryStore } from './memory-store';

const PNG = (tail: string) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new TextEncoder().encode(tail)]);
const light = { environment: 'desktop-web', profile: { scheme: 'light' } } as const;

async function build(states: UiStateCapture[], plan: string[] = []) {
  const store = memoryStore();
  if (plan.length) await publishChecks(store, uiPlanLayer({ producer: 'planner', recordedAtMs: 1, ...light, states: plan.map(id => ({ id })) }));
  await publishChecks(store, uiStateLayer({ producer: 'capture', recordedAtMs: 2, ...light, sha: 'c'.repeat(40), states }));
  const read = await readBackendLayers([{ id: 'ci', store }]);
  const catalog = uiCatalog(read.loaded.map(item => item.evidence), { backends: read.backends, notices: read.notices });
  const readPicture = async (want: { layer: string; bundleKey: string }) => (await readLayerFile(store, want.layer, want.bundleKey))?.bytes ?? null;
  return { store, catalog, readPicture };
}

const manifestOf = (html: string) => JSON.parse(/<script type="application\/json" id="ui-catalog">([\s\S]*?)<\/script>/.exec(html)![1]!.replace(/\\u003c/g, '<').replace(/\\u003e/g, '>').replace(/\\u0026/g, '&'));

describe('the single-file export', () => {
  test('is one document with its pictures, its manifest and no reference to anything outside it', async () => {
    const { catalog, readPicture } = await build([{ id: 'home', title: 'Home', route: '/', screenshot: { data: PNG('home'), width: 10, height: 20 } }, { id: 'cart', title: 'Cart', status: 'failed', detail: 'timed out waiting for #total' }], ['home', 'cart', 'admin']);
    const { pictures, left } = await gatherUiPictures(uiPicturesWanted(catalog), readPicture, { maxBytes: 1 << 20 });
    const html = uiCatalogHtml(catalog, { pictures, left, generatedAtMs: Date.UTC(2026, 0, 2, 3, 4, 5) });
    expect(html).toContain('Made 2026-01-02 03:04:05 UTC');
    expect(html).toContain('does not update');
    expect(html).toContain('<img alt="Home, Desktop web · light" loading="lazy" src="data:image/png;base64,');
    expect(html).toContain('width="10" height="20"');
    // A failure says why; nothing that was not captured is called captured.
    expect(html).toContain('timed out waiting for #total');
    expect(html).toContain('Capture failed');
    // No network: nothing but data addresses, and a policy that forbids the rest.
    expect(html).toContain("default-src 'none'; img-src data:");
    expect(html.match(/(?:src|href)="(?!data:)[^"]*"/g) ?? []).toEqual([]);
    expect(manifestOf(html)).toEqual(JSON.parse(JSON.stringify(catalog)));
    expect(uiCatalogHtml(catalog, { pictures, left, generatedAtMs: 5 })).toBe(uiCatalogHtml(catalog, { pictures, left, generatedAtMs: 5 }));
  });

  test('says when what should exist is unknown, and when a backend could not be read', async () => {
    const { catalog } = await build([{ id: 'home' }]);
    expect(uiCatalogHtml(catalog)).toContain('No expected set was published');
    const withNotice = { ...catalog, sources: { ...catalog.sources, backends: [{ id: 'lab', label: 'Device lab', live: false, available: false }], notices: ['Device lab is unavailable: down'] } };
    const html = uiCatalogHtml(withNotice);
    expect(html).toContain('Device lab is unavailable: down');
    expect(html).toContain('nothing that depends on them is shown as captured');
  });

  test('text from a test run cannot become markup or script', async () => {
    const hostile = '</script><img src=x onerror=alert(1)>"\'&';
    const { catalog } = await build([{ id: hostile, title: hostile, route: hostile, detail: hostile, status: 'failed', area: hostile, labels: { shard: hostile } }]);
    const html = uiCatalogHtml(catalog);
    expect(html).not.toContain('<img src=x');
    expect(html.match(/<\/script>/g)).toHaveLength(2);
    expect(html).toContain('&lt;/script&gt;&lt;img src=x onerror=alert(1)&gt;&quot;&#39;&amp;');
    expect(manifestOf(html).states[0].id).toBe(hostile);
  });

  test('only addresses a browser may follow are linked', async () => {
    const { catalog } = await build([{ id: 'ok', screenshot: { uri: 'https://example.com/a.png' } }, { id: 'bad', screenshot: { uri: 'javascript:alert(1)' } }]);
    const html = uiCatalogHtml(catalog);
    expect(html).toContain('<a href="https://example.com/a.png" rel="noopener noreferrer">');
    expect(html).not.toContain('javascript:alert');
  });

  test('keeps to a size budget in the order of the page and says what it left out; the manifest stays complete', async () => {
    const { catalog, readPicture } = await build(['a', 'b', 'c'].map(id => ({ id, screenshot: { data: PNG(id.repeat(100)) } })));
    const size = PNG('a'.repeat(100)).length;
    const gathered = await gatherUiPictures(uiPicturesWanted(catalog), readPicture, { maxBytes: size * 2 });
    expect(gathered.pictures.size).toBe(2);
    expect(gathered.bytes).toBe(size * 2);
    expect([...gathered.left.values()]).toEqual([expect.stringContaining('size limit')]);
    const html = uiCatalogHtml(catalog, gathered);
    expect(html).toContain('would pass the export');
    expect(manifestOf(html).states).toHaveLength(3);
    // The same budget gives the same pictures.
    expect([...(await gatherUiPictures(uiPicturesWanted(catalog), readPicture, { maxBytes: size * 2 })).pictures.keys()]).toEqual([...gathered.pictures.keys()]);
  });

  test('embeds only raster images by what their bytes are, and a picture that cannot be read is left out, not a failed export', async () => {
    const { catalog } = await build([{ id: 'svg', screenshot: { data: new TextEncoder().encode('<svg onload=alert(1)/>'), contentType: 'image/svg+xml' } }, { id: 'png', screenshot: { data: PNG('ok') } }, { id: 'gone', screenshot: { data: PNG('gone') } }]);
    const wanted = uiPicturesWanted(catalog);
    expect(wanted).toHaveLength(3);
    const gathered = await gatherUiPictures(wanted, async want => {
      const state = catalog.states.find(candidate => candidate.cells.some(cell => `${cell.capture!.origin.layer}/${cell.capture!.image!.bundleKey}` === want.key))!;
      if (state.id === 'gone') throw new Error('store unavailable');
      if (state.id === 'svg') return new TextEncoder().encode('<svg onload=alert(1)/>');
      return PNG('ok');
    }, { maxBytes: 1 << 20 });
    expect(gathered.pictures.size).toBe(1);
    expect([...gathered.left.values()].sort()).toEqual(['could not be read (store unavailable)', 'is not a PNG, JPEG, GIF or WebP image']);
    expect(uiCatalogHtml(catalog, gathered)).not.toContain('onload');
    expect(sniffImage(new TextEncoder().encode('<svg/>'))).toBeNull();
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImage(new TextEncoder().encode('GIF89a'))).toBe('image/gif');
    expect(sniffImage(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
  });
});
