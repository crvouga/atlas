/**
 * @module Generated documentation
 *
 * `bun run docs` writes every file that is generated from the code, and `bun run docs -- --check` writes nothing and
 * exits 1 when one is stale (CI and `generate.test.ts` run the check). What is generated:
 *
 * - `packages/server/openapi.json`: the server's OpenAPI 3.1 document, from its operation table.
 * - `docs/reference/<package>.md`: the TypeScript API of each package, from the doc comments in its source.
 * - `docs/reference/cli.md` and `docs/reference/http-api.md`: the usage text of every command, and the HTTP operations.
 * - Marked blocks inside hand-written guides (`<!-- generated:NAME -->` … `<!-- /generated:NAME -->`): the server
 *   settings and operation tables, consumer facts, and contributor check commands.
 * - JSON Schemas, from the same Zod registry used by schema and command contract tests.
 * - `llms.txt` and `llms-full.txt`: the guide index for AI agents and the guides in one file ([llmstxt.org](https://llmstxt.org)).
 *
 * The source is always the code or a comment beside it; nothing here is edited by hand.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

import { USAGE } from '../../packages/core/src/cli';
import { INIT_USAGE } from '../../packages/reports/src/init';
import { CRITIC_USAGE } from '../../packages/critics/src/cli';
import { REPORT_USAGE } from '../../packages/reports/src/report-cli';
import { UI_CATALOG_USAGE } from '../../packages/reports/src/ui-catalog-cli';
import { packageManagerTable } from '../../packages/reports/src/package-managers';
import { CLI_RESULTS } from '../../packages/schema/src/cli-results';
import { renderSchemas } from '../../packages/schema/scripts/schemas';
import { DEV_USAGE } from '../../packages/server/src/dev';
import { SERVER_SETTINGS, SERVER_USAGE } from '../../packages/server/src/config';
import { OPERATIONS, openApiDocument } from '../../packages/server/src/openapi';
import { DOCUMENTED_ROOTS, REPO } from './coverage';
import { packageReference } from './reference';
import { renderBlocks } from './blocks';

/** One generated file: where it goes, relative to the repository, and its content. */
export type Generated = { readonly file: string; readonly text: string };

/** The packages with a generated reference, and the sentence that introduces each. */
export const PACKAGES: Readonly<Record<string, string>> = {
  core: 'Executable statecharts: loading, composing, linting, planning and running specs against real apps, and the `atlas` command. Import path `@crvouga/atlas`.',
  reports: 'Layered evidence for any kind of spec: publishing layers, stores (folder, S3, an Atlas server), combining and gating, the incremental report, init. Import paths `@crvouga/atlas/reports/<module>`.',
  schema: 'The contract: Zod schemas, and the JSON Schemas generated from them, for layers, checks, report status, command results, server responses and configuration. Import path `@crvouga/atlas/schema`.',
  server: 'The Atlas server: the API results are uploaded to, the live report, and the viewer on one host. Import path `@crvouga/atlas/server`.',
  playwright: 'The Playwright driver for statechart runs. Import path `@crvouga/atlas/playwright`.',
  bun: 'The Bun WebView driver for statechart runs. Import path `@crvouga/atlas/bun`.',
  webdriver: 'The W3C WebDriver / Appium driver for statechart runs. Import path `@crvouga/atlas/webdriver`.',
  detox: 'The Detox driver for statechart runs of React Native apps. Import path `@crvouga/atlas/detox`.',
  runners: 'Native reporters that upload to the project server. Import paths `@crvouga/atlas/codecept`, `@crvouga/atlas/mocha`, `@crvouga/atlas/jest`, `@crvouga/atlas/node-test`.',
  vitest: 'Run a statechart plan as Vitest tests. Import path `@crvouga/atlas/vitest`.',
  critics: 'Automated reviewers of the UI catalog: the critic contract, the runner (caching, retries, rate limits, budgets), credential references and redaction, the `atlas.critique` evidence as layers, the catalog client, spooling, calibration and report, warn and gate modes, the `atlas critic` command, and the UIClip and LLM critic adapters. Import paths `@crvouga/atlas/critics`, `@crvouga/atlas/critics/uiclip`, `@crvouga/atlas/critics/llm`.',
  'playwright-reporter': 'A Playwright Test reporter that streams every test to Atlas with its duration, device labels, steps, retries, videos, screenshots and traces. Import path `@crvouga/atlas/playwright-reporter`.'
};

