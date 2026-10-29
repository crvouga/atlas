/** @module Execute the documented help and JSON command inventory against the actual CLI. */
import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { CLI_RESULTS } from '../../packages/schema/src/cli-results';
import { REPO } from './coverage';
import { CLI_HELP } from './generate';

const cli = path.join(REPO, 'packages/core/bin/atlas.mjs');

for (const help of CLI_HELP) {
  test(`${help.title} --help equals the generated CLI reference`, async () => {
    const child = Bun.spawn([process.execPath, cli, ...help.args, '--help'], { stdout: 'pipe', stderr: 'pipe' });
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    expect({ code, err }).toEqual({ code: 0, err: '' });
    expect(out.trim()).toBe(help.usage.trim());
  });
}

test('every documented JSON result validates against the same registry that publishes its schema', async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), 'atlas-json-contract-'));
  const scenarios: Record<keyof typeof CLI_RESULTS, { args: string[]; code: number; stdin?: string }> = {
    init: { args: ['init'], code: 0 },
    publish: { args: ['report', 'publish', '--checks', 'checks.json'], code: 0 },
    stream: { args: ['report', 'stream', '--producer', 'streamed'], stdin: '{"id":"b","title":"streamed","status":"passed"}\n', code: 0 },
    merge: { args: ['report', 'merge', '--into', 'merged'], code: 0 },
    doctor: { args: ['report', 'doctor'], code: 0 },
    status: { args: ['report', 'status'], code: 0 },
    verifyRecordings: { args: ['report', 'verify-recordings'], code: 0 },
    error: { args: ['report', 'publish'], code: 2 }
  };
  try {
    await writeFile(path.join(cwd, 'checks.json'), JSON.stringify({ producer: 'smoke', checks: [{ id: 'a', title: 'passed', status: 'passed' }] }));
    for (const [name, contract] of Object.entries(CLI_RESULTS)) {
      const scenario = scenarios[name as keyof typeof scenarios];
      const child = Bun.spawn([process.execPath, cli, ...scenario.args, '--format', 'json'], {
        cwd, env: { ...process.env, ATLAS_STORE: path.join(cwd, 'store') },
        stdin: scenario.stdin ? new Blob([scenario.stdin]) : 'ignore', stdout: 'pipe', stderr: 'pipe'
      });
      const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      expect(code, `${contract.command}: ${err}`).toBe(scenario.code);
      expect(contract.schema.safeParse(JSON.parse(name === 'error' ? err : out)).success, contract.schemaName).toBe(true);
      if (name === 'error') expect(out).toBe('');
    }
  } finally { await rm(cwd, { recursive: true, force: true }); }
}, 30_000);
