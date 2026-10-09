import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { isStatechartFile, ReportSourcesSchema, RunInfoSchema, type Count, type RemoteReportSource, type ReportSource, type RunSummary, type SpecIndex } from '@crvouga/atlas-schema';

export const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FIXTURES_ROOT = path.join(APP_ROOT, 'fixtures');

/** The fixture shown when no specs directory is configured and none exists where pnpm ran. */
export const DEFAULT_FIXTURE = 'full';
export const DEFAULT_SPECS_DIR = 'specs';
export const DEFAULT_RUNS_DIR = 'atlas-runs';

export type AtlasRoots = { specs: string; runs: string; label: string };

export function resolveReportSources(roots: AtlasRoots, env: NodeJS.ProcessEnv = process.env): ReportSource[] {
  const workspace: ReportSource = { id: 'workspace', label: 'Workspace runs', type: 'directory', runs: roots.runs };
  if (!env.ATLAS_SOURCES_FILE) return [workspace];
  const file = path.resolve(env.INIT_CWD || process.cwd(), env.ATLAS_SOURCES_FILE);
  const parsed = ReportSourcesSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
  if (parsed.sources.some((source) => source.id === workspace.id)) throw new Error('The source id "workspace" is reserved for --runs.');
  return [workspace, ...parsed.sources.map((source) => source.type === 'directory' ? { ...source, runs: path.resolve(path.dirname(file), source.runs) } : source)];
}

export function publicReportSources(sources: ReportSource[], base = '/__atlas/'): RemoteReportSource[] {
  return sources.map((source) => source.type === 'directory'
    ? { id: source.id, label: source.label, type: 'http', live: true, baseUrl: source.id === 'workspace' ? base : `${base}sources/${source.id}/` }
    : source);
}

/** A chart in either open format: W3C SCXML or XState machine config. */
export function isChartFile(file: string) {
  return /\.scxml$/i.test(file) || /(^|\/)([\w.-]+\.)?machine\.(ya?ml|json)$/.test(file);
}

/** Every file the visualizer reads from a specs directory: charts, journeys, notes, layouts. */
export function isSpecFile(file: string) {
  return isChartFile(file) || isStatechartFile(file);
}

export function fixtureRoots(name: string): AtlasRoots {
  const dir = path.join(FIXTURES_ROOT, name);
  if (!existsSync(dir)) {
    const known = existsSync(FIXTURES_ROOT) ? readdirSync(FIXTURES_ROOT).filter((n) => !n.startsWith('.')).join(', ') : 'none';
    throw new Error(`No fixture called "${name}". Fixtures: ${known}`);
  }
  return { specs: path.join(dir, 'specs'), runs: path.join(dir, 'runs'), label: `fixture: ${name}` };
}

/**
 * Where the dev server and the publish script read from, in order: a named fixture
 * (`ATLAS_FIXTURE`), explicit roots (`ATLAS_SPECS_ROOT`, `ATLAS_RUNS_ROOT`), then `specs/` and
 * `atlas-runs/` where the command was run. Relative paths resolve against `INIT_CWD` (where pnpm
 * was run) or the current directory. With nothing configured and no `specs/` there, the bundled
 * example fixture is shown.
 */
export function resolveRoots(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): AtlasRoots {
  if (env.ATLAS_FIXTURE) return fixtureRoots(env.ATLAS_FIXTURE);
  const base = env.INIT_CWD || cwd;
  const specsSet = Boolean(env.ATLAS_SPECS_ROOT);
  const specs = path.resolve(base, env.ATLAS_SPECS_ROOT || DEFAULT_SPECS_DIR);
  const runs = path.resolve(base, env.ATLAS_RUNS_ROOT || DEFAULT_RUNS_DIR);
  if (!specsSet && !env.ATLAS_RUNS_ROOT && !existsSync(specs)) {
    return { ...fixtureRoots(DEFAULT_FIXTURE), label: `example (no ${DEFAULT_SPECS_DIR}/ in ${base}; set ATLAS_SPECS_ROOT)` };
  }
  return { specs, runs, label: 'configured' };
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.cache']);

/**
 * Spec files under the specs root, relative and with forward slashes. Journeys, notes and layouts
 * are listed only beside a chart, so unrelated files elsewhere stay out.
 */
export function listSpecFiles(specsRoot: string): string[] {
  if (!existsSync(specsRoot)) return [];
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    const files = entries.filter((name) => isSpecFile(name) && statSafe(path.join(dir, name))?.isFile());
    const rel = path.relative(specsRoot, dir).split(path.sep).join('/');
    const hasChart = files.some(isChartFile);
    for (const name of files) {
      const file = rel ? `${rel}/${name}` : name;
      if (hasChart || (!rel && /^atlas\.ya?ml$/.test(name))) out.push(file);
    }
    for (const name of entries) {
      if (name.startsWith('.') || SKIP_DIRS.has(name)) continue;
      if (statSafe(path.join(dir, name))?.isDirectory()) walk(path.join(dir, name));
    }
  };
  walk(specsRoot);
  return out.sort();
}

