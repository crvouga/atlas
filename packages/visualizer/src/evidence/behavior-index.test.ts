import type { LayerHeader, LayerRow } from '@crvouga/atlas/reports/evidence-types';
import type { CheckSlot, EvidenceView } from '@crvouga/atlas/reports/evidence-view';
import type { EvidenceResult } from '@crvouga/atlas/reports/layer-merge';
import { expect, test } from 'bun:test';

import { passesFilters, parseSearch } from '../find/query';
import { behaviorDoc, indexBehaviors } from './behavior-index';

const PAY = `Feature: Pay an invoice
  Rule: Cards
    @smoke
    Scenario: Pay by card
      Given an invoice
      When paying by card
      Then the invoice is paid

    Scenario Outline: Pay in a currency
      When paying in "<code>"
      Examples:
        | code |
        | EUR  |
        | USD  |
`;
const LISTS = 'Feature: Share a list\n  Scenario: Add an item\n    When adding tea\n';

const header = (layer: string): LayerHeader => ({
  id: layer, backend: 'b', producer: 'e2e', packageDir: null, recordedAtMs: 1, sha: null, branch: 'main', environment: 'desktop-web', runUrl: null, parameters: {},
  recording: null, live: false, counts: { passed: 0, failed: 0, running: 0, 'not-run': 0 }, execution: layer
});
const VIDEO = { attachments: 1, steps: 0, annotations: 0, attempts: 0, links: 0, tags: [], labels: {}, roles: ['video'], videos: [{ name: 'a.webm', owner: 'check' as const, recording: 'sha256:1', available: true }] };
function slot(title: string, layer: string, row: Partial<LayerRow> = {}): CheckSlot {
  const result: EvidenceResult = {
    key: layer, slot: title, layer: header(layer), parameters: {}, warning: null,
    row: { kind: 'behavior', id: title, title, status: 'passed', specPath: 'specs/billing/pay.feature', detail: '', measurements: [], testId: null, variant: {}, durationMs: null, ...row }
  };
  return { key: title, id: title, title, specPath: result.row.specPath, status: result.row.status, outcomes: [result], diagnostics: [], latestAtMs: 1, live: false };
}
const view = (slots: Record<string, CheckSlot[]>) => ({ specs: new Map(Object.entries(slots).map(([path, list]) => [path, { slots: list }])) }) as unknown as EvidenceView;
const specs = [
  { path: 'specs/billing/pay.feature', domain: 'billing', kind: 'gherkin', title: 'Pay', fingerprint: 'now' },
  { path: 'specs/lists/add.feature', domain: '', kind: 'gherkin', title: 'Lists' }
];

test('every feature\'s behaviors are listed once, an outline as one per example row and never as its template', () => {
  const index = indexBehaviors({
    files: ['billing/pay.feature', 'lists/add.feature'],
    texts: new Map([['billing/pay.feature', PAY], ['lists/add.feature', LISTS]]),
    specs,
    view: view({ 'specs/billing/pay.feature': [slot('Pay an invoice: Pay by card', 'l1', { evidence: VIDEO })] }),
    evidence: [{ layer: header('l1'), fingerprints: { 'specs/billing/pay.feature': 'now' } }]
  });
  expect(index.entries.map((entry) => entry.title)).toEqual(['Pay by card', 'Pay in a currency — EUR', 'Pay in a currency — USD', 'Add an item']);
  expect(index.entries.map((entry) => entry.behavior.state)).toEqual(['demonstrated', 'unexecuted', 'unexecuted', 'unexecuted']);
  expect(index.entries[0]).toMatchObject({ file: 'billing/pay.feature', feature: 'Pay an invoice', rule: 'Cards', domain: 'billing' });
  // A domain nobody declared is not invented.
  expect(index.entries[3]!.domain).toBe('');
  expect(new Set(index.entries.map((entry) => entry.id)).size).toBe(4);
  expect(index).toMatchObject({ features: 2, unread: 0, unreadable: [] });
});

test('a recording of an older revision is not demonstrated here either', () => {
  const index = indexBehaviors({
    files: ['billing/pay.feature'],
    texts: new Map([['billing/pay.feature', PAY]]),
    specs,
    view: view({ 'specs/billing/pay.feature': [slot('Pay an invoice: Pay by card', 'l1', { evidence: VIDEO })] }),
    evidence: [{ layer: header('l1'), fingerprints: { 'specs/billing/pay.feature': 'earlier' } }]
  });
  expect(index.entries[0]!.behavior.state).toBe('outdated-recording');
  expect(index.entries[0]!.assessment.verdict).toBe('stale');
});

test('features not read yet or not readable are counted and named, never silently absent', () => {
  const index = indexBehaviors({
    files: ['billing/pay.feature', 'lists/add.feature', 'broken.feature', 'gone.feature'],
    texts: new Map([['billing/pay.feature', PAY], ['broken.feature', 'this is not gherkin'], ['gone.feature', '']]),
    specs,
    view: view({}),
    evidence: []
  });
  expect(index.unread).toBe(1);
  expect(index.unreadable).toEqual(['broken.feature', 'gone.feature']);
  expect(index.features).toBe(4);
  expect(index.entries).toHaveLength(3);
});

test('a result no scenario claims is still a behavior that was checked', () => {
  const index = indexBehaviors({
    files: ['lists/add.feature'],
    texts: new Map([['lists/add.feature', LISTS]]),
    specs,
    view: view({ 'specs/lists/add.feature': [slot('Share a list: Renamed since', 'l9', { specPath: 'specs/lists/add.feature' })] }),
    evidence: []
  });
  expect(index.entries.map((entry) => entry.title)).toEqual(['Add an item', 'Renamed since']);
  expect(index.entries[1]!.behavior.state).toBe('no-recording');
});

test('the search document carries wording, steps, domain and tags, and its facets feed the typed filters', () => {
  const index = indexBehaviors({
    files: ['billing/pay.feature'],
    texts: new Map([['billing/pay.feature', PAY]]),
    specs,
    view: view({ 'specs/billing/pay.feature': [slot('Pay an invoice: Pay by card', 'l1', { evidence: VIDEO })] }),
    evidence: []
  });
  const doc = behaviorDoc(index.entries[0]!);
  expect(doc.fields.find((field) => field.name === 'steps')!.text).toContain('paying by card');
  expect(doc.fields.find((field) => field.name === 'metadata')!.text).toContain('billing');
  expect(doc.target).toMatchObject({ to: '/specs/$kind', kind: 'gherkin', search: { spec: 'billing/pay.feature' } });
  const passes = (query: string) => passesFilters(doc.facets, parseSearch(query).filters);
  expect(passes('has:video')).toBe(true);
  expect(passes('status:passed tag:smoke domain:billing')).toBe(true);
  expect(passes('status:failed')).toBe(false);
  // A behavior nothing reported on has no status to match and no video.
  const unreported = behaviorDoc(index.entries[1]!);
  expect(passesFilters(unreported.facets, parseSearch('has:video').filters)).toBe(false);
  expect(unreported.status).toBe('none');
});
