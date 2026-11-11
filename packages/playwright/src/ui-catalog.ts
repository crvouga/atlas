/**
 * @module Playwright adapter for the UI catalog
 *
 * The optional Playwright side of the UI catalog: take a page to a state, wait until it is ready, photograph it, and hand the
 * result to `uiStateLayer` (`@crvouga/atlas/reports/ui-catalog-publish`) as a capture. This is the only Playwright-specific code
 * of the feature; reading, composing and exploring the catalog know nothing about it, and any other program that writes the
 * same layer produces the same catalog. The page is typed by the methods used, so no `playwright` import is needed here
 * and a Playwright Test `page`, a `Page` of the driver, or a stub all fit.
 *
 * Readiness is bounded and cancellable. The project's own `ready` check (its business state: a locator, a route) receives a
 * signal and a deadline; opt-in generic policies wait for web fonts, for visible images to load and decode, and for the
 * picture to stop changing, and explicitly named scrolling regions are captured as supplemental views of the same state.
 * None of them is on by default, none sleeps for a fixed time, and none waits for the network to go idle: a state that
 * intentionally shows loading or animation stays valid by leaving them off. Each phase is timed; a phase that runs out of
 * budget fails the capture naming the phase, with a picture of what the page showed.
 *
 * @see docs/ui-catalog.md#readiness-policies
 */
import type { UiCaptureAttachment, UiStateCapture } from '../../reports/src/ui-catalog-publish';
import type { UiStateFacts } from '../../reports/src/ui-state';

/** The part of a Playwright `Locator` that capturing a scrolling region uses. */
export type CaptureLocator = {
  screenshot(options?: { readonly animations?: 'disabled' | 'allow'; readonly type?: 'png'; readonly timeout?: number }): Promise<Uint8Array>;
  evaluate<R, A>(pageFunction: (element: HTMLElement, arg: A) => R | Promise<R>, arg: A): Promise<R>;
};

/**
 * The part of a Playwright `Page` that capturing uses. `evaluate` and `locator` are optional: only the readiness policies
 * and scrolling regions need them, so a stub with the first two methods still fits.
 */
export type CapturePage = {
  screenshot(options?: { readonly fullPage?: boolean; readonly animations?: 'disabled' | 'allow'; readonly type?: 'png' }): Promise<Uint8Array>;
  viewportSize(): { readonly width: number; readonly height: number } | null;
  /** Run a function in the page. Needed by `waitForFonts` and `waitForImages`. */
  evaluate?<R>(pageFunction: () => R | Promise<R>): Promise<R>;
  /** Find an element. Needed by `regions`. */
  locator?(selector: string): CaptureLocator;
};

/** What a `ready` check is given besides the page: abort when `signal` does, and finish by `deadlineAt` (epoch ms). */
export type CaptureReadyContext = {
  /** Aborts when the readiness budget runs out or the capture is cancelled (the claim was lost, the shard is stopping). */
  readonly signal: AbortSignal;
  /** When the readiness budget runs out, epoch milliseconds. */
  readonly deadlineAt: number;
};

/** A phase of readiness or capture, timed and named in a timeout. */
export type CapturePhase = 'ready' | 'fonts' | 'images' | 'stability' | 'screenshot' | 'regions';

/** How one phase went: `ok`, `timeout` (it ran out of budget), or `failed` (it threw). */
export type CapturePhaseTiming = { readonly phase: CapturePhase; readonly ms: number; readonly outcome: 'ok' | 'timeout' | 'failed' };

/** What `captureUiState` reports about readiness besides the capture: each phase's time, and the phase that ran out of budget. */
export type CaptureReadiness = { readonly phases: readonly CapturePhaseTiming[]; readonly timedOut?: CapturePhase };

/** A capture with its readiness report. `readiness` is not published; the timings are in the `atlas.readiness` label when a policy is on. */
export type CaptureResult = UiStateCapture & { readonly readiness: CaptureReadiness };

/** Wait for the picture to stop changing: `frames` consecutive identical screenshots (default 2) within `timeoutMs`. */
export type StabilityPolicy = { readonly frames?: number; readonly timeoutMs?: number };

/** A scrolling element captured as named supplemental views: its content a viewport at a time, at most `maxViews` (default 5). */
export type CaptureRegion = {
  /** Stable: part of each view's name (`<state>--<name>-<n>.png`). */
  readonly name: string;
  /** A selector the page's `locator` understands. */
  readonly selector: string;
  /** For a person; default the name. */
  readonly label?: string;
  readonly maxViews?: number;
};

