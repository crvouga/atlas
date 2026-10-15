import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runConfig } from './config';
import { functionDriver } from './run/types';
import { createAtlasServer } from '../../server/src/app';
import { listen } from '../../server/src/host';
import { memoryStore } from '../../reports/tests/memory-store';

test('runConfig streams a path before it finishes and archives its manifest on completion', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'atlas-core-live-'));
  const specs = path.join(root, 'specs');
  await mkdir(specs);
  await writeFile(path.join(specs, 'flow.machine.json'), JSON.stringify({ id: 'Flow', initial: 'Off', meta: { description: 'A switch.' }, states: { Off: { meta: { description: 'Off.' }, on: { Switch: 'On' } }, On: { type: 'final', meta: { description: 'On.' } } } }));
  await writeFile(path.join(specs, 'journeys.yaml'), 'journeys:\n  Turns on:\n    description: Turns the switch on.\n    events: [Switch]\n    endsIn: [On]\n');
  const app = createAtlasServer({ backends: [{ id: 'data', store: memoryStore() }], write: 'data' });
  await app.ready;
  const host = await listen(app.fetch, { host: '127.0.0.1', port: 0, maxBodyBytes: 32 << 20 });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const execution = runConfig({ specs, driver: functionDriver(() => ({ on: false })), output: path.join(root, 'out'), reporting: { url: host.url, flushMs: 0 },
    implementation: { setup: async () => {}, states: { Off: { recognize: async ctx => ({ matched: !ctx.on, signals: [] }) }, On: { recognize: async ctx => ({ matched: ctx.on, signals: [] }) } }, events: { Switch: { kind: 'user', how: 'Flip the switch.', run: async ctx => { await gate; ctx.on = true; } } } } }, { retry: false, workers: 1, log: () => {} }, root);
  // Capture a rejection immediately even if preparation fails before the feed is queried.
  void execution.catch(() => {});
  try {
    let feed: { runs: { status: string; running: number }[] } = { runs: [] };
    for (let i = 0; i < 100; i++) {
      feed = await (await fetch(`${host.url}/api/live`)).json();
      if (feed.runs[0]?.running) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(feed.runs[0]).toMatchObject({ status: 'running', running: 1 });
    release();
    const outcome = await execution;
    expect(outcome.ok).toBe(true);
    const final = await (await fetch(`${host.url}/api/live`)).json();
    expect(final.runs[0]).toMatchObject({ status: 'completed', running: 0, completed: 1, passed: 1 });
    const runs = await (await fetch(`${host.url}/api/data/runs/index.json`)).json();
    expect(runs.runs.map((run: { id: string }) => run.id)).toContain(outcome.manifest.run.id);
    const effective = await (await fetch(`${host.url}/api/reports/evidence/effective`)).json();
    expect(effective.layers.flatMap((entry: { rows: { status: string }[] }) => entry.rows).map((row: { status: string }) => row.status)).toEqual(['passed']);
  } finally { release(); await execution.catch(() => {}); app.close(); await host.close(); await rm(root, { recursive: true, force: true }); }
}, 15_000);