/** The guides, in the order an agent should meet them, with the section of `llms.txt` each is listed under. */
export const GUIDES: readonly { readonly file: string; readonly section: string }[] = [
  { file: 'docs/agents.md', section: 'Start here' },
  { file: 'docs/quickstart.md', section: 'Start here' },
  { file: 'docs/integrating.md', section: 'Start here' },
  { file: 'docs/runners.md', section: 'Start here' },
  { file: 'docs/rich-evidence.md', section: 'Start here' },
  { file: 'docs/ui-catalog.md', section: 'Start here' },
  { file: 'docs/server.md', section: 'Run and use the server' },
  { file: 'docs/deploying.md', section: 'Run and use the server' },
  { file: 'docs/report-contract.md', section: 'Formats and rules' },
  { file: 'docs/extending.md', section: 'Formats and rules' },
  { file: 'docs/critics.md', section: 'Formats and rules' },
  { file: 'docs/report-backends.md', section: 'Formats and rules' },
  { file: 'docs/statecharts.md', section: 'Formats and rules' },
  { file: 'docs/workspaces.md', section: 'Working with this project' },
  { file: 'docs/ui.md', section: 'Working with this project' },
  { file: 'docs/dogfooding.md', section: 'Working with this project' },
  { file: 'docs/reporting-issues.md', section: 'Working with this project' },
  { file: 'docs/releasing.md', section: 'Optional' }
];

const read = (file: string) => readFileSync(path.join(REPO, file), 'utf8');
const RAW = 'https://raw.githubusercontent.com/crvouga/atlas/main';

/** The command line reference: the usage text of every command. */
export const CLI_HELP = [
  { title: 'atlas', args: [], usage: USAGE },
  { title: 'atlas init', args: ['init'], usage: INIT_USAGE },
  { title: 'atlas serve', args: ['serve'], usage: SERVER_USAGE },
  { title: 'atlas dev', args: ['dev'], usage: DEV_USAGE },
  { title: 'atlas report', args: ['report'], usage: REPORT_USAGE },
  { title: 'atlas ui-catalog', args: ['ui-catalog'], usage: UI_CATALOG_USAGE },
  { title: 'atlas critic', args: ['critic'], usage: CRITIC_USAGE }
];

/** The command line reference, using the same help inventory the executable documentation checks exercise. */
function cliReference(): string {
  const block = (title: string, text: string) => `## ${title}\n\n\`\`\`text\n${text.trimEnd()}\n\`\`\`\n`;
  return `# Command line reference\n\n> Generated from the usage text each command prints (\`atlas <command> --help\`) by \`bun run docs\`. Do not edit.\n\nAdd \`--format json\` (alias \`--json\`) to \`init\`, \`report publish\`, \`stream\`, \`merge\`, \`doctor\`, \`status\`, every \`ui-catalog\` command and \`critic list\`, \`setup\`, \`doctor\` and \`run\` for a JSON document on standard output (schemas in \`@crvouga/atlas/schemas\`). Exit codes: \`0\` it worked, \`1\` it ran and the answer is no, \`2\` the command was wrong.\n\n${CLI_HELP.map(help => block(help.title, help.usage)).join('\n')}`;
}

