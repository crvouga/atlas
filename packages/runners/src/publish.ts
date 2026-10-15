/** @module Publishing native runner results
 * Native reporters send checks to the project's Atlas server. Only the server knows its storage backend.
 */
import path from 'node:path';
import { createLiveReporter } from '../../reports/src/live-reporter';
import type { EvidenceCheck } from '../../reports/src/explorer-types';
import { uniqueChecks } from '../../reports/src/ingest';

/** Reporter options; explicit values override ATLAS_SERVER_URL, ATLAS_PUBLISH_TOKEN, ATLAS_ENVIRONMENT, ATLAS_BRANCH and ATLAS_SHA. */
export type ReporterOptions = {
  /** Project namespace; defaults to ATLAS_PROJECT. */
  readonly project?: string;
  readonly url?: string;
  readonly token?: string;
  readonly producer?: string;
  readonly environment?: string;
  readonly branch?: string;
  readonly sha?: string;
  readonly timeoutMs?: number;
  readonly rootDir?: string;
  /** Explicit final evidence time; normally generated when publication finishes. */
  readonly recordedAtMs?: number;
};

/** A portable check identity: paths relative to the project, using forward slashes on every OS. */
export function testFile(file: string | undefined, root = process.cwd()): string {
  return file ? path.relative(root, path.resolve(root, file)).replaceAll('\\', '/') : '';
}

/**
 * Upload one completed runner invocation. Unknown outcomes stay not-run, repeated identities are numbered.
 * Throws on missing configuration, timeouts or refused uploads so CI cannot silently lose its evidence.
 * No storage credentials or backend URL are needed by the runner.
 * @example
 * await uploadChecks('mocha', checks, { url: 'https://atlas.example.com', token: process.env.ATLAS_PUBLISH_TOKEN });
 */
export async function uploadChecks(runner: string, checks: readonly EvidenceCheck[], options: ReporterOptions = {}): Promise<void> {
  const url = options.url ?? process.env.ATLAS_SERVER_URL;
  if (!url) throw new Error('Atlas reporter: set ATLAS_SERVER_URL to the project Atlas server');
  const target = new URL(url);
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || target.search || target.hash) throw new Error('Atlas reporter: use an HTTP(S) server URL without credentials, query or fragment');
  target.pathname = `${target.pathname.replace(/\/$/, '')}/api/checks`;
  const token = options.token ?? process.env.ATLAS_PUBLISH_TOKEN ?? process.env.ATLAS_TOKEN;
  const response = await fetch(target, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
    headers: { 'content-type': 'application/json', ...((options.project ?? process.env.ATLAS_PROJECT) ? { 'x-atlas-project': options.project ?? process.env.ATLAS_PROJECT! } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ producer: options.producer ?? runner, recordedAtMs: options.recordedAtMs ?? Date.now(),
      environment: options.environment ?? process.env.ATLAS_ENVIRONMENT,
      branch: options.branch ?? process.env.ATLAS_BRANCH, sha: options.sha ?? process.env.ATLAS_SHA,
      checks: uniqueChecks(checks) })
  });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Atlas reporter: upload refused (HTTP ${response.status})`); }
  await response.body?.cancel();
}

/** Start the native runner's live feed with the same endpoint and identity as its final report. */
export function runnerLive(runner: string, options: ReporterOptions = {}, plannedChecks?: number): import('../../reports/src/live-reporter').LiveReporter {
  const url = options.url ?? process.env.ATLAS_SERVER_URL;
  if (!url) throw new Error('Atlas reporter: set ATLAS_SERVER_URL to the project Atlas server');
  return createLiveReporter({ producer: options.producer ?? runner, plannedChecks, title: `${runner} tests`, environment: options.environment ?? process.env.ATLAS_ENVIRONMENT,
    branch: options.branch ?? process.env.ATLAS_BRANCH, sha: options.sha ?? process.env.ATLAS_SHA }, { url, project: options.project ?? process.env.ATLAS_PROJECT, token: options.token ?? process.env.ATLAS_PUBLISH_TOKEN ?? process.env.ATLAS_TOKEN, timeoutMs: options.timeoutMs });
}

/** Flush live progress, then publish the full final evidence even if the lease was interrupted. Reject either failure. */
export async function finishRunner(live: import('../../reports/src/live-reporter').LiveReporter, runner: string, checks: readonly EvidenceCheck[], options: ReporterOptions = {}): Promise<void> {
  let error: unknown;
  const finalChecks = uniqueChecks(checks);
  finalChecks.forEach(check => live.check(check));
  try { await live.finish(); } catch (caught) { error = caught; }
  try { await uploadChecks(runner, finalChecks, { ...options, recordedAtMs: Math.max(Date.now(), (live.finishedAtMs ?? 0) + 1) }); } catch (caught) { error ??= caught; }
  if (error) throw error;
}
