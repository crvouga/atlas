import { afterEach, expect, test } from 'bun:test';
import { writeUtf8 } from '@crvouga/atlas-reports/object-io';
import type { RunReport } from '@crvouga/atlas-reports/report-types';
import { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';

import { productName } from '../src/components/Header';
import { DecisionTables, decisionTables } from '../src/evidence/decision-table';
import { featureModel, slotsByScenario } from '../src/evidence/gherkin';
import { ModelTrace } from '../src/evidence/model-trace';
import { quintOutline, recordedModelStates, traceStates } from '../src/evidence/quint';
import { Timeline } from '../src/evidence/recording';
import { SnapshotPicture } from '../src/evidence/snapshot';
import { FEATURE, memoryStore, openAtlas, publishRun, recorded, step, type Atlas } from './atlas';

let atlas: Atlas | null = null;
afterEach(async () => {
  await atlas?.close();
  atlas = null;
});

const ADD = { test: 'add', title: 'Share a list: Add an item', status: 'passed' as const, steps: [step(1, 'Given a list'), step(2, 'When adding tea'), step(3, 'Then the list includes tea')] };
const ADD_FAILED = { ...ADD, status: 'failed' as const, error: 'Expected tea in the list', steps: [step(1, 'Given a list'), step(2, 'When adding tea', 'failed', { error: 'Expected tea in the list' })] };
const TEA = { test: 'several-tea', title: 'Share a list: Add several — Tea', status: 'passed' as const };
const MILK = { test: 'several-milk', title: 'Share a list: Add several — Milk', status: 'passed' as const };

test('the index says which specs have results, and a spec without evidence says what is missing', async () => {
  const localStore = memoryStore();
  await publishRun(localStore, { at: 20, checks: [ADD_FAILED, TEA, MILK] });
  atlas = await openAtlas({ at: '/specs/gherkin', deps: { localStore } });
  await atlas.sees('1 failed');
  // The tab, the filters and each row all state what was recorded.
  expect(atlas.find('nav[aria-label="Spec type"] a', 'Gherkin')!.textContent).toBe('Gherkin1');
  expect(atlas.find('button', /^ ?All/)!.textContent).toBe('All 2');
  expect(atlas.find('button', /^ ?Results/)!.textContent).toBe('Results 1');
  expect(atlas.find('button', /^ ?Failing/)!.textContent).toBe('Failing 1');
  expect(atlas.find('button', /^ ?None/)!.textContent).toBe('None 1');
  expect(atlas.find('nav[aria-label="Gherkin features"] a', 'Share a list')!.getAttribute('data-result')).toBe('failed');
  expect(atlas.find('nav[aria-label="Gherkin features"] a', 'Empty the list')!.getAttribute('data-result')).toBe('none');
  expect(atlas.text()).toContain('2 features');
  expect(atlas.text()).toContain('1 with results');
  expect(atlas.text()).toContain('1 without');
  await atlas.click('button', /^ ?None/);
  expect(atlas.find('nav[aria-label="Gherkin features"] a', 'Share a list')).toBeUndefined();
  expect(atlas.find('nav[aria-label="Gherkin features"] a', 'Empty the list')).toBeDefined();

  await atlas.click('nav[aria-label="Gherkin features"] a', 'Empty the list');
  await atlas.sees('No completed test report for this feature yet.');
  // The scenario is still readable, and nothing is shown as passed.
  await atlas.click('button', 'Clear');
  await atlas.sees('No completed test report for this scenario yet.');
  expect(atlas.text()).toContain('clearing');
  expect(atlas.text()).not.toContain('Passed');
});

test('a feature shows each scenario with what was recorded for it, including each example of an outline', async () => {
  const localStore = memoryStore();
  await publishRun(localStore, { at: 20, checks: [ADD_FAILED, TEA, MILK, { test: 'gone', title: 'Share a list: A renamed scenario', status: 'passed' }] });
  atlas = await openAtlas({ at: '/specs/gherkin?spec=lists/add.feature', deps: { localStore } });
  await atlas.sees('1 failed');
  expect(atlas.text()).toContain('Owners add items');
  expect(atlas.text()).toContain('3 passed');
  // The unrecorded scenario counts as missing, never as a pass.
  expect(atlas.text()).toContain('1 without a result');
  const rows = [...atlas.host.querySelectorAll('li[data-status]')].map((row) => [row.querySelector('span:nth-of-type(1)')?.textContent, row.getAttribute('data-status')]);
  expect(rows).toEqual([['Add an item', 'failed'], ['Add several — Tea', 'passed'], ['Add several — Milk', 'passed'], ['Remove an item', 'none'], ['A renamed scenario', 'passed']]);
  expect(atlas.text()).toContain('Other recorded results');
  // The failure reads in the list before anything is opened.
  expect(atlas.host.querySelector('li[data-status="failed"] p')?.textContent).toBe('Expected tea in the list');

  await atlas.click('button', 'Add an item');
  await atlas.until(() => atlas!.host.querySelector('li[data-open] ol li[data-status="failed"]') !== null, 'the recorded failed step');
  const failed = atlas.host.querySelector('li[data-open] ol li[data-status="failed"]')!;
  expect(failed.textContent).toContain('When adding tea');
  expect(failed.textContent).toContain('Expected tea in the list');
});

test('results from different backends and branches combine, and switching a newer source off reveals the earlier result', async () => {
  // regression: report-revisions-crowded
  // regression: report-root-navigation-missing
  const localStore = memoryStore(), store = memoryStore();
  await publishRun(store, { at: 10, branch: 'main', checks: [ADD, TEA] });
  await publishRun(localStore, { at: 20, branch: 'feat/lists', checks: [ADD_FAILED] });
  atlas = await openAtlas({ at: '/specs/gherkin?spec=lists/add.feature', deps: { localStore, store } });
  await atlas.sees('1 failed');
  // The newer branch replaced only the check it repeated; the older run still fills the rest.
  expect(atlas.text()).toContain('1 passed');
  await atlas.click('button', 'Add an item');
  await atlas.sees('Recorded in 2 runs');
  const history = [...atlas.host.querySelectorAll('section[aria-label="Other runs of this check"] li button')].map((row) => row.textContent);
  expect(history[0]).toContain('FailedThis machinefeat/lists');
  expect(history[1]).toContain('PassedShared reportsmain');

  // The superseded result stays readable in its own layer.
  await atlas.click('section[aria-label="Other runs of this check"] li button', 'Shared reports');
  await atlas.sees('An earlier result. A newer run replaced it in the combined report.');
  await atlas.sees('Then the list includes tea');

  await atlas.click('button', 'Sources');
  await atlas.sees('2 of 2 runs contribute');
  expect(atlas.text()).toContain('This machine1 run');
  expect(atlas.text()).toContain('Shared reports1 run');
  const branch = atlas.find('label', 'feat/lists')!.querySelector('input')!;
  await atlas.click('label', 'feat/lists');
  expect(branch.checked).toBe(false);
  await atlas.sees('1 of 2 runs contribute');
  const row = () => atlas!.find('nav[aria-label="Gherkin features"] a', 'Share a list')!;
  await atlas.until(() => row().getAttribute('data-result') === 'passed', 'the earlier pass');
  expect(atlas.host.querySelector('li[data-open]')!.getAttribute('data-status')).toBe('passed');
  expect(atlas.find('button', 'Sources')!.textContent).toContain('1 off');
  await atlas.click('button', 'Use every source');
  await atlas.until(() => row().getAttribute('data-result') === 'failed', 'the newer failure again');
});

test('a recording opens at its first failure and its address names the moment', async () => {
  const localStore = memoryStore();
  const frames = (index: number) => ({ frames: [{ index, capturedAtMs: index, snapshots: [] }] });
  await publishRun(localStore, { at: 20, checks: [{ ...ADD_FAILED, steps: [step(1, 'Given a list', 'passed', frames(1)), step(2, 'When adding tea', 'failed', { error: 'Expected tea in the list', ...frames(2) }), step(3, 'Then the list includes tea', 'passed', frames(3))] }] });
  atlas = await openAtlas({ at: '/specs/gherkin?spec=lists/add.feature', deps: { localStore } });
  await atlas.sees('1 failed');
  await atlas.click('button', 'Add an item');
  await atlas.sees('Open recording');
  await atlas.click('button', 'Open recording');
  await atlas.sees('Moment 2 of 3');
  // The page is named for the check, and leads back to its spec.
  expect(atlas.host.querySelector('h1')!.textContent).toBe('Add an item');
  expect(atlas.find('button', 'Share a list')).toBeDefined();
  await atlas.click('button', 'Next moment');
  await atlas.sees('Moment 3 of 3');
  expect(atlas.router.state.location.search).toMatchObject({ moment: 3, view: 'recording', check: 'lists/add' });
  await atlas.go('/specs/gherkin?spec=lists/add.feature&check=lists/add&view=recording&moment=1');
  await atlas.sees('Moment 1 of 3');
  // A moment the recording does not have falls back to where it usually opens.
  await atlas.go('/specs/gherkin?spec=lists/add.feature&check=lists/add&view=recording&moment=9');
  await atlas.sees('Moment 2 of 3');
  await atlas.click('button', 'Share a list');
  await atlas.sees('Owners add items');
});

test('a running suite shows each finished test before its package is collected', async () => {
  const localStore = memoryStore(), bucket = memoryStore();
  await publishRun(localStore, { at: 20, checks: [ADD] });
  atlas = await openAtlas({ at: '/specs/gherkin', deps: { localStore, live: { bucket: () => bucket, origin: async () => ({ sha: 'b'.repeat(40), branch: 'feat/lists' }) } } });
  await atlas.sees('1 with results');
  expect(atlas.text()).not.toContain('Running');
  await writeUtf8(localStore, 'active/lists.json', JSON.stringify({ packageDir: 'libs/lists', bucket: 'all', startedAtMs: atlas.time.clock.at, plannedChecks: 2 }), 'application/json');
  await atlas.poll();
  await atlas.sees('Running lists · 0 results');
  await writeUtf8(bucket, 'runs/latest/tests/add/report.json', JSON.stringify(recorded(ADD_FAILED)), 'application/json');
  atlas.time.clock.at += 2_000;
  await atlas.poll();
  await atlas.sees('Running lists · 1 result');
  await atlas.sees('1 failed');
  expect(atlas.text()).toContain('1 result so far, 1 failed');
  await atlas.click('nav[aria-label="Gherkin features"] a', 'Share a list');
  await atlas.sees('Owners add items');
  await atlas.click('button', 'Add an item');
  await atlas.sees('Running now');
  // Its timeline is readable while the suite is still going.
  await atlas.sees('Expected tea in the list');
});

test('unavailable reports say why and offer another attempt; the specs stay readable', async () => {
  const localStore = memoryStore();
  await publishRun(localStore, { at: 20, checks: [ADD] });
  const down = { value: true };
  atlas = await openAtlas({ at: '/specs/gherkin', deps: { localStore }, down });
  await atlas.sees('Recorded results are unavailable.');
  expect(atlas.text()).toContain('The reports store is unavailable.');
  expect(atlas.find('nav[aria-label="Gherkin features"] a', 'add')).toBeDefined();
  down.value = false;
  await atlas.click('button', 'Try again');
  await atlas.sees('1 with results');
  expect(atlas.text()).not.toContain('unavailable');
});

test('a model lists its recorded traces beside its declarations', async () => {
  const localStore = memoryStore();
  const trace = [0, 1].map((count) => step(count + 1, `add(${count})`, 'passed', { kind: 'quint', detail: `size = ${count}` }));
  await publishRun(localStore, { at: 20, checks: [{ test: 'list.trace-1', title: 'list · trace 1', status: 'passed', spec: 'specs/lists/list.qnt', steps: trace }] });
  atlas = await openAtlas({ at: '/specs/quint?spec=lists/list.qnt', deps: { localStore } });
  await atlas.sees('1 trace');
  expect(atlas.host.querySelector('h1')!.textContent).toBe('list');
  expect(atlas.text()).toContain('State');
  expect(atlas.text()).toContain('Actions');
  await atlas.click('button', 'trace 1');
  await atlas.sees('add(0)');
  await atlas.click('button', 'State 2');
  await atlas.sees('Changed');
});

test('a spec with far more results than fit a page shows them a page at a time', async () => {
  // regression: report-unbounded-parts
  const localStore = memoryStore();
  await publishRun(localStore, { at: 20, checks: Array.from({ length: 130 }, (_, i) => ({ test: `list.trace-${i + 1}`, title: `list · trace ${i + 1}`, status: 'passed' as const, spec: 'specs/lists/list.qnt' })) });
  atlas = await openAtlas({ at: '/specs/quint?spec=lists/list.qnt', deps: { localStore } });
  await atlas.sees('130 traces');
  expect(atlas.host.querySelectorAll('li[data-status]')).toHaveLength(40);
  await atlas.click('button', 'More traces (90 more)');
  expect(atlas.host.querySelectorAll('li[data-status]')).toHaveLength(80);
});

test('the product names the viewer, without the subtitle its spec title carries', () => {
  expect(productName('Gamezilla — the whole product')).toBe('Gamezilla');
  expect(productName('Coffee: ordering')).toBe('Coffee');
  expect(productName('Atlas')).toBe('Atlas');
  expect(productName(undefined)).toBe('Atlas');
});

test('a feature reads as rules and scenarios, and each result is filed under the scenario it ran', () => {
  const feature = featureModel(FEATURE)!;
  expect(feature.name).toBe('Share a list');
  expect(feature.description).toBe('People keep one list together.');
  expect(feature.rules.map((rule) => [rule.name, rule.scenarios.map((scenario) => scenario.name)])).toEqual([['Owners add items', ['Add an item', 'Add several', 'Remove an item']]]);
  expect(feature.rules[0]!.scenarios[1]!.examples[0]).toEqual({ name: '', header: ['item'], rows: [['Tea'], ['Milk']] });
  const slot = (title: string) => ({ title }) as Parameters<typeof slotsByScenario>[1][number];
  const filed = slotsByScenario(feature, [slot('Share a list: Add an item'), slot('Share a list: Add several — Tea'), slot('Share a list: Add several — Milk'), slot('Share a list: Add an item again'), slot('Something else')]);
  expect(filed.byScenario.get('Add an item')!.map((entry) => entry.title)).toEqual(['Share a list: Add an item']);
  expect(filed.byScenario.get('Add several')).toHaveLength(2);
  expect(filed.byScenario.has('Remove an item')).toBe(false);
  expect(filed.leftOver.map((entry) => entry.title)).toEqual(['Share a list: Add an item again', 'Something else']);
});

test('Quint outlines identify declarations without treating source as verification', () => {
  const source = "module list {\n var size: int\n action add = size' = size + 1\n val invSize = size >= 0\n}";
  expect(quintOutline(source).map((item) => [item.kind, item.name])).toEqual([['module', 'list'], ['var', 'size'], ['action', 'add'], ['val', 'invSize']]);
});

test('DMN displays conditions and outcomes together', () => {
  // regression: atlas-dmn-namespace-parser
  const dmn = '<definitions xmlns="https://www.omg.org/spec/DMN/20191111/MODEL/"><decision><decisionTable id="access"><input label="Owner"/><output name="Allowed"/><rule><inputEntry><text>true</text></inputEntry><outputEntry><text>true</text></outputEntry></rule></decisionTable></decision></definitions>';
  expect(decisionTables(dmn)[0]).toMatchObject({ columns: ['Owner', 'Allowed'], inputs: 1, rows: [['true', 'true']] });
  const html = renderToStaticMarkup(<DecisionTables text={dmn} />);
  expect(html).toContain('<th scope="col">Owner</th>');
  expect(html).toContain('<td data-output="true">true</td>');
  expect(renderToStaticMarkup(<DecisionTables text="<definitions" />)).toContain('could not be read');
});

const cleanups: (() => void)[] = [];
afterEach(async () => {
  for (const dispose of cleanups.splice(0)) await act(dispose);
});
async function mount(element: React.ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(element));
  cleanups.push(() => {
    root.unmount();
    host.remove();
  });
  return host;
}
async function press(host: HTMLElement, label: string) {
  const button = [...host.querySelectorAll('button')].find((candidate) => (candidate.getAttribute('aria-label') ?? candidate.textContent) === label);
  expect(button, label).toBeDefined();
  await act(async () => button!.click());
}
function timeline(statuses: readonly ('passed' | 'failed')[], extra: (index: number) => Partial<RunReport['steps'][number]> = () => ({})): RunReport {
  return { ...recorded({ test: 'list', title: 'Adds tea', status: statuses.includes('failed') ? 'failed' : 'passed' }), steps: statuses.map((status, index) => step(index, `Step ${index + 1}`, status, { frames: [{ index, capturedAtMs: index, snapshots: [] }], ...extra(index) })) };
}
/** The recording as its page holds it: the address is where the moment lives. */
function Recording({ report, at = null }: { report: RunReport; at?: number | null }) {
  const [moment, setMoment] = useState<number | null>(at);
  return <Timeline report={report} fileUrl={(file) => file} css="" moment={moment} onMoment={(next) => setMoment(next)} />;
}

