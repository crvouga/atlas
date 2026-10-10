import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { LayerSummary } from '@crvouga/atlas-reports/layer-types';
import { combineLayers, textFingerprint } from '@crvouga/atlas-reports/layer-merge';
import type { RunReport } from '@crvouga/atlas-reports/report-types';
import { SpecDocument, parseFeature } from '../src/reports/document';
import { QuintDocument, quintOutline } from '../src/quint/quint-document';
import { LayerResults } from '../src/reports/layer-results';
import { Timeline } from '../src/reports/recording';
import { EvidenceBrowser } from '../src/reports/evidence-browser';
import { reportLocation, patchReportLocation } from '../src/reports/location';
import { ModelTrace, recordedModelStates, traceStates } from '../src/reports/trace';
import { snapshotDocument, highlightRecordedSnapshot } from '../src/reports/snapshot';
import { decisionTables } from '../src/reports/decision-table';

const cleanups: (() => void)[] = [];
afterEach(async () => { for (const dispose of cleanups.splice(0)) await act(dispose); window.history.replaceState(null, '', '#/specs'); });
async function mount(element: React.ReactNode) {
  const host = document.createElement('div'); document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(element));
  cleanups.push(() => { root.unmount(); host.remove(); });
  return host;
}
async function click(host: HTMLElement, label: string) {
  const button = [...host.querySelectorAll('button')].find(button => button.textContent === label);
  expect(button).toBeDefined();
  await act(async () => button!.click());
}
const feature = 'Feature: Share a list\n  Rule: Owners add items\n    Scenario Outline: Add an item\n      Given a list\n      When adding "<item>"\n      Then the list includes "<item>"\n      Examples:\n        | item |\n        | Tea |\n';
test('Gherkin rules, scenario outlines, steps and example tables remain structured', () => {
  expect(parseFeature(feature).feature?.children[0]?.rule?.children[0]?.scenario?.examples[0]?.tableBody).toHaveLength(1);
  const html = renderToStaticMarkup(<SpecDocument path="lists/add.feature" text={feature} />);
  expect(html).toContain('Owners add items'); expect(html).toContain('<td>Tea</td>'); expect(html).toContain('Scenario Outline: Add an item');
  expect(html).not.toContain('Model outline');
  expect(html).not.toContain('module ');
});
test('Quint outlines identify declarations without treating source as verification', () => {
  const source = 'module list {\n var size: int\n action add = size\' = size + 1\n val invSize = size >= 0\n}';
  expect(quintOutline(source).map(item => item.kind)).toEqual(['module', 'var', 'action', 'val']);
  const html = renderToStaticMarkup(<QuintDocument path="list.qnt" text={source} />);
  expect(html).toContain('State');
  expect(html).toContain('Actions');
  expect(html).not.toContain('Scenario');
  expect(html).not.toContain('Feature:');
});
test('DMN displays conditions and outcomes together', () => {
  // regression: atlas-dmn-namespace-parser
  const tables = decisionTables('<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/"><decision><decisionTable id="access"><input label="Owner"/><output name="Allowed"/><rule><inputEntry><text>true</text></inputEntry><outputEntry><text>true</text></outputEntry></rule></decisionTable></decision></definitions>');
  expect(tables[0]).toMatchObject({ columns: ['Owner', 'Allowed'], rows: [['true', 'true']] });
});
const spec = { path: 'specs/lists/add.feature', title: 'Share a list', domain: 'lists', kind: 'feature', fingerprint: textFingerprint(feature) };
function layer(id: string, time: number, title: string): LayerSummary {
  return { id, producer: 'lists', recordedAtMs: time, sha: String(time).repeat(40), branch: id, parameters: { device: 'phone' }, runUrl: null, source: null, recording: null, specs: [spec], parts: [{ sha: String(time).repeat(40), id: 'lists', title: 'Lists', kind: 'behavior', recordedAtMs: time, checks: [{ id: 'add', title, specPath: spec.path, status: 'passed', detail: '', measurements: [] }] }] };
}
test('many layers share a single bounded result page', () => {
  // regression: report-unbounded-parts
  const layers = Array.from({ length: 200 }, (_, i) => ({ ...layer(String(i), i, `Check ${i}`), producer: String(i) }));
  const results = combineLayers({ specs: [spec], sha: null, changedFiles: [] }, layers).specs[0]!.results;
  const html = renderToStaticMarkup(<LayerResults results={results} open={() => {}} />);
  expect(html.match(/<tr>/g)).toHaveLength(65);
  expect(html).toContain('Next results');
});
const report: RunReport = { meta: { testId: 'list', runId: 'run', title: 'Adds tea', system: 'list', runtime: 'memory', seed: '1', status: 'failed', actorIds: [], startedAtMs: 0, endedAtMs: 3, durationMs: 3 }, steps: [0, 1, 2].map(index => ({ index, title: `Step ${index + 1}`, kind: 'when', status: index === 1 ? 'failed' : 'passed', startedAtMs: index, endedAtMs: index + 1, durationMs: 1, frames: [{ index, capturedAtMs: index, snapshots: [] }], steps: [] })) };
test('recording starts at first failure, follows shared addresses, and stops at the ends', async () => {
  const host = await mount(<Timeline report={report} base="/recording" css="" />);
  expect(host.textContent).toContain('Moment 2 / 3');
  await click(host, 'Next moment'); expect(host.textContent).toContain('Moment 3 / 3');
  await click(host, 'Next moment'); expect(host.textContent).toContain('Moment 3 / 3');
  await click(host, 'Next failure'); expect(host.textContent).toContain('Moment 2 / 3');
  expect(reportLocation(window.location.hash).moment).toBe('2');
});
test('passing reports start at their final captured moment', async () => {
  const passing = { ...report, steps: report.steps.map(step => ({ ...step, status: 'passed' as const })) };
  const host = await mount(<Timeline report={passing} base="/passing" css="" />);
  expect(host.textContent).toContain('Moment 3 / 3');
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home' })));
  expect(host.textContent).toContain('Moment 1 / 3');
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'End' })));
  expect(host.textContent).toContain('Moment 3 / 3');
  await click(host, 'Play');
  expect(host.textContent).toContain('Moment 1 / 3');
  await click(host, 'Pause');
});
test('Quint traces expose prior state and changed variables', async () => {
  const states = traceStates({ states: [{ count: 0 }, { count: 1 }] });
  const host = await mount(<ModelTrace states={states!} />);
  await click(host, 'State 2');
  expect(host.textContent).toContain('Changed'); expect(host.textContent).toContain('count');
});
test('spec skeleton combines branches and disabling a newer layer reveals retained evidence', async () => {
  // regression: report-revisions-crowded
  // regression: report-root-navigation-missing
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  const old = layer('earlier', 1, 'Earlier check');
  const recent = layer('later', 2, 'Later check');
  client.setQueryData(['report-outline'], { specs: [spec, { ...spec, path: 'specs/empty.feature', title: 'Empty spec' }], sha: '3'.repeat(40), changedFiles: [] });
  client.setQueryData(['report-layers'], { pages: [{ layers: [recent, old], cursor: null, notices: [] }], pageParams: [null] });
  const host = await mount(<QueryClientProvider client={client}><EvidenceBrowser /></QueryClientProvider>);
  expect(host.textContent).toContain('Later check'); expect(host.textContent).not.toContain('Earlier check');
  expect(host.textContent).toContain('Potentially outdated');
  expect(host.textContent).toContain('No recorded evidence');
  expect(host.textContent).toContain('2 layers');
  const toggle = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  await act(async () => toggle.click());
  expect(host.textContent).toContain('Earlier check'); expect(host.textContent).not.toContain('Later check');
  expect(host.textContent).toContain('earlier');
  client.clear();
});
test('changing revision clears selected test and moment while preserving the Atlas route', () => {
  const hash = patchReportLocation('#/specs?tab=evidence&revision=one&test=a&moment=2', { revision: 'two', test: null, moment: null });
  expect(hash).toBe('#/specs?tab=evidence&revision=two');
});

