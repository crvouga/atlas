import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { defineConfig, functionDriver } from '../../core/src/index';
import { runConfig } from '../../core/src/config';
import { reportMain } from '../src/report-cli';
import type { ReportStatus } from '../../schema/src/layer';

/** A real statechart run, sharded as CI would across two nodes, reported as layers. */
const LAMP = {
  id: 'Lamp', initial: 'Off', meta: { description: 'A lamp.' },
  states: {
    Off: { meta: { description: 'Dark.' }, on: { 'Switches on': 'On' } },
    On: { meta: { description: 'Lit.' }, initial: 'Dim', on: { 'Switches off': 'Off' }, states: { Dim: { meta: { description: 'Low.' }, on: { Brightens: 'Bright' } }, Bright: { meta: { description: 'Full.' }, on: { Dims: 'Dim' } } } }
  }
};

class Lamp { power = 'off'; level = 'dim'; broken = false; }
let root: string;

function config(broken: boolean) {
  const is = (matches: (l: Lamp) => boolean) => ({ recognize: async (l: Lamp) => ({ matched: matches(l), signals: [{ signal: 'lamp', expected: 'visible', visible: matches(l) }] }) });
  return defineConfig<Lamp>({
    specs: path.join(root, 'specs'),
    driver: functionDriver(() => new Lamp()),
    stepTimeoutMs: 300,
    implementation: {
      setup: async () => undefined,
      events: {
        'Switches on': { kind: 'user', how: 'on', run: async l => { l.power = 'on'; l.level = 'dim'; } },
        'Switches off': { kind: 'user', how: 'off', run: async l => { l.power = 'off'; } },
        Brightens: { kind: 'user', how: 'brighten', run: async l => { l.level = broken ? 'dim' : 'bright'; } },
        Dims: { kind: 'user', how: 'dim', run: async l => { l.level = 'dim'; } }
      },
      states: { Off: is(l => l.power === 'off'), Dim: is(l => l.power === 'on' && l.level === 'dim'), Bright: is(l => l.power === 'on' && l.level === 'bright') }
    }
  });
}

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'atlas-layers-'));
  mkdirSync(path.join(root, 'specs'));
  writeFileSync(path.join(root, 'specs', 'lamp.machine.json'), JSON.stringify(LAMP));
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

async function gate(...stores: string[]) {
  let output = '';
  const code = await reportMain(['status', ...stores.flatMap(store => ['--store', store]), '--format', 'json'], { out: text => { output += text; }, cwd: root, env: {}, git: () => null });
  return { code, status: JSON.parse(output) as ReportStatus };
}
async function publish(store: string, manifest: string, extra: string[] = []) {
  await reportMain(['publish', '--store', store, '--producer', 'lamp', '--manifest', manifest, '--environment', 'desktop-web', '--sha', 'a'.repeat(40), '--branch', 'main', ...extra], { out: () => undefined, cwd: root, env: {}, git: () => null });
}

test('shards run apart, publish their own layers, and the aggregate is the whole plan', async () => {
  const shard = async (index: number, broken = false) => (await runConfig(config(broken), { mode: 'fast', retry: false, shard: { index, count: 2 }, output: path.join(root, `runs-${index}${broken ? '-broken' : ''}`) }, root));
  const first = await shard(1);
  const second = await shard(2);
  expect(first.manifest.paths.length).toBeGreaterThan(0);

  await publish('node-1', path.join(first.runDir, 'manifest.json'));
  expect((await gate('node-1')).status.checks.total).toBe(first.manifest.paths.length);
  expect((await gate('node-1')).status.ok).toBe(true);
  await publish('node-2', path.join(second.runDir, 'manifest.json'));

  const both = await gate('node-1', 'node-2');
  expect(both.code).toBe(0);
  // Each node reported only what it ran. Together they are the plan: nothing is double counted or lost.
  const planned = first.manifest.paths.length + second.manifest.paths.length;
  expect(both.status.checks).toMatchObject({ failed: 0, running: 0, 'not-run': 0, total: planned, passed: planned });
});

test('a later failing run of a path fails the aggregate, and the run that fixes it clears it', async () => {
  const broken = await runConfig(config(true), { mode: 'fast', retry: false, output: path.join(root, 'runs-broken') }, root);
  expect(broken.manifest.paths.some(item => item.status === 'failed')).toBe(true);
  // Recorded after the passing shards.
  await publish('node-3', path.join(broken.runDir, 'manifest.json'), ['--recorded-at', String(Date.now() + 60_000)]);
  expect((await gate('node-1', 'node-2', 'node-3')).code).toBe(1);

  const fixed = await runConfig(config(false), { mode: 'fast', retry: false, output: path.join(root, 'runs-fixed') }, root);
  await publish('node-4', path.join(fixed.runDir, 'manifest.json'), ['--recorded-at', String(Date.now() + 120_000)]);
  expect((await gate('node-1', 'node-2', 'node-3', 'node-4')).code).toBe(0);
});