/** The label holding each phase's time when a readiness policy is on (`ready=12ms fonts=3ms …`). */
export const READINESS_LABEL = 'atlas.readiness';
/** The label naming the phase that ran out of budget (`fonts`, `images`, `stability`…), when a readiness policy is on. */
export const READINESS_TIMEOUT_LABEL = 'atlas.readiness-timeout';

/** What to capture and how to know the page is ready. */
export type CaptureUiStateOptions = UiStateFacts & {
  /** The state's stable id: how a later capture replaces this one. */
  readonly id: string;
  readonly title?: string;
  /**
   * Resolves when the page shows the state (a locator is visible, a request has answered). A rejection or a timeout makes the
   * capture `failed`, with the reason as its detail. It is given a signal and deadline: stop when the signal aborts.
   */
  readonly ready?: (page: CapturePage, context: CaptureReadyContext) => Promise<void>;
  /** The readiness budget: how long `ready` and every policy may take together; default 15 seconds. */
  readonly readyTimeoutMs?: number;
  /** Photograph the whole scrollable page rather than the viewport. */
  readonly fullPage?: boolean;
  /** Extra labels for the capture (`browser`, `os`), which never split it. */
  readonly labels?: Readonly<Record<string, string>>;
  /** Cancel the capture: it throws the signal's reason and returns nothing, so no late capture is ever published. */
  readonly signal?: AbortSignal;
  /** Opt in: wait for `document.fonts.ready`. Needs `page.evaluate`. */
  readonly waitForFonts?: boolean;
  /** Opt in: wait until every image in the viewport has loaded and decoded. Needs `page.evaluate`. */
  readonly waitForImages?: boolean;
  /** Opt in: wait for consecutive identical frames, within the budget. The last frame is the picture. */
  readonly stability?: boolean | StabilityPolicy;
  /** Opt in: scrolling elements to capture as supplemental views of this state. Needs `page.locator`. */
  readonly regions?: readonly CaptureRegion[];
  /** Supplemental evidence the caller already has (a trace, a video), kept after any region views. */
  readonly attachments?: readonly UiCaptureAttachment[];
  /** The clock; default `Date.now`. */
  readonly now?: () => number;
};