test('a failed recording opens at its first failure, stops at the ends, and wraps among failures', async () => {
  const host = await mount(<Recording report={timeline(['passed', 'failed', 'passed', 'failed'])} />);
  expect(host.textContent).toContain('Moment 2 of 4');
  await press(host, 'Next failure');
  expect(host.textContent).toContain('Moment 4 of 4');
  expect(host.querySelector<HTMLButtonElement>('button[aria-label="Next moment"]')!.disabled).toBe(true);
  await press(host, 'Next failure');
  expect(host.textContent).toContain('Moment 2 of 4');
  await press(host, 'Previous moment');
  expect(host.textContent).toContain('Moment 1 of 4');
  expect(host.querySelector<HTMLButtonElement>('button[aria-label="Previous moment"]')!.disabled).toBe(true);
  expect(host.querySelector('[aria-current="step"]')!.textContent).toContain('Step 1');
});

test('a passing recording opens at its final moment and has no failure to move to', async () => {
  const host = await mount(<Recording report={timeline(['passed', 'passed', 'passed'])} />);
  expect(host.textContent).toContain('Moment 3 of 3');
  expect([...host.querySelectorAll('button')].find((button) => button.textContent === 'Next failure')!.disabled).toBe(true);
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home' })));
  expect(host.textContent).toContain('Moment 1 of 3');
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' })));
  expect(host.textContent).toContain('Moment 2 of 3');
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'End' })));
  expect(host.textContent).toContain('Moment 3 of 3');
  await press(host, 'Play');
  expect(host.textContent).toContain('Moment 1 of 3');
  await press(host, 'Pause');
});

