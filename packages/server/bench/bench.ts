/**
 * `bun packages/server/bench/bench.ts [layers] [checks]`: how the server behaves with a long history.
 * Not a test (it measures, it asserts nothing) and not shipped. Prints one line per thing measured.
 */
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

import { directoryStore } from '../../reports/src/directory-store';
import { httpStore } from '../../reports/src/http-store';
import { publishChecks } from '../../reports/src/publish-checks';
import { createAtlasServer } from '../src/app';
import { listen } from '../src/host';

const LAYERS = Number(process.argv[2] ?? 2000);
const CHECKS = Number(process.argv[3] ?? 100);
const COMBOS = 100;

const ms = (start: number) => `${(performance.now() - start).toFixed(1)} ms`;
const mib = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
const line = (name: string, value: string) => console.log(`${name.padEnd(46)} ${value}`);

// ATLAS_BENCH_DIR keeps the seeded data between runs, so the thing being changed can be measured without waiting for it.
const kept = process.env.ATLAS_BENCH_DIR;
const dir = kept ?? (await mkdtemp(path.join(tmpdir(), 'atlas-bench-')));
const seeded = kept !== undefined && existsSync(path.join(dir, 'layers'));
await mkdir(dir, { recursive: true });
try {
  const store = directoryStore(dir);
  let started = performance.now();
  const titles = Array.from({ length: CHECKS }, (_, i) => `Scenario ${i}: a user does something that takes a few words to say`);
  for (let batch = 0; !seeded && batch < LAYERS; batch += 20) {
    await Promise.all(Array.from({ length: Math.min(20, LAYERS - batch) }, (_, k) => {
      const n = batch + k, combo = n % COMBOS;
      return publishChecks(store, {
        producer: `p${combo % 10}`, environment: `e${Math.floor(combo / 10)}`, branch: n % 7 ? 'main' : 'feat/x', sha: n.toString(16).padStart(40, '0'), recordedAtMs: 1_700_000_000_000 + n * 60_000,
        checks: titles.map((title, i) => ({ id: `c${i}`, title, status: (n * 31 + i) % 17 === 0 ? 'failed' : 'passed', specPath: `specs/f${i % 40}.feature`, durationMs: 120 + i }))
      });
    }));
  }
  line(`seed ${LAYERS} layers × ${CHECKS} checks`, ms(started));

  const server = createAtlasServer({ backends: [{ id: 'data', store }], write: 'data', refreshMs: 3_600_000 });
  const http = await listen(server.fetch, { port: 0, host: '127.0.0.1', maxBodyBytes: 64 << 20 });
  const url = `http://127.0.0.1:${http.port}`;

  started = performance.now();
  await server.ready;
  line('cold start (read the catalog, fold every layer)', ms(started));
  line('heap after start', mib(process.memoryUsage().heapUsed));

  started = performance.now();
  await server.index.refresh();
  line('refresh with nothing new', ms(started));

  started = performance.now();
  const first = await fetch(`${url}/api/reports/evidence/effective`, { headers: { 'accept-encoding': 'gzip' } });
  const firstBytes = (await first.arrayBuffer()).byteLength;
  line('GET effective, first (gzip)', `${ms(started)}  ${mib(firstBytes)} on the wire`);
  started = performance.now();
  const again = await fetch(`${url}/api/reports/evidence/effective`, { headers: { 'accept-encoding': 'gzip' } });
  await again.arrayBuffer();
  line('GET effective, again (cached)', ms(started));
  started = performance.now();
  const etag = first.headers.get('etag')!;
  await (await fetch(`${url}/api/reports/evidence/effective`, { headers: { 'if-none-match': etag } })).arrayBuffer();
  line('GET effective, 304', ms(started));
  const raw = await (await fetch(`${url}/api/reports/evidence/effective`)).text();
  line('effective, raw JSON / gzip', `${mib(raw.length)} / ${mib(gzipSync(raw).length)}  (${server.index.stats().slots} slots)`);

  started = performance.now();
  await (await fetch(`${url}/api/status`)).arrayBuffer();
  line('GET status', ms(started));

  // Streaming: a result arrives every call, and what it costs to take in, to announce and to deliver.
  const client = httpStore({ url });
  const events = await fetch(`${url}/api/events`);
  const reader = events.body!.getReader();
  await reader.read();
  const times: number[] = [];
  const snapshotTimes: number[] = [];
  for (let i = 0; i < 20; i++) {
    started = performance.now();
    await publishChecks(client, { producer: 'p1', environment: 'e1', branch: 'main', recordedAtMs: Date.now() + i, checks: titles.slice(0, 10).map((title, k) => ({ id: `c${k}`, title, status: 'running' as const })) });
    times.push(performance.now() - started);
    let seen = '';
    while (!seen.includes('event: report')) seen += new TextDecoder().decode((await reader.read()).value);
    const t = performance.now();
    server.index.snapshot();
    snapshotTimes.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  line('upload one 10-check layer → report event (median)', `${times[10]!.toFixed(1)} ms  (p95 ${times[19]!.toFixed(1)} ms)`);
  started = performance.now();
  const after = await fetch(`${url}/api/reports/evidence/effective`, { headers: { 'accept-encoding': 'gzip' } });
  await after.arrayBuffer();
  line('GET effective after a change', ms(started));

  await reader.cancel();
  server.close();
  await http.close(100);
} finally {
  if (!kept) await rm(dir, { recursive: true, force: true });
}
