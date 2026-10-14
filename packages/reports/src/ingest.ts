/**
 * @module Importing checks from existing test reports
 *
 * Turns the output of tools that already exist (CTRF JSON, JUnit XML, an Atlas run `manifest.json`) into checks a
 * layer can hold, so any test suite can publish without a custom producer. It owns the mapping of foreign
 * statuses onto the four Atlas statuses (anything not clearly passed or failed is `not-run`, never a pass) and the
 * rule for check ids: stable across runs, built from the file, suite and name, with a repeated id numbered
 * (`#2`, `#3`) so no check is silently counted as another. It reads text it is given and touches no files.
 *
 * @see docs/report-contract.md (choosing a check id)
 */
import path from 'node:path';

import { parseJunit } from './junit';
import { specPath } from './layer-merge';
import type { EvidenceCheck, EvidenceStatus } from './explorer-types';

/** The checks an existing test report holds, and when it was recorded when the report says. */
export type IngestedChecks = {
  /** One per test, with ids made unique. Attachments that name a file carry a `path` for the publisher to read; see `attachment-files.ts`. */
  readonly checks: readonly EvidenceCheck[];
  /**
   * For each check, in order, the names the report gave its container (suite, class, file), which
   * can name the spec it checks when the report has no path for it.
   */
  readonly hints?: readonly (readonly string[])[];
  /** When the report says the run ended (or started), epoch milliseconds; null when it does not say. */
  readonly recordedAtMs: number | null;
  /** The tool that wrote the report, when it says. */
  readonly tool: string | null;
  /** What the report says about the run as a whole: the tool, the build, the platform. */
  readonly labels?: Readonly<Record<string, string>>;
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

/** Never silently count two checks as one: the first check with an id keeps it and a repeat becomes `<id> #2`, `<id> #3`, ... in input order. */
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
 * `not-run`: never a pass; a status this function does not know is also `not-run`.
 *
 * Also carries what CTRF has beyond the outcome as evidence: tags, labels (browser, device, flaky, run environment
 * and tool), steps, attachments (files by `path`, `url` as `uri`, inline screenshot, stdout/stderr, trace), retry
 * attempts, a snippet annotation and `extra` under the `ctrf.extra` extension. `recordedAtMs` is `summary.stop`,
 * else `summary.start`. Throws `Not a CTRF report: results.tests is missing` when there is no `results.tests` array.
 *
 * @param report The parsed CTRF JSON.
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
    const tags = Array.isArray(test.tags) ? test.tags.map(text).filter(Boolean) : [];
    const labels: Record<string, string> = {};
    for (const key of ['browser', 'device', 'type', 'os', 'osPlatform']) if (text(test[key])) labels[key] = text(test[key]);
    if (test.flaky === true) labels.flaky = 'true';
    const steps = Array.isArray(test.steps) ? test.steps.map(step => { const item = record(step); return { name: text(item.name) || 'step', ...(text(item.status) ? { status: text(item.status) } : {}) }; }) : [];
    const attachments = [
      ...(Array.isArray(test.attachments) ? test.attachments.flatMap(raw => { const item = record(raw); return text(item.name) || text(item.path) ? [{ name: text(item.name) || path.basename(text(item.path)), ...(text(item.contentType) ? { contentType: text(item.contentType) } : {}), ...(text(item.path) ? { path: text(item.path) } : {}), ...(text(item.url) ? { uri: text(item.url) } : {}) }] : []; }) : []),
      ...(text(test.screenshot) ? [{ name: 'screenshot.png', role: 'screenshot', contentType: 'image/png', base64: text(test.screenshot) }] : []),
      ...logOf(test.stdout, 'stdout'),
      ...logOf(test.stderr, 'stderr'),
      ...(text(test.trace) ? [{ name: 'stack trace', role: 'log', contentType: 'text/plain', text: text(test.trace) }] : [])
    ];
    const attempts = Array.isArray(test.retryAttempts) ? test.retryAttempts.map((raw, at) => { const item = record(raw); return { index: finite(item.attempt) !== null ? Math.max(0, finite(item.attempt)! - 1) : at, status: ((CTRF_STATUS[text(item.status)] ?? 'not-run') as EvidenceStatus), ...(finite(item.duration) !== null ? { durationMs: finite(item.duration)! } : {}), ...(text(item.message) ? { detail: text(item.message) } : {}) }; }) : [];
    const annotations = text(test.snippet) ? [{ type: 'snippet', message: text(test.snippet), level: 'info', ...(file ? { source: { file, ...(finite(test.line) !== null ? { line: finite(test.line)! } : {}) } } : {}) }] : [];
    const extra = record(test.extra);
    return {
      id: [file, ...suite, name].filter(Boolean).join(' > '),
      title: name,
      status,
      detail: status === 'failed' ? (message || 'failed') : test.flaky === true ? 'Passed on retry (flaky)' : message,
      ...(file ? { specPath: specPath(file) } : {}),
      measurements: [],
      ...(duration === null ? {} : { durationMs: duration }),
      ...(tags.length ? { tags } : {}),
      ...(Object.keys(labels).length ? { labels } : {}),
      ...(steps.length ? { steps } : {}),
      ...(attachments.length ? { attachments } : {}),
      ...(attempts.length ? { attempts } : {}),
      ...(annotations.length ? { annotations } : {}),
      ...(Object.keys(extra).length ? { extensions: { 'ctrf.extra': extra } } : {})
    };
  });
  const summary = record(results.summary);
  const hints = tests.map(raw => {
    const test = record(raw);
    return [...(Array.isArray(test.suite) ? test.suite.map(text) : [text(test.suite)]), text(test.filePath)].filter(Boolean);
  });
  const tool = record(results.tool);
  const labels: Record<string, string> = {};
  for (const [key, value] of Object.entries(record(results.environment))) if (typeof value === 'string' || typeof value === 'number') labels[key] = String(value);
  if (text(tool.name)) labels.tool = text(tool.name);
  if (text(tool.version)) labels['tool.version'] = text(tool.version);
  return { checks: uniqueChecks(checks), hints, recordedAtMs: finite(summary.stop) ?? finite(summary.start), tool: text(tool.name) || null, ...(Object.keys(labels).length ? { labels } : {}) };
}

