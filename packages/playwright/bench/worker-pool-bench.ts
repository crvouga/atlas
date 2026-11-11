/**
 * `bun packages/playwright/bench/worker-pool-bench.ts [items] [batch] [workers] [--real]`: per-batch spawn against reusable workers.
 * Not a test (it measures, it asserts nothing) and not shipped.
 *
 * - **spawn per batch**: what `atlas ui-catalog collect --exec` does: one child process per claim, which loads the capture code,
 *   starts its worker (a browser), captures the batch and exits.
 * - **reusable workers**: `catalogWorkerPool` in this process: `workers` warm workers, a fresh page per item.
 *
 * Without `--real`, a worker is a stub (no browser, a blank picture), so the numbers show the runner overhead alone: process
 * start, module load and per-capture bookkeeping. With `--real` and Chromium installed (`bunx playwright install chromium`),
 * each worker is a real browser and each item a real context and page on `about:blank`.
 */
import { spawn } from 'node:child_process';

import type { CollectItem, CollectUnit } from '../../reports/src/ui-catalog-collect';
import { catalogWorkerPool } from '../src/ui-catalog-pool';
import type { CapturePage } from '../src/ui-catalog';

const args = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
const REAL = process.argv.includes('--real');
const CHILD = process.argv.includes('--child');
const ITEMS = Number(args[0] ?? 60);
const BATCH = Number(args[1] ?? 5);
const WORKERS = Number(args[2] ?? 2);

type Worker = { newPage(): Promise<CapturePage & { close(): Promise<void> }>; close(): Promise<void> };

async function launch(): Promise<Worker> {
  if (REAL) {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch();
    return {
      newPage: async () => { const context = await browser.newContext({ viewport: { width: 390, height: 844 } }); const page = await context.newPage(); await page.goto('about:blank'); return Object.assign(page, { close: () => context.close() }); },
      close: () => browser.close()
    };
  }
  return { newPage: async () => ({ screenshot: async () => new Uint8Array(64), viewportSize: () => ({ width: 390, height: 844 }), close: async () => undefined }), close: async () => undefined };
}

const item = (n: number): CollectItem => ({ key: `s${n}`, state: { id: `s${n}` }, profile: { key: 'p', values: {}, environment: null, parameters: {} } }) as CollectItem;
const units = (count: number, from = 0): CollectUnit[] => Array.from({ length: count }, (_, i) => ({ key: `u${from + i}`, tier: 'empty', items: [item(from + i)] }) as CollectUnit);

function pool(size: number) {
  return catalogWorkerPool<Worker, CapturePage & { close(): Promise<void> }>({
    size, launch, newPage: worker => worker.newPage(), closePage: page => page.close(), teardown: worker => worker.close(), recipes: () => ({})
  });
}

if (CHILD) {
  // One batch, as an --exec child would: start, capture, exit.
  const work = pool(1);
  const signal = new AbortController().signal;
  let captured = 0;
  for (const unit of units(BATCH)) captured += (await work.capture(unit, signal)).length;
  await work.close();
  console.log(JSON.stringify({ captured }));
  process.exit(0);
}

const line = (name: string, ms: number) => console.log(`${name.padEnd(40)} ${ms.toFixed(0).padStart(7)} ms  ${(ms / ITEMS).toFixed(1).padStart(6)} ms/item`);

async function spawnPerBatch(): Promise<number> {
  const started = performance.now();
  const batches = Math.ceil(ITEMS / BATCH);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(WORKERS, batches) }, async () => {
    while (next < batches) {
      next++;
      await new Promise<void>((resolve, reject) => {
        const child = spawn(process.execPath, [import.meta.path, String(ITEMS), String(BATCH), '1', '--child', ...(REAL ? ['--real'] : [])], { stdio: ['ignore', 'pipe', 'inherit'] });
        child.on('error', reject);
        child.on('exit', code => (code === 0 ? resolve() : reject(new Error(`child exited ${code}`))));
      });
    }
  }));
  return performance.now() - started;
}

async function reusable(): Promise<number> {
  const started = performance.now();
  const work = pool(WORKERS);
  const signal = new AbortController().signal;
  const all = units(ITEMS);
  let next = 0;
  await Promise.all(Array.from({ length: WORKERS }, async () => { while (next < all.length) await work.capture(all[next++]!, signal); }));
  const launched = work.stats().launched;
  await work.close();
  if (launched > WORKERS) throw new Error(`launched ${launched} workers for a pool of ${WORKERS}`);
  return performance.now() - started;
}

console.log(`${ITEMS} items, batches of ${BATCH}, ${WORKERS} workers, ${REAL ? 'real Chromium' : 'stub workers'}`);
line('spawn per batch (--exec)', await spawnPerBatch());
line('reusable workers (catalogWorkerPool)', await reusable());