/** The operations of the HTTP API as Markdown, in full. */
function operationsReference(): string {
  const sections = OPERATIONS.map(operation => {
    const statuses = Object.entries(operation.responses).map(([status, response]) => `\`${status}\` ${response.description}`).join('; ');
    const params = (operation.parameters ?? []).map(parameter => `- \`${parameter.name}\` (${parameter.in}${parameter.required ? ', required' : ''}): ${parameter.description}`).join('\n');
    return `### ${operation.summary}\n\n\`${operation.route.split(' ')[0]} ${operation.path}\` · role: ${operation.role}\n\n${operation.description}\n${params ? `\n${params}\n` : ''}\nResponses: ${statuses}\n`;
  });
  return `# HTTP API reference\n\n> Generated from the operation table in \`packages/server/src/openapi.ts\` by \`bun run docs\`. Do not edit. The same description, for tools, is \`openapi.json\` (OpenAPI 3.1) and \`GET /api/openapi.json\` on every server.\n\n${sections.join('\n')}`;
}

/** The server settings table, from `SERVER_SETTINGS`. */
function settingsTable(): string {
  const rows = SERVER_SETTINGS.map(setting => `| ${setting.summary} | \`${setting.key}\` | ${setting.flag ? `\`${setting.flag}${setting.flag.includes('`') ? '' : '`'}` : ''} | ${setting.env.map(name => `\`${name}\``).join(', ')} | ${setting.default} |`);
  return `| Setting | File key | Flag | Environment | Default |\n| --- | --- | --- | --- | --- |\n${rows.join('\n')}`;
}

/** A compact table of the operations, for the server guide. */
function operationsTable(): string {
  const rows = OPERATIONS.map(operation => `| \`${operation.route.split(' ')[0]} ${operation.path}\` | ${operation.role === 'none' ? 'none' : operation.role} | ${operation.summary}. |`);
  return `| Method and path | Role | |\n| --- | --- | --- |\n${rows.join('\n')}\n\nEvery operation, parameter, body, response and error is in [the HTTP API reference](reference/http-api.md) and, for tools, in \`openapi.json\`.`;
}

/** Required generated blocks by document. Removing both markers is drift too. */
export const BLOCK_FILES: Readonly<Record<string, readonly string[]>> = {
  'server-settings': ['docs/server.md'],
  'server-operations': ['docs/server.md'],
  'package-managers': ['docs/agents.md'],
  'json-command-schemas': ['docs/agents.md'],
  'public-exports': ['docs/agents.md'],
  'repository-checks': ['AGENTS.md'],
  'runtime-requirements': ['README.md', 'docs/agents.md', 'docs/integrating.md', 'docs/dogfooding.md', 'docs/deploying.md', 'docs/server.md', 'packages/core/README.md']
};