/** CTRF writes a stream as a list of lines. */
function logOf(value: unknown, name: string): { name: string; role: string; contentType: string; text: string }[] {
  const lines = Array.isArray(value) ? value.map(text).join('\n') : text(value);
  return lines.trim() ? [{ name, role: 'log', contentType: 'text/plain', text: lines }] : [];
}

/** Many JUnit writers omit the offset. Read such a time as UTC, so it is the same wherever Atlas runs. */
function parseTimestamp(value: string): number {
  return Date.parse(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(value) ? `${value}Z` : value);
}

/**
 * A JUnit XML report: one check per `<testcase>`, identified by its file or class and its name (`file or classname > name`).
 *
 * A case with a `<failure>` (an assertion that did not hold) or an `<error>` (an exception) is `failed`, one with
 * `<skipped>` is `not-run`, any other is `passed`. Durations are seconds converted to milliseconds. Properties become labels, `<system-out>`/`<system-err>` become log
 * attachments, and a Jenkins `[[ATTACHMENT|path]]` line in the output attaches that file by `path`. `recordedAtMs`
 * is the newest `<testsuite timestamp>` (a timestamp with no offset is read as UTC). Throws
 * `Not a JUnit report: no <testsuite> found` when the text has no test cases and no `<testsuite`.
 */
export function checksFromJunit(xml: string): IngestedChecks {
  const cases = parseJunit(xml);
  if (cases.length === 0 && !/<testsuite/.test(xml)) throw new Error('Not a JUnit report: no <testsuite> found');
  const checks = cases.map((item): EvidenceCheck => {
    const where = item.file || item.classname;
    // Jenkins' convention: a line `[[ATTACHMENT|/path/to/file]]` in a test's output attaches that file.
    const jenkins = [...`${item.stdout ?? ''}\n${item.stderr ?? ''}`.matchAll(/\[\[ATTACHMENT\|([^\]]+)\]\]/g)].map(match => ({ name: path.basename(match[1]!), path: match[1]! }));
    const attachments = [
      ...(item.stdout ? [{ name: 'stdout', role: 'log', contentType: 'text/plain', text: item.stdout }] : []),
      ...(item.stderr ? [{ name: 'stderr', role: 'log', contentType: 'text/plain', text: item.stderr }] : []),
      ...jenkins
    ];
    return {
      id: [where, item.name].filter(Boolean).join(' > '),
      title: item.name,
      status: item.status === 'passed' ? 'passed' : item.status === 'failed' ? 'failed' : 'not-run',
      detail: item.failure ?? '',
      ...(item.file ? { specPath: specPath(item.file) } : {}),
      measurements: [],
      ...(item.time === null ? {} : { durationMs: Math.round(item.time * 1000) }),
      ...(item.properties ? { labels: item.properties } : {}),
      ...(attachments.length ? { attachments } : {})
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
 *
 * Every check's `specPath` is the run's root chart file under its spec directory. A run is still going when
 * `run.finishedAt` is `null`. `recordedAtMs` is `run.finishedAt`, else `run.startedAt` plus `run.durationMs`.
 * Throws `Not an Atlas manifest: run and paths are required` when `paths` or `run.id` is missing.
 *
 * @param manifest The parsed `manifest.json` of an Atlas run.
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
    const steps = Array.isArray(item.steps) ? item.steps.map(raw => {
      const step = record(raw);
      const state = text(step.status);
      return { name: text(step.event) || 'step', kind: 'event', status: state === 'passed' || state === 'flaky' ? 'passed' : state === 'failed' ? 'failed' : 'not-reached', ...(text(step.reason) ? { detail: text(step.reason) } : {}), ...(text(step.transition) ? { extensions: { 'atlas.transition': text(step.transition) } } : {}) };
    }) : [];
    const journeys = Array.isArray(item.journeys) ? item.journeys.map(text).filter(Boolean) : [];
    return {
      id: text(item.key) || `${text(item.kind)}: ${text(item.name)}`,
      title: text(item.name) || text(item.id),
      status: mapped,
      detail: mapped === 'failed' ? text(attempts.at(-1)?.error) || 'failed' : status === 'flaky' ? 'Passed on retry (flaky)' : '',
      ...(path ? { specPath: path } : {}),
      measurements: [],
      ...(duration === null ? {} : { durationMs: duration }),
      ...(steps.length ? { steps } : {}),
      ...(text(item.kind) ? { labels: { kind: text(item.kind), ...(text(item.seed) ? { seed: text(item.seed) } : {}) } } : {}),
      ...(journeys.length ? { tags: journeys } : {})
    };
  });
  const startedAt = Date.parse(text(run.startedAt));
  const finishedAt = Date.parse(text(run.finishedAt));
  const duration = finite(run.durationMs) ?? 0;
  const at = Number.isFinite(finishedAt) ? finishedAt : Number.isFinite(startedAt) ? startedAt + duration : null;
  return { checks: uniqueChecks(checks), recordedAtMs: at, tool: 'atlas' };
}
