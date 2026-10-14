import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { expect, test } from 'bun:test';

import type { EvidencePage, LayerEvidence } from '@crvouga/atlas/reports/evidence-types';
import { checkSlots } from '@crvouga/atlas/reports/evidence-view';
import { combineEvidence } from '@crvouga/atlas/reports/layer-merge';
import type { ReportOutline } from '@crvouga/atlas/reports/layer-types';
import { publishLayer } from '@crvouga/atlas/reports/layer-store';

import { directoryStore } from './report-store';
import { exampleReportsApp } from './reports-dev';

const CHECK = 'todo/gherkin.share-a-list.plans-a-weekend';
const SHA = `c0ffee${'1'.repeat(34)}`;

async function evidence(app: { request: (path: string) => Response | Promise<Response> }) {
  const response = await app.request('/evidence');
  expect(response.status).toBe(200);
  const page = (await response.json()) as EvidencePage;
  const layers: LayerEvidence[] = [];
  for (const layer of page.layers) {
    const rows = await app.request(`/evidence/rows/${layer.backend}/${layer.id}`);
    expect(rows.status).toBe(200);
    layers.push({ ...(await rows.json()), layer });
  }
  const outline = (await (await app.request('/outline')).json()) as ReportOutline;
  return { page, layers, outline };
}

test('atlas viz serves five layers across environments before a run', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'atlas-example-reports-'));
  try {
    const { page } = await evidence(await exampleReportsApp(directoryStore(dir)));
    expect(page.layers).toHaveLength(5);
    expect(page.backends.map((backend) => backend.label)).toEqual(['This machine', 'Shared reports', 'Device lab', 'Example run']);
    expect(new Set(page.layers.map((layer) => layer.environment))).toEqual(new Set(['desktop-web', 'mobile-web', 'ios', 'android']));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('a desktop web example run replaces only the desktop slot it repeated', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'atlas-example-reports-'));
  try {
    const at = Date.parse('2026-10-13T12:00:00.000Z');
    await publishLayer(directoryStore(dir), {
      producer: 'todo',
      recordedAtMs: at,
      sha: SHA,
      branch: 'main',
      environment: 'desktop-web',
      runUrl: null,
      parameters: {},
      specs: [],
      recording: { type: 'layer' },
      source: { source: 'todo', packageDir: 'examples/todo', bucket: 'all', status: 'failed', updatedAtMs: at, environment: 'desktop-web', tests: [] },
      parts: [{
        sha: SHA,
        id: 'todo',
        kind: 'behavior',
        title: 'Todo example',
        recordedAtMs: at,
        checks: [{ id: CHECK, title: 'Share a list: Plans a weekend', status: 'failed', detail: 'The name field was covered', specPath: 'specs/share-a-list.feature', measurements: [] }]
      }]
    }, (async function* () {})());
    const { page, layers, outline } = await evidence(await exampleReportsApp(directoryStore(dir)));
    expect(page.layers).toHaveLength(6);
    const slot = checkSlots(combineEvidence(outline, layers).specs.find((spec) => spec.spec.path === 'specs/share-a-list.feature')!.results).find((entry) => entry.id === CHECK);
    const desktop = slot?.outcomes.find((outcome) => outcome.layer.environment === 'desktop-web');
    const ios = slot?.outcomes.find((outcome) => outcome.layer.environment === 'ios');
    expect(desktop?.row.detail).toBe('The name field was covered');
    expect(desktop?.layer.backend).toBe('example-run');
    expect(ios?.row.detail).toBe('The list name field never appeared');
    const offline = checkSlots(combineEvidence(outline, layers).specs.find((spec) => spec.spec.path === 'specs/share-a-list.feature')!.results).find((entry) => entry.title.includes('Starts over while offline'));
    expect(offline?.outcomes.find((outcome) => outcome.layer.environment === 'desktop-web')?.layer.backend).toBe('shared');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
