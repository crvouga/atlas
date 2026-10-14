/**
 * @module Project detection and `atlas init`
 *
 * Looks at a project (its package manager, test runners, spec files, CI and git state) and produces a plan to send its
 * test results to an Atlas server: for each suite the command that runs it and the command that publishes (or streams)
 * its results, a CI workflow, and a section of `AGENTS.md` that tells the next agent how to use Atlas in this project.
 * It changes nothing unless asked (`--write`), and applying it twice changes nothing the second time: files are
 * rewritten only between their `atlas:begin` / `atlas:end` markers (or created whole), never merged by guesswork.
 *
 * The plan is one JSON document (`InitPlanSchema`) so an agent can run `atlas init --format json`, read it, and act. See
 * docs/agents.md for the whole flow. Detection is deliberately conservative: it names what it found and why
 * (`evidence`), says what it could not tell, and never invents a suite.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { InitPlanSchema } from '../../schema/src/cli-results';
import type { z } from 'zod/v4';
import { collectSpecFiles, specKindOf } from './directory-outline';
import { httpStore } from './http-store';
import { serverToken } from './store-url';

/** The document `atlas init` prints, and what {@link planInit} returns. */
export type InitPlan = z.infer<typeof InitPlanSchema>;
type Suite = InitPlan['suites'][number];
type PlannedFile = InitPlan['files'][number];

/** What `planInit` is told: where the project is, which server, and what to do with the plan. */
export type InitOptions = {
  /** The project directory. Default: the current directory. */
  readonly directory: string;
  /** The Atlas server clients will send results to (`https://atlas.example.com`). Falls back to `ATLAS_STORE` when that is a server. */
  readonly server?: string;
  /** Write the files of the plan. Without it nothing is changed. */
  readonly write?: boolean;
  /** Ask the server who we are and whether this token may upload. */
  readonly verify?: boolean;
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** For tests: git as a function from arguments to output (or null). Default: the `git` command. */
  readonly git?: (args: readonly string[], cwd: string) => string | null;
  readonly fetch?: typeof fetch;
};

const BEGIN = '<!-- atlas:begin -->';
const END = '<!-- atlas:end -->';

function defaultGit(args: readonly string[], cwd: string): string | null {
  try { return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null; } catch { return null; }
}

function readJson(file: string): Record<string, unknown> | null {
  try { return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>; } catch { return null; }
}

