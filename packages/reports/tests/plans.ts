import type { EvidenceStatus } from '../src/explorer-types';
import type { ObjectStore } from '../src/object-store';
import { publishChecks } from '../src/publish-checks';

/** A small deterministic generator, so a failure names its seed and reproduces. */
export function random(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const pick = <T,>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!;
  const shuffle = <T,>(items: readonly T[]): T[] => {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [copy[i], copy[j]] = [copy[j]!, copy[i]!]; }
    return copy;
  };
  return { next, pick, shuffle };
}

export type Plan = { producer: string; environment: string | null; branch: string; sha: string; recordedAtMs: number; checks: { id: string; status: EvidenceStatus }[] };

/** Partial runs: each plan checks a few things, on one environment, from one branch, at one time. */
export function plans(seed: number, count = 36): Plan[] {
  const r = random(seed);
  const ids = ['join', 'leave', 'rename', 'invite', 'archive', 'restore'];
  return Array.from({ length: count }, () => ({
    producer: r.pick(['gherkin', 'quint', 'e2e']),
    environment: r.pick(['desktop-web', 'ios', 'android', null]),
    branch: r.pick(['main', 'feat-a', 'feat-b']),
    sha: r.pick(['a', 'b', 'c']).repeat(40),
    // Few distinct times, so ties happen.
    recordedAtMs: 1 + Math.floor(r.next() * 8),
    checks: r.shuffle(ids).slice(0, 1 + Math.floor(r.next() * 4)).map(id => ({ id: `specs/list.feature > ${id}`, status: r.pick<EvidenceStatus>(['passed', 'passed', 'failed', 'running', 'not-run']) }))
  }));
}

export async function publish(store: ObjectStore, plan: Plan) {
  return publishChecks(store, {
    producer: plan.producer,
    ...(plan.environment ? { environment: plan.environment } : {}),
    branch: plan.branch,
    sha: plan.sha,
    recordedAtMs: plan.recordedAtMs,
    checks: plan.checks.map(check => ({ ...check, title: check.id, specPath: 'specs/list.feature' }))
  });
}
