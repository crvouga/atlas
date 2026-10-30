import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { UiCatalogCollectResultSchema } from '../../schema/src/cli-results';
import { createAtlasServer, type AtlasServer } from '../../server/src/app';
import { listen } from '../../server/src/host';
import { uiCatalogMain } from '../src/ui-catalog-cli';
import { memoryStore } from './memory-store';

const dirs: string[] = [];
const servers: AtlasServer[] = [];
const closers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  for (const server of servers.splice(0)) server.close();
  for (const close of closers.splice(0)) await close();
});

const CATALOG = `export default {
  name: 'web',
  matrix: { dimensions: { device: { values: ['mobile', 'desktop'], profile: device => ({ environment: device + '-web' }) }, scheme: { values: ['light', 'dark'] } } },
  states: async () => [{ id: 'home', route: '/' }, { id: 'settings', area: 'account' }],
  group: item => item.state.id + '|' + item.profile.device
};
`;

/** A collector as a project writes one: it reads the batch, "photographs" each state, and writes the captures beside it. */
const COLLECTOR = `import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const batch = JSON.parse(readFileSync(process.env.ATLAS_UI_BATCH, 'utf8'));
const dir = path.dirname(process.env.ATLAS_UI_CAPTURES);
const states = batch.states.map((state, i) => {
  if (process.env.FAIL_STATE === state.id) return { item: state.item, status: 'failed', detail: 'never ready' };
  writeFileSync(path.join(dir, i + '.png'), new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, i]));
  return { item: state.item, screenshot: i + '.png' };
});
console.log('captured', states.length);
writeFileSync(process.env.ATLAS_UI_CAPTURES, JSON.stringify({ states }));
`;

async function setup() {
  const dir = mkdtempSync(path.join(tmpdir(), 'ui-catalog-collect-'));
  dirs.push(dir);
  writeFileSync(path.join(dir, 'atlas.catalog.mjs'), CATALOG);
  writeFileSync(path.join(dir, 'collector.mjs'), COLLECTOR);
  const server = createAtlasServer({ backends: [{ id: 'data', store: memoryStore() }], write: 'data', tokens: [{ name: 'ci', role: 'publish', token: 'publish-token-12345' }], refreshMs: 60_000 });
  servers.push(server);
  await server.ready;
  const http = await listen(server.fetch, { port: 0, host: '127.0.0.1', maxBodyBytes: 16 * 1024 * 1024 });
  closers.push(() => http.close(100));
  const url = `http://127.0.0.1:${http.port}`;
  const exec = `"${process.execPath}" collector.mjs`;
  const run = async (argv: string[], env: Record<string, string> = {}) => {
    let out = '';
    const code = await uiCatalogMain(['collect', ...argv, '--format', 'json'], { out: text => { out += text; }, cwd: dir, env: { ATLAS_TOKEN: 'publish-token-12345', ...env }, git: () => null });
    return { code, doc: out ? UiCatalogCollectResultSchema.parse(JSON.parse(out)) : null };
  };
  return { dir, server, url, exec, run };
}

describe('atlas ui-catalog collect', () => {
  test('one command drains the queue through --exec, publishing every capture with its picture', async () => {
    const { url, exec, run, server } = await setup();
    const { code, doc } = await run(['--catalog', 'atlas.catalog.mjs', '--exec', exec, '--store', url, '--shard', 'laptop', '--batch-size', '2']);
    expect(code).toBe(0);
    expect(doc).toMatchObject({ ok: true, shard: 'laptop', stoppedBy: 'empty', definition: { name: 'web' }, units: { claimed: 4, collected: 4, lost: 0 }, items: { captured: 8, failed: 0 } });
    const catalog = await (await server.fetch(new Request('http://atlas.test/api/reports/ui-catalog', { headers: { authorization: 'Bearer publish-token-12345' } }))).json() as { summary: { coverage: { captured: number; missing: number } }; states: { cells: { capture: { image: { path?: string } | null; labels: Record<string, string> } }[] }[] };
    expect(catalog.summary.coverage).toMatchObject({ captured: 8, missing: 0 });
    expect(catalog.states[0]!.cells[0]!.capture.image?.path).toMatch(/^\/layers\//);
    expect(catalog.states[0]!.cells[0]!.capture.labels).toMatchObject({ shard: 'laptop', 'atlas.claim': expect.any(String) });
    // Running it again finds nothing due.
    expect((await run(['--catalog', 'atlas.catalog.mjs', '--exec', exec, '--store', url])).doc).toMatchObject({ stoppedBy: 'empty', claims: 0 });
  });

  test('--where narrows what a shard takes; a failing state fails the command; --max-units bounds it', async () => {
    const { url, exec, run } = await setup();
    const mobile = await run(['--catalog', 'atlas.catalog.mjs', '--exec', exec, '--store', url, '--where', 'device=mobile'], { FAIL_STATE: 'settings' });
    expect(mobile.code).toBe(1);
    // The failing unit is retried first until it hits the retry limit (3 in a row), then nothing is left for this shard.
    expect(mobile.doc).toMatchObject({ ok: false, stoppedBy: 'empty', claims: 3, units: { collected: 4 }, items: { captured: 2, failed: 6 } });
    const bounded = await run(['--catalog', 'atlas.catalog.mjs', '--exec', exec, '--store', url, '--max-units', '1']);
    expect(bounded.doc).toMatchObject({ stoppedBy: 'max-units', units: { claimed: 1 } });
  });

  test('a collector that exits non-zero records its items as failed, with the exit code', async () => {
    const { url, run } = await setup();
    const { code, doc } = await run(['--catalog', 'atlas.catalog.mjs', '--exec', 'exit 3', '--store', url, '--max-units', '1']);
    expect(code).toBe(1);
    expect(doc).toMatchObject({ items: { failed: 2, captured: 0 } });
  });

  test('4, 20: an unknown --where is a wrong command; a store that is not a server is refused; an unreachable server collects nothing', async () => {
    const { url, exec, run, dir } = await setup();
    await expect(run(['--catalog', 'atlas.catalog.mjs', '--exec', exec, '--store', url, '--where', 'device=tablet'])).rejects.toThrow(/device="tablet".*"mobile", "desktop"/);
    await expect(run(['--catalog', 'atlas.catalog.mjs', '--exec', exec, '--store', url, '--where', 'colour=red'])).rejects.toThrow(/dimension "colour".*"device", "scheme"/);
    await expect(run(['--catalog', 'atlas.catalog.mjs', '--exec', exec, '--store', path.join(dir, 'store')])).rejects.toThrow(/needs an Atlas server/);
    const unreachable = await run(['--catalog', 'atlas.catalog.mjs', '--exec', exec, '--store', 'http://127.0.0.1:9']);
    expect(unreachable.code).toBe(1);
    expect(unreachable.doc).toMatchObject({ ok: false, stoppedBy: 'unreachable', claims: 0, error: expect.stringMatching(/cannot reach/) });
  }, 30_000);
});
