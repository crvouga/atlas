import { expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { publishChecks } from '../../packages/reports/src/publish-checks';
import { ReportIndex } from '../../packages/reports/src/report-index';
import { catalogModel, runList, testCatalog } from '../../packages/reports/src/test-catalog';
import { uiCatalog } from '../../packages/reports/src/ui-catalog';
import { memoryStore } from '../../packages/reports/tests/memory-store';
import { publishStatusExamples } from '../../packages/visualizer/vite/example-statuses';

test('status examples persist across catalog and report views without replacing real results', async () => {
  const store = memoryStore();
  const featureText = await readFile(path.join(import.meta.dir, 'specs/getting-started.feature'), 'utf8');
  await publishChecks(store, { producer: 'real-browser', environment: 'desktop-web', recordedAtMs: 1, checks: [
    { id: 'examples/status/error', title: 'Name a list: Skip naming', status: 'passed', specPath: 'specs/getting-started.feature' }
  ] });
  // Repeat population with a later timestamp: the samples stay browsable and do not multiply.
  for (const recordedAtMs of [10, 20]) await publishStatusExamples(store, { featureText, recordedAtMs });
  const index = new ReportIndex([{ id: 'examples', store }]);
  await index.refresh();
  const layers = index.snapshot().layers;
  const catalog = uiCatalog(layers);
  expect(catalog.summary.coverage).toEqual({ captured: 0, missing: 2, capturing: 2, failed: 2, skipped: 0 });
  expect(catalog.states).toHaveLength(3);
  for (const cell of catalog.states.find(state => state.id.endsWith('/pending'))!.cells) {
    expect(cell.expected).toBe('declared');
    expect(cell.capture).toBeNull();
  }
  for (const state of catalog.states.filter(state => !state.id.endsWith('/pending'))) {
    for (const cell of state.cells) {
      expect(cell.capture?.detail).toContain('Intentional');
      expect(cell.capture?.labels.fixture).toBe('status-preview');
      expect(cell.capture?.image).toBeNull();
    }
  }
  const tests = testCatalog(catalogModel(layers, { history: index.history })).tests.filter(item => item.specPath === 'specs/getting-started.feature');
  expect(tests.map(item => item.status).sort()).toEqual(['failed', 'not-run', 'running']);
  expect(tests.find(item => item.id.endsWith('/error'))!.outcomes.find(outcome => outcome.environment === 'desktop-web')!.status).toBe('passed');
  const runs = runList(index.history, 'examples').runs.filter(run => run.runId === 'todo-status-examples');
  expect(runs).toHaveLength(1);
  expect(runs[0]!.title).toBe('Status examples');
  expect(runs[0]!.counts['not-run']).toBe(1);
  expect(runs[0]!.counts.failed).toBe(1);
  // Running is current progress, so it is visible in Tests rather than counted as a historical completion.
  expect(runs[0]!.counts.running).toBe(0);
});
