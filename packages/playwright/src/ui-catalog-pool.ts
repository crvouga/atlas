/**
 * @module Reusable capture workers for a UI catalog queue
 *
 * `catalogWorkerPool` turns declared capture recipes into the `capture` callback of `collectCatalog`
 * (`@crvouga/atlas/reports/ui-catalog-collect`), with a bounded pool of warm workers instead of a process per claim. A worker is
 * whatever the project's `launch` returns (normally a Playwright `Browser`, or the `browser` fixture of a Playwright Test) and is
 * started once and reused; every captured item gets a fresh page from `newPage` (normally a new browser context sized and
 * themed for the item's profile), so no mutable state crosses from one capture to the next, and the page is closed afterwards.
 *
 * Claimed items are matched to recipes by state id, and run through `captureUiState`. A recipe that throws, or a state without a
 * recipe, is that item's failure only. When the claim is lost or the shard stops, the active page is closed at once, the call
 * rejects with the signal's reason, and nothing it captured is returned, so the collector never publishes it. Nothing here
 * imports Playwright: the pool knows the worker and the page only through the project's callbacks, and reports and core never
 * acquire a Playwright dependency.
 *
 * @see docs/ui-catalog.md#warm-workers-for-a-queue
 */
import type { CapturedItem, CollectItem, CollectUnit } from '../../reports/src/ui-catalog-collect';
import { CollectorInfrastructureError } from '../../reports/src/ui-catalog-collect';
import { captureUiState, type CapturePage, type CaptureUiStateOptions } from './ui-catalog';

/** What a recipe's `open` is given: the item it captures, the worker it runs on, and the signal to stop on. */
export type CatalogRecipeContext<W> = { readonly item: CollectItem; readonly worker: W; readonly signal: AbortSignal };

/**
 * How to bring a page to one declared state: `open` navigates and arranges fixture data, then `captureUiState` runs with the rest
 * (its `ready` check, readiness policies, regions). The state id, title and facts come from the claimed item.
 */
export type CatalogRecipe<P extends CapturePage = CapturePage, W = unknown> = Omit<CaptureUiStateOptions, 'id' | 'signal'> & {
  readonly open?: (page: P, context: CatalogRecipeContext<W>) => Promise<void>;
};

/** How the pool runs. `W` is the worker (a browser), `P` the page each capture gets. */
export type CatalogWorkerPoolOptions<W, P extends CapturePage> = {
  /** How many workers at most; default 1. Give `collectCatalog` the same `concurrency`. */
  readonly size?: number;
  /** Start one worker, once (`chromium.launch()`, or return a Playwright Test `browser` fixture). A failure is an infrastructure error, never an item result. */
  readonly launch: (index: number) => Promise<W>;
  /** A fresh page for one item, isolated from every other capture: apply its profile here (`viewport`, `colorScheme`). */
  readonly newPage: (worker: W, item: CollectItem, signal: AbortSignal) => Promise<P>;
  /** Close what `newPage` made (its context too). Default `page.close()` when the page has one. Called once per page, also on cancellation. */
  readonly closePage?: (page: P, worker: W) => Promise<void>;
  /** Stop one worker when the pool closes (`browser.close()`). Default nothing: a fixture's owner closes it. */
  readonly teardown?: (worker: W) => Promise<void>;
  /** Whether a worker can still be used after a capture (`browser.isConnected()`). One that cannot is torn down and replaced. */
  readonly healthy?: (worker: W) => boolean;
  /** The recipes, by state id, or a function that finds one. A claimed state without a recipe is a failed item. */
  readonly recipes: Readonly<Record<string, CatalogRecipe<P, W>>> | ((item: CollectItem) => CatalogRecipe<P, W> | undefined);
};

/** What the pool tells about itself, for a log line or a test. */
export type CatalogWorkerPoolStats = { readonly launched: number; readonly captures: number; readonly pagesOpen: number; readonly busy: number };

/** A pool: `capture` goes to `collectCatalog`, `close` ends it. */
export type CatalogWorkerPool = {
  readonly capture: (unit: CollectUnit, signal: AbortSignal) => Promise<readonly CapturedItem[]>;
  /** Wait for active captures to end, then tear every worker down. Captures after it reject. */
  readonly close: () => Promise<void>;
  readonly stats: () => CatalogWorkerPoolStats;
};

/** Settle with `work`, or reject with the signal's reason as soon as it aborts: a recipe that ignores the signal cannot hold the call. */
async function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  let stop: (() => void) | undefined;
  work.catch(() => undefined);
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      stop = () => reject(signal.reason);
      if (signal.aborted) stop(); else signal.addEventListener('abort', stop, { once: true });
    })]);
  } finally { if (stop) signal.removeEventListener('abort', stop); }
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * A bounded pool of warm capture workers for `collectCatalog`. Throws for a `size` that is not a positive integer.
 *
 * @example
 * ```ts
 * const pool = catalogWorkerPool({
 *   size: 4, launch: () => chromium.launch(), teardown: browser => browser.close(), healthy: browser => browser.isConnected(),
 *   newPage: async (browser, item) => (await browser.newContext({ viewport: viewportOf(item.profile), colorScheme: item.profile.parameters.scheme === 'dark' ? 'dark' : 'light' })).newPage(),
 *   closePage: page => page.context().close(),
 *   recipes: { 'checkout/payment': { open: page => page.goto(`${base}/checkout`).then(() => undefined), ready: page => page.getByText('Total').waitFor() } }
 * });
 * try { await collectCatalog({ store, catalog, shard: { id: 'ci-1' }, concurrency: 4, capture: pool.capture }); } finally { await pool.close(); }
 * ```
 */