function statSafe(file: string) {
  try {
    return statSync(file);
  } catch {
    return null;
  }
}

export function specIndex(specsRoot: string, ref: string | null = null): SpecIndex {
  return { schemaVersion: 1, generatedAt: new Date().toISOString(), ref, files: listSpecFiles(specsRoot) };
}

/** A manifest that doesn't parse yet is taken as still being written for this long. */
const STILL_WRITING_MS = 60_000;

function startedAtFromId(id: string, fallback: Date) {
  const m = id.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/);
  return m ? `${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z` : fallback.toISOString();
}

function asCount(value: unknown): Count | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as Record<string, unknown>;
  const n = (k: string) => (typeof v[k] === 'number' ? (v[k] as number) : 0);
  return { total: n('total'), passed: n('passed'), failed: n('failed'), flaky: n('flaky'), notReached: n('notReached') };
}

function object(value: unknown) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** A run directory's summary: complete once its manifest is readable, running before that. */
export function summarizeRun(runsRoot: string, id: string): RunSummary | null {
  const dir = path.join(runsRoot, id);
  const stat = statSafe(dir);
  if (!stat?.isDirectory()) return null;
  const manifestFile = path.join(dir, 'manifest.json');
  const running: RunSummary = { id, startedAt: startedAtFromId(id, stat.birthtime), mode: id.endsWith('showcase') ? 'showcase' : 'fast', progress: 'running', hasManifest: false };
  if (!existsSync(manifestFile)) return running;
  let manifest: Record<string, unknown>;
  try {
    const raw: unknown = JSON.parse(readFileSync(manifestFile, 'utf8'));
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ...running, progress: 'complete' };
    manifest = object(raw);
  } catch {
    const ageMs = Date.now() - (statSafe(manifestFile)?.mtimeMs ?? 0);
    return ageMs < STILL_WRITING_MS ? running : { ...running, progress: 'complete' };
  }
  const run = object(manifest.run);
  const coverage = object(object(manifest.coverage).overall);
  const paths = Array.isArray(manifest.journeys)
    ? manifest.journeys.map(object)
    : Array.isArray(manifest.paths)
      ? manifest.paths.map(object).filter((p) => p.kind === 'journey')
      : [];
  const journeys: Count = { total: paths.length, passed: 0, failed: 0, flaky: 0, notReached: 0 };
  for (const p of paths) {
    if (p.status === 'passed') journeys.passed++;
    else if (p.status === 'failed') journeys.failed++;
    else if (p.status === 'flaky') journeys.flaky++;
    else journeys.notReached++;
  }
  return {
    id,
    startedAt: typeof run.startedAt === 'string' ? run.startedAt : running.startedAt,
    mode: typeof run.mode === 'string' ? run.mode : running.mode,
    commit: typeof run.commit === 'string' ? run.commit : null,
    branch: typeof run.branch === 'string' ? run.branch : null,
    durationMs: typeof run.durationMs === 'number' ? run.durationMs : undefined,
    specVersion: typeof run.specVersion === 'string' ? run.specVersion : undefined,
    progress: typeof run.finishedAt === 'string' || run.finishedAt === undefined ? 'complete' : 'running',
    execution: RunInfoSchema.shape.progress.safeParse(run.progress).data,
    hasManifest: true,
    coverage: Object.keys(coverage).length ? { states: asCount(coverage.states), transitions: asCount(coverage.transitions) } : undefined,
    journeys
  };
}

export function runsIndex(runsRoot: string, keep = Number.POSITIVE_INFINITY) {
  const ids = existsSync(runsRoot) ? readdirSync(runsRoot).filter((name) => !name.startsWith('.')) : [];
  const runs = ids
    .map((id) => summarizeRun(runsRoot, id))
    .filter((r): r is RunSummary => r !== null)
    .sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt))
    .slice(0, keep);
  return { generatedAt: new Date().toISOString(), runs };
}

/** `root/relative`, or null when the relative path tries to leave the root. */
export function safeJoin(root: string, relative: string) {
  let decoded: string;
  try {
    decoded = decodeURIComponent(relative).replace(/^\/+/, '');
  } catch {
    return null;
  }
  const full = path.resolve(root, decoded);
  return full === root || full.startsWith(`${root}${path.sep}`) ? full : null;
}
