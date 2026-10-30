/** Persistent, explicitly illustrative status fixtures shared by local dev and the example preview. */
import type { ObjectStore } from '@crvouga/atlas/reports/object-store';
import { publishChecks } from '@crvouga/atlas/reports/publish-checks';
import { specEntry } from '@crvouga/atlas/reports/spec-inventory';
import { uiPlanLayer, uiStateLayer } from '@crvouga/atlas/reports/ui-catalog-publish';

const tags = ['example', 'status-preview'];
const labels = { fixture: 'status-preview' };
const states = [
  { id: 'examples/status/pending', title: 'Example: Pending capture', kind: 'loading' },
  { id: 'examples/status/running', title: 'Example: Running capture', kind: 'loading' },
  { id: 'examples/status/error', title: 'Example: Errored capture', kind: 'error' }
].map(state => ({ ...state, area: 'Status examples', fixture: 'status-preview', route: '/', covers: ['status-examples'] }));

/** Publish lasting pending/running/error samples without opening a live job or changing real execution results. */
export async function publishStatusExamples(store: ObjectStore, options: {
  featureText: string;
  recordedAtMs: number;
  sha?: string | null;
  branch?: string | null;
}): Promise<void> {
  const origin = { recordedAtMs: options.recordedAtMs, sha: options.sha ?? null, branch: options.branch ?? null };
  for (const profile of [
    { environment: 'desktop-web', profile: { viewport: '1280x800', scheme: 'light' } },
    { environment: 'mobile-web', profile: { viewport: '390x844', scheme: 'light' } }
  ]) {
    const common = { ...origin, ...profile, producer: 'todo-status-examples' };
    await publishChecks(store, { ...uiPlanLayer({ ...common, states }), tags, labels });
    await publishChecks(store, { ...uiStateLayer({ ...common, states: [
      { ...states[1]!, status: 'running', tags, labels, detail: 'Intentional running example: a capture is in progress. This persistent UI fixture has no active worker.' },
      { ...states[2]!, status: 'failed', tags, labels, detail: 'Intentional error example: the page did not become ready before the capture deadline. No screenshot was produced.' }
    ] }), tags, labels });
  }

  // A separate environment keeps these illustrative outcomes alongside the real browser results.
  // Matching existing scenarios also makes them readable in Gherkin and Behaviors, without adding executable specs.
  for (const sample of [
    { name: 'Pending', key: 'pending', scenario: 'Type a name', status: 'not-run', detail: 'Waiting for a worker; this check has not run.' },
    { name: 'Running', key: 'running', scenario: 'Create a named list', status: 'running', detail: 'The check has started and is waiting for the list to open.' },
    { name: 'Errored', key: 'error', scenario: 'Skip naming', status: 'failed', detail: 'The page did not become ready before the deadline.' }
  ] as const) {
    await publishChecks(store, {
      ...origin, producer: 'todo-status-examples', kind: 'behavior', title: 'Example statuses',
      environment: 'example-statuses', parameters: { fixture: 'status-preview' },
      run: { id: 'todo-status-examples', title: 'Status examples' },
      specs: [specEntry('specs/getting-started.feature', options.featureText)], tags, labels,
      checks: [{
        id: `examples/status/${sample.key}`, title: `Name a list: ${sample.scenario}`,
        specPath: 'specs/getting-started.feature', status: sample.status, tags, labels,
        detail: `Intentional ${sample.name.toLowerCase()} example. ${sample.detail} Persistent UI fixture; no active worker.`
      }]
    });
  }
}