class PhaseTimeout extends Error {
  constructor(readonly phase: CapturePhase, ms: number, what: string) {
    super(`${what} did not become true within ${ms} ms`);
    this.name = 'PhaseTimeout';
  }
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const slug = (text: string) => text.replace(/[^\w.-]+/g, '-');

function same(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  for (let i = 0; i < a.byteLength; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Run one phase under its own abort signal: it ends at `deadlineAt` with a {@link PhaseTimeout}, or at once with the outer
 * signal's reason when the capture is cancelled. The phase's work is told to stop through the signal it is given.
 */
async function bounded<T>(phase: CapturePhase, what: string, budgetMs: number, deadlineAt: number, now: () => number, outer: AbortSignal | undefined, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  outer?.throwIfAborted();
  const controller = new AbortController();
  const ms = Math.max(0, deadlineAt - now());
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stop: (() => void) | undefined;
  try {
    return await Promise.race([
      work(controller.signal),
      new Promise<never>((_, reject) => {
        // Settle first, then tell the work to stop, so the work's own reaction to the abort never wins the race.
        timer = setTimeout(() => { const error = new PhaseTimeout(phase, budgetMs, what); reject(error); controller.abort(error); }, ms);
        if (outer) {
          stop = () => { reject(outer.reason); controller.abort(outer.reason); };
          outer.addEventListener('abort', stop, { once: true });
        }
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (stop) outer!.removeEventListener('abort', stop);
    controller.abort();
  }
}

/** In the page: resolves once web fonts have loaded. Self-contained, because Playwright sends its source to the page. */
const fontsReady = () => (document.fonts ? document.fonts.ready.then(() => true) : true);

/** In the page: resolves once every image that is in the viewport has loaded (or failed) and decoded. Self-contained. */
const imagesReady = () => {
  const visible = Array.from(document.images).filter(image => {
    const box = image.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && box.bottom > 0 && box.right > 0 && box.top < window.innerHeight && box.left < window.innerWidth;
  });
  return Promise.all(visible.map(image => (image.complete
    ? Promise.resolve()
    : new Promise<void>(resolve => { image.addEventListener('load', () => resolve(), { once: true }); image.addEventListener('error', () => resolve(), { once: true }); })
  ).then(() => (image.naturalWidth > 0 ? image.decode().catch(() => undefined) : undefined)))).then(() => visible.length);
};

/**
 * Wait for the page to be ready, photograph it, and return the capture to publish. Never throws for the page's sake: a page
 * that never became ready, or could not be photographed, is a `failed` capture that says why, so a broken state shows in the
 * catalog instead of ending the run. A readiness failure still attaches a picture of what the page showed, for diagnosis.
 *
 * Throws only when `signal` aborts (with its reason): a cancelled capture returns nothing, so a collector whose claim was
 * lost never publishes it. With no policy enabled it behaves as it always has.
 *
 * @example
 * ```ts
 * const shot = await captureUiState(page, {
 *   id: 'checkout/payment', route: '/checkout', ready: (p, { signal }) => waitForTotal(p, signal),
 *   waitForFonts: true, waitForImages: true, stability: { frames: 2 }, regions: [{ name: 'summary', selector: '#summary' }]
 * });
 * await publishChecks(store, uiStateLayer({ producer: 'playwright', recordedAtMs: Date.now(), environment: 'desktop-web', profile: { viewport: '1280x800' }, states: [shot] }));
 * ```
 */
export async function captureUiState(page: CapturePage, options: CaptureUiStateOptions): Promise<CaptureResult> {
  const { ready, readyTimeoutMs = 15_000, fullPage = false, labels, signal, waitForFonts, waitForImages, stability, regions, attachments: given, now = Date.now, ...rest } = options;
  signal?.throwIfAborted();
  const started = now();
  const deadlineAt = started + readyTimeoutMs;
  const policies = !!(waitForFonts || waitForImages || stability || regions?.length);
  const phases: CapturePhaseTiming[] = [];
  let status: 'passed' | 'failed' = 'passed';
  let detail = '';
  let timedOut: CapturePhase | undefined;
  let frame: Uint8Array | undefined;

  const run = async <T>(phase: CapturePhase, what: string, work: (signal: AbortSignal) => Promise<T>): Promise<T | undefined> => {
    const began = now();
    try {
      const value = await bounded(phase, what, readyTimeoutMs, deadlineAt, now, signal, work);
      phases.push({ phase, ms: now() - began, outcome: 'ok' });
      return value;
    } catch (error) {
      // A cancellation is not the page's fault and is never a capture: it ends the call.
      if (signal?.aborted) throw signal.reason;
      const timeout = error instanceof PhaseTimeout;
      phases.push({ phase, ms: now() - began, outcome: timeout ? 'timeout' : 'failed' });
      status = 'failed';
      if (timeout) timedOut = phase;
      detail = timeout && policies ? `${message(error)} (readiness phase "${phase}")` : message(error);
      return undefined;
    }
  };
  const needs = (method: 'evaluate' | 'locator', what: string) => {
    if (typeof page[method] !== 'function') throw new Error(`${what} needs page.${method}, which this page does not have`);
  };

  if (ready) await run('ready', 'The ready check', readySignal => ready(page, { signal: readySignal, deadlineAt }));
  if (status === 'passed' && waitForFonts) await run('fonts', 'Web fonts', async () => { needs('evaluate', 'waitForFonts'); await page.evaluate!(fontsReady); });
  if (status === 'passed' && waitForImages) await run('images', 'Visible images', async () => { needs('evaluate', 'waitForImages'); await page.evaluate!(imagesReady); });
  if (status === 'passed' && stability) {
    const wanted = Math.max(2, (typeof stability === 'object' ? stability.frames : undefined) ?? 2);
    const budget = typeof stability === 'object' && stability.timeoutMs !== undefined ? Math.min(stability.timeoutMs, readyTimeoutMs) : readyTimeoutMs;
    const stableBy = Math.min(deadlineAt, now() + budget);
    const began = now();
    try {
      await bounded('stability', 'A stable picture', budget, stableBy, now, signal, async stabilitySignal => {
        let alike = 1;
        frame = await page.screenshot({ fullPage, animations: 'disabled', type: 'png' });
        while (alike < wanted) {
          stabilitySignal.throwIfAborted();
          const next = await page.screenshot({ fullPage, animations: 'disabled', type: 'png' });
          alike = same(next, frame) ? alike + 1 : 1;
          frame = next;
        }
      });
      phases.push({ phase: 'stability', ms: now() - began, outcome: 'ok' });
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      const timeout = error instanceof PhaseTimeout;
      phases.push({ phase: 'stability', ms: now() - began, outcome: timeout ? 'timeout' : 'failed' });
      status = 'failed';
      if (timeout) timedOut = 'stability';
      detail = `${message(error)} (readiness phase "stability")`;
    }
  }

  signal?.throwIfAborted();
  const size = page.viewportSize();
  // The last stable frame is the picture; after a stability timeout it is the diagnostic picture of what the page showed.
  let data: Uint8Array | undefined = frame;
  const shotBegan = now();
  if (!data) {
    try {
      data = await page.screenshot({ fullPage, animations: 'disabled', type: 'png' });
      if (policies) phases.push({ phase: 'screenshot', ms: now() - shotBegan, outcome: 'ok' });
    } catch (error) {
      signal?.throwIfAborted();
      if (policies) phases.push({ phase: 'screenshot', ms: now() - shotBegan, outcome: 'failed' });
      status = 'failed';
      detail = [detail, `The picture could not be taken: ${message(error)}`].filter(Boolean).join('. ');
    }
  }
  signal?.throwIfAborted();

  const views: UiCaptureAttachment[] = [];
  if (regions?.length && data) {
    const began = now();
    let outcome: CapturePhaseTiming['outcome'] = 'ok';
    for (const region of regions) {
      try { views.push(...await captureRegion(page, options.id, region, signal)); }
      catch (error) {
        if (signal?.aborted) throw signal.reason;
        outcome = 'failed';
        views.push({ name: `${slug(options.id)}--${slug(region.name)}-1.png`, label: region.label ?? region.name, role: 'view', contentType: 'image/png', omitted: 'not-captured' });
        detail = [detail, `The region "${region.name}" could not be captured: ${message(error)}`].filter(Boolean).join('. ');
      }
    }
    phases.push({ phase: 'regions', ms: now() - began, outcome });
  }
  signal?.throwIfAborted();

  const allLabels = policies
    ? { ...labels, [READINESS_LABEL]: phases.map(item => `${item.phase}=${item.ms}ms${item.outcome === 'ok' ? '' : `(${item.outcome})`}`).join(' '), ...(timedOut ? { [READINESS_TIMEOUT_LABEL]: timedOut } : {}) }
    : labels;
  const attachments = [...views, ...(given ?? [])];
  return {
    ...rest, status, detail, durationMs: now() - started, ...(allLabels ? { labels: allLabels } : {}),
    ...(data ? { screenshot: { data, contentType: 'image/png', ...(size && !fullPage ? { width: size.width, height: size.height } : {}) } } : {}),
    ...(attachments.length ? { attachments } : {}),
    readiness: { phases, ...(timedOut ? { timedOut } : {}) }
  };
}

/** A region's content a viewport at a time, then its scroll position put back. Views are named `<state>--<region>-<n>.png`. */
async function captureRegion(page: CapturePage, id: string, region: CaptureRegion, signal: AbortSignal | undefined): Promise<UiCaptureAttachment[]> {
  if (typeof page.locator !== 'function') throw new Error('regions need page.locator, which this page does not have');
  const element = page.locator(region.selector);
  const box = await element.evaluate(node => ({ top: node.scrollTop, height: node.scrollHeight, client: node.clientHeight }), null);
  const step = Math.max(1, box.client);
  const count = Math.max(1, Math.min(region.maxViews ?? 5, Math.ceil(box.height / step)));
  const label = region.label ?? region.name;
  const views: UiCaptureAttachment[] = [];
  try {
    for (let i = 0; i < count; i++) {
      signal?.throwIfAborted();
      await element.evaluate((node, top) => { node.scrollTop = top; }, i * step);
      const data = await element.screenshot({ animations: 'disabled', type: 'png' });
      views.push({ name: `${slug(id)}--${slug(region.name)}-${i + 1}.png`, label: count > 1 ? `${label} (${i + 1} of ${count})` : label, role: 'view', contentType: 'image/png', data });
    }
  } finally {
    await element.evaluate((node, top) => { node.scrollTop = top; }, box.top).catch(() => undefined);
  }
  return views;
}
