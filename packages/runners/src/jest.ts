/** @module Jest reporter
 * Uploads the aggregated results after Jest has finished, with suite crashes represented as failed checks.
 */
import type { EvidenceCheck } from '../../reports/src/explorer-types';
import { testFile, runnerLive, finishRunner, type ReporterOptions } from './publish';
type Result = { testFilePath: string; testExecError?: { message?: string; stack?: string }; failureMessage?: string; testResults: { title: string; fullName: string; status: string; duration?: number | null; failureMessages: string[]; invocations?: number }[] };
/**
 * Jest's native reporter; retain `default` in the reporter list for console output. Upload errors fail Jest.
 * @example
 * export default { reporters: ['default', ['@crvouga/atlas/jest', { url: 'https://atlas.example.com' }]] };
 */
export default class AtlasJestReporter {
  private live: import('../../reports/src/live-reporter').LiveReporter | undefined;
  private error: Error | undefined;
  constructor(_config: unknown, private readonly options: ReporterOptions = {}) {}
  /** Reset publishing errors for each watch-mode invocation. */
  onRunStart(result?: { numTotalTests?: number }): void { this.error = undefined; this.live = runnerLive('jest', this.options, result?.numTotalTests || undefined); }
  /** Publish the test as running before its body executes in a worker. */
  onTestCaseStart(test: { path: string }, info: { fullName: string; title: string }): void {
    this.live ??= runnerLive('jest', this.options);
    this.live.check({ id: `${testFile(test.path, this.options.rootDir)} > ${info.fullName}`, title: info.title, status: 'running' });
  }
  /** Stream each test outcome immediately, without waiting for other files to finish. */
  onTestCaseResult(test: { path: string }, result: Result['testResults'][number]): void {
    this.live ??= runnerLive('jest', this.options);
    this.live.check({ id: `${testFile(test.path, this.options.rootDir)} > ${result.fullName}`, title: result.title,
      status: result.status === 'passed' ? 'passed' : result.status === 'failed' ? 'failed' : 'not-run', detail: result.failureMessages.join('\n') });
  }
  /** Await uploading every final result, including test-file failures before any test ran. */
  async onRunComplete(_contexts: unknown, result: { testResults: Result[] }): Promise<void> {
    const checks: EvidenceCheck[] = [];
    for (const suite of result.testResults) {
      const file = testFile(suite.testFilePath, this.options.rootDir);
      for (const test of suite.testResults) checks.push({ id: `${file} > ${test.fullName}`, title: test.title,
        status: test.status === 'passed' ? 'passed' : test.status === 'failed' ? 'failed' : 'not-run',
        detail: test.failureMessages.join('\n'), measurements: [],
        ...(typeof test.duration === 'number' && Number.isFinite(test.duration) && test.duration >= 0 ? { durationMs: test.duration } : {}),
        ...((test.invocations ?? 1) > 1 ? { labels: { retries: String(test.invocations! - 1), ...(test.status === 'passed' ? { flaky: 'true' } : {}) } } : {}) });
      if (suite.testExecError) checks.push({ id: `${file} > [suite error]`, title: `${file}: suite error`, status: 'failed', detail: suite.testExecError.stack ?? suite.testExecError.message ?? suite.failureMessage ?? 'Suite did not execute', measurements: [] });
    }
    this.live ??= runnerLive('jest', this.options);
    checks.forEach(check => this.live!.check(check));
    try { await finishRunner(this.live, 'jest', checks, this.options); } catch (error) { this.error = error instanceof Error ? error : new Error(String(error)); }
  }
  /** Jest uses this to turn a publishing error into a failed invocation. */
  getLastError(): Error | undefined { return this.error; }
}
