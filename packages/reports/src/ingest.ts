import { parseJunit } from './junit';
import { specPath } from './layer-merge';
import type { EvidenceCheck, EvidenceStatus } from './explorer-types';

/** The checks an existing test report holds, and when it was recorded when the report says. */
export type IngestedChecks = {
  readonly checks: readonly EvidenceCheck[];
  /**
   * For each check, in order, the names the report gave its container (suite, class, file), which
   * can name the spec it checks when the report has no path for it.
   */
  readonly hints?: readonly (readonly string[])[];
  readonly recordedAtMs: number | null;
  /** The tool that wrote the report, when it says. */
  readonly tool: string | null;
};

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Never silently count two checks as one: a repeated id gets the number of its occurrence. */
export function uniqueChecks(checks: readonly EvidenceCheck[]): EvidenceCheck[] {
  const seen = new Map<string, number>();
  return checks.map(check => {
    const count = (seen.get(check.id) ?? 0) + 1;
    seen.set(check.id, count);
    return count === 1 ? check : { ...check, id: `${check.id} #${count}` };
  });
}

const CTRF_STATUS: Readonly<Record<string, EvidenceStatus>> = { passed: 'passed', failed: 'failed', skipped: 'not-run', pending: 'not-run', other: 'not-run' };

/**
 * A [CTRF](https://ctrf.io) report (`results.tests`). A check's id is its file, its suites and its
 * name, so the same test keeps the same id in every run. Skipped, pending and other results are
 * `not-run`: never a pass.
 */
export function checksFromCtrf(report: unknown): IngestedChecks {
  const results = record(record(report).results);
  const tests = Array.isArray(results.tests) ? results.tests : [];
  if (!Array.isArray(results.tests)) throw new Error('Not a CTRF report: results.tests is missing');
  const checks = tests.map((raw, index): EvidenceCheck => {
    const test = record(raw);
    const suite = Array.isArray(test.suite) ? test.suite.map(text) : text(test.suite) ? [text(test.suite)] : [];
    const file = text(test.filePath);
    const name = text(test.name) || `test ${index + 1}`;
    const status = CTRF_STATUS[text(test.status)] ?? 'not-run';
    const message = text(test.message) || text(test.trace);
    const duration = finite(test.duration);
    return {
      id: [file, ...suite, name].filter(Boolean).join(' > '),
      title: name,
      status,
      detail: status === 'failed' ? (message || 'failed') : test.flaky === true ? 'Passed on retry (flaky)' : message,
      ...(file ? { specPath: specPath(file) } : {}),
      measurements: [],
      ...(duration === null ? {} : { durationMs: duration })
    };
  });
  const summary = record(results.summary);
  const hints = tests.map(raw => {
    const test = record(raw);
    return [...(Array.isArray(test.suite) ? test.suite.map(text) : [text(test.suite)]), text(test.filePath)].filter(Boolean);
  });
  return { checks: uniqueChecks(checks), hints, recordedAtMs: finite(summary.stop) ?? finite(summary.start), tool: text(record(results.tool).name) || null };
}

/** Many JUnit writers omit the offset. Read such a time as UTC, so it is the same wherever Atlas runs. */
function parseTimestamp(value: string): number {
  return Date.parse(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(value) ? `${value}Z` : value);
}

/** A JUnit XML report: one check per `<testcase>`, identified by its file or class and its name. */
export function checksFromJunit(xml: string): IngestedChecks {
  const cases = parseJunit(xml);
  if (cases.length === 0 && !/<testsuite/.test(xml)) throw new Error('Not a JUnit report: no <testsuite> found');
  const checks = cases.map((item): EvidenceCheck => {
    const where = item.file || item.classname;
    return {
      id: [where, item.name].filter(Boolean).join(' > '),
      title: item.name,
      status: item.status === 'passed' ? 'passed' : item.status === 'failed' ? 'failed' : 'not-run',
      detail: item.failure ?? '',
      ...(item.file ? { specPath: specPath(item.file) } : {}),
      measurements: [],
      ...(item.time === null ? {} : { durationMs: Math.round(item.time * 1000) })
    };
  });
  const hints = cases.map(item => [item.classname, item.suite, item.file].filter(Boolean));
  const stamps = [...xml.matchAll(/<testsuite\b[^>]*\stimestamp="([^"]+)"/g)].map(match => parseTimestamp(match[1]!)).filter(Number.isFinite);
  return { checks: uniqueChecks(checks), hints, recordedAtMs: stamps.length ? Math.max(...stamps) : null, tool: null };
}

/**
 * An Atlas run (`manifest.json`): one check per path. A path's key, which the same start and
 * events give in every run, is its id. A flaky path passed. While the run is still going, a
 * running path is `running` and a queued one `not-run`, so a snapshot never reads as finished.
 */
export function checksFromManifest(manifest: unknown): IngestedChecks {
  const root = record(manifest);
  const run = record(root.run);
  if (!Array.isArray(root.paths) || !run.id) throw new Error('Not an Atlas manifest: run and paths are required');
  const charts = Array.isArray(root.charts) ? root.charts.map(record) : [];
  const chart = charts.find(item => item.parentState == null) ?? charts[0];
  const directory = text(run.specDirectory).replace(/\/+$/, '');
  const file = text(chart?.file);
  const path = file ? specPath(directory ? `${directory}/${file}` : file) : null;
  const live = run.finishedAt === null;
  const checks = root.paths.map((raw): EvidenceCheck => {
    const item = record(raw);
    const status = text(item.status);
    const attempts = Array.isArray(item.attempts) ? item.attempts.map(record) : [];
    const progress = text(item.progress);
    const mapped: EvidenceStatus = live && progress === 'running' ? 'running' : live && progress === 'queued' ? 'not-run' : status === 'passed' || status === 'flaky' ? 'passed' : status === 'failed' ? 'failed' : 'not-run';
    const duration = finite(item.durationMs);
    return {
      id: text(item.key) || `${text(item.kind)}: ${text(item.name)}`,
      title: text(item.name) || text(item.id),
      status: mapped,
      detail: mapped === 'failed' ? text(attempts.at(-1)?.error) || 'failed' : status === 'flaky' ? 'Passed on retry (flaky)' : '',
      ...(path ? { specPath: path } : {}),
      measurements: [],
      ...(duration === null ? {} : { durationMs: duration })
    };
  });
  const startedAt = Date.parse(text(run.startedAt));
  const finishedAt = Date.parse(text(run.finishedAt));
  const duration = finite(run.durationMs) ?? 0;
  const at = Number.isFinite(finishedAt) ? finishedAt : Number.isFinite(startedAt) ? startedAt + duration : null;
  return { checks: uniqueChecks(checks), recordedAtMs: at, tool: 'atlas' };
}