export function catalogWorkerPool<W, P extends CapturePage>(options: CatalogWorkerPoolOptions<W, P>): CatalogWorkerPool {
  const size = options.size ?? 1;
  if (!Number.isSafeInteger(size) || size < 1) throw new Error('catalogWorkerPool: size must be a positive integer');
  const idle: W[] = [];
  const all = new Set<W>();
  const waiting: { resolve: (worker: W | null) => void }[] = [];
  const active = new Set<Promise<unknown>>();
  let starting = 0, launched = 0, captures = 0, pagesOpen = 0, busy = 0;
  let closed = false;

  const recipeOf = (item: CollectItem) => typeof options.recipes === 'function' ? options.recipes(item) : Object.hasOwn(options.recipes, item.state.id) ? options.recipes[item.state.id] : undefined;
  const closePage = async (page: P, worker: W) => {
    pagesOpen--;
    try {
      if (options.closePage) await options.closePage(page, worker);
      else await (page as { close?: () => Promise<void> }).close?.();
    } catch { /* a page that is already gone is closed */ }
  };

  const acquire = async (signal: AbortSignal): Promise<W> => {
    signal.throwIfAborted();
    if (closed) throw new Error('The capture pool is closed');
    const ready = idle.pop();
    if (ready !== undefined) return ready;
    if (all.size + starting < size) {
      starting++;
      try {
        const worker = await options.launch(launched);
        launched++;
        all.add(worker);
        return worker;
      } catch (error) {
        throw new CollectorInfrastructureError(`A capture worker could not start: ${message(error)}`, { phase: 'launch', retryable: true });
      } finally { starting--; }
    }
    // Wait for a worker to come back, or stop waiting when the signal aborts.
    const worker = await new Promise<W | null>((resolve, reject) => {
      const entry = { resolve: (value: W | null) => { signal.removeEventListener('abort', stop); resolve(value); } };
      const stop = () => { const at = waiting.indexOf(entry); if (at >= 0) waiting.splice(at, 1); reject(signal.reason); };
      signal.addEventListener('abort', stop, { once: true });
      waiting.push(entry);
    });
    if (worker === null) throw new Error(closed ? 'The capture pool is closed' : 'No capture worker is available: a replacement could not start');
    return worker;
  };

  const release = async (worker: W) => {
    if (options.healthy && !options.healthy(worker)) {
      all.delete(worker);
      await options.teardown?.(worker).catch(() => undefined);
      // A waiter takes the free slot and launches a replacement.
      const next = waiting.shift();
      if (next) void acquireFor(next);
      return;
    }
    if (closed) return;
    const next = waiting.shift();
    if (next) next.resolve(worker); else idle.push(worker);
  };
  const acquireFor = async (entry: { resolve: (worker: W | null) => void }) => {
    if (closed) { entry.resolve(null); return; }
    starting++;
    try { const worker = await options.launch(launched); launched++; all.add(worker); entry.resolve(worker); }
    catch { entry.resolve(null); }
    finally { starting--; }
  };

  const captureItem = async (worker: W, item: CollectItem, signal: AbortSignal): Promise<CapturedItem> => {
    const recipe = recipeOf(item);
    if (!recipe) return { item: item.key, status: 'failed', detail: `No recipe declares the state "${item.state.id}"` };
    const page = await options.newPage(worker, item, signal);
    pagesOpen++;
    let closing: Promise<void> | undefined;
    const shut = () => (closing ??= closePage(page, worker));
    // Cancellation stops the active work by closing its page at once: whatever the recipe awaits on it rejects.
    const onAbort = () => { void shut(); };
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      // A page that arrived after the signal aborted is closed (in `finally`) and never used.
      signal.throwIfAborted();
      const { open, ...capture } = recipe;
      if (open) {
        try { await untilAborted(open(page, { item, worker, signal }), signal); }
        catch (error) {
          signal.throwIfAborted();
          return { item: item.key, status: 'failed', detail: `The recipe could not open the state: ${message(error)}` };
        }
      }
      const { id: _id, title: _title, ...facts } = item.state;
      const { readiness: _readiness, id: _captured, ...shot } = await untilAborted(captureUiState(page, { ...facts, ...capture, id: item.state.id, signal }), signal);
      signal.throwIfAborted();
      captures++;
      return { ...shot, item: item.key };
    } finally {
      signal.removeEventListener('abort', onAbort);
      await shut();
    }
  };

  const capture = async (unit: CollectUnit, signal: AbortSignal): Promise<readonly CapturedItem[]> => {
    const work = (async () => {
      const worker = await acquire(signal);
      busy++;
      try {
        const out: CapturedItem[] = [];
        for (const item of unit.items) {
          signal.throwIfAborted();
          try { out.push(await captureItem(worker, item, signal)); }
          catch (error) {
            if (signal.aborted) throw signal.reason;
            // One recipe's failure is that item's failure: the next item gets a fresh page on the same worker.
            out.push({ item: item.key, status: 'failed', detail: `The capture failed: ${message(error)}` });
          }
        }
        // A late result of a cancelled unit is never handed back.
        signal.throwIfAborted();
        return out;
      } finally {
        busy--;
        await release(worker);
      }
    })();
    active.add(work);
    try { return await work; } finally { active.delete(work); }
  };

  const close = async () => {
    if (closed) return;
    closed = true;
    for (const entry of waiting.splice(0)) entry.resolve(null);
    await Promise.allSettled([...active]);
    const workers = [...all];
    all.clear();
    idle.length = 0;
    await Promise.allSettled(workers.map(worker => options.teardown?.(worker)));
  };

  return { capture, close, stats: () => ({ launched, captures, pagesOpen, busy }) };
}
