/** @module Workspace verify
 * Check a running Dev server end to end, the way a person would before trusting it: the server answers, the viewer
 * and settings load, the example project has reports and a UI catalog, and a shared link (if any) reaches it. The
 * intentional status examples (pending, running, errored) are reported as such and never fail verification.
 */
import path from 'node:path';
import { sharedLinks } from './workspace-share';

type Level = 'ok' | 'warn' | 'fail';
/** One verification result. */
export type Verdict = { check: string; level: Level; detail: string };

/** Producers and ids of the fixtures that are meant to look pending, running or errored. */
const intentional = (value: { producer?: string | null; check?: string; state?: string }) =>
  value.producer === 'todo-status-examples' || (value.check ?? value.state ?? '').startsWith('examples/status/');

type ReportStatus = { checks?: Record<string, number>; failing?: { check: string; producer?: string | null; status: string; environment: string }[] } | null;
type CatalogStatus = { summary?: { states: number; coverage: Record<string, number> }; problems?: { kind: string; state: string; profile: string }[] } | null;

/** Judge `atlas report status --format json`: any failed check that is not an intentional example fails. */
export function judgeReports(status: ReportStatus, err = ''): Verdict {
  if (!status?.checks) return { check: 'reports', level: 'fail', detail: `atlas report status gave no result${err ? `: ${err}` : ''}` };
  const real = (status.failing ?? []).filter((item) => item.status === 'failed' && !intentional(item));
  const examples = (status.failing ?? []).filter(intentional).length;
  return real.length
    ? { check: 'reports', level: 'fail', detail: `${real.length} failed: ${real.slice(0, 5).map((item) => `${item.check} (${item.environment})`).join(', ')}` }
    : { check: 'reports', level: 'ok', detail: `${status.checks.passed} passed of ${status.checks.total}; ${examples} intentional status examples` };
}

/** Judge `atlas ui-catalog status --format json`: a real problem, or nothing captured at all, fails. */
export function judgeCatalog(ui: CatalogStatus, err = ''): Verdict {
  if (!ui?.summary) return { check: 'ui catalog', level: 'fail', detail: `atlas ui-catalog status gave no result${err ? `: ${err}` : ''}` };
  const real = (ui.problems ?? []).filter((item) => !intentional(item));
  const captured = ui.summary.coverage.captured ?? 0;
  if (real.length) return { check: 'ui catalog', level: 'fail', detail: `${real.length} problems: ${real.slice(0, 5).map((item) => `${item.kind} ${item.state} (${item.profile})`).join(', ')}` };
  if (!captured) return { check: 'ui catalog', level: 'fail', detail: 'No state has been captured; run Dev to populate it' };
  return { check: 'ui catalog', level: 'ok', detail: `${captured} captured across ${ui.summary.states} states; status examples excluded` };
}

/** Run the Atlas CLI from this checkout against `url`, returning its parsed JSON output. */
export async function atlasJson(root: string, url: string, args: string[]): Promise<{ code: number; json: unknown; err: string }> {
  const child = Bun.spawn([process.execPath, path.join(root, 'packages/core/bin/atlas.mjs'), ...args, '--format', 'json'], {
    cwd: root,
    env: { ...process.env, ATLAS_STORE: url, ATLAS_SERVER_URL: url, ATLAS_PROJECT: process.env.ATLAS_PROJECT ?? 'todo-app' },
    stdout: 'pipe',
    stderr: 'pipe'
  });
  const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  let json: unknown = null;
  try {
    json = JSON.parse(out);
  } catch {}
  return { code, json, err: err.trim() };
}

async function get(url: string, timeout = 5000): Promise<{ status: number; body: string } | { error: string }> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeout), redirect: 'manual' });
    return { status: response.status, body: await response.text() };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/** Verify the running server at `url`. `population` is the Dev runtime's population state, when known. */
export async function verifyWorkspace(root: string, url: string, population?: string): Promise<Verdict[]> {
  const project = process.env.ATLAS_PROJECT ?? 'todo-app';
  const verdicts: Verdict[] = [];
  const add = (check: string, level: Level, detail: string) => verdicts.push({ check, level, detail });

  const ready = await get(`${url}/readyz`);
  add('server', 'status' in ready && ready.status === 200 ? 'ok' : 'fail', 'status' in ready ? `/readyz answered ${ready.status}` : ready.error);
  const page = await get(`${url}/`);
  add('viewer', 'status' in page && page.status === 200 && page.body.includes('__ATLAS_CONFIG__') ? 'ok' : 'fail', 'status' in page ? `page answered ${page.status}` : page.error);
  const admin = await get(`${url}/admin`);
  add('settings', 'status' in admin && admin.status === 200 ? 'ok' : 'fail', 'status' in admin ? `/admin answered ${admin.status}` : admin.error);
  const projects = await get(`${url}/api/projects`);
  const listed = 'status' in projects && projects.status === 200 && projects.body.includes(`"${project}"`);
  add('project', listed ? 'ok' : 'fail', listed ? `${project} is listed` : `${project} is not listed; run Dev to populate it`);

  if (population === 'running') add('population', 'warn', 'Dev is still populating the examples; verify again when it completes');
  else if (population === 'failed') add('population', 'fail', 'The last population failed; see the Dev output');
  else if (population === 'complete') add('population', 'ok', 'Examples populated');

  const reports = await atlasJson(root, url, ['report', 'status']);
  verdicts.push(judgeReports(reports.json as ReportStatus, reports.err));
  const catalog = await atlasJson(root, url, ['ui-catalog', 'status']);
  verdicts.push(judgeCatalog(catalog.json as CatalogStatus, catalog.err));

  const port = Number(new URL(url).port);
  const link = (await sharedLinks([port])).get(port);
  if (link) {
    const shared = await get(link, 10_000);
    add('shared link', 'status' in shared && shared.status === 200 ? 'ok' : 'fail', `${link} ${'status' in shared ? `answered ${shared.status}` : shared.error}`);
  }
  return verdicts;
}

/** Human-readable verdict lines. */
export function formatVerdicts(verdicts: Verdict[]): string {
  const mark = { ok: '✓', warn: '!', fail: '✗' } as const;
  const failed = verdicts.filter((item) => item.level === 'fail').length;
  return `${verdicts.map((item) => `${mark[item.level]} ${item.check}: ${item.detail}`).join('\n')}\n${failed ? `${failed} check(s) failed.` : 'Verified.'}`;
}