test('Quint replay recordings expose actual captured assignments and actions', async () => {
  const steps = report.steps.map((step, index) => ({ ...step, kind: 'quint' as const, title: `add(item: ${index})`, detail: `count = ${index}\nitems = Set(${index})` }));
  const recorded = recordedModelStates(steps);
  expect(recorded[1]?.state).toEqual({ '#action': 'add(item: 1)', count: '1', items: 'Set(1)' });
  const trace = await mount(<ModelTrace states={recorded.map(entry => entry.state)} />);
  await click(trace, 'State 3');
  expect(trace.textContent).toContain('Changed');
  const host = await mount(<Timeline report={{ ...report, steps }} base="/quint" css="" />);
  expect(host.textContent).toContain('Moment 2 / 3');
  expect(host.textContent).not.toContain('Model trace');
  expect(host.textContent).not.toContain('quint ·');
});

test('highlighting a captured picture preserves its content and security policy', () => {
  // regression: atlas-snapshot-preserved
  const doc = new DOMParser().parseFromString(snapshotDocument('<button data-testid="join">Join</button>', 'button{color:red}'), 'text/html');
  expect(highlightRecordedSnapshot(doc, { path: ['join'] })).toBe('found');
  expect(doc.querySelector('button')?.textContent).toBe('Join');
  expect(doc.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content')).toContain("default-src 'none'");
  expect(doc.getElementById('sr-overlay-css')).not.toBeNull();
  expect(highlightRecordedSnapshot(doc, { path: ['absent'] })).toBe('missing');
});


test('spec navigation reads only the selected document and distinguishes empty results from filters', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(['report-outline'], { specs: [spec], sha: '1'.repeat(40), changedFiles: [] });
  client.setQueryData(['report-layers'], { pages: [{ layers: [], cursor: null, notices: [] }], pageParams: [null] });
  const reads: string[] = [];
  const host = await mount(<QueryClientProvider client={client}><EvidenceBrowser readSpec={async path => { reads.push(path); return feature; }} /></QueryClientProvider>);
  expect(reads).toEqual([]);
  expect(host.textContent).toContain('No recorded evidence yet');
  const specButton = host.querySelector<HTMLButtonElement>(`button[title="${spec.path}"]`)!;
  await act(async () => specButton.click());
  expect(reads).toEqual([spec.path]);
  expect(host.querySelector('.report-content-heading h2')?.textContent).toBe('Share a list');
  expect(host.querySelector('.report-document')?.hasAttribute('open')).toBe(true);
  const outcome = host.querySelector('select')!;
  await act(async () => { outcome.value = 'failed'; outcome.dispatchEvent(new Event('change', { bubbles: true })); });
  expect(host.textContent).toContain('No results match these filters');
  await click(host, 'Clear filters');
  expect(host.textContent).toContain('No recorded evidence yet');
  expect(outcome.value).toBe('all');
  client.clear();
});

test('result pagination keeps a large evidence collection bounded and opens the chosen recording', async () => {
  const layers = Array.from({ length: 70 }, (_, i) => ({ ...layer(String(i), i, `Check ${i}`), producer: String(i) }));
  const results = combineLayers({ specs: [spec], sha: null, changedFiles: [] }, layers).specs[0]!.results.map(result => ({ ...result, testId: result.check.title }));
  const opened: string[] = [];
  const host = await mount(<LayerResults results={results} open={result => opened.push(result.testId!)} />);
  expect(host.querySelectorAll('tbody tr')).toHaveLength(64);
  await click(host, 'Next results');
  expect(host.querySelectorAll('tbody tr')).toHaveLength(6);
  await click(host, 'Open recording');
  expect(opened).toEqual(['Check 64']);
});
