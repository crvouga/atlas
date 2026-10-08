#!/usr/bin/env node
import { existsSync, readdirSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_FILE = path.join(APP_ROOT, 'vite.config.ts');

const USAGE = `atlas-visualizer: browse statechart specs and the runs that execute them

Usage
  atlas-visualizer dev          [--specs <dir>] [--runs <dir>] [--port <n>] [--host <host>]
  atlas-visualizer build        [--specs <dir>] [--runs <dir>] [--out <dir>] [--keep <n>] [--no-data]
  atlas-visualizer publish-data [--specs <dir>] [--runs <dir>] [--out <dir>] [--keep <n>]

Options
  --specs <dir>    statecharts (*.scxml, *.machine.yaml|yml|json), journeys.yaml, notes   (default: ./specs)
  --runs <dir>     run directories, each with a manifest.json                              (default: ./atlas-runs)
  --fixture <name> show a bundled example instead (spec-only, partial, full, failures, removed, malformed, large)
  --out <dir>      build: the static site (default ./atlas-site); publish-data: the data (default ./atlas-data)
  --keep <n>       how many of the newest runs to publish (default 30)
  --no-data        build: leave the data out; point the site at it with VITE_ATLAS_BASE_URL
  --port <n>       dev: port to listen on (default 5180, or the next free one)
  --host <host>    dev: address to listen on (default localhost)

Relative paths resolve against the directory the command was run from. ATLAS_SPECS_ROOT and
ATLAS_RUNS_ROOT are read when the flags are absent.
`;

class UsageError extends Error {}

function parse(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      specs: { type: 'string' },
      runs: { type: 'string' },
      fixture: { type: 'string' },
      out: { type: 'string' },
      keep: { type: 'string' },
      port: { type: 'string' },
      host: { type: 'string' },
      'no-data': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false }
    }
  });
  return { command: positionals[0], extra: positionals.slice(1), values };
}

function integer(name, value, min, max) {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new UsageError(`--${name} must be a whole number from ${min} to ${max}, got "${value}"`);
  return n;
}

/** Point the shared root resolution (vite/atlas-files.ts) at the flags, as absolute paths. */
function applyRoots(values, base) {
  if (values.fixture) {
    if (values.specs || values.runs) throw new UsageError('--fixture cannot be combined with --specs or --runs');
    process.env.ATLAS_FIXTURE = values.fixture;
    return;
  }
  if (values.specs || values.runs) delete process.env.ATLAS_FIXTURE;
  if (values.specs) {
    const specs = path.resolve(base, values.specs);
    if (!existsSync(specs) || !statSync(specs).isDirectory()) throw new UsageError(`No specs directory at ${specs}`);
    process.env.ATLAS_SPECS_ROOT = specs;
  } else if (process.env.ATLAS_SPECS_ROOT) {
    process.env.ATLAS_SPECS_ROOT = path.resolve(base, process.env.ATLAS_SPECS_ROOT);
  }
  if (values.runs) process.env.ATLAS_RUNS_ROOT = path.resolve(base, values.runs);
  else if (process.env.ATLAS_RUNS_ROOT) process.env.ATLAS_RUNS_ROOT = path.resolve(base, process.env.ATLAS_RUNS_ROOT);
  process.env.INIT_CWD = base;
}

/** Refuse to empty a directory that is not a previous build: the base, its ancestors, home, or anything else with files. */
function assertSafeOut(out, base) {
  const rel = path.relative(out, base);
  if (out === path.parse(out).root || out === os.homedir() || rel === '' || !rel.startsWith('..')) {
    throw new UsageError(`Refusing to build into ${out}: it holds the directory you ran from. Pass --out <new dir>.`);
  }
  if (existsSync(out)) {
    const entries = readdirSync(out).filter((n) => n !== '.DS_Store');
    if (entries.length && !entries.includes('index.html')) {
      throw new UsageError(`Refusing to replace ${out}: it is not empty and is not a previous build. Pass --out <new dir>.`);
    }
  }
}

async function loadNodeSide() {
  const { runnerImport } = await import('vite');
  const files = await runnerImport(path.join(APP_ROOT, 'vite/atlas-files.ts'));
  const publish = await runnerImport(path.join(APP_ROOT, 'vite/publish.ts'));
  return { resolveRoots: files.module.resolveRoots, publishData: publish.module.publishData };
}

function publish(publishData, roots, out, keep) {
  const result = publishData({ roots, out, keep: keep ?? 30 });
  process.stdout.write(`Published ${result.files.length} spec file(s) and ${result.published.length} run(s) to ${out}\n`);
  if (result.skipped.length) process.stdout.write(`Not published, privacy check missing or failed: ${result.skipped.join(', ')}\n`);
}

async function main(argv) {
  const { command, extra, values } = parse(argv);
  if (values.help || !command) {
    process.stdout.write(USAGE);
    return command || values.help ? 0 : 1;
  }
  if (extra.length) throw new UsageError(`Unexpected argument: ${extra.join(' ')}`);
  const base = process.env.INIT_CWD || process.cwd();
  const port = integer('port', values.port, 0, 65_535);
  const keep = integer('keep', values.keep, 0, 10_000);
  applyRoots(values, base);

  if (command === 'dev') {
    const { createServer } = await import('vite');
    const server = await createServer({
      configFile: CONFIG_FILE,
      configLoader: 'runner',
      root: APP_ROOT,
      server: { ...(port !== undefined ? { port } : {}), ...(values.host ? { host: values.host } : {}), strictPort: false }
    });
    await server.listen();
    server.printUrls();
    server.bindCLIShortcuts({ print: true });
    return null;
  }

  if (command === 'build') {
    const out = path.resolve(base, values.out ?? 'atlas-site');
    assertSafeOut(out, base);
    const { build } = await import('vite');
    await build({
      configFile: CONFIG_FILE,
      configLoader: 'runner',
      root: APP_ROOT,
      publicDir: false,
      build: { outDir: out, emptyOutDir: true }
    });
    if (!values['no-data']) {
      const { resolveRoots, publishData } = await loadNodeSide();
      publish(publishData, resolveRoots(), path.join(out, 'data'), keep);
    }
    process.stdout.write(`Built the site in ${out}; serve it with any static file server.\n`);
    return 0;
  }

  if (command === 'publish-data') {
    const out = path.resolve(base, values.out ?? 'atlas-data');
    const { resolveRoots, publishData } = await loadNodeSide();
    publish(publishData, resolveRoots(), out, keep);
    return 0;
  }

  throw new UsageError(`Unknown command "${command}"`);
}

main(process.argv.slice(2)).then(
  (code) => {
    if (typeof code === 'number') process.exitCode = code;
  },
  (error) => {
    const usage = error instanceof UsageError || error?.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION' || error?.code === 'ERR_PARSE_ARGS_INVALID_OPTION_VALUE';
    process.stderr.write(`atlas-visualizer: ${error instanceof Error ? error.message : String(error)}\n`);
    if (usage) process.stderr.write(`\n${USAGE}`);
    process.exitCode = 1;
  }
);
