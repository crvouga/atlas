import { describe, expect, test } from 'bun:test';

import { publishChecks } from '../../reports/src/publish-checks';
import { uiCatalog } from '../../reports/src/ui-catalog';
import { uiStateLayer } from '../../reports/src/ui-catalog-publish';
import { combineBackends } from '../../reports/src/compose';
import { ReportIndex } from '../../reports/src/report-index';
import { memoryStore } from '../../reports/tests/memory-store';
import { captureUiState, type CapturePage } from './ui-catalog';

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
