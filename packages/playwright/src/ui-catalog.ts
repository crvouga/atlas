/**
 * @module Playwright adapter for the UI catalog
 *
 * The optional Playwright side of the UI catalog: take a page to a state, wait until it is ready, photograph it, and hand the
 * result to `uiStateLayer` (`@crvouga/atlas/reports/ui-catalog-publish`) as a capture. This is the only Playwright-specific code
 * of the feature; reading, composing and exploring the catalog know nothing about it, and any other program that writes the
 * same layer produces the same catalog. The page is typed by the three methods used, so no `playwright` import is needed here
 * and a Playwright Test `page`, a `Page` of the driver, or a stub all fit.
 *
 * @see docs/ui-catalog.md
 */
import type { UiStateCapture } from '../../reports/src/ui-catalog-publish';
import type { UiStateFacts } from '../../reports/src/ui-state';

/** The part of a Playwright `Page` that capturing uses. */
export type CapturePage = {
  screenshot(options?: { readonly fullPage?: boolean; readonly animations?: 'disabled' | 'allow'; readonly type?: 'png' }): Promise<Uint8Array>;
  viewportSize(): { readonly width: number; readonly height: number } | null;
};

/** What to capture and how to know the page is ready. */
export type CaptureUiStateOptions = UiStateFacts & {
  /** The state's stable id: how a later capture replaces this one. */
  readonly id: string;
  readonly title?: string;
  /** Resolves when the page shows the state (a locator is visible, the network is idle). A rejection or a timeout makes the capture `failed`, with the reason as its detail. */
  readonly ready?: (page: CapturePage) => Promise<void>;
  /** How long to wait for `ready`; default 15 seconds. */
  readonly readyTimeoutMs?: number;
  /** Photograph the whole scrollable page rather than the viewport. */
  readonly fullPage?: boolean;
  /** Extra labels for the capture (`browser`, `os`), which never split it. */
  readonly labels?: Readonly<Record<string, string>>;
};

async function within<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${what} did not become true within ${ms} ms`)), ms); })]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Wait for the page to be ready, photograph it, and return the capture to publish. Never throws for the page's sake: a page
 * that never became ready, or could not be photographed, is a `failed` capture that says why, so a broken state shows in the
 * catalog instead of ending the run. A readiness failure still attaches a picture of what the page showed, for diagnosis.
 *
 * @example
 * ```ts
 * const shot = await captureUiState(page, { id: 'checkout/payment', route: '/checkout', ready: p => expectVisible(p, '#total') });
 * await publishChecks(store, uiStateLayer({ producer: 'playwright', recordedAtMs: Date.now(), environment: 'desktop-web', profile: { viewport: '1280x800' }, states: [shot] }));
 * ```
 */
export async function captureUiState(page: CapturePage, options: CaptureUiStateOptions): Promise<UiStateCapture> {
  const { ready, readyTimeoutMs = 15_000, fullPage = false, labels, ...rest } = options;
  const started = Date.now();
  let status: 'passed' | 'failed' = 'passed';
  let detail = '';
  if (ready) {
    try { await within(ready(page), readyTimeoutMs, 'The ready check'); }
    catch (error) { status = 'failed'; detail = error instanceof Error ? error.message : String(error); }
  }
  const size = page.viewportSize();
  try {
    const data = await page.screenshot({ fullPage, animations: 'disabled', type: 'png' });
    return { ...rest, status, detail, durationMs: Date.now() - started, ...(labels ? { labels } : {}), screenshot: { data, contentType: 'image/png', ...(size && !fullPage ? { width: size.width, height: size.height } : {}) } };
  } catch (error) {
    return { ...rest, status: 'failed', detail: [detail, `The picture could not be taken: ${error instanceof Error ? error.message : String(error)}`].filter(Boolean).join('. '), durationMs: Date.now() - started, ...(labels ? { labels } : {}) };
  }
}
