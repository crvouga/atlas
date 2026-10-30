import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { directoryStore } from '../../packages/reports/src/directory-store';
import type { UiCatalog } from '../../packages/reports/src/ui-catalog';
import { memoryStore } from '../../packages/reports/tests/memory-store';
import { createAtlasServer } from '../../packages/server/src/app';
import { listen } from '../../packages/server/src/host';
import { populateExampleCatalog } from './catalog';
import { publishExampleReports } from './publish';

// The example CI job installs Chromium; the ordinary unit-test gate needs no browser download.
test.skipIf(process.env.ATLAS_TEST_UI_CATALOG !== '1')('the example captures every UI state on desktop and mobile and uploads readable pictures', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'atlas-todo-catalog-'));
  const app = createAtlasServer({ backends: [{ id: 'data', store: memoryStore() }], write: 'data' });
  const http = await listen(app.fetch, { host: '127.0.0.1', port: 0, maxBodyBytes: 32 << 20 });
  try {
    await app.ready;
    await mkdir(path.join(root, 'specs'));
    await writeFile(path.join(root, 'specs/flow.machine.json'), JSON.stringify({ id: 'Flow', initial: 'Start', states: { Start: {} } }));
    await populateExampleCatalog(directoryStore(path.join(root, 'atlas-reports')));
    const base = `${http.url}/api/projects/${encodeURIComponent(process.env.ATLAS_PROJECT ?? 'todo-app')}/reports`;
    const read = async () => {
      await publishExampleReports(http.url, { root, out: () => {} });
      const response = await fetch(`${base}/ui-catalog`);
      expect(response.ok).toBe(true);
      return response.json() as Promise<UiCatalog>;
    };
    const catalog = await read();
    expect(catalog.states.map(state => state.id).sort()).toEqual([
      'todo/active', 'todo/completed', 'todo/empty', 'todo/naming', 'todo/offline', 'todo/offline-pending', 'todo/welcome'
    ]);
    expect(catalog.profiles.map(profile => profile.environment).sort()).toEqual(['desktop-web', 'mobile-web']);
    expect(catalog.surfaces.map(surface => surface.status)).toEqual(['covered', 'covered', 'covered']);
    const pictures = new Set<string>();
    for (const state of catalog.states) {
      expect(state.cells).toHaveLength(2);
      for (const cell of state.cells) {
        expect(cell.coverage).toBe('captured');
        expect(cell.expected).toBe('declared');
        const image = cell.capture!.image!;
        expect(image.path).toBeTruthy();
        const response = await fetch(`${base}${image.path}`);
        expect(response.ok).toBe(true);
        expect(response.headers.get('content-type')).toBe('image/png');
        const bytes = new Uint8Array(await response.arrayBuffer());
        expect([...bytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
        const png = new DataView(bytes.buffer);
        expect(`${png.getUint32(16)}x${png.getUint32(20)}`).toBe(cell.profile.parameters.viewport!);
        pictures.add(image.sha256!);
      }
    }
    expect(pictures.size).toBe(14);
    // Re-publishing saved captures preserves the same inventory and profile slots.
    expect((await read()).states).toEqual(catalog.states);
  } finally { app.close(); await http.close(); await rm(root, { recursive: true, force: true }); }
}, 60_000);
