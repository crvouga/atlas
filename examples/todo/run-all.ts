import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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

if (atlas !== 0 || documents !== 0) process.exitCode = 1;
