import { addSummaries, summarizeSlots, type CheckSlot, type EvidenceView, type SpecEvidence } from '@crvouga/atlas/reports/evidence-view';
import type { LiveTest } from './live-runs';

type LiveIndex = ReadonlyMap<string, readonly LiveTest[]>;
const testKey = (id: string, file: string | null) => JSON.stringify([file, id]);

/** Build once per server update so rendering a row only looks up that test's executions. */
export function indexLiveTests(tests: readonly LiveTest[]): LiveIndex {
  const index = new Map<string, LiveTest[]>();
  for (const test of tests) {
    const key = testKey(test.check.id, test.check.specPath ?? null);
    const values = index.get(key);
    if (values) values.push(test);
    else index.set(key, [test]);
  }
  return index;
}

/** Match identity and spec, never a display title: different specs can use the same test name. */
export function testsForSlot(index: LiveIndex, slot: Pick<CheckSlot, 'id' | 'specPath' | 'latestAtMs'>) {
  const seen = new Set<string>();
  return (index.get(testKey(slot.id, slot.specPath)) ?? []).filter(({ run }) => {
    const identity = JSON.stringify([run.producer, run.environment, run.branch]);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return run.status === 'running' || (run.finishedAtMs ?? run.lastProgressAtMs) >= slot.latestAtMs;
  });
}

/** Display current execution beside history without changing immutable layers or report composition. */
export function withLiveProgress(view: EvidenceView, tests: readonly LiveTest[]): EvidenceView {
  if (!tests.length) return view;
  const specs = new Map(view.specs);
  const index = indexLiveTests(tests);
  const bySpec = new Map<string | null, Map<string, CheckSlot>>();
  for (const { check } of tests) {
    const file = check.specPath ?? null;
    if (!bySpec.has(file)) bySpec.set(file, new Map((file ? specs.get(file)?.slots ?? [] : view.unassigned).map(slot => [slot.id, slot])));
    const slots = bySpec.get(file)!;
    if (!slots.has(check.id)) slots.set(check.id, { key: testKey(check.id, file), id: check.id, title: check.title, specPath: file,
      status: check.status, outcomes: [], diagnostics: [], latestAtMs: 0, live: false });
  }
  const update = (slots: CheckSlot[]) => slots.map(slot => {
    const matches = testsForSlot(index, slot);
    if (!matches.length) return slot;
    const running = matches.some(({ run, check }) => run.status === 'running' && check.status === 'running');
    const latest = matches[0]!;
    const status = running ? 'running' : slot.outcomes.length ? slot.status : latest.check.status === 'running' ? 'not-run' : latest.check.status;
    const interrupted = matches.some(({ run, check }) => run.status === 'interrupted' && check.status === 'not-run');
    return { ...slot, status: interrupted && !running ? 'not-run' as const : status, live: running,
      latestAtMs: Math.max(slot.latestAtMs, ...matches.map(({ run }) => run.lastProgressAtMs)) };
  });
  let unassigned = view.unassigned;
  for (const [file, slots] of bySpec) {
    const updated = update([...slots.values()]);
    if (file) {
      const entry: SpecEvidence = { slots: updated, summary: summarizeSlots(updated) };
      specs.set(file, entry);
    } else unassigned = updated;
  }
  return { specs, unassigned, total: addSummaries([...specs.values()].map(entry => entry.summary)) };
}
