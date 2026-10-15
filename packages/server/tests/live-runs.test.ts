import { afterEach, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { LiveRunStartSchema, LiveRunUpdateSchema } from '../../schema/src/live-run';
import { memoryStore } from '../../reports/tests/memory-store';
import { createLiveReporter } from '../../reports/src/live-reporter';
import { createAtlasServer, type AtlasServer } from '../src/app';
import { LiveRuns } from '../src/live-runs';
import { listen, type RunningServer } from '../src/host';

const apps: AtlasServer[] = [];
const hosts: RunningServer[] = [];
afterEach(async () => { apps.splice(0).forEach(app => app.close()); await Promise.all(hosts.splice(0).map(host => host.close())); });
const start = (id = randomUUID()) => LiveRunStartSchema.parse({ id, producer: 'unit', plannedChecks: 2 });
const update = (sequence: number, checks: { id: string; title: string; status: 'running' | 'passed' | 'failed' | 'not-run' }[] = [], finish?: 'completed' | 'interrupted') => LiveRunUpdateSchema.parse({ sequence, checks, finish });

test('a test is visible while running, its result arrives before suite completion, and heartbeats do not make layers', async () => {
  const app = createAtlasServer({ backends: [{ id: 'data', store: memoryStore() }], write: 'data' });
  apps.push(app);
  await app.ready;
  const host = await listen(app.fetch, { host: '127.0.0.1', port: 0, maxBodyBytes: 32 << 20 });
  hosts.push(host);
  const client = createLiveReporter({ producer: 'unit', plannedChecks: 2 }, { url: host.url, heartbeatMs: 100_000 });
  const get = async () => (await (await fetch(`${host.url}/api/live`)).json()).runs[0];
  client.check({ id: 'a', title: 'Adds a todo', status: 'running', detail: 'Clicking Add' });
  await client.flush();
  expect(await get()).toMatchObject({ status: 'running', running: 1, completed: 0, current: [{ title: 'Adds a todo', detail: 'Clicking Add' }] });
  expect(app.index.snapshot().totalLayers).toBe(0);
  client.check({ id: 'a', title: 'Adds a todo', status: 'passed' });
  client.check({ id: 'b', title: 'Syncs the list', status: 'running' });
  await client.flush();
  expect(await get()).toMatchObject({ status: 'running', completed: 1, passed: 1, running: 1 });
  expect(app.index.snapshot().layers.flatMap(entry => entry.rows).map(row => row.status)).toEqual(['passed']);
  const layers = app.index.snapshot().totalLayers;
  await fetch(`${host.url}/api/live/${client.id}/heartbeat`, { method: 'POST' });
  expect(app.index.snapshot().totalLayers).toBe(layers);
  client.check({ id: 'b', title: 'Syncs the list', status: 'failed', detail: 'Connection dropped' });
  await client.finish();
  expect(await get()).toMatchObject({ status: 'completed', completed: 2, passed: 1, failed: 1, running: 0 });
});

test('expired producers cannot revive a run, and completed outcomes survive interruption and restart', async () => {
  let now = 1000;
  const store = memoryStore();
  const layers: string[] = [];
  const options = { store, now: () => now, timeoutMs: 30_000, stalledMs: 900_000, onChange: () => {}, onLayer: async (_key: string, layer: { id: string }) => { layers.push(layer.id); } };
  const live = new LiveRuns(options);
  const identity = start();
  await live.start(identity, 'owner');
  await live.update(identity.id, update(1, [{ id: 'done', title: 'done', status: 'passed' }, { id: 'pending', title: 'pending', status: 'running' }]), 'owner');
  now = 20_000;
  await live.heartbeat(identity.id, 'owner');
  now = 45_000;
  await live.sweep();
  expect((await live.list())[0]!.status).toBe('running');
  now = 50_000;
  await expect(live.heartbeat(identity.id, 'owner')).rejects.toThrow('heartbeat timed out');
  expect((await live.list())[0]).toMatchObject({ status: 'interrupted', completed: 1, passed: 1, running: 0, current: [{ status: 'not-run' }] });
  await expect(live.update(identity.id, update(2), 'owner')).rejects.toThrow('ended');
  expect(layers).toHaveLength(1);
  const active = start();
  await live.start(active, 'owner');
  const restored = new LiveRuns(options);
  await restored.ready;
  expect((await restored.list()).every(run => run.status === 'interrupted')).toBe(true);
  expect((await restored.list()).find(run => run.id === active.id)!.reason).toContain('restarted');
});

test('heartbeats do not conceal a progress stall, and disabling stall detection permits long tests', async () => {
  let now = 0;
  for (const stalledMs of [20_000, 0]) {
    const live = new LiveRuns({ store: memoryStore(), now: () => now, timeoutMs: 30_000, stalledMs, onChange: () => {}, onLayer: async () => {} });
    const identity = start();
    now = 0;
    await live.start(identity, 'owner');
    now = 10_000;
    await live.heartbeat(identity.id, 'owner');
    now = 20_000;
    await live.sweep();
    expect((await live.list())[0]!.status).toBe(stalledMs ? 'interrupted' : 'running');
  }
});

test('ordered updates fence stale writers; retries and a rejected finish do not double count', async () => {
  let now = 1000;
  const live = new LiveRuns({ store: memoryStore(), now: () => now, timeoutMs: 30_000, stalledMs: 0, onChange: () => {}, onLayer: async () => {} });
  const identity = start();
  await live.start(identity, 'owner');
  const input = update(1, [{ id: 'a', title: 'a', status: 'running' }]);
  await live.update(identity.id, input, 'owner');
  await live.update(identity.id, input, 'owner');
  await expect(live.update(identity.id, update(1), 'owner')).rejects.toThrow('stale');
  await expect(live.heartbeat(identity.id, 'other')).rejects.toThrow('another publisher');
  await expect(live.update(identity.id, update(2, [], 'completed'), 'owner')).rejects.toThrow('Finish running');
  expect((await live.list())[0]).toMatchObject({ sequence: 1, running: 1, completed: 0 });
  now += 10;
  const final = update(2, [{ id: 'a', title: 'a', status: 'passed' }], 'completed');
  await live.update(identity.id, final, 'owner');
  await live.update(identity.id, final, 'owner');
  expect((await live.list())[0]).toMatchObject({ sequence: 2, completed: 1, passed: 1, running: 0, status: 'completed' });
});

test('a failed summary write is retried with the same result layer and unchanged counters', async () => {
  const store = memoryStore();
  const put = store.put.bind(store);
  let refuse = false;
  store.put = async (key, ...rest) => { if (refuse && key.startsWith('server/live/')) { refuse = false; throw new Error('temporary storage outage'); } return put(key, ...rest); };
  const layers: string[] = [];
  const live = new LiveRuns({ store, timeoutMs: 30_000, stalledMs: 0, onChange: () => {}, onLayer: async (_key, layer) => { layers.push(layer.id); } });
  const identity = start();
  await live.start(identity, 'owner');
  const input = update(1, [{ id: 'a', title: 'a', status: 'passed' }]);
  refuse = true;
  await expect(live.update(identity.id, input, 'owner')).rejects.toThrow('temporary');
  expect((await live.list())[0]).toMatchObject({ sequence: 0, completed: 0 });
  await live.update(identity.id, input, 'owner');
  expect(new Set(layers).size).toBe(1);
  expect((await live.list())[0]).toMatchObject({ sequence: 1, completed: 1 });
});

test('one SSE stream carries start, logs, heartbeat, completion, and expiry without publisher credentials', async () => {
  let now = 1000;
  const app = createAtlasServer({ backends: [{ id: 'data', store: memoryStore() }], write: 'data', now: () => now, runTimeoutMs: 10_000 });
  apps.push(app);
  await app.ready;
  const stream = await app.fetch(new Request('http://atlas/api/events'));
  const reader = stream.body!.getReader();
  const decoder = new TextDecoder();
  const next = async (event: string) => {
    for (let i = 0; i < 20; i++) {
      const frame = decoder.decode((await reader.read()).value);
      if (frame.includes(`event: ${event}\n`)) return JSON.parse(frame.split('data: ')[1]!.split('\n')[0]!);
    }
    throw Error('Missing event '+event);
  };
  const send = async (path: string, body?: unknown, method = 'POST') => {
    const response = await app.fetch(new Request('http://atlas/api/live'+path, { method, ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}) }));
    expect(response.ok).toBe(true);
  };
  try {
    expect(await next('hello')).toMatchObject({ heartbeatMs: 15_000 });
    const first = start();
    await send('/'+first.id, first);
    expect(await next('run')).toMatchObject({ id: first.id, status: 'running', sequence: 0 });
    await send('/'+first.id, { sequence: 1, checks: [{ id: 'a', title: 'A', status: 'running', detail: 'Opening the page' }] }, 'PATCH');
    const progress = await next('run');
    expect(progress.current[0].detail).toBe('Opening the page');
    expect(progress.owner).toBeUndefined();
    now = 2000;
    await send('/'+first.id+'/heartbeat');
    expect(await next('run')).toMatchObject({ lastHeartbeatAtMs: 2000, sequence: 1 });
    await send('/'+first.id, { sequence: 2, checks: [{ id: 'a', title: 'A', status: 'passed' }], finish: 'completed' }, 'PATCH');
    expect(await next('report')).toMatchObject({ addedTotal: 1 });
    expect(await next('run')).toMatchObject({ status: 'completed', passed: 1, running: 0 });
    const second = start();
    await send('/'+second.id, second); await next('run');
    now = 12_001;
    // A heartbeat on an expired lease interrupts it before refusing renewal.
    const expired = await app.fetch(new Request('http://atlas/api/live/'+second.id+'/heartbeat', { method: 'POST' }));
    expect(expired.status).toBe(409);
    expect(await next('run')).toMatchObject({ status: 'interrupted', running: 0 });
  } finally { await reader.cancel(); }
});
