/** @module Execute the setup, publish and gate instructions Atlas writes for the next agent. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { CLI_RESULTS } from '../../packages/schema/src/cli-results';
import { PACKAGE_MANAGERS } from '../../packages/reports/src/package-managers';
import { run } from '../process';

const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

/**
 * Follow init's actual generated commands in a fresh consumer, using a real failing suite and its later fix.
 * The supplied CLI can be the source CLI or the installed tarball under Bun/Node; no server is required.
 */
export async function probeAgentInstructions(options: { cwd: string; command: readonly string[]; runtime: 'bun' | 'node' }): Promise<void> {
  const { cwd, runtime } = options;
  const manager = runtime === 'bun' ? 'bun' : 'npm';
  const testFile = runtime === 'bun' ? 'plumbing.test.ts' : 'plumbing.test.mjs';
  const testSource = (passes: boolean) => runtime === 'bun'
    ? `import { test, expect } from 'bun:test'; test('plumbing', () => expect(${passes}).toBe(true));\n`
    : `import { test } from 'node:test'; import assert from 'node:assert/strict'; test('plumbing', () => assert.equal(${passes}, true));\n`;
  mkdirSync(path.join(cwd, '.github'), { recursive: true });
  writeFileSync(path.join(cwd, 'package.json'), JSON.stringify({ name: 'consumer', type: 'module', devDependencies: { '@crvouga/atlas': '*' }, scripts: { test: runtime === 'bun' ? 'bun test' : 'node --test' } }));
  writeFileSync(path.join(cwd, runtime === 'bun' ? 'bun.lock' : 'package-lock.json'), '');
  writeFileSync(path.join(cwd, testFile), testSource(false));
  const env = { ...process.env, ATLAS_STORE: path.join(cwd, 'store'), GITHUB_SHA: 'a'.repeat(40), GITHUB_HEAD_REF: '', GITHUB_REF_NAME: 'main', ATLAS_ONLY_BRANCH: '', ATLAS_IGNORE_MODIFIED: '' };
  const binary = options.command.map(quote).join(' ');
  const execute = (command: string) => run('sh', ['-c', command.replace(`${PACKAGE_MANAGERS[manager].exec} atlas`, binary)], { cwd, env });
  const init = async () => {
    const result = await execute(`${PACKAGE_MANAGERS[manager].exec} atlas init --write --format json`);
    if (result.code !== 0) throw new Error(`agent init: ${result.stderr || result.stdout}`);
    return CLI_RESULTS.init.schema.parse(JSON.parse(result.stdout));
  };
  const plan = await init();
  const suite = plan.suites[0];
  if (plan.suites.length !== 1 || !suite) throw new Error('agent instructions did not detect the consumer suite');
  const agents = readFileSync(path.join(cwd, 'AGENTS.md'), 'utf8');
  if (!agents.includes(suite.run) || !agents.includes(suite.publish)) throw new Error('agent guidance omitted the planned suite commands');
  const gate = /\*\*Is it passing\?\*\* `([^`]+)`/.exec(agents)?.[1];
  if (!gate) throw new Error('agent guidance omitted its gate command');
  if ((await init()).written.length) throw new Error('repeating init changed the consumer instructions');

  let previousLayer: string | undefined;
  for (const passes of [false, true]) {
    if (passes) {
      // JUnit timestamps may have only second precision. A later run must be newer, not a tied outcome.
      await new Promise(resolve => setTimeout(resolve, 1100));
      writeFileSync(path.join(cwd, testFile), testSource(true));
    }
    const ran = await execute(suite.run);
    if (ran.code !== (passes ? 0 : 1)) throw new Error(`generated suite command exited ${ran.code}: ${ran.stderr}`);
    const sent = await execute(`${suite.publish} --format json`);
    if (sent.code !== 0) throw new Error(`generated publish command failed: ${sent.stderr}`);
    const published = CLI_RESULTS.publish.schema.parse(JSON.parse(sent.stdout));
    const gated = await execute(gate);
    const status = CLI_RESULTS.status.schema.parse(JSON.parse(gated.stdout));
    if (gated.code !== (passes ? 0 : 1) || status.ok !== passes || status.checks.total !== 1 || status.checks[passes ? 'passed' : 'failed'] !== 1) {
      throw new Error(`generated agent gate did not follow the real suite: ${gated.stdout} ${gated.stderr}`);
    }
    if (passes && previousLayer === published.layer.id) throw new Error('the real fix did not publish new evidence');
    previousLayer = published.layer.id;
    const again = await execute(`${suite.publish} --format json`);
    if (again.code !== 0 || CLI_RESULTS.publish.schema.parse(JSON.parse(again.stdout)).layer.id !== published.layer.id) throw new Error('repeating the generated publish changed evidence identity');
  }
}
