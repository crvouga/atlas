import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { exampleServerUrl, publishExampleReports } from './publish';

process.env.ATLAS_SERVER_URL ??= exampleServerUrl();
process.env.ATLAS_PROJECT ??= 'todo-app';
process.env.ATLAS_PRODUCER ??= 'todo-statecharts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function run(args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn('bun', args, { cwd: root, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

// A flaky statechart journey must not skip the Gherkin and Quint specs.
let atlas = 1;
try {
  atlas = await run(['--cwd', 'examples/todo', '../../packages/core/bin/atlas.mjs', 'run', '--mode', 'showcase']);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
}

let documents = 1;
try {
  documents = await run(['examples/todo/documents.ts']);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
}

let published = 0;
try {
  await publishExampleReports(exampleServerUrl());
} catch (error) {
  published = 1;
  console.error(`Reports remain on disk, but uploading to ${exampleServerUrl()} failed: ${error instanceof Error ? error.message : String(error)}`);
  console.error('Start `bun atlas`, then run `bun example:publish` to upload this run without rerunning tests.');
}
if (atlas !== 0 || documents !== 0 || published !== 0) process.exitCode = 1;