test('a recording without moments keeps its steps and says no moment was recorded', async () => {
  const report = { ...recorded({ test: 'list', title: 'Adds tea', status: 'passed' }), steps: [step(1, 'Given a list')] };
  const host = await mount(<Recording report={report} />);
  expect(host.textContent).toContain('This test recorded no moments.');
  expect(host.textContent).toContain('Given a list');
  expect(host.querySelector<HTMLButtonElement>('ol[aria-label="Recorded steps"] button')!.disabled).toBe(true);
});

test('timing marks a step over the allowance as slow and opens its moment; no measurement is never quick', async () => {
  const measured = timeline(['passed', 'passed'], (index) => ({ performance: { executionMs: index ? 80 : 5, selfMs: index ? 80 : 5, snapshotMs: 0 } }));
  const host = await mount(<Recording report={measured} at={1} />);
  await press(host, 'Timing');
  const rows = [...host.querySelectorAll('ol[aria-label="Recorded time per step"] li')];
  expect(rows.map((row) => [row.getAttribute('data-band'), row.textContent])).toEqual([['cool', 'Step 15.0 ms'], ['slow', 'Step 2Slow80.0 ms']]);
  await act(async () => rows[1]!.querySelector('button')!.click());
  expect(host.textContent).toContain('Moment 2 of 2');
  const unmeasured = await mount(<Recording report={timeline(['passed'])} />);
  await press(unmeasured, 'Timing');
  expect(unmeasured.textContent).toContain('Measurements are unavailable for this recording.');
});

