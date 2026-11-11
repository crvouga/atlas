import { describe, expect, test } from 'bun:test';

import { publishChecks } from '../../reports/src/publish-checks';
import { uiCatalog } from '../../reports/src/ui-catalog';
import { uiStateLayer } from '../../reports/src/ui-catalog-publish';
import { combineBackends } from '../../reports/src/compose';
import { ReportIndex } from '../../reports/src/report-index';
import { memoryStore } from '../../reports/tests/memory-store';
import type { Page } from 'playwright';

import { captureUiState, READINESS_LABEL, READINESS_TIMEOUT_LABEL, type CaptureLocator, type CapturePage } from './ui-catalog';

const page = (extra: Partial<CapturePage> = {}): CapturePage => ({ screenshot: async () => new TextEncoder().encode('png'), viewportSize: () => ({ width: 390, height: 844 }), ...extra });

describe('capturing a UI state with Playwright', () => {
  test('a ready page becomes a passing capture with its picture and size', async () => {
    const shot = await captureUiState(page(), { id: 'home', route: '/', covers: ['home'] });
    expect(shot).toMatchObject({ id: 'home', status: 'passed', route: '/', screenshot: { contentType: 'image/png', width: 390, height: 844 } });
  });

  test('a page that is never ready is a failed capture that says why, with a picture of what it showed', async () => {
    const shot = await captureUiState(page(), { id: 'pay', ready: () => new Promise<void>(() => {}), readyTimeoutMs: 20 });
    expect(shot.status).toBe('failed');
    expect(shot.detail).toContain('did not become true within 20 ms');
    expect(shot.screenshot?.data).toBeDefined();
  });

  test('a ready check that throws, and a picture that cannot be taken, are failures and not exceptions', async () => {
    const thrown = await captureUiState(page(), { id: 'a', ready: async () => { throw new Error('#total not visible'); } });
    expect(thrown).toMatchObject({ status: 'failed', detail: '#total not visible' });
    const blind = await captureUiState(page({ screenshot: async () => { throw new Error('page closed'); } }), { id: 'b' });
    expect(blind).toMatchObject({ status: 'failed' });
    expect(blind.detail).toContain('page closed');
    expect(blind.screenshot).toBeUndefined();
  });

  test('what it captures is published and explored like any other collector', async () => {
    const store = memoryStore();
    const shots = await Promise.all([captureUiState(page(), { id: 'home' }), captureUiState(page(), { id: 'pay', ready: async () => { throw new Error('boom'); } })]);
    await publishChecks(store, uiStateLayer({ producer: 'playwright', recordedAtMs: 5, environment: 'mobile-web', profile: { viewport: '390x844' }, states: shots }));
    const index = new ReportIndex([{ id: 'one', store }]);
    await index.refresh();
    const catalog = uiCatalog(index.snapshot().layers);
    expect(Object.fromEntries(catalog.states.map(state => [state.id, state.cells[0]!.coverage]))).toEqual({ home: 'captured', pay: 'failed' });
    expect((await combineBackends([{ id: 'one', store }])).layers.length).toBe(1);
  });
});

