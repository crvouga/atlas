/**
 * @module Test-runner adapter
 *
 * Runs an Atlas config as a test suite in Vitest, `bun test` or any Jest-style runner. The runner's own
 * `describe`, `it`, `beforeAll` and `expect` are passed in, so this module imports no test framework
 * and never touches global test state. It owns the mapping from planned paths to tests; the run itself
 * is `runConfig` from the core.
 */
import type { AtlasConfig, RunCommandOptions } from '../../core/src/index';
import { prepare, runConfig } from '../../core/src/index';

/** The subset of a Vitest/Jest-style runner's API that `describeAtlas` calls. */
type Suite = {
  describe: (name: string, fn: () => void) => void;
  it: (name: string, fn: () => void | Promise<void>, timeout?: number) => void;
  beforeAll: (fn: () => Promise<void>, timeout?: number) => void;
  expect: (value: unknown) => { toBe(expected: unknown): void };
};

/**
 * Registers a test suite for an Atlas config: one test that the charts are executable (no structural
 * lint finding), then one test per planned path, so any Vitest/Jest-style runner reports each journey
 * and generated path on its own. The whole plan runs once in `beforeAll` (paths share one manifest);
 * each test then reads its path's outcome. A failed path fails its test with the last attempt's error;
 * `passed` and `flaky` paths pass; a path that was `not-reached` (blocked by an event with no
 * implementation) or was not part of the run passes quietly.
 *
 * `prepare` runs synchronously when `describeAtlas` is called, so specs that cannot be loaded throw at
 * collection time. The run writes its output like `atlas run` does.
 *
 * @param config the Atlas config to run.
 * @param suite the runner's `describe`, `it`, `beforeAll` and `expect`.
 * @param options the `atlas run` options (`mode`, `paths`, `retry`, `output`, `log`, ...);
 *   `baseDirectory` resolves relative config paths (the current directory when omitted) and `timeoutMs`
 *   bounds the `beforeAll` (30 minutes by default). Progress lines are discarded unless `log` is given.
 *
 * @example
 * import { beforeAll, describe, expect, it } from 'bun:test';
 * describeAtlas(config, { describe, it, beforeAll, expect });
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

export { functionDriver } from '../../core/src/index';
