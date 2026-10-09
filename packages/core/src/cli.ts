import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { AtlasConfig } from './config';
import type { RunMode } from './run/types';
import { mergeConfigRuns, prepare, runConfig } from './config';
import { lintBundle } from './lint';
import { toMermaid } from './report/formats';
import { composeCharts } from './spec/compose';
import { loadSpecDirectory } from './spec/load';
import { machineToScxml } from './spec/scxml';

const USAGE = `atlas — executable statecharts

  atlas lint   [--config atlas.config.ts | --specs <dir>] [--require-implementations]
  atlas plan   [--config atlas.config.ts] [--state <name>]
  atlas run    [--config atlas.config.ts] [--mode fast|showcase] [--workers n] [--state <name>]
               [--seed <name>]... [--paths id,id] [--shard i/n] [--rerun-failed | --reuse <run-dir>]
               [--no-retry] [--output <dir>]
  atlas merge  [--config atlas.config.ts] [--output <dir>] <run-dir> <run-dir>...
  atlas export --specs <dir> --format scxml|mermaid|json [--out <file>]

  --workers       path attempts that run at once (default: one per CPU, capped by the driver)
  --seed          only paths that start from this seed ("start" for paths setup starts); repeatable
  --shard 2/4     run the second quarter of the plan; merge the shards' runs afterwards
  --rerun-failed  keep the newest run's passed paths and run only the rest
`;

const VALUE_FLAGS = ['config', 'specs', 'format', 'out', 'mode', 'paths', 'seed', 'output', 'workers', 'shard', 'reuse', 'state'];

/** Arguments that are not flags or flag values. */
function positionals(argv: string[]) {
  const out: string[] = [];
  for (let i = 1; i < argv.length; i++) {
    const token = argv[i]!;
    if (token.startsWith('--')) {
      if (VALUE_FLAGS.includes(token.slice(2))) i++;
      continue;
    }
    out.push(token);
  }
  return out;
}

function parseShard(value: string | undefined) {
  if (!value) return undefined;
  const m = value.match(/^(\d+)\/(\d+)$/);
  if (!m) throw new Error(`--shard takes i/n, like 2/4 (got "${value}")`);
  return { index: Number(m[1]), count: Number(m[2]) };
}

function parseWorkers(value: string | undefined) {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error(`--workers takes a whole number of at least 1 (got "${value}")`);
  return n;
}

function flag(argv: string[], name: string) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}

/** Every value of a flag that may be given more than once. */
function flags(argv: string[], name: string) {
  return argv.flatMap((token, i) => (token === `--${name}` && argv[i + 1] !== undefined ? [argv[i + 1]!] : []));
}

async function loadConfig(file: string): Promise<{ config: AtlasConfig; base: string }> {
  const absolute = path.resolve(file);
  const mod = (await import(pathToFileURL(absolute).href)) as { default?: AtlasConfig };
  if (!mod.default) throw new Error(`${file} has no default export (use defineConfig)`);
  return { config: mod.default, base: path.dirname(absolute) };
}

