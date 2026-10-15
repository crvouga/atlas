/** Real runner/packed-package integration probes, called by the consumer smoke. */
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { run } from '../process';

/** Run real CodeceptJS, Mocha, Jest and Node test invocations against the installed tarball and a live Atlas server. */
export async function probeRunners(cwd: string): Promise<void> {
  // Import the actual installed tarball, without pulling application runtime sources into the maintainer scripts' TypeScript project.
  const packageRoot = path.join(cwd, 'node_modules/@crvouga/atlas/dist');
  const { createAtlasServer, listen } = await import(path.join(packageRoot, 'server/src/index.js'));
  const { directoryStore } = await import(path.join(packageRoot, 'reports/src/directory-store.js'));
  const data = path.join(cwd, 'runner-smoke-data');
  mkdirSync(data, { recursive: true });
  const app = createAtlasServer({ backends: [{ id: 'data', store: directoryStore(data) }], write: 'data', tokens: [{ name: 'ci', role: 'publish', token: 'runner-smoke-token' }] });
  const http = await listen(app.fetch, { host: '127.0.0.1', port: 0, maxBodyBytes: 32 << 20 });
  await app.ready;
  const fixtures = path.join(cwd, 'runner-smoke');
  mkdirSync(fixtures, { recursive: true });
  const write = (file: string, text: string) => writeFileSync(path.join(fixtures, file), text);
  write('mocha.cjs', `describe('suite', () => { it('passes', () => {}); it('fails', () => { throw Error('expected smoke failure'); }); it.skip('skips', () => {}); });`);
  write('jest.test.cjs', `describe('suite', () => { test('passes', () => {}); test('fails', () => { throw Error('expected smoke failure'); }); test.skip('skips', () => {}); });`);
  write('jest.config.cjs', `module.exports = { testMatch: ['**/runner-smoke/jest.test.cjs'], reporters: ['@crvouga/atlas/jest'], maxWorkers: 1 };`);
  write('codecept.cjs', `Feature('suite'); Scenario('passes', () => {}); Scenario('fails', () => { throw Error('expected smoke failure'); }); Scenario.skip('skips', () => {});`);
  write('codecept.conf.cjs', `exports.config = { tests: './codecept.cjs', output: './output', helpers: {}, name: 'Atlas reporter smoke' };`);
  write('node.test.mjs', `import { describe, it } from 'node:test'; describe('suite', () => { it('passes', () => {}); it('fails', () => { throw Error('expected smoke failure'); }); it.skip('skips', () => {}); });`);
  const binaries = path.join(cwd, 'node_modules');
  const cases: [string, string[]][] = [
    ['mocha', [path.join(binaries, 'mocha/bin/mocha.js'), 'runner-smoke/mocha.cjs', '--reporter', '@crvouga/atlas/mocha']],
    ['jest', [path.join(binaries, 'jest/bin/jest.js'), '--config', 'runner-smoke/jest.config.cjs']],
    ['codeceptjs', [path.join(binaries, 'codeceptjs/bin/codecept.js'), 'run', '--config', 'runner-smoke/codecept.conf.cjs', '--reporter', '@crvouga/atlas/codecept']],
    ['node-test', ['--test', '--test-reporter=@crvouga/atlas/node-test', 'runner-smoke/node.test.mjs']]
  ];
  try {
    for (const [producer, args] of cases) {
      console.log(`consumer-smoke: native ${producer} reporter`);
      const project = `smoke-${producer}`;
      const result = await run('node', args, { cwd, env: { ...process.env, ATLAS_PROJECT: project, ATLAS_SERVER_URL: http.url, ATLAS_PUBLISH_TOKEN: 'runner-smoke-token' } });
      const headers = { authorization: 'Bearer runner-smoke-token' };
      const snapshot = await (await app.fetch(new Request(`http://atlas/api/projects/${project}/reports/evidence/effective`, { headers }))).json() as { layers: { layer: { producer: string }; rows: { status: string }[] }[] };
      const layers = snapshot.layers.filter(entry => entry.layer.producer === producer);
      const rows = layers.flatMap(layer => layer.rows);
      const states = rows.map(row => row.status).sort();
      const feed = await (await app.fetch(new Request(`http://atlas/api/projects/${project}/live`, { headers }))).json() as { runs: { producer: string; status: string; completed: number }[] };
      const live = feed.runs.find(run => run.producer === producer);
      if (!live || live.status !== 'completed' || live.completed !== 3) throw new Error(`${producer} did not finish its live feed: ${JSON.stringify(live)}\n${result.stdout}\n${result.stderr}`);
      if (result.code !== 1 || JSON.stringify(states) !== JSON.stringify(['failed', 'not-run', 'passed'])) {
        throw new Error(`${producer} smoke: exit=${result.code}, statuses=${JSON.stringify(states)}\n${result.stdout}\n${result.stderr}`);
      }
    }
    if (app.index.stats().layers !== 0) throw new Error('Project-scoped native reporters leaked layers into the default project.');
  } finally { app.close(); await http.close(); }
}
