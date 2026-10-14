import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { AstBuilder, GherkinClassicTokenMatcher, Parser } from '@cucumber/gherkin';
import { IdGenerator, type Background, type Scenario, type Step } from '@cucumber/messages';
import type { SpecEntry } from '@crvouga/atlas/reports/explorer-types';
import { textFingerprint } from '@crvouga/atlas/reports/layer-merge';
import type { ReportOutline } from '@crvouga/atlas/reports/layer-types';

const exec = promisify(execFile);

export type ScenarioStep = { readonly keyword: string; readonly text: string };

/** One scenario, or one row of a scenario outline, ready to run against the app. */
export type RunnableScenario = {
  readonly feature: string;
  readonly name: string;
  readonly example: string | null;
  readonly title: string;
  readonly id: string;
  readonly specPath: string;
  readonly steps: readonly ScenarioStep[];
  /** False for a feature tagged `@unrecorded`: it is in the outline, but nothing here has steps to run it. */
  readonly runnable: boolean;
};

export type QuintRun = {
  readonly name: string;
  readonly title: string;
  readonly id: string;
  readonly body: string;
};

const ACTIONS = ['init', 'get_started', 'type_name', 'create_list', 'skip_naming', 'add', 'mark_all_done', 'clear_completed', 'sync_fails', 'retry', 'start_over', 'hold'] as const;
const ACTION_PATTERN = new RegExp(`\\b(${ACTIONS.join('|')})\\b(?:\\s*\\([^)]*\\))?(?:\\s*\\.fail\\s*\\(\\s*\\))?`, 'g');

export function slug(text: string): string {
  const value = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return value || 'check';
}

function quotedSteps(steps: readonly Step[]): ScenarioStep[] {
  return steps.map((step) => ({ keyword: step.keyword.trim(), text: step.text }));
}

function cells(row: { cells: readonly { value: string }[] } | undefined): string[] {
  return row?.cells.map((cell) => cell.value) ?? [];
}

function substitute(text: string, values: ReadonlyMap<string, string>): string {
  return text.replace(/<([^<>]+)>/g, (match, name: string) => values.get(name) ?? match);
}

function applyRow(steps: readonly ScenarioStep[], values: ReadonlyMap<string, string>): ScenarioStep[] {
  return steps.map((step) => ({ keyword: step.keyword, text: substitute(step.text, values) }));
}

type Collected = { background: ScenarioStep[]; scenarios: { name: string; steps: ScenarioStep[]; examples: { header: string[]; rows: string[][] }[] }[] };

function collect(background: Background | null | undefined, scenarios: readonly Scenario[]): Collected {
  return {
    background: background ? quotedSteps(background.steps) : [],
    scenarios: scenarios.map((scenario) => ({
      name: scenario.name,
      steps: quotedSteps(scenario.steps),
      examples: scenario.examples.map((example) => ({ header: cells(example.tableHeader), rows: example.tableBody.map((row) => cells(row)) }))
    }))
  };
}

function unique(base: string, used: Set<string>): string {
  let id = base;
  let n = 2;
  while (used.has(id)) id = `${base}-${n++}`;
  used.add(id);
  return id;
}

/** Expand a feature: background steps first, and one scenario per outline row. */
export function expandFeature(specPath: string, text: string): RunnableScenario[] {
  const feature = new Parser(new AstBuilder(IdGenerator.incrementing()), new GherkinClassicTokenMatcher()).parse(text).feature;
  if (!feature) throw new Error(`${specPath} has no Feature`);
  const groups: Collected[] = [];
  let featureBackground: ScenarioStep[] = [];
  for (const child of feature.children) {
    if (child.background) featureBackground = quotedSteps(child.background.steps);
    if (child.scenario) groups.push(collect(null, [child.scenario]));
    if (child.rule) {
      const rules = child.rule.children.flatMap((entry) => (entry.scenario ? [entry.scenario] : []));
      const background = child.rule.children.find((entry) => entry.background)?.background;
      groups.push(collect(background, rules));
    }
  }
  const used = new Set<string>();
  const scenarios: RunnableScenario[] = [];
  for (const group of groups) {
    for (const scenario of group.scenarios) {
      const rows = scenario.examples.flatMap((table) => table.rows.map((row) => ({ header: table.header, row })));
      const cases = rows.length > 0 ? rows : [null];
      for (const example of cases) {
        const values = example ? new Map(example.header.map((name, index) => [name, example.row[index] ?? ''])) : null;
        const exampleLabel = example ? example.row.filter(Boolean).join(', ') : null;
        const name = exampleLabel ? `${scenario.name} — ${exampleLabel}` : scenario.name;
        const steps = [...featureBackground, ...group.background, ...(values ? applyRow(scenario.steps, values) : scenario.steps)];
        scenarios.push({
          feature: feature.name,
          name: scenario.name,
          example: exampleLabel,
          title: `${feature.name}: ${name}`,
          id: unique(`gherkin.${slug(feature.name)}.${slug(name)}`, used),
          specPath,
          steps,
          runnable: !feature.tags.some((tag) => tag.name === '@unrecorded')
        });
      }
    }
  }
  return scenarios;
}