const manifest = () => JSON.parse(read('package.json')) as { name: string; engines: Record<string, string>; exports: Record<string, unknown> };
const BLOCKS: Readonly<Record<string, () => string>> = {
  'server-settings': settingsTable,
  'server-operations': operationsTable,
  'package-managers': packageManagerTable,
  'repository-checks': () => {
    const ci = YAML.parse(read('.github/workflows/ci.yml')) as { jobs: { check: { steps: { run?: string }[] } } };
    return ['```sh', ...ci.jobs.check.steps.flatMap(step => step.run ? [step.run] : []), '```'].join('\n');
  },
  'json-command-schemas': () => ['| Command | Schema |', '| --- | --- |', ...Object.values(CLI_RESULTS).map(result => `| \`${result.command}\` | \`${result.schemaName}\` |`)].join('\n'),
  'runtime-requirements': () => `Supported runtimes (from \`package.json\`): ${Object.entries(manifest().engines).map(([name, range]) => `**${name} \`${range}\`**`).join(' or ')}. Node consumers do not need Bun unless they use the Bun WebView driver.`,
  'public-exports': () => ['```text', ...Object.keys(manifest().exports).map(key => key === '.' ? manifest().name : `${manifest().name}/${key.slice(2)}`), '```'].join('\n')
};

/** The text of a hand-written guide with each generated block between its markers replaced by what the code says. */
export function withBlocks(text: string, required: readonly string[] = []): string {
  return renderBlocks(text, BLOCKS, required);
}

/** Render a document with its required blocks, so removing its markers fails generation and CI. */
export function renderDocument(file: string, text = read(file)): string {
  try {
    const required = Object.entries(BLOCK_FILES).filter(([, files]) => files.includes(file)).map(([name]) => name);
    for (const match of text.matchAll(/^<!-- generated:([\w-]+) -->$/gm)) {
      if (!required.includes(match[1]!)) throw new Error(`Generated block "${match[1]}" is not registered for this file in BLOCK_FILES`);
    }
    return withBlocks(text, required);
  }
  catch (error) { throw new Error(`${file}: ${error instanceof Error ? error.message : String(error)}`); }
}

/** The first sentence of a guide's opening paragraph: what `llms.txt` says about it. */
function describe(file: string): { title: string; summary: string } {
  const lines = read(file).split('\n');
  const title = lines.find(line => line.startsWith('# '))?.slice(2).trim() ?? file;
  const start = lines.findIndex(line => line.startsWith('# ')) + 1;
  const paragraph: string[] = [];
  for (const line of lines.slice(start)) {
    if (!line.trim()) { if (paragraph.length) break; continue; }
    if (/^[#>|`\-*!<]/.test(line.trim()) && !paragraph.length) continue;
    paragraph.push(line.trim());
  }
  const text = paragraph.join(' ').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[`*]/g, '');
  const sentence = /^.{40,}?[.:](?=\s|$)/.exec(text)?.[0] ?? text;
  return { title, summary: sentence.length > 220 ? `${sentence.slice(0, 217)}…` : sentence };
}

/** `llms.txt`: the index for an AI agent, in the format of llmstxt.org. */
function llmsTxt(): string {
  const sections = new Map<string, string[]>();
  for (const guide of GUIDES) {
    const { title, summary } = describe(guide.file);
    (sections.get(guide.section) ?? sections.set(guide.section, []).get(guide.section)!).push(`- [${title}](${RAW}/${guide.file}): ${summary}`);
  }
  const reference = [
    `- [HTTP API (OpenAPI 3.1)](${RAW}/packages/server/openapi.json): every endpoint of the server, machine-readable. A running server serves it at /api/openapi.json and a guide for itself at /llms.txt.`,
    `- [HTTP API, in words](${RAW}/docs/reference/http-api.md): the same operations as Markdown.`,
    `- [Command line](${RAW}/docs/reference/cli.md): the usage of every command.`,
    ...Object.entries(PACKAGES).map(([name, summary]) => `- [TypeScript API: ${name}](${RAW}/docs/reference/${name}.md): ${summary.split('. Import')[0]}.`),
    `- [JSON Schemas](https://unpkg.com/@crvouga/atlas/packages/schema/schemas/): the layer format, checks file, report status, command results, server responses, server configuration.`
  ];
  const parts = ['Start here', 'Run and use the server', 'Formats and rules', 'Working with this project'];
  const body = [
    ...parts.flatMap(name => [`## ${name}`, '', ...(sections.get(name) ?? []), '']),
    '## Reference (generated from the code)', '', ...reference, '',
    '## Optional', '', ...(sections.get('Optional') ?? []), ''
  ];
  return `# Atlas

> Atlas shows whether a product still does what it was specified to do. Test results from any suite on any machine are published as immutable layers; a report is computed from layers, and a shared Atlas server hosts projects selected by slug and shows each project's combined report, live. Directory stores also work without a server. Specs of any kind (Gherkin, Quint, DMN, Alloy, OpenSLO, statecharts); evidence of any kind (screenshots, videos, traces, logs). Distributed as the npm package \`@crvouga/atlas\`; runs on Bun and Node.

Given only the repository link, start at docs/agents.md: install \`@crvouga/atlas\` in the consumer project with its own package manager, then read the version-matched docs in the installed package. No clone or Atlas build is needed. docs/quickstart.md verifies local publishing and gating without a server or token. For a shared server, \`atlas init --server <url> --format json\` prints a plan; \`--write\` applies it. Report commands and init support JSON with published schemas; exits are 0 (worked), 1 (the answer is no), 2 (the command was wrong).

${body.join('\n')}`;
}

