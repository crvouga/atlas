import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { exampleServerUrl, publishExampleReports } from './publish';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function run(args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn('bun', args, { cwd: root, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

/** Run every producer and upload their evidence even when an earlier suite fails. */
export async function runExampleWorkflow(options: {
  run?: (args: string[]) => Promise<number>;
  publish?: () => Promise<void>;
  error?: (message: string) => void;
} = {}): Promise<number> {
  const execute = options.run ?? run;
  const error = options.error ?? console.error;
  let failed = false;
  for (const args of [
    ['--cwd', 'examples/todo', '../../packages/core/bin/atlas.mjs', 'run', '--mode', 'showcase'],
    ['examples/todo/documents.ts'],
    ['examples/todo/catalog.ts']
  ]) {
    try { if (await execute(args) !== 0) failed = true; }
    catch (reason) { failed = true; error(reason instanceof Error ? reason.message : String(reason)); }
  }
  try {
    await (options.publish ?? (() => publishExampleReports(exampleServerUrl())))();
  } catch (reason) {
    failed = true;
    error(`Reports remain on disk, but uploading to ${exampleServerUrl()} failed: ${reason instanceof Error ? reason.message : String(reason)}`);
    error('Start `bun run dev --server`, then run `bun examples/todo/publish.ts` to upload this run without rerunning tests.');
  }
  return failed ? 1 : 0;
}

if (import.meta.main) {
  process.env.ATLAS_SERVER_URL ??= exampleServerUrl();
  process.env.ATLAS_PROJECT ??= 'todo-app';
  process.env.ATLAS_PRODUCER ??= 'todo-statecharts';
  process.exitCode = await runExampleWorkflow();
}