export async function main(argv = process.argv.slice(2)) {
  const [command] = argv;
  const configFile = flag(argv, 'config') ?? 'atlas.config.ts';
  const specs = flag(argv, 'specs');

  if (command === 'export') {
    if (!specs) throw new Error('export needs --specs <dir>');
    const composition = composeCharts(loadSpecDirectory(path.resolve(specs)));
    const format = flag(argv, 'format') ?? 'scxml';
    const text =
      format === 'scxml' ? machineToScxml(composition.machine) : format === 'mermaid' ? toMermaid(composition.machine) : `${JSON.stringify(composition.machine, null, 2)}\n`;
    const out = flag(argv, 'out');
    if (out) writeFileSync(out, text);
    else process.stdout.write(text);
    return 0;
  }

  if (command === 'lint' && specs) {
    const { findings } = lintBundle(loadSpecDirectory(path.resolve(specs)));
    for (const f of findings) process.stdout.write(`✗ [${f.rule}] ${f.message}\n`);
    process.stdout.write(`${findings.length} problem(s)\n`);
    return findings.length ? 1 : 0;
  }

  if (command === 'merge') {
    const { config, base } = await loadConfig(configFile);
    const dirs = positionals(argv);
    if (dirs.length < 1) throw new Error('merge needs the run directories to compose');
    const { runDir, manifest, ok } = mergeConfigRuns(config, dirs, { output: flag(argv, 'output'), state: flag(argv, 'state') }, base);
    const c = manifest.coverage.overall!;
    process.stdout.write(`Merged ${dirs.length} run(s): transitions ${c.transitions.passed}/${c.transitions.total} passed, ${c.transitions.failed} failed\n`);
    process.stdout.write(`Manifest: ${path.join(runDir, 'manifest.json')}\n`);
    return ok ? 0 : 1;
  }

  if (command === 'lint' || command === 'plan' || command === 'run') {
    const { config, base } = await loadConfig(configFile);
    const prepared = prepare(config, base, { state: flag(argv, 'state') });
    const strict = argv.includes('--require-implementations');
    const structural = prepared.lint.findings.filter((f) => f.rule !== 'implemented');
    const missing = prepared.lint.findings.filter((f) => f.rule === 'implemented');
    for (const f of structural) process.stdout.write(`✗ [${f.rule}] ${f.message}\n`);
    for (const f of missing) process.stdout.write(`${strict ? '✗' : '·'} [${f.rule}] ${f.message}\n`);
    process.stdout.write(`${structural.length} spec problem(s), ${missing.length} unimplemented\n`);
    if (command === 'lint') return structural.length || (strict && missing.length) ? 1 : 0;
    if (command === 'plan') {
      const { paths, journeys, seeds, unreachable } = prepared.plan;
      for (const s of seeds) process.stdout.write(`seed ${JSON.stringify(s.name)} at ${s.active.join(' > ')}${s.blocked ? `  [blocked: ${s.blocked}]` : ''}\n`);
      for (const p of paths) {
        const from = p.seed ? ` from "${p.seed}"` : '';
        process.stdout.write(
          `${p.id.padEnd(14)} ${p.kind.padEnd(9)} ${String(p.steps.length).padStart(2)} steps  ${p.name}${from}${p.blockedBy.length ? `  [blocked: ${p.blockedBy.join('; ')}]` : ''}${p.skipRun ? ' (reported, not run)' : ''}\n`
        );
      }
      for (const j of journeys) process.stdout.write(`journey ${JSON.stringify(j.name)} = ${j.paths.join(' + ')}\n`);
      const runnable = paths.filter((p) => !p.skipRun);
      const longest = Math.max(0, ...runnable.map((p) => p.steps.length));
      const total = runnable.reduce((n, p) => n + p.steps.length, 0);
      process.stdout.write(`${paths.length} paths (${runnable.length} run, ${total} steps, the longest ${longest}); ${unreachable.length} transitions left uncovered\n`);
      return 0;
    }
    if (structural.length) return 1;
    const { runDir, manifest, ok } = await runConfig(
      config,
      {
        mode: (flag(argv, 'mode') ?? 'fast') as RunMode,
        paths: flag(argv, 'paths')?.split(','),
        seeds: flags(argv, 'seed').length ? flags(argv, 'seed') : undefined,
        state: flag(argv, 'state'),
        retry: !argv.includes('--no-retry'),
        output: flag(argv, 'output'),
        workers: parseWorkers(flag(argv, 'workers')),
        shard: parseShard(flag(argv, 'shard')),
        reuse: argv.includes('--rerun-failed') ? 'latest' : flag(argv, 'reuse')
      },
      base
    );
    const c = manifest.coverage.overall!;
    process.stdout.write(`\nStates ${c.states.passed}/${c.states.total} passed, ${c.states.failed} failed, ${c.states.notReached} not reached\n`);
    process.stdout.write(`Transitions ${c.transitions.passed}/${c.transitions.total} passed, ${c.transitions.failed} failed, ${c.transitions.notReached} not reached\n`);
    const j = manifest.journeys;
    if (j.length) process.stdout.write(`Journeys ${j.filter((x) => x.status === 'passed').length}/${j.length} passed, ${j.filter((x) => x.status === 'failed').length} failed\n`);
    process.stdout.write(`Manifest: ${path.join(runDir, 'manifest.json')}\n`);
    return ok ? 0 : 1;
  }

  process.stdout.write(USAGE);
  return command ? 2 : 0;
}