/** `llms-full.txt`: the guides and the command and HTTP references in one file, for an agent that reads one document. */
function llmsFull(): string {
  const doc = (file: string, text: string) => `<doc path="${file}">\n${text.trimEnd()}\n</doc>\n`;
  return `${llmsTxt().split('\n## ')[0]!.trimEnd()}\n\nThe documents below are the whole guide, then the references. The TypeScript API of each package is in docs/reference/<package>.md.\n\n${[
    ...GUIDES.filter(guide => guide.file !== 'docs/releasing.md').map(guide => doc(guide.file, renderDocument(guide.file))),
    doc('docs/reference/cli.md', cliReference()),
    doc('docs/reference/http-api.md', operationsReference())
  ].join('\n')}`;
}

/** Every generated file, in the order it is written. */
export function generated(): Generated[] {
  const files: Generated[] = [
    { file: 'packages/server/openapi.json', text: `${JSON.stringify(openApiDocument(), null, 2)}\n` },
    { file: 'docs/reference/cli.md', text: cliReference() },
    { file: 'docs/reference/http-api.md', text: operationsReference() },
    ...Object.entries(PACKAGES).map(([name, summary]) => ({ file: `docs/reference/${name}.md`, text: packageReference(name, summary) })),
    ...Object.entries(renderSchemas()).map(([file, text]) => ({ file: `packages/schema/schemas/${file}`, text })),
    ...[...new Set([...GUIDES.map(guide => guide.file), ...Object.values(BLOCK_FILES).flat()])].map(file => ({ file, text: renderDocument(file) })),
    { file: 'llms.txt', text: llmsTxt() }
  ];
  files.push({ file: 'llms-full.txt', text: llmsFull() });
  return files;
}

/** The generated files that differ from what is on disk (`current` is null when the file does not exist). */
export function drift(): { file: string; current: string | null }[] {
  const files = generated();
  const expected = new Set(files.map(file => file.file));
  const stale = files.flatMap(({ file, text }) => {
    let current: string | null = null;
    try { current = readFileSync(path.join(REPO, file), 'utf8'); } catch { /* not there */ }
    return current === text ? [] : [{ file, current }];
  });
  for (const file of obsoleteOutputs(expected)) stale.push({ file, current: read(file) });
  return stale;
}

/** Files left behind after a generated reference or schema was removed from its source inventory. */
export function obsoleteOutputs(expected: ReadonlySet<string>, root = REPO): string[] {
  return ['docs/reference', 'packages/schema/schemas'].flatMap(directory =>
    (existsSync(path.join(root, directory)) ? readdirSync(path.join(root, directory)) : []).map(name => `${directory}/${name}`).filter(file => !expected.has(file))
  );
}

if (import.meta.main) {
  const check = process.argv.includes('--check');
  if (check) {
    const stale = drift();
    for (const { file } of stale) process.stdout.write(`out of date: ${file} (run \`bun run docs\`; remove obsolete generated files)\n`);
    process.exitCode = stale.length ? 1 : 0;
  } else {
    const files = generated();
    for (const { file, text } of files) {
      mkdirSync(path.dirname(path.join(REPO, file)), { recursive: true });
      writeFileSync(path.join(REPO, file), text);
    }
    process.stdout.write(`Wrote ${files.length} generated files\n`);
  }
}

// Every documented package has a reference; a package added to the roots without one is a mistake caught here.
for (const root of DOCUMENTED_ROOTS) {
  const name = path.basename(path.dirname(root));
  if (!(name in PACKAGES)) throw new Error(`packages/${name} is documented but has no entry in PACKAGES (scripts/docs/generate.ts)`);
}
