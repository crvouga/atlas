/** @module Mocha and CodeceptJS reporter
 * Receives Mocha's final test outcomes, including CodeceptJS scenarios, and waits for the server upload in `done`.
 * No runner package is imported, so consumers use their own installed version.
 */
import type { EvidenceCheck } from '../../reports/src/explorer-types';
import { testFile, runnerLive, finishRunner, type ReporterOptions } from './publish';

type Test = { title: string; file?: string; duration?: number; fullTitle(): string; err?: { stack?: string; message?: string }; steps?: { name?: string; status?: string }[]; currentRetry?(): number };
type Runner = { total?: number; on(event: string, listener: (test: Test, error?: Error) => void): unknown };

/**
 * Mocha reporter; use `--reporter @crvouga/atlas/mocha` or CodeceptJS `--reporter @crvouga/atlas/codecept`.
 * Reporter options go in `reporterOptions`; environment variables are supported by every runner.
 * A failed upload adds a runner failure through Mocha's completion callback.
 * @example
 * // mocha configuration
 * export default { reporter: '@crvouga/atlas/mocha', reporterOptions: { url: 'https://atlas.example.com' } };
 */
export default class AtlasMochaReporter {
  private readonly checks = new Map<Test, EvidenceCheck>();
  private readonly options: ReporterOptions;
  private readonly runnerName: string;
  private readonly live: import('../../reports/src/live-reporter').LiveReporter;
  constructor(runner: Runner, options: { reporterOptions?: ReporterOptions } = {}, runnerName = 'mocha') {
    this.options = options.reporterOptions ?? {};
    this.runnerName = runnerName;
    this.live = runnerLive(runnerName, this.options, runner.total);
    const add = (test: Test, status: EvidenceCheck['status'], error?: Error) => {
      const file = testFile(test.file, this.options.rootDir);
      const retry = test.currentRetry?.() ?? 0;
      this.checks.set(test, { id: [file, test.fullTitle()].filter(Boolean).join(' > '), title: test.title, status,
        detail: error?.stack ?? error?.message ?? (status === 'failed' ? test.err?.stack ?? test.err?.message ?? 'failed' : ''), measurements: [],
        ...(typeof test.duration === 'number' && Number.isFinite(test.duration) && test.duration >= 0 ? { durationMs: test.duration } : {}),
        ...(retry ? { labels: { retries: String(retry), ...(status === 'passed' ? { flaky: 'true' } : {}) } } : {}),
        ...(test.steps?.length ? { steps: test.steps.map(step => ({ name: step.name ?? 'step', ...(step.status ? { status: step.status } : {}) })) } : {}) });
      const check = this.checks.get(test)!;
      this.live.check({ ...check, steps: check.steps?.map(step => ({ name: step.name, status: step.status })) });
    };
    runner.on('test', test => add(test, 'running'));
    runner.on('pass', test => add(test, 'passed'));
    runner.on('fail', (test, error) => add(test, 'failed', error));
    runner.on('pending', test => add(test, 'not-run'));
  }
  /** Mocha waits for this callback before exiting. Publishing errors fail the invocation. */
  done(failures: number, callback: (failures: number) => void): void {
    void finishRunner(this.live, this.runnerName, [...this.checks.values()], this.options).then(
      () => callback(failures), error => { console.error(error instanceof Error ? error.message : String(error)); callback(failures + 1); }
    );
  }
}
