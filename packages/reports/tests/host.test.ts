import { afterAll, beforeAll, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { directoryStore } from '../src/directory-store';
import { reportsHost } from '../src/host';
import { loadDirectoryOutline } from '../src/directory-outline';
import { publishChecks } from '../src/publish-checks';
import type { EvidencePage } from '../src/evidence-types';
import { textFingerprint } from '../src/layer-merge';
import { memoryStore } from './memory-store';

let root: string;
beforeAll(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'atlas-host-'));
  await mkdir(path.join(root, 'specs', 'nested'), { recursive: true });
  await mkdir(path.join(root, 'specs', 'node_modules'), { recursive: true });
  await writeFile(path.join(root, 'specs', 'join.feature'), 'Feature: Join a list\n  Scenario: Joins\n');
  await writeFile(path.join(root, 'specs', 'nested', 'book.qnt'), 'module Booking {\n}\n');
  await writeFile(path.join(root, 'specs', 'node_modules', 'ignored.feature'), 'Feature: no');
  await writeFile(path.join(root, 'specs', 'latency.openslo.yaml'), 'kind: SLO\n');
  await writeFile(path.join(root, 'specs', '.hidden'), 'x');
  const store = directoryStore(path.join(root, 'reports'));
  await publishChecks(store, { producer: 'gherkin', environment: 'ios', recordedAtMs: 5, branch: 'main', checks: [{ id: 'specs/join.feature > Joins', title: 'Joins', status: 'passed', specPath: 'specs/join.feature' }], specs: [{ path: 'specs/join.feature', domain: 'x', kind: 'gherkin', title: 'Join a list', fingerprint: textFingerprint('Feature: Join a list\n  Scenario: Joins\n') }] });
});
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

test('a directory of specs is the outline: each file named specs/<path>, with its notation, title and fingerprint', async () => {
  const outline = await loadDirectoryOutline(path.join(root, 'specs'), { domain: 'lists' });
  expect(outline.specs.map(spec => [spec.path, spec.kind, spec.title, spec.domain])).toEqual([
    ['specs/join.feature', 'gherkin', 'Join a list', 'lists'],
    ['specs/latency.openslo.yaml', 'openslo', 'latency.openslo.yaml', 'lists'],
    ['specs/nested/book.qnt', 'quint', 'Booking', 'lists']
  ]);
  expect(outline.specs[0]!.fingerprint).toBe(textFingerprint('Feature: Join a list\n  Scenario: Joins\n'));
  expect(await outline.readSpec('specs/join.feature')).toContain('Feature: Join a list');
  expect(await outline.readSpec('specs/missing')).toBeNull();
});

test('a folder-derived store id never collides with an id the caller chose', async () => {
  const fetchReports = reportsHost({ specs: './specs', stores: [{ id: 'reports', label: 'Bucket', store: memoryStore() }, './reports'] });
  const page = await (await fetchReports(new Request('http://viewer/api/reports/evidence'), root)).json() as EvidencePage;
  expect(page.backends.map(backend => backend.id)).toEqual(['reports', 'reports-2']);
});

test('a wrong path comes back as a JSON error that names it', async () => {
  const response = await reportsHost({ specs: './no-such-specs', stores: ['./reports'] })(new Request('http://viewer/api/reports/outline'), root);
  expect(response.status).toBe(500);
  expect(((await response.json()) as { error: string }).error).toContain('no-such-specs');
});

test('the viewer asks the host, which lays the stores over the specs', async () => {
  const fetchReports = reportsHost({ specs: './specs', stores: ['./reports', { id: 'lab', label: 'Device lab', store: memoryStore() }] });
  const outline = await (await fetchReports(new Request('http://viewer/api/reports/outline'), root)).json() as { specs: { path: string }[] };
  expect(outline.specs.map(spec => spec.path)).toContain('specs/nested/book.qnt');
  const page = await (await fetchReports(new Request('http://viewer/api/reports/evidence'), root)).json() as EvidencePage;
  expect(page.layers.map(layer => [layer.producer, layer.environment, layer.backend])).toEqual([['gherkin', 'ios', 'reports']]);
  expect(page.backends.map(backend => [backend.id, backend.label, backend.available])).toEqual([['reports', 'reports', true], ['lab', 'Device lab', true]]);
  expect(page.notices).toEqual([]);
  const rows = await (await fetchReports(new Request(`http://viewer/api/reports/evidence/rows/reports/${page.layers[0]!.id}`), root)).json() as { rows: { id: string; status: string }[] };
  expect(rows.rows.map(row => [row.id, row.status])).toEqual([['specs/join.feature > Joins', 'passed']]);
});
