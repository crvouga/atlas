import { spawn } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createLiveReporter, type LiveReporter } from '../../packages/reports/src/live-reporter';
import { publishLayer } from '@crvouga/atlas/reports/layer-store';
import type { LayerSummary } from '@crvouga/atlas/reports/layer-types';
import type { ReportArtifact, ReportFrame, ReportStep, RunReport } from '@crvouga/atlas/reports/report-types';
import { chromium, type Browser, type Page } from 'playwright';

import { directoryStore } from './report-store';
import { startTodoServer, type TodoServer } from './server';
import { actionsIn, expandFeature, gitOrigin, loadOutline, quintRuns, specFiles, type QuintRun, type RunnableScenario, type ScenarioStep } from './spec-outline';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const specsDir = path.join(here, 'specs');
const reportsDir = path.join(here, 'atlas-reports');
const quintBin = path.join(repoRoot, 'node_modules/.bin/quint');
const modelPath = path.join(specsDir, 'todo.qnt');

type Runtime = 'gherkin' | 'quint';
type Recorded = {
  id: string;
  title: string;
  specPath: string;
  runtime: Runtime;
  status: 'passed' | 'failed';
  error?: string;
  startedAtMs: number;
  endedAtMs: number;
  steps: ReportStep[];
  files?: CapturedFile[];
  artifacts?: ReportArtifact[];
};

type CapturedFile = { file: string; bytes: Uint8Array; contentType: string };

let live: LiveReporter | undefined;
const progress = (value: Pick<Recorded, 'id' | 'title' | 'specPath'>, status: 'running' | 'passed' | 'failed', detail = '', steps: ReportStep[] = []) => live?.check({ id: `todo/${value.id}`, title: value.title, specPath: value.specPath, status, detail, steps: steps.slice(-20).map(step => ({ name: step.title, status: step.status })) });

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function step(index: number, title: string, status: 'passed' | 'failed', startedAtMs: number, endedAtMs: number, extra: { kind?: string; detail?: string; error?: string; frames?: ReportFrame[] } = {}): ReportStep {
  return {
    index,
    kind: extra.kind ?? 'when',
    title,
    status,
    startedAtMs,
    endedAtMs,
    durationMs: Math.max(0, endedAtMs - startedAtMs),
    frames: extra.frames ?? [],
    steps: [],
    ...(extra.detail ? { detail: extra.detail } : {}),
    ...(extra.error ? { error: extra.error } : {})
  };
}

async function snap(page: Page, index: number, at: number, files: CapturedFile[]): Promise<ReportFrame[]> {
  try {
    const bytes = new Uint8Array(await page.screenshot({ type: 'png' }));
    const file = `frames/${String(index).padStart(2, '0')}.png`;
    files.push({ file, bytes, contentType: 'image/png' });
    return [{ index: 0, capturedAtMs: at, snapshots: [{ name: 'screen', media: 'png', file }] }];
  } catch {
    return [];
  }
}

function quote(text: string): string {
  const value = /"([^"]*)"/.exec(text)?.[1];
  if (value === undefined) throw new Error(`Expected a quoted value in: ${text}`);
  return value;
}

async function see(page: Page, text: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  let last = '';
  while (Date.now() < deadline) {
    last = await page.locator('body').innerText();
    if (last.includes(text)) return;
    await delay(50);
  }
  throw new Error(`Did not see "${text}".\n${last}`);
}

async function todoItem(page: Page, title: string) {
  const item = page.locator('li.todo', { hasText: title });
  await item.first().waitFor({ timeout: 5_000 });
  const count = await item.count();
  if (count !== 1) throw new Error(`Expected one todo "${title}", found ${count}`);
  return item;
}

async function tap(page: Page, name: string): Promise<void> {
  const button = page.getByRole('button', { name, exact: true });
  if (name === 'Create list' || name === 'Skip for now' || name === 'Start over') {
    const suffix = name === 'Start over' ? '/api/reset' : '/api/setup';
    const response = page.waitForResponse((candidate) => candidate.url().endsWith(suffix));
    await button.click();
    const answered = await response;
    if (!answered.ok()) throw new Error(`${suffix} answered ${answered.status()}`);
    return;
  }
  await button.click();
}

async function addTodo(page: Page, title: string): Promise<void> {
  await page.getByLabel('New todo').fill(title);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await todoItem(page, title);
}

async function openList(page: Page, name: string): Promise<void> {
  await tap(page, 'Get started');
  if (name === 'My todos') await tap(page, 'Skip for now');
  else {
    await page.getByLabel('List name').fill(name);
    await tap(page, 'Create list');
  }
  await page.getByRole('heading', { name, exact: true }).waitFor({ timeout: 5_000 });
}

