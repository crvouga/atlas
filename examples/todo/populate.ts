import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpeg from 'ffmpeg-static';
import { workspaceStatus } from '../../scripts/workspace';
import { copyStore } from '../../packages/reports/src/copy-store';
import { openStore } from '../../packages/reports/src/store-url';
import { exampleReports, readExampleSpecs } from '../../packages/visualizer/vite/example-reports';
import { exampleRoot, publishExampleReports } from './publish';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const runtime = (await workspaceStatus(root)).runtimes.find(item => item.mode === 'server' && item.state === 'running');
const url = process.env.ATLAS_SERVER_URL ?? runtime?.url;
if (!url) throw new Error('Start Atlas with bun run workspace:run before running workspace:populate.');
if (!ffmpeg) throw new Error('No project-local FFmpeg binary is available for this platform.');
const env = { ...process.env, ATLAS_SERVER_URL: url, ATLAS_PROJECT: process.env.ATLAS_PROJECT ?? 'todo-app',
  PATH: `${path.dirname(ffmpeg)}${path.delimiter}${process.env.PATH ?? ''}`,
  ATLAS_TOKEN: process.env.ATLAS_PUBLISH_TOKEN ?? process.env.ATLAS_TOKEN };
const target = openStore(url, { base: root, env }).store;
console.log(`Populating Todo example at ${url} (project ${env.ATLAS_PROJECT})`);
// These are the same multi-version, environment and spec-type fixtures as Viewer examples.
const seeded = await exampleReports(readExampleSpecs(path.join(exampleRoot, 'specs')));
if (!seeded) throw new Error('Todo example fixtures are missing.');
for (const store of [seeded.localStore, seeded.store, ...(seeded.backends ?? []).map(backend => backend.store)]) {
  if (store) await copyStore(store, target);
}
let failed = false;
for (const args of [
  ['node_modules/playwright/cli.js', 'install', 'chromium'],
  ['run', 'example:clients'],
  ['run', 'example:run'],
  ['examples/todo/ui-catalog.ts']
]) {
  const child = Bun.spawn([process.execPath, ...args], { cwd: root, env, stdout: 'inherit', stderr: 'inherit' });
  const code = await child.exited;
  if (code !== 0) { failed = true; console.error(`Example step failed (${code}): bun ${args.join(' ')}`); }
}
// Publish every completed privacy-checked run, all document layers and catalog pictures, even after a failed check.
await publishExampleReports(url);
console.log(`Example data: ${url}/?project=${encodeURIComponent(env.ATLAS_PROJECT)}\nUI catalog: ${url}/catalog?project=${encodeURIComponent(env.ATLAS_PROJECT)}`);
if (failed) process.exitCode = 1;