describe('#96: bounded, cancellable readiness policies', () => {
  const bytes = (text: string) => new TextEncoder().encode(text);
  /** A page whose `evaluate` answers the fonts and images checks as told: a delay in ms, or `never`. */
  const policyPage = (answers: { fonts?: number | 'never'; images?: number | 'never' }, extra: Partial<CapturePage> = {}): CapturePage => page({
    evaluate: async <R>(fn: () => R | Promise<R>) => {
      const answer = String(fn).includes('fonts') ? answers.fonts : answers.images;
      if (answer === 'never') return new Promise<R>(() => {});
      await new Promise(resolve => setTimeout(resolve, answer ?? 0));
      return true as R;
    },
    ...extra
  });

  test('a Playwright Page still fits the page type, with the optional methods', () => {
    const fits = (value: Page): CapturePage => value;
    expect(typeof fits).toBe('function');
  });

  test('1: delayed fonts and images are waited for within the budget, and each phase is timed', async () => {
    const shot = await captureUiState(policyPage({ fonts: 5, images: 5 }), { id: 'home', waitForFonts: true, waitForImages: true, readyTimeoutMs: 1000 });
    expect(shot.status).toBe('passed');
    expect(shot.readiness.phases.map(item => [item.phase, item.outcome])).toEqual([['fonts', 'ok'], ['images', 'ok'], ['screenshot', 'ok']]);
    expect(shot.labels?.[READINESS_LABEL]).toMatch(/^fonts=\d+ms images=\d+ms screenshot=\d+ms$/);
  });

  test('1: a policy that runs out of budget fails the capture naming its phase, with a picture of what was shown', async () => {
    const fonts = await captureUiState(policyPage({ fonts: 'never' }), { id: 'home', waitForFonts: true, waitForImages: true, readyTimeoutMs: 30 });
    expect(fonts).toMatchObject({ status: 'failed', readiness: { timedOut: 'fonts' }, labels: { [READINESS_TIMEOUT_LABEL]: 'fonts' } });
    expect(fonts.detail).toContain('readiness phase "fonts"');
    expect(fonts.screenshot?.data).toBeDefined();
    const images = await captureUiState(policyPage({ images: 'never' }), { id: 'home', waitForImages: true, readyTimeoutMs: 30 });
    expect(images.readiness.timedOut).toBe('images');
    const missing = await captureUiState(page(), { id: 'home', waitForFonts: true });
    expect(missing.status).toBe('failed');
    expect(missing.detail).toContain('needs page.evaluate');
  });

  test('2: with the policies off, a page that keeps animating is a valid capture, as before', async () => {
    let frame = 0;
    const shot = await captureUiState(page({ screenshot: async () => bytes(`frame ${frame++}`) }), { id: 'loading', kind: 'loading' });
    expect(shot.status).toBe('passed');
    expect(shot.labels).toBeUndefined();
    expect(shot.readiness.phases).toEqual([]);
  });

  test('3: the ready check is given a signal and a deadline; cancelling rejects and returns no capture', async () => {
    const stop = new AbortController();
    let seen: { signal: AbortSignal; deadlineAt: number } | undefined;
    let taken = 0;
    const capturing = captureUiState(page({ screenshot: async () => { taken++; return bytes('png'); } }), {
      id: 'pay', signal: stop.signal, readyTimeoutMs: 5000,
      ready: (_page, context) => { seen = context; setTimeout(() => stop.abort(new Error('claim lost')), 5); return new Promise<void>(() => {}); }
    });
    await expect(capturing).rejects.toThrow('claim lost');
    expect(seen!.signal.aborted).toBe(true);
    expect(seen!.deadlineAt).toBeGreaterThan(Date.now());
    expect(taken).toBe(0);
    // A one-argument ready check still fits.
    const legacy = await captureUiState(page(), { id: 'pay', ready: async (only: CapturePage) => { expect(only).toBeDefined(); } });
    expect(legacy.status).toBe('passed');
  });

  test('3: a capture whose signal is already aborted never starts', async () => {
    await expect(captureUiState(page(), { id: 'x', signal: AbortSignal.abort(new Error('stopped')) })).rejects.toThrow('stopped');
  });

  test('4: a requested scrolling region becomes named views of the same state and profile', async () => {
    const scrolls: number[] = [];
    let top = 0;
    const region: CaptureLocator = {
      evaluate: async <R, A>(fn: (element: HTMLElement, arg: A) => R | Promise<R>, arg: A) => {
        const element = { get scrollTop() { return top; }, set scrollTop(value: number) { top = value; scrolls.push(value); }, scrollHeight: 250, clientHeight: 100 } as unknown as HTMLElement;
        return fn(element, arg);
      },
      screenshot: async () => bytes(`region at ${top}`)
    };
    const shot = await captureUiState(page({ locator: () => region }), { id: 'checkout/summary', regions: [{ name: 'order lines', selector: '#lines', label: 'Order lines' }] });
    expect(shot.status).toBe('passed');
    expect(shot.attachments!.map(item => [item.name, item.label, item.role])).toEqual([
      ['checkout-summary--order-lines-1.png', 'Order lines (1 of 3)', 'view'],
      ['checkout-summary--order-lines-2.png', 'Order lines (2 of 3)', 'view'],
      ['checkout-summary--order-lines-3.png', 'Order lines (3 of 3)', 'view']
    ]);
    expect(scrolls).toEqual([0, 100, 200, 0]);
    const store = memoryStore();
    await publishChecks(store, uiStateLayer({ producer: 'playwright', recordedAtMs: 5, environment: 'mobile-web', profile: { viewport: '390x844' }, states: [shot] }));
    const index = new ReportIndex([{ id: 'one', store }]);
    await index.refresh();
    const catalog = uiCatalog(index.snapshot().layers);
    expect(catalog.states.map(state => state.id)).toEqual(['checkout/summary']);
    expect(catalog.states[0]!.cells[0]!.capture!.attachments!.map(item => item.label)).toEqual(['Order lines (1 of 3)', 'Order lines (2 of 3)', 'Order lines (3 of 3)']);
  });

  test('5: a page that never stabilises fails within its budget, keeping its last frame as the diagnostic picture', async () => {
    let frame = 0;
    const began = Date.now();
    const shot = await captureUiState(page({ screenshot: async () => { await new Promise(resolve => setTimeout(resolve, 1)); return bytes(`frame ${frame++}`); } }), { id: 'spinner', stability: { frames: 3, timeoutMs: 40 } });
    expect(Date.now() - began).toBeLessThan(1000);
    expect(shot).toMatchObject({ status: 'failed', readiness: { timedOut: 'stability' }, labels: { [READINESS_TIMEOUT_LABEL]: 'stability' } });
    expect(shot.detail).toContain('A stable picture did not become true within 40 ms');
    expect(new TextDecoder().decode(shot.screenshot!.data)).toMatch(/^frame \d+$/);
  });

  test('5: a page that settles passes, and its stable frame is the picture', async () => {
    let frame = 0;
    const shot = await captureUiState(page({ screenshot: async () => bytes(`frame ${Math.min(frame++, 2)}`) }), { id: 'settles', stability: true });
    expect(shot.status).toBe('passed');
    expect(new TextDecoder().decode(shot.screenshot!.data)).toBe('frame 2');
    expect(shot.readiness.phases.map(item => item.phase)).toEqual(['stability']);
  });
});
