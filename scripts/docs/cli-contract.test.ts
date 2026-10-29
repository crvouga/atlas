/** @module Execute the documented help and JSON command inventory against the actual CLI. */
import { expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { httpStore } from '../../packages/reports/src/http-store';
import { publishChecks } from '../../packages/reports/src/publish-checks';
import { uiStateLayer } from '../../packages/reports/src/ui-catalog-publish';
import { memoryStore } from '../../packages/reports/tests/memory-store';
import { CLI_RESULTS } from '../../packages/schema/src/cli-results';
import { createAtlasServer } from '../../packages/server/src/app';
import { listen } from '../../packages/server/src/host';
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
  // A server to read the catalog from, with one captured state to judge, and a critic of the project's own.
  const server = createAtlasServer({ backends: [{ id: 'data', store: memoryStore() }], write: 'data', refreshMs: 60_000 });
  const http = await listen(server.fetch, { port: 0, host: '127.0.0.1', maxBodyBytes: 16 * 1024 * 1024 });
  await server.ready;
  const serverUrl = `http://127.0.0.1:${http.port}`;
  await publishChecks(httpStore({ url: serverUrl }), uiStateLayer({ producer: 'capture', recordedAtMs: 1, environment: 'desktop-web', states: [{ id: 'home', screenshot: { data: new TextEncoder().encode('png:home') } }] }));
  await writeFile(path.join(cwd, 'atlas.critics.json'), JSON.stringify({ critics: { contrast: { type: 'module', module: 'contrast.mjs' } } }));
  await writeFile(path.join(cwd, 'contrast.mjs'), "export default { name: 'contrast', version: '1.0.0', kind: 'heuristic', describe: () => ({ sendsImagesTo: null, needsSetup: false }), evaluate: async () => ({ verdict: { score: 0.5 } }) };\n");
  const scenarios: Record<keyof typeof CLI_RESULTS, { args: string[]; code: number; stdin?: string }> = {
    init: { args: ['init'], code: 0 },
    publish: { args: ['report', 'publish', '--checks', 'checks.json'], code: 0 },
    stream: { args: ['report', 'stream', '--producer', 'streamed'], stdin: '{"id":"b","title":"streamed","status":"passed"}\n', code: 0 },
    merge: { args: ['report', 'merge', '--into', 'merged'], code: 0 },
    doctor: { args: ['report', 'doctor'], code: 0 },
    status: { args: ['report', 'status'], code: 0 },
    verifyRecordings: { args: ['report', 'verify-recordings'], code: 0 },
    criticList: { args: ['critic', 'list'], code: 0 },
    criticSetup: { args: ['critic', 'setup', 'contrast'], code: 0 },
    criticDoctor: { args: ['critic', 'doctor', '--server', serverUrl], code: 0 },
    criticRun: { args: ['critic', 'run', '--critic', 'contrast', '--all', '--server', serverUrl], code: 0 },
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
  } finally { server.close(); await http.close(200); await rm(cwd, { recursive: true, force: true }); }
}, 30_000);