test('a model trace shows the prior state and what each step changed', async () => {
  const states = traceStates({ states: [{ count: 0, name: 'a' }, { count: 1, name: 'a' }] })!;
  const host = await mount(<ModelTrace states={states} />);
  expect(host.textContent).not.toContain('Changed');
  await press(host, 'State 2');
  const rows = [...host.querySelectorAll('tbody tr')].map((row) => [row.querySelector('th')!.textContent, row.hasAttribute('data-changed')]);
  expect(rows).toEqual([['countChanged', true], ['name', false]]);
  expect(traceStates({ states: [1] })).toBeNull();
});

test('a recorded model replay exposes the assignments and actions it captured', () => {
  const steps = [0, 1].map((index) => step(index, `add(item: ${index})`, 'passed', { kind: 'quint', detail: `count = ${index}\nitems = Set(${index})` }));
  expect(recordedModelStates(steps)[1]!.state).toEqual({ '#action': 'add(item: 1)', count: '1', items: 'Set(1)' });
  expect(recordedModelStates([step(0, 'When adding tea')])).toEqual([]);
});

test('a captured picture is placed in the page as recorded, without a frame, and marks only the control it recorded', async () => {
  // regression: atlas-snapshot-preserved
  const html = '<!DOCTYPE html><html><head><style>body{margin:0}</style></head><body><div class="dom-root"><button data-testid="join">Join</button><script>window.ran = true</script></div></body></html>';
  const host = await mount(<SnapshotPicture file="frames/f-1.html" html={html} css="button{color:red}" hit={{ path: ['join'] }} who="alice" />);
  expect(host.querySelector('iframe')).toBeNull();
  const picture = host.querySelector('.sr-snap')!.shadowRoot!;
  expect(picture.querySelector('button')!.textContent).toBe('Join');
  expect(picture.querySelector('script')).toBeNull();
  // The recorded stylesheet stays inside the picture: the viewer's own buttons are untouched.
  const sheets = [...picture.querySelectorAll('style')].map((style) => style.textContent).join('\n');
  expect(sheets).toContain('button{color:red}');
  // Its page-level rules apply to the picture's own box, not to the viewer's page.
  expect(sheets).toContain('.sr-snap-body{margin:0}');
  expect(document.head.textContent).not.toContain('button{color:red}');
  expect(host.querySelector('[role="img"]')!.getAttribute('aria-label')).toBe('Recorded alice');
  expect(host.textContent).not.toContain('cannot be found');
  const missing = await mount(<SnapshotPicture file="frames/f-1.html" html={html} css="" hit={{ path: ['absent'] }} who="alice" />);
  expect(missing.shadowRoot).toBeNull();
  expect(missing.querySelector('.sr-snap')!.shadowRoot!.querySelector('button')!.textContent).toBe('Join');
  expect(missing.textContent).toContain('The recorded control cannot be found in this picture.');
});
