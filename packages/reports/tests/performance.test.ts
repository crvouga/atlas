import { afterAll, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { combineBackends, summarize } from '../src/compose';
import { directoryStore } from '../src/directory-store';
import type { LayerEvidence } from '../src/evidence-types';
import { combineEvidence, layerEvidence, textFingerprint } from '../src/layer-merge';
import { publishChecks } from '../src/publish-checks';

// Budgets are twenty or more times what a quiet laptop needs, so they catch an accidental O(n²) and not a slow or busy machine.

test('combining 2,000 layers of 100 checks (200,000 results) is one linear pass', () => {
  const evidence: LayerEvidence[] = Array.from({ length: 2_000 }, (_, l) => layerEvidence({
    id: `source-${String(l).padStart(40, '0')}-p`, recordedAtMs: l, producer: `p${l % 7}`, sha: null, branch: `b${l % 5}`, runUrl: null,
    environment: ['ios', 'android', 'desktop-web'][l % 3]!, parameters: {}, specs: [], source: null, recording: null,
    parts: [{ sha: '', id: 'p', kind: 'checks', title: 'p', recordedAtMs: l, checks: Array.from({ length: 100 }, (_, c) => ({ id: `s${(l * 3 + c) % 4_000}.feature > c${c}`, title: `c${c}`, status: (c + l) % 17 ? 'passed' as const : 'failed' as const, detail: '', specPath: `specs/s${(l * 3 + c) % 4_000}.feature`, measurements: [] })) }]
  }, 'ci'));
  const started = performance.now();
  const combined = combineEvidence({ specs: Array.from({ length: 4_000 }, (_, i) => ({ path: `specs/s${i}.feature`, domain: 'd', kind: 'feature', title: `s${i}`, fingerprint: textFingerprint(String(i)) })), sha: null, changedFiles: [] }, evidence);
  const summary = summarize(combined);
  const elapsed = performance.now() - started;
  expect(summary.checks.total).toBeGreaterThan(100_000);
  expect(elapsed).toBeLessThan(6_000);
});

const roots: string[] = [];
afterAll(async () => { await Promise.all(roots.map(root => rm(root, { recursive: true, force: true }))); });

test('300 layers on disk, each recorded against 300 specs, combine in well under a few seconds', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'atlas-perf-'));
  roots.push(root);
  const store = directoryStore(root);
  const specs = Array.from({ length: 300 }, (_, i) => ({ path: `specs/s${i}.feature`, domain: 'd', kind: 'feature', title: `S${i}`, fingerprint: 'f'.repeat(24) }));
  for (let l = 0; l < 300; l++) {
    await publishChecks(store, { producer: `p${l % 7}`, environment: ['ios', 'android', 'desktop-web'][l % 3]!, branch: `b${l % 5}`, recordedAtMs: l, specs, checks: Array.from({ length: 50 }, (_, c) => ({ id: `s${(l * 3 + c) % 300}.feature > c${c}`, title: `c${c}`, status: 'passed' as const, specPath: `specs/s${(l * 3 + c) % 300}.feature` })) });
  }
  const started = performance.now();
  const report = await combineBackends([{ id: 'disk', store }]);
  expect(performance.now() - started).toBeLessThan(10_000);
  expect(report.layers.length).toBe(300);
  expect(report.notices).toEqual([]);
});
