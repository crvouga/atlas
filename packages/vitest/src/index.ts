import type { AtlasConfig, RunCommandOptions } from '@crvouga/atlas';
import { prepare, runConfig } from '@crvouga/atlas';

type Suite = {
  describe: (name: string, fn: () => void) => void;
  it: (name: string, fn: () => void | Promise<void>, timeout?: number) => void;
  beforeAll: (fn: () => Promise<void>, timeout?: number) => void;
  expect: (value: unknown) => { toBe(expected: unknown): void };
};

/**
 * Turn an Atlas config into a test suite: one test per planned path, so any Vitest/Jest-style
 * runner reports each journey and generated path on its own. The whole plan runs once in
 * `beforeAll` (paths share one manifest); each test then reads its path's outcome.
 *
 *   import { describe, it, beforeAll, expect } from 'vitest';
 *   describeAtlas(config, { describe, it, beforeAll, expect });
 */
export function describeAtlas<C>(config: AtlasConfig<C>, suite: Suite, options: RunCommandOptions & { baseDirectory?: string; timeoutMs?: number } = {}) {
  const prepared = prepare(config, options.baseDirectory);
  const timeout = options.timeoutMs ?? 30 * 60_000;
  suite.describe(`atlas: ${prepared.scope.chart}`, () => {
    let outcome: Awaited<ReturnType<typeof runConfig<C>>> | null = null;
    suite.beforeAll(async () => {
      outcome = await runConfig(config, { ...options, log: options.log ?? (() => undefined) }, options.baseDirectory);
    }, timeout);
    suite.it('is a pure, reachable statechart whose journeys replay', () => {
      const structural = prepared.lint.findings.filter((f) => f.rule !== 'implemented').map((f) => f.message);
      suite.expect(structural.join('\n')).toBe('');
    });
    for (const planned of prepared.plan.paths) {
      suite.it(`${planned.kind}: ${planned.name}`, () => {
        const result = outcome?.manifest.paths.find((p) => p.id === planned.id);
        if (!result || result.status === 'not-reached') return;
        const error = result.attempts.at(-1)?.error ?? '';
        suite.expect(result.status === 'failed' ? error : 'ok').toBe('ok');
      });
    }
  });
}

export { functionDriver } from '@crvouga/atlas';