async function perform(page: Page, url: string, action: ScenarioStep): Promise<void> {
  const text = action.text;
  if (text === 'no list yet') return;
  if (text === 'a list' || text === 'a list with a todo' || text === 'a sync outage') {
    await openList(page, 'My todos');
    if (text === 'a list with a todo') await addTodo(page, 'Water the plants');
    if (text === 'a sync outage') await perform(page, url, { keyword: 'When', text: 'the sync fails' });
    return;
  }
  if (text === 'the customer names the list') return openList(page, 'Weekend chores');
  if (text === 'adds a todo' || text === 'the customer adds a todo') return addTodo(page, 'Water the plants');
  if (text === 'marks it done') return tap(page, 'Mark all done');
  if (text === 'sync fails') return perform(page, url, { keyword: 'When', text: 'the sync fails' });
  if (text === 'the retry timer elapses') return perform(page, url, { keyword: 'When', text: '30 seconds pass' });
  if (text === 'the list is synced' || text === 'the new list is synced') return see(page, 'All changes synced');
  if (text === 'the list is clear and synced') {
    await see(page, 'All done!');
    return see(page, 'All changes synced');
  }
  if (text === 'the customer throws the list away') return tap(page, 'Start over');
  if (text === 'the app is back at the welcome') return see(page, 'Plan your day');
  if (text === 'starts a new list') return openList(page, 'My todos');
  if (text.startsWith('a list named ') && !text.includes('"')) return openList(page, text.slice('a list named '.length));
  if (text.startsWith('the customer renames it to ')) {
    await page.getByLabel('New list name').fill(text.slice('the customer renames it to '.length));
    await tap(page, 'Rename list');
    return;
  }
  if (text.startsWith('the list is called ')) {
    await page.getByRole('heading', { name: text.slice('the list is called '.length), exact: true }).waitFor({ timeout: 5000 });
    return;
  }
  if (/welcome screen says|they see|the list says/.test(text)) return see(page, quote(text));
  if (/the list is named/.test(text)) {
    await page.getByRole('heading', { name: quote(text), exact: true }).waitFor({ timeout: 5_000 });
    return;
  }
  if (/is not synced/.test(text)) {
    const pending = (await todoItem(page, quote(text))).locator('.pending');
    const label = (await pending.textContent())?.trim();
    if (label !== 'not synced') throw new Error(`Expected "${quote(text)}" to be not synced`);
    return;
  }
  if (/is open$/.test(text)) {
    const className = (await (await todoItem(page, quote(text))).getAttribute('class')) ?? '';
    if (/\bdone\b/.test(className)) throw new Error(`"${quote(text)}" is done`);
    return;
  }
  if (text === '"Create list" is disabled' || text === '"Create list" is enabled') {
    const button = page.getByRole('button', { name: 'Create list', exact: true });
    await button.waitFor({ timeout: 5_000 });
    const disabled = await button.isDisabled();
    if (text.endsWith('disabled') !== disabled) throw new Error(`Create list is ${disabled ? 'disabled' : 'enabled'}`);
    return;
  }
  if (/they tap/.test(text)) return tap(page, quote(text));
  if (/into the list name/.test(text)) {
    await page.getByLabel('List name').fill(quote(text));
    return;
  }
  if (/they add|the list has/.test(text)) return addTodo(page, quote(text));
  if (/the sync fails/.test(text)) {
    const response = await fetch(`${url}/control/sync-failure`, { method: 'POST' });
    if (!response.ok) throw new Error(`/control/sync-failure answered ${response.status}`);
    // The poll is a page timer. The fake clock does not advance it on its own.
    await page.clock.runFor(1_000);
    return;
  }
  if (/30 seconds pass/.test(text)) {
    await page.clock.fastForward(30_000);
    return;
  }
  if (/a list named/.test(text)) return openList(page, quote(text));
  throw new Error(`No step for: ${action.keyword} ${text}`);
}