/** Runs written under a `///` title. `quint test` only executes names that end in `Test`. */
export function quintRuns(text: string): { readonly moduleName: string; readonly runs: readonly QuintRun[] } {
  const moduleName = /^\s*module\s+(\w+)/m.exec(text)?.[1] ?? 'model';
  const runs: QuintRun[] = [];
  const pattern = /^[ \t]*\/\/\/[ \t]*(.+)\r?\n[ \t]*run[ \t]+(\w+)[ \t]*=[ \t]*([\s\S]*?)(?=^[ \t]*\/\/\/|\n\}[ \t]*$)/gm;
  for (const match of text.matchAll(pattern)) {
    const title = match[1]?.trim();
    const name = match[2];
    const body = match[3]?.trim();
    if (!title || !name || !body) continue;
    runs.push({ name, title, id: `quint.${slug(name)}`, body });
  }
  return { moduleName, runs };
}

/** Actions a run takes, in order. `.fail()` marks an action that must be disabled. */
export function actionsIn(body: string): { name: string; disabled: boolean }[] {
  return [...body.matchAll(ACTION_PATTERN)].flatMap((match) => {
    const name = match[1];
    return name ? [{ name, disabled: match[0].includes('.fail') }] : [];
  });
}

export type SpecFile = { readonly path: string; readonly text: string; readonly kind: string; readonly title: string };

function kindOf(file: string): string {
  if (file.endsWith('.feature')) return 'gherkin';
  if (file.endsWith('.qnt')) return 'quint';
  const extension = file.split('.').at(-1);
  return extension && extension !== file ? extension : 'document';
}

function titleOf(file: string, text: string): string {
  if (file.endsWith('.feature')) return /^Feature:\s*(.+)$/m.exec(text)?.[1]?.trim() || path.posix.basename(file);
  if (file.endsWith('.qnt')) return /^\s*module\s+(\w+)/m.exec(text)?.[1] || path.posix.basename(file);
  return path.posix.basename(file);
}

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      return entry.isFile() ? [full] : [];
    })
  );
  return files.flat().sort();
}

export async function specFiles(specsDir: string): Promise<SpecFile[]> {
  const files = await walk(specsDir);
  return Promise.all(
    files.map(async (file) => {
      const relative = path.relative(specsDir, file).split(path.sep).join('/');
      const text = await readFile(file, 'utf8');
      return { path: `specs/${relative}`, text, kind: kindOf(relative), title: titleOf(relative, text) };
    })
  );
}

export async function gitOrigin(cwd: string): Promise<{ sha: string | null; branch: string | null }> {
  const read = async (args: string[]) => {
    try {
      const { stdout } = await exec('git', args, { cwd });
      return stdout.trim();
    } catch {
      return null;
    }
  };
  const sha = await read(['rev-parse', 'HEAD']);
  const branch = await read(['rev-parse', '--abbrev-ref', 'HEAD']);
  return { sha: sha && /^[0-9a-f]{40}$/.test(sha) ? sha : null, branch: branch && branch !== 'HEAD' ? branch : null };
}

export async function loadOutline(specsDir: string, repoRoot: string): Promise<ReportOutline & { readSpec: (specPath: string) => Promise<string | null> }> {
  const files = await specFiles(specsDir);
  const origin = await gitOrigin(repoRoot);
  const byPath = new Map(files.map((file) => [file.path, file.text]));
  const specs: SpecEntry[] = files.map((file) => ({ path: file.path, domain: 'todo', kind: file.kind, title: file.title, fingerprint: textFingerprint(file.text) }));
  return { specs, sha: origin.sha, changedFiles: [], readSpec: async (specPath) => byPath.get(specPath) ?? null };
}