/** The package manager a project uses, from its lockfile (or `packageManager` in package.json). */
function packageManagerOf(directory: string, pkg: Record<string, unknown> | null): InitPlan['project']['packageManager'] {
  if (existsSync(path.join(directory, 'bun.lock')) || existsSync(path.join(directory, 'bun.lockb'))) return 'bun';
  if (existsSync(path.join(directory, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(path.join(directory, 'yarn.lock'))) return 'yarn';
  if (existsSync(path.join(directory, 'package-lock.json'))) return 'npm';
  const declared = typeof pkg?.packageManager === 'string' ? pkg.packageManager.split('@')[0] : null;
  return declared === 'bun' || declared === 'pnpm' || declared === 'yarn' || declared === 'npm' ? declared : pkg ? 'npm' : null;
}

/** How the package manager runs a package's binary without installing it: `bunx`, `pnpm dlx`, `yarn dlx`, `npx`. */
const EXEC: Readonly<Record<string, string>> = { bun: 'bunx', pnpm: 'pnpm dlx', yarn: 'yarn dlx', npm: 'npx' };
const INSTALL_DEV: Readonly<Record<string, string>> = { bun: 'bun add -d', pnpm: 'pnpm add -D', yarn: 'yarn add -D', npm: 'npm install -D' };

/** The spec files of a project by kind, and the folder to pass as `--specs`. */
async function specsOf(directory: string): Promise<InitPlan['specs']> {
  const candidates = ['specs', 'spec', 'features', 'docs/specs', 'test/features', 'tests/features'];
  let best: { dir: string; kinds: Record<string, number>; total: number } | null = null;
  for (const candidate of candidates) {
    const full = path.join(directory, candidate);
    if (!existsSync(full) || !statSync(full).isDirectory()) continue;
    const files = await collectSpecFiles(full).catch(() => []);
    const kinds: Record<string, number> = {};
    // Prose and data files are specs only because they sit in a specs folder: count the notations that mean something.
    for (const file of files) { const kind = specKindOf(file.path); if (['gherkin', 'quint', 'dmn', 'alloy', 'openslo', 'scxml'].includes(kind)) kinds[kind] = (kinds[kind] ?? 0) + 1; }
    const total = Object.values(kinds).reduce((sum, count) => sum + count, 0);
    if (total > (best?.total ?? 0)) best = { dir: candidate, kinds, total };
  }
  return best ? { directory: best.dir, kinds: best.kinds } : { directory: null, kinds: {} };
}

type Detected = { readonly runner: string; readonly evidence: string };

/** The test runners a project declares, with where each was seen. Order: the more specific first. */
function runnersOf(directory: string, pkg: Record<string, unknown> | null): Detected[] {
  const found: Detected[] = [];
  const deps = { ...((pkg?.dependencies as Record<string, string> | undefined) ?? {}), ...((pkg?.devDependencies as Record<string, string> | undefined) ?? {}) };
  const scripts = Object.values((pkg?.scripts as Record<string, string> | undefined) ?? {}).join('\n');
  const dep = (name: string, runner: string) => { if (deps[name]) found.push({ runner, evidence: `package.json dependencies: ${name}` }); };
  dep('vitest', 'vitest'); dep('@playwright/test', 'playwright'); dep('@cucumber/cucumber', 'cucumber'); dep('cypress', 'cypress'); dep('jest', 'jest'); dep('mocha', 'mocha');
  if (!found.some(item => item.runner === 'vitest' || item.runner === 'jest' || item.runner === 'mocha') && /\bbun test\b/.test(scripts)) found.push({ runner: 'bun-test', evidence: 'package.json scripts: bun test' });
  else if (!found.length && pkg && (existsSync(path.join(directory, 'bun.lock')) || existsSync(path.join(directory, 'bunfig.toml'))) && readdirSafe(directory).some(name => /\.(test|spec)\.[cm]?[tj]sx?$/.test(name) || name === 'tests' || name === 'test')) found.push({ runner: 'bun-test', evidence: 'bun.lock and test files' });
  const python = ['pyproject.toml', 'pytest.ini', 'tox.ini', 'setup.cfg', 'requirements.txt', 'requirements-dev.txt'].map(name => path.join(directory, name)).filter(existsSync);
  for (const file of python) if (/pytest/.test(readFileSync(file, 'utf8'))) { found.push({ runner: 'pytest', evidence: `${path.basename(file)} mentions pytest` }); break; }
  if (existsSync(path.join(directory, 'go.mod'))) found.push({ runner: 'go-test', evidence: 'go.mod' });
  if (existsSync(path.join(directory, 'atlas.config.ts')) || existsSync(path.join(directory, 'atlas.config.js'))) found.push({ runner: 'atlas-statecharts', evidence: 'atlas.config.ts' });
  return found;
}

function readdirSafe(directory: string): string[] {
  try { return readdirSync(directory); } catch { return []; }
}

/** The suite for a detected runner: how to run it so it writes a JUnit file (or the run manifest), and how to publish it. */
function suiteOf(detected: Detected, context: { exec: string; install: string; specs: string | null; server: string | null }): Suite {
  const specs = context.specs ? ` --specs ${context.specs}` : '';
  const publishCommand = (producer: string, input: string, environment: string | null) => `${context.exec} @crvouga/atlas report publish --producer ${producer} ${input}${specs}${environment ? ` --environment ${environment}` : ''}`;
  const make = (id: string, output: string, run: string, environment: string | null, prerequisites: string[] = [], format: Suite['format'] = 'junit', stream: string | null = null): Suite => ({
    id, runner: detected.runner, evidence: detected.evidence, run, output, format, environment,
    publish: publishCommand(id, format === 'manifest' ? `--manifest ${output} --upload-run` : `--${format} ${output}`, environment), stream, prerequisites
  });
  const out = (id: string) => `atlas-${id}.xml`;
  switch (detected.runner) {
    case 'vitest': return make('vitest', out('vitest'), `${context.exec} vitest run --reporter=default --reporter=junit --outputFile.junit=${out('vitest')}`, null);
    case 'jest': return make('jest', out('jest'), `JEST_JUNIT_OUTPUT_FILE=${out('jest')} ${context.exec} jest --reporters=default --reporters=jest-junit`, null, [`${context.install} jest-junit`]);
    case 'playwright': return make('playwright', out('playwright'), `PLAYWRIGHT_JUNIT_OUTPUT_NAME=${out('playwright')} ${context.exec} playwright test --reporter=list,junit`, 'desktop-web');
    case 'cypress': return make('cypress', out('cypress'), `${context.exec} cypress run --reporter junit --reporter-options mochaFile=${out('cypress')}`, 'desktop-web');
    case 'cucumber': return make('cucumber', out('cucumber'), `${context.exec} cucumber-js --format summary --format junit:${out('cucumber')}`, null);
    case 'mocha': return make('mocha', out('mocha'), `MOCHA_FILE=${out('mocha')} ${context.exec} mocha --reporter mocha-junit-reporter`, null, [`${context.install} mocha-junit-reporter`]);
    case 'bun-test': return make('bun-test', out('bun'), `bun test --reporter=junit --reporter-outfile=${out('bun')}`, null);
    case 'pytest': return make('pytest', out('pytest'), `pytest --junitxml=${out('pytest')}`, null);
    case 'go-test': return make('go-test', out('go'), `go test -v ./... 2>&1 | go-junit-report > ${out('go')}`, null, ['go install github.com/jstemmer/go-junit-report/v2@latest']);
    default: return make('statecharts', 'atlas-runs/latest/manifest.json', `${context.exec} @crvouga/atlas run --mode fast`, null, [], 'manifest');
  }
}

/** A suite that does not set its own exit-code handling must still publish: a failure is evidence. */
function githubWorkflow(suites: readonly Suite[], context: { manager: InitPlan['project']['packageManager']; defaultBranch: string; specs: string | null }): string {
  const setup = context.manager === 'bun'
    ? '      - uses: oven-sh/setup-bun@v2\n      - run: bun install --frozen-lockfile\n'
    : `      - uses: actions/setup-node@v4\n        with: { node-version: 22 }\n      - run: ${context.manager === 'pnpm' ? 'corepack enable && pnpm install --frozen-lockfile' : context.manager === 'yarn' ? 'corepack enable && yarn install --immutable' : 'npm ci'}\n`;
  const exec = EXEC[context.manager ?? 'npm']!;
  const jobs = suites.map(suite => `  ${suite.id.replace(/[^a-z0-9]+/g, '-')}:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
${setup}      # A failing suite must still publish: a failure is evidence. The job's own result is the gate's, below.
      - run: ${suite.run}
        continue-on-error: true
      - run: ${suite.publish}
        if: always()
`).join('\n');
  return `# Sends every suite's results to the project's Atlas server and gates on the combined report.
# Generated by \`atlas init\`; safe to edit. Needs the repository variable ATLAS_URL (https://atlas.example.com) and the
# secrets ATLAS_PUBLISH_TOKEN (a \`publish\` token) and ATLAS_READ_TOKEN (a \`read\` token) of that server.
name: atlas
on: [push, pull_request]
permissions:
  contents: read
env:
  ATLAS_STORE: \${{ vars.ATLAS_URL }}
  ATLAS_TOKEN: \${{ secrets.ATLAS_PUBLISH_TOKEN }}
jobs:
${jobs}
  gate:
    needs: [${suites.map(suite => suite.id.replace(/[^a-z0-9]+/g, '-')).join(', ')}]
    if: always()
    runs-on: ubuntu-latest
    env:
      ATLAS_TOKEN: \${{ secrets.ATLAS_READ_TOKEN }}
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      # This branch laid over ${context.defaultBranch}: what this run did not re-run is inherited from ${context.defaultBranch}'s latest
      # results, and a laptop's work in progress or another branch's results cannot turn this red.
      - run: bunx @crvouga/atlas report status --branch "\${GITHUB_HEAD_REF:-$GITHUB_REF_NAME}" --branch ${context.defaultBranch} --ignore-modified${context.specs ? ' --require-all-specs' : ''}
`;
}

/** The `AGENTS.md` section: what Atlas is in this project and the commands to use, replaced between its markers. */
function agentsSection(plan: Pick<InitPlan, 'suites' | 'specs' | 'server' | 'git'>): string {
  const url = plan.server.url ?? '<the project\'s Atlas server>';
  const lines = [
    BEGIN,
    '## Atlas: test evidence for this project',
    '',
    `This project sends the results of its test suites to an [Atlas](https://github.com/crvouga/atlas) server (${url}), which shows everyone one combined, live report. A check is identified by a stable id; the newest completed result of each check wins; unknown is never a pass. Set \`ATLAS_STORE=${url}\` and \`ATLAS_TOKEN\` (a \`publish\` token for sending, a \`read\` token for asking).`,
    '',
    '- **Machine-readable API:** `' + `${url}/api/openapi.json` + '` (OpenAPI 3.1). **Guide for agents:** `' + `${url}/llms.txt` + '`.',
    '- **After you change behaviour,** run the suite, then send its results (publish even when it fails: a failure is evidence).',
    ...plan.suites.flatMap(suite => ['', `  - **${suite.id}**: \`${suite.run}\``, `    then \`${suite.publish}\`` + (suite.stream ? ` (or stream: \`${suite.stream}\`)` : '')]),
    '',
    `- **Is it passing?** \`bunx @crvouga/atlas report status --branch ${plan.git.defaultBranch} --ignore-modified --format json\` (exit 0 passes, 1 does not, 2 means the command was wrong). The failing checks are in \`failing\`.`,
    plan.specs.directory ? `- **Specs** live in \`${plan.specs.directory}/\` (${Object.entries(plan.specs.kinds).map(([kind, count]) => `${count} ${kind}`).join(', ')}). Results are laid over them by path.` : '- No spec files were found. Pass `--spec <path>` or `--specs <dir>` to `publish` to link checks to specs.',
    '- Keep each check\'s `id` stable across runs: that is what lets a new result replace an old one.',
    '- Evidence (screenshots, videos, traces, logs) rides on checks: https://github.com/crvouga/atlas/blob/main/docs/extending.md',
    END
  ];
  return `${lines.join('\n')}\n`;
}

/** The new text of a file that holds a marked section: the section replaced in place, or appended, or the file created. */
function withSection(current: string | null, section: string): string {
  if (current === null) return section;
  const start = current.indexOf(BEGIN);
  const end = current.indexOf(END);
  if (start >= 0 && end > start) return `${current.slice(0, start)}${section.trimEnd()}${current.slice(end + END.length)}`;
  return `${current.trimEnd()}\n\n${section}`;
}

/**
 * Detects the project in `options.directory` and returns the plan, writing its files when `options.write` is set.
 * Never throws for a project it cannot understand: it says so in `warnings` and plans what it can (the `AGENTS.md`
 * section with no suites, so the next agent knows to add them). Throws only for a directory that does not exist.
 *
 * @example
 * const plan = await planInit({ directory: process.cwd(), server: 'https://atlas.example.com' });
 * for (const suite of plan.suites) console.log(suite.run, '→', suite.publish);
 */
export async function planInit(options: InitOptions): Promise<InitPlan> {
  const directory = path.resolve(options.directory);
  if (!existsSync(directory) || !statSync(directory).isDirectory()) throw new Error(`Not a directory: ${options.directory}`);
  const env = options.env ?? {};
  const git = options.git ?? defaultGit;
  const pkg = readJson(path.join(directory, 'package.json'));
  const manager = packageManagerOf(directory, pkg);
  const specs = await specsOf(directory);
  const configured = env.ATLAS_STORE?.split(/[\n,]+/).map(item => item.trim()).find(item => /^https?:\/\//i.test(item));
  const serverUrl = (options.server ?? configured ?? null)?.replace(/\/+$/, '') ?? null;
  const warnings: string[] = [];
  const exec = EXEC[manager ?? 'npm']!;
  const context = { exec, install: INSTALL_DEV[manager ?? 'npm']!, specs: specs.directory, server: serverUrl };
  const suites = runnersOf(directory, pkg).map(found => suiteOf(found, context));
  if (!suites.length) warnings.push('No test runner was recognised (looked for vitest, jest, playwright, cypress, cucumber, mocha, bun test, pytest, go test and Atlas statecharts). Add one suite by hand: run it so it writes a JUnit XML or CTRF file, then `atlas report publish --producer <name> --junit <file>`.');
  if (!serverUrl) warnings.push('No server given. Pass --server https://… (or set ATLAS_STORE) so the plan can name it; until then the generated text says "the project\'s Atlas server".');
  if (!specs.directory) warnings.push('No spec files (Gherkin, Quint, DMN, Alloy, OpenSLO, SCXML) were found in specs/, features/ or the usual places. Results are still reported; they belong to no spec until `--specs <dir>` or `--spec <path>` links them.');
  if (existsSync(path.join(directory, 'atlas.config.ts')) && suites.some(suite => suite.runner === 'atlas-statecharts')) warnings.push('atlas.config.ts found: the statechart suite runs the whole plan (`atlas run --mode fast`); see docs/statecharts.md to choose modes and shards.');

  const branch = git(['branch', '--show-current'], directory);
  const remoteHead = git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], directory)?.replace(/^origin\//, '') ?? null;
  const defaultBranch = remoteHead ?? (git(['rev-parse', '--verify', 'main'], directory) ? 'main' : git(['rev-parse', '--verify', 'master'], directory) ? 'master' : 'main');
  const ci: InitPlan['ci'] = existsSync(path.join(directory, '.github')) || /github\.com/.test(git(['remote', 'get-url', 'origin'], directory) ?? '') ? 'github-actions' : existsSync(path.join(directory, '.gitlab-ci.yml')) ? 'gitlab-ci' : existsSync(path.join(directory, '.circleci')) ? 'circleci' : 'none';
  if (ci === 'gitlab-ci' || ci === 'circleci') warnings.push(`${ci} detected: no workflow is generated for it. In its jobs run each suite, then its publish command (with ATLAS_STORE and ATLAS_TOKEN set from secrets), then the gate command from AGENTS.md.`);

  const base = { suites, specs, server: { url: serverUrl, tokenEnv: 'ATLAS_TOKEN' as const }, git: { branch, defaultBranch } };
  const wanted: { path: string; purpose: string; next: (current: string | null) => string }[] = [
    { path: 'AGENTS.md', purpose: 'Tells every agent working in this repository how to send and read test evidence.', next: current => withSection(current, agentsSection(base)) }
  ];
  if (ci === 'github-actions' && suites.length) wanted.push({ path: '.github/workflows/atlas.yml', purpose: 'Runs each suite in CI, sends its results to the server even when it fails, and gates on the combined report.', next: () => githubWorkflow(suites, { manager, defaultBranch, specs: specs.directory }) });
  const files: PlannedFile[] = [];
  for (const item of wanted) {
    const full = path.join(directory, item.path);
    const current = existsSync(full) ? await readFile(full, 'utf8') : null;
    const content = item.next(current);
    // A workflow that exists and was not generated by this tool is the project's own: never overwritten.
    const foreign = item.path.startsWith('.github/') && current !== null && !current.startsWith('# Sends every suite');
    if (foreign) { warnings.push(`${item.path} already exists and was not generated by atlas init; left alone. The generated version is in this plan's files.`); files.push({ path: item.path, action: 'unchanged', purpose: item.purpose, content }); continue; }
    files.push({ path: item.path, action: current === null ? 'create' : current === content ? 'unchanged' : 'update', purpose: item.purpose, content });
  }

  const written: string[] = [];
  if (options.write) {
    for (const file of files) {
      if (file.action === 'unchanged') continue;
      await mkdir(path.dirname(path.join(directory, file.path)), { recursive: true });
      await writeFile(path.join(directory, file.path), file.content);
      written.push(file.path);
    }
  }

  let verification: InitPlan['verification'] = null;
  if (options.verify && serverUrl) {
    const token = serverToken(env);
    const answer = await httpStore({ url: serverUrl, ...(token ? { token } : {}), retries: 1, ...(options.fetch ? { fetch: options.fetch } : {}) }).ping();
    verification = { reachable: answer.ok || /\b(401|403)\b|wants a token|may not do that/.test(answer.error ?? ''), role: answer.role ?? null, canPublish: answer.role === 'publish' || answer.role === 'admin', error: answer.ok ? null : (answer.error ?? 'no answer') };
    if (answer.ok && !verification.canPublish) verification = { ...verification, error: `This token's role is "${answer.role}": it can look but not upload. Use a publish token for sending results.` };
  } else if (options.verify) warnings.push('--verify needs a server: pass --server or set ATLAS_STORE.');

  const nextSteps = [
    ...(serverUrl ? [] : ['Decide which server to send results to (run one with `atlas serve`), then run this again with --server <url>.']),
    ...(options.write ? [] : ['Review the plan, then run again with --write to create the files in `files`.']),
    ...suites.flatMap(suite => suite.prerequisites.map(command => `Install what ${suite.id} needs: ${command}`)),
    ...(serverUrl ? [`Set ATLAS_STORE=${serverUrl} and ATLAS_TOKEN (a publish token) in CI and on each machine that should send results.`, 'Run `atlas report doctor` to prove the server can be written to and read.'] : []),
    ...suites.map(suite => `Prove ${suite.id}: run \`${suite.run}\`, then \`${suite.publish}\`, then open ${serverUrl ?? 'the server'} and find its results.`)
  ];
  const ok = verification ? verification.reachable && verification.canPublish && verification.error === null : true;
  return InitPlanSchema.parse({ ok, directory, project: { name: typeof pkg?.name === 'string' ? pkg.name : path.basename(directory), packageManager: manager, languages: languagesOf(directory, pkg) }, git: base.git, ci, server: base.server, specs, suites, files, written, verification, nextSteps, warnings });
}

function languagesOf(directory: string, pkg: Record<string, unknown> | null): string[] {
  const languages: string[] = [];
  if (pkg) languages.push(existsSync(path.join(directory, 'tsconfig.json')) ? 'typescript' : 'javascript');
  if (['pyproject.toml', 'requirements.txt', 'setup.py'].some(name => existsSync(path.join(directory, name)))) languages.push('python');
  if (existsSync(path.join(directory, 'go.mod'))) languages.push('go');
  return languages;
}

/** The plan as the text a person reads: what was found, what is planned, and what to do next. */
export function formatPlan(plan: InitPlan): string {
  const lines = [`Project ${plan.project.name ?? plan.directory}${plan.project.packageManager ? ` (${plan.project.packageManager})` : ''}, CI: ${plan.ci}, server: ${plan.server.url ?? 'not given'}`];
  lines.push(plan.suites.length ? 'Suites:' : 'Suites: none recognised');
  for (const suite of plan.suites) lines.push(`  ${suite.id}  (${suite.evidence})`, `    run:     ${suite.run}`, `    publish: ${suite.publish}`);
  lines.push(plan.specs.directory ? `Specs: ${plan.specs.directory}/ (${Object.entries(plan.specs.kinds).map(([kind, count]) => `${count} ${kind}`).join(', ')})` : 'Specs: none found');
  lines.push('Files:');
  for (const file of plan.files) lines.push(`  ${plan.written.includes(file.path) ? 'wrote ' : file.action.padEnd(9)} ${file.path}  ${file.action === 'unchanged' ? '' : `- ${file.purpose}`}`);
  if (plan.verification) lines.push(`Server: ${plan.verification.reachable ? 'reachable' : 'NOT reachable'}${plan.verification.role ? `, token role ${plan.verification.role}` : ''}${plan.verification.error ? ` — ${plan.verification.error}` : ''}`);
  for (const warning of plan.warnings) lines.push(`! ${warning}`);
  lines.push('Next:');
  plan.nextSteps.forEach((step, i) => lines.push(`  ${i + 1}. ${step}`));
  return `${lines.join('\n')}\n`;
}

/** The usage of `atlas init`, printed by `atlas init --help`. */
export const INIT_USAGE = `atlas init — integrate a project with an Atlas server

  atlas init [--dir <project>] [--server <url>] [--write] [--verify] [--format json]

  Looks at the project (package manager, test runners, spec files, CI) and prints a plan: for each suite the command
  that runs it and the command that sends its results, a CI workflow, and an AGENTS.md section that tells the next
  agent how to use Atlas here. Nothing is changed until --write; running it again changes nothing more.

  --dir <path>     the project (default: the current directory)
  --server <url>   the Atlas server results go to (default: an http(s) store in ATLAS_STORE)
  --write          create or update the files of the plan (AGENTS.md between its atlas markers, .github/workflows/atlas.yml)
  --verify         ask the server who this token is and whether it may upload (token: ATLAS_TOKEN)
  --format json    print the plan as one JSON document (schema: init-plan.schema.json)

  Exit codes: 0 planned (and verified), 1 --verify failed, 2 the command was wrong.
`;

/** `atlas init`: parses the arguments, plans, prints the plan as text or JSON, and returns the exit code. */
export async function initMain(argv: readonly string[], io: { readonly out: (text: string) => void; readonly env?: Readonly<Record<string, string | undefined>>; readonly cwd?: string; readonly fetch?: typeof fetch }): Promise<number> {
  if (argv.includes('--help') || argv.includes('-h')) { io.out(INIT_USAGE); return 0; }
  const flag = (name: string) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
  const format = flag('format');
  const json = format === 'json' || argv.includes('--json');
  try {
    if (format !== undefined && format !== 'json' && format !== 'text') throw new Error(`--format takes text|json (got "${format}")`);
    const plan = await planInit({ directory: path.resolve(io.cwd ?? process.cwd(), flag('dir') ?? '.'), ...(flag('server') ? { server: flag('server')! } : {}), write: argv.includes('--write'), verify: argv.includes('--verify'), env: io.env ?? process.env, ...(io.fetch ? { fetch: io.fetch } : {}) });
    io.out(json ? `${JSON.stringify(plan, null, 2)}\n` : formatPlan(plan));
    return plan.ok ? 0 : 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(json ? `${JSON.stringify({ ok: false, error: { message, code: 'usage' } })}\n` : `atlas init: ${message}\n`);
    return 2;
  }
}