async function runScenario(browser: Browser, server: TodoServer, scenario: RunnableScenario): Promise<Recorded> {
  const startedAtMs = Date.now();
  progress(scenario, 'running');
  const steps: ReportStep[] = [];
  const files: CapturedFile[] = [];
  const videoDir = await mkdtemp(path.join(os.tmpdir(), 'atlas-gherkin-'));
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: { dir: videoDir, size: { width: 1280, height: 720 } }
  });
  const page = await context.newPage();
  page.setDefaultTimeout(5_000);
  let error: string | undefined;
  const run = async () => {
    await fetch(`${server.url}/control/reset`, { method: 'POST' });
    await page.clock.install();
    await page.goto(server.url, { waitUntil: 'load' });
    for (const [index, action] of scenario.steps.entries()) {
      const at = Date.now();
      const title = `${action.keyword} ${action.text}`;
      const kind = action.keyword.toLowerCase();
      progress(scenario, 'running', title, steps);
      try {
        await perform(page, server.url, action);
        const frames = await snap(page, index + 1, at, files);
        steps.push(step(index + 1, title, 'passed', at, Date.now(), { kind, frames }));
        progress(scenario, 'running', title, steps);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : String(cause);
        const frames = await snap(page, index + 1, at, files);
        steps.push(step(index + 1, title, 'failed', at, Date.now(), { kind, error: message, frames }));
        throw cause;
      }
    }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      run(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Timed out after 25 seconds')), 25_000);
      })
    ]);
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  } finally {
    if (timer) clearTimeout(timer);
    const video = page.video();
    try {
      await context.close();
      if (video) {
        const bytes = new Uint8Array(await readFile(await video.path()));
        files.push({ file: 'recording.webm', bytes, contentType: 'video/webm' });
      }
    } catch {
      // The steps and screenshots still stand when the runner could not keep a video.
    }
    await rm(videoDir, { recursive: true, force: true });
  }
  const endedAtMs = Date.now();
  const artifacts: ReportArtifact[] = files.some((file) => file.file === 'recording.webm')
    ? [{ name: 'Recording', media: 'video', file: 'recording.webm' }]
    : [];
  return { id: scenario.id, title: scenario.title, specPath: scenario.specPath, runtime: 'gherkin', status: error ? 'failed' : 'passed', ...(error ? { error } : {}), startedAtMs, endedAtMs, steps, files, ...(artifacts.length ? { artifacts } : {}) };
}

async function runGherkin(scenarios: readonly RunnableScenario[]): Promise<Recorded[]> {
  const server = await startTodoServer({ port: 0 });
  const browser = await chromium.launch({ headless: true });
  const recorded: Recorded[] = [];
  try {
    for (const scenario of scenarios) {
      const result = await runScenario(browser, server, scenario);
      recorded.push(result);
      progress(result, result.status, result.error, result.steps);
      console.log(`▶ ${scenario.title.slice(scenario.title.indexOf(': ') + 2)}`);
      console.log(`${result.status}${result.error ? `: ${result.error.split('\n')[0]}` : ''}`);
    }
  } finally {
    await browser.close();
    await server.close();
  }
  return recorded;
}

type CommandResult = { code: number; stdout: string; stderr: string };

function command(args: string[], cwd: string): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(quintBin, args, { cwd });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => out.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => err.push(chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stdout: Buffer.concat(out).toString('utf8'), stderr: Buffer.concat(err).toString('utf8') }));
  });
}

function notable(text: string): string {
  return text
    .split('\n')
    .filter((line) => line.trim() && !line.includes('NO_COLOR') && !line.includes('trace-warnings'))
    .join('\n')
    .trim();
}

function showValue(value: unknown): string {
  if (value && typeof value === 'object' && !Array.isArray(value) && 'tag' in value && typeof value.tag === 'string') return value.tag;
  return JSON.stringify(value) ?? 'null';
}

function traceSteps(body: string, file: { vars?: string[]; states?: Record<string, unknown>[] } | null, failed: boolean): ReportStep[] {
  const vars = file?.vars ?? [];
  const actions = actionsIn(body).filter((action) => !action.disabled);
  const details = (file?.states ?? []).flatMap((state) => {
    const names = vars.filter((name) => Object.prototype.hasOwnProperty.call(state, name));
    if (!names.length) return [];
    return [names.map((name) => `${name} = ${showValue(state[name])}`).join('\n')];
  });
  const at = Date.now();
  return details.map((detail, index) => {
    const title = details.length === actions.length ? (actions[index]?.name ?? `State ${index + 1}`) : `State ${index + 1}`;
    const status = failed && index === details.length - 1 ? 'failed' : 'passed';
    return step(index + 1, title, status, at, at, { kind: 'quint', detail });
  });
}

async function readItf(dir: string, name: string): Promise<{ vars?: string[]; states?: Record<string, unknown>[] } | null> {
  const files = (await readdir(dir)).filter((file) => new RegExp(`^${name}_\\d+\\.itf\\.json$`).test(file)).sort();
  const last = files.at(-1);
  if (!last) return null;
  return JSON.parse(await readFile(path.join(dir, last), 'utf8')) as { vars?: string[]; states?: Record<string, unknown>[] };
}

