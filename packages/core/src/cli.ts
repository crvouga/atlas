import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { AtlasConfig } from './config';
import type { RunMode } from './run/types';
import { prepare, runConfig } from './config';
import { lintBundle } from './lint';
import { toMermaid } from './report/formats';
import { composeCharts } from './spec/compose';
import { loadSpecDirectory } from './spec/load';
import { machineToScxml } from './spec/scxml';

const USAGE = `atlas — executable statecharts

  atlas lint   [--config atlas.config.ts | --specs <dir>] [--require-implementations]
  atlas plan   [--config atlas.config.ts]
  atlas run    [--config atlas.config.ts] [--mode fast|showcase] [--paths id,id] [--no-retry] [--output <dir>]
  atlas export --specs <dir> --format scxml|mermaid|json [--out <file>]
`;

function flag(argv: string[], name: string) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
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

  if (command === 'lint' || command === 'plan' || command === 'run') {
    const { config, base } = await loadConfig(configFile);
    const prepared = prepare(config, base);
    const strict = argv.includes('--require-implementations');
    const structural = prepared.lint.findings.filter((f) => f.rule !== 'implemented');
    const missing = prepared.lint.findings.filter((f) => f.rule === 'implemented');
    for (const f of structural) process.stdout.write(`✗ [${f.rule}] ${f.message}\n`);
    for (const f of missing) process.stdout.write(`${strict ? '✗' : '·'} [${f.rule}] ${f.message}\n`);
    process.stdout.write(`${structural.length} spec problem(s), ${missing.length} unimplemented\n`);
    if (command === 'lint') return structural.length || (strict && missing.length) ? 1 : 0;
    if (command === 'plan') {
      for (const p of prepared.plan.paths) {
        process.stdout.write(`${p.id.padEnd(14)} ${p.kind.padEnd(9)} ${p.name}${p.blockedBy.length ? `  [blocked: ${p.blockedBy.join('; ')}]` : ''}${p.skipRun ? ' (reported, not run)' : ''}\n`);
      }
      process.stdout.write(`${prepared.plan.paths.length} paths; ${prepared.plan.unreachable.length} transitions left uncovered\n`);
      return 0;
    }
    if (structural.length) return 1;
    const { runDir, manifest, ok } = await runConfig(
      config,
      {
        mode: (flag(argv, 'mode') ?? 'fast') as RunMode,
        paths: flag(argv, 'paths')?.split(','),
        retry: !argv.includes('--no-retry'),
        output: flag(argv, 'output')
      },
      base
    );
    const c = manifest.coverage.overall!;
    process.stdout.write(`\nStates ${c.states.passed}/${c.states.total} passed, ${c.states.failed} failed, ${c.states.notReached} not reached\n`);
    process.stdout.write(`Transitions ${c.transitions.passed}/${c.transitions.total} passed, ${c.transitions.failed} failed, ${c.transitions.notReached} not reached\n`);
    process.stdout.write(`Manifest: ${path.join(runDir, 'manifest.json')}\n`);
    return ok ? 0 : 1;
  }

  process.stdout.write(USAGE);
  return command ? 2 : 0;
}
