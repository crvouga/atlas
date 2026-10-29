/** @module Execute the documented help and JSON command inventory against the actual CLI. */
import { expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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
  const OLD = 'a'.repeat(40), NEW = 'b'.repeat(40);
  const profile = ['--environment', 'desktop-web', '--param', 'viewport=1280x800'];
  const scenarios: Record<keyof typeof CLI_RESULTS, { args: string[]; code: number; stdin?: string; before?: string[][] }> = {
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
    criticWatch: { args: ['critic', 'watch', '--critic', 'contrast', '--server', serverUrl, '--max-batches', '1'], code: 0 },
    criticReview: { args: ['critic', 'review', '--server', serverUrl], code: 0 },
    criticCalibrate: { args: ['critic', 'calibrate', 'contrast', '--good', 'examples/good', '--bad', 'examples/bad'], code: 0 },
    // The UI catalog: an earlier commit is captured first, then the plan and the later commit, so status is complete and diff has two sides.
    uiCatalogPlan: { args: ['ui-catalog', 'plan', '--states', 'ui-plan.json', '--producer', 'planner', ...profile, '--sha', NEW, '--recorded-at', '1500'], code: 0, before: [['ui-catalog', 'publish', '--captures', 'ui-old.json', '--producer', 'capture', ...profile, '--sha', OLD, '--recorded-at', '1000']] },
    uiCatalogPublish: { args: ['ui-catalog', 'publish', '--captures', 'ui-new.json', '--producer', 'capture', ...profile, '--sha', NEW, '--recorded-at', '2000', '--shard', '1/1'], code: 0 },
    uiCatalogStatus: { args: ['ui-catalog', 'status'], code: 0 },
    uiCatalogDiff: { args: ['ui-catalog', 'diff', '--from', OLD.slice(0, 12), '--to', NEW.slice(0, 12)], code: 0 },
    uiCatalogExport: { args: ['ui-catalog', 'export', '--out', 'catalog.html'], code: 0 },
    uiCatalogCollect: { args: ['ui-catalog', 'collect', '--catalog', 'atlas.catalog.mjs', '--exec', `"${process.execPath}" collector.mjs`, '--store', serverUrl, '--shard', 'contract'], code: 0 },
    error: { args: ['report', 'publish'], code: 2 }
  };
  try {
    const png = (tail: number) => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, tail]);
    await writeFile(path.join(cwd, 'old.png'), png(1));
    await writeFile(path.join(cwd, 'new.png'), png(2));
    await mkdir(path.join(cwd, 'examples/good'), { recursive: true });
    await mkdir(path.join(cwd, 'examples/bad'), { recursive: true });
    await writeFile(path.join(cwd, 'examples/good/a.png'), png(3));
    await writeFile(path.join(cwd, 'examples/bad/b.png'), png(4));
    await writeFile(path.join(cwd, 'ui-plan.json'), JSON.stringify({ states: [{ id: 'home', covers: ['home'] }, { id: 'settings', inventory: true }] }));
    await writeFile(path.join(cwd, 'ui-old.json'), JSON.stringify({ states: [{ id: 'home', title: 'Home', route: '/', covers: ['home'], screenshot: 'old.png' }] }));
    await writeFile(path.join(cwd, 'ui-new.json'), JSON.stringify({ states: [{ id: 'home', title: 'Home', route: '/', covers: ['home'], screenshot: 'new.png' }, { id: 'settings', title: 'Settings', screenshot: { path: 'new.png', width: 1, height: 1 } }] }));
    await writeFile(path.join(cwd, 'atlas.catalog.mjs'), "export default { name: 'contract', matrix: { dimensions: { scheme: { values: ['light', 'dark'] } } }, states: [{ id: 'queued' }] };\n");
    await writeFile(path.join(cwd, 'collector.mjs'), "import { readFileSync, writeFileSync } from 'node:fs';\nconst batch = JSON.parse(readFileSync(process.env.ATLAS_UI_BATCH, 'utf8'));\nwriteFileSync(process.env.ATLAS_UI_CAPTURES, JSON.stringify({ states: batch.states.map(state => ({ item: state.item, title: 'Queued' })) }));\n");
    await writeFile(path.join(cwd, 'checks.json'), JSON.stringify({ producer: 'smoke', checks: [{ id: 'a', title: 'passed', status: 'passed' }] }));
    for (const [name, contract] of Object.entries(CLI_RESULTS)) {
      const scenario = scenarios[name as keyof typeof scenarios];
      for (const before of scenario.before ?? []) {
        const setup = Bun.spawn([process.execPath, cli, ...before, '--format', 'json'], { cwd, env: { ...process.env, ATLAS_STORE: path.join(cwd, 'store') }, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
        const [, setupErr, setupCode] = await Promise.all([new Response(setup.stdout).text(), new Response(setup.stderr).text(), setup.exited]);
        expect(setupCode, `${before.join(' ')}: ${setupErr}`).toBe(0);
      }
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