function errorText(errors: unknown): string {
  if (!Array.isArray(errors) || errors.length === 0) return '';
  return errors
    .map((error) => (error && typeof error === 'object' && 'message' in error ? String(error.message) : JSON.stringify(error)))
    .join('\n');
}

async function runQuint(moduleName: string, runs: readonly QuintRun[]): Promise<Recorded[]> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'atlas-todo-quint-'));
  const startedAtMs = Date.now();
  try {
    const resultPath = path.join(dir, 'result.json');
    for (const run of runs) progress({ id: run.id, title: `${moduleName} · ${run.title}`, specPath: 'specs/todo.qnt' }, 'running');
    const tested = await command(['test', modelPath, '--seed=1', '--max-samples=1', '--out', resultPath, '--out-itf', path.join(dir, '{test}_{seq}.itf.json')], repoRoot);
    const note = notable(`${tested.stdout}\n${tested.stderr}`);
    if (note) console.log(note);
    let result: { passed?: string[]; failed?: string[]; errors?: unknown[] } = {};
    try {
      result = JSON.parse(await readFile(resultPath, 'utf8')) as typeof result;
    } catch {
      const message = note || `quint test exited ${tested.code}`;
      return runs.map((run) => ({ id: run.id, title: `${moduleName} · ${run.title}`, specPath: 'specs/todo.qnt', runtime: 'quint', status: 'failed', error: message, startedAtMs, endedAtMs: Date.now(), steps: [] }));
    }
    const passed = new Set(result.passed ?? []);
    const failed = new Set(result.failed ?? []);
    const failure = errorText(result.errors);
    const recorded: Recorded[] = [];
    for (const run of runs) {
      const ok = passed.has(run.name) && !failed.has(run.name);
      const missing = !passed.has(run.name) && !failed.has(run.name);
      const status = ok ? 'passed' : 'failed';
      const error = ok ? undefined : missing ? `${run.name} did not run` : failure || `${run.name} failed`;
      const steps = traceSteps(run.body, await readItf(dir, run.name), status === 'failed');
      const endedAtMs = Date.now();
      recorded.push({ id: run.id, title: `${moduleName} · ${run.title}`, specPath: 'specs/todo.qnt', runtime: 'quint', status, ...(error ? { error } : {}), startedAtMs, endedAtMs, steps });
      progress(recorded.at(-1)!, status, error, steps);
      console.log(`▶ ${run.title}`);
      console.log(`${status}${error ? `: ${error.split('\n')[0]}` : ''}`);
    }
    progress({ id: 'quint.invariants', title: `${moduleName} · Invariants hold`, specPath: 'specs/todo.qnt' }, 'running');
    const invariants = await command(['run', modelPath, '--seed=1', '--max-samples=200', '--max-steps=20', '--invariant=list_holds', '--out', path.join(dir, 'invariants.json'), '--out-itf', path.join(dir, 'invariants_{seq}.itf.json')], repoRoot);
    const invariantNote = notable(`${invariants.stdout}\n${invariants.stderr}`);
    if (invariantNote) console.log(invariantNote);
    let invariantStatus: 'passed' | 'failed' = 'failed';
    let invariantError: string | undefined = 'quint run did not report a status';
    try {
      const outcome = JSON.parse(await readFile(path.join(dir, 'invariants.json'), 'utf8')) as { status?: string; errors?: unknown[] };
      if (outcome.status === 'ok') {
        invariantStatus = 'passed';
        invariantError = undefined;
      } else invariantError = errorText(outcome.errors) || outcome.status || invariantError;
    } catch {
      invariantError = invariantNote || invariantError;
    }
    const invariantSteps = traceSteps('', await readItf(dir, 'invariants'), invariantStatus === 'failed');
    recorded.push({
      id: 'quint.invariants',
      title: `${moduleName} · Invariants hold`,
      specPath: 'specs/todo.qnt',
      runtime: 'quint',
      status: invariantStatus,
      ...(invariantError ? { error: invariantError } : {}),
      startedAtMs,
      endedAtMs: Date.now(),
      steps: invariantSteps
    });
    progress(recorded.at(-1)!, invariantStatus, invariantError, invariantSteps);
    console.log('▶ Invariants hold');
    console.log(`${invariantStatus}${invariantError ? `: ${invariantError.split('\n')[0]}` : ''}`);
    return recorded;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function reportOf(check: Recorded): RunReport {
  return {
    meta: {
      system: 'todo',
      runtime: check.runtime,
      seed: check.id,
      startedAtMs: check.startedAtMs,
      endedAtMs: check.endedAtMs,
      durationMs: Math.max(0, check.endedAtMs - check.startedAtMs),
      status: check.status,
      runId: 'latest',
      testId: check.id,
      title: check.title,
      actorIds: [],
      sourceFile: check.specPath,
      ...(check.error ? { error: check.error } : {})
    },
    steps: check.steps,
    ...(check.artifacts?.length ? { artifacts: check.artifacts } : {})
  };
}

async function publish(checks: readonly Recorded[]): Promise<void> {
  const outline = await loadOutline(specsDir, repoRoot);
  const origin = await gitOrigin(repoRoot);
  const now = Date.now();
  const reports = checks.map(reportOf);
  const failed = checks.some((check) => check.status === 'failed');
  const summary: Omit<LayerSummary, 'id'> = {
    ...(origin.sha ? {} : { freshness: 'unknown' }),
    producer: 'todo',
    recordedAtMs: now,
    sha: origin.sha,
    branch: origin.branch,
    // The browser scenarios run on desktop web. This fills that slot and leaves the other environments.
    environment: 'desktop-web',
    runUrl: null,
    parameters: {},
    specs: outline.specs,
    recording: { type: 'layer' },
    source: { source: 'todo', packageDir: 'examples/todo', bucket: 'all', status: failed ? 'failed' : 'passed', updatedAtMs: now, environment: 'desktop-web', tests: reports.map((report) => report.meta) },
    parts: [
      {
        sha: origin.sha ?? '',
        id: 'todo',
        kind: 'behavior',
        title: 'Todo example',
        recordedAtMs: now,
        checks: checks.map((check) => ({ id: `todo/${check.id}`, title: check.title, status: check.status, detail: check.error ?? '', specPath: check.specPath, measurements: [] }))
      }
    ]
  };
  async function* entries() {
    for (const check of checks) {
      const report = reportOf(check);
      yield { key: `tests/${report.meta.testId}/report.json`, bytes: new TextEncoder().encode(JSON.stringify(report)), contentType: 'application/json' };
      for (const file of check.files ?? []) yield { key: `tests/${report.meta.testId}/files/${file.file}`, bytes: file.bytes, contentType: file.contentType };
    }
  }
  await publishLayer(directoryStore(reportsDir), summary, entries());
}

function summary(label: string, checks: readonly Recorded[]): void {
  const passed = checks.filter((check) => check.status === 'passed').length;
  const failed = checks.length - passed;
  console.log(`${label} ${passed}/${checks.length} passed, ${failed} failed`);
}

export async function runDocuments(): Promise<number> {
  const files = await specFiles(specsDir);
  const scenarios = files.filter((file) => file.kind === 'gherkin').flatMap((file) => expandFeature(file.path, file.text)).filter((scenario) => scenario.runnable);
  const model = files.find((file) => file.path === 'specs/todo.qnt');
  if (!model) throw new Error('examples/todo/specs/todo.qnt is missing');
  const quint = quintRuns(model.text);
  if (process.env.ATLAS_SERVER_URL) live = createLiveReporter({ producer: 'todo', title: 'Todo · Gherkin and Quint', plannedChecks: scenarios.length + quint.runs.length + 1, environment: 'desktop-web' }, { url: process.env.ATLAS_SERVER_URL, project: process.env.ATLAS_PROJECT ?? 'todo-app', token: process.env.ATLAS_PUBLISH_TOKEN ?? process.env.ATLAS_TOKEN });
  try {
  console.log(`Running ${scenarios.length} scenario(s) and ${quint.runs.length + 1} trace(s)`);
  let gherkin: Recorded[];
  try {
    gherkin = await runGherkin(scenarios);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    gherkin = scenarios.map((scenario) => ({ id: scenario.id, title: scenario.title, specPath: scenario.specPath, runtime: 'gherkin', status: 'failed', error: message, startedAtMs: Date.now(), endedAtMs: Date.now(), steps: [] }));
  }
  const traces = await runQuint(quint.moduleName, quint.runs);
  const checks = [...gherkin, ...traces];
  for (const check of checks) progress(check, check.status, check.error, check.steps);
  await live?.finish();
  await publish(checks);
  summary('Gherkin', gherkin);
  summary('Quint', traces);
  console.log(`Reports: ${path.relative(repoRoot, reportsDir)}`);
  return checks.some((check) => check.status === 'failed') ? 1 : 0;
  } catch (error) { await live?.finish('interrupted', 'The document runner stopped unexpectedly.').catch(() => {}); throw error; } finally { live = undefined; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await runDocuments());
}
