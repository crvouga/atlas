import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { checkMain } from './check';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

test('the public command set contains six regular names and the automatic install hook', async () => {
  const pkg = await Bun.file(path.join(import.meta.dir, '../package.json')).json();
  expect(Object.keys(pkg.scripts).sort()).toEqual(['build', 'check', 'dev', 'docs', 'prepare', 'smoke', 'test']);
});

async function fixture(fail = '') {
  const root = await mkdtemp(path.join(tmpdir(), 'atlas commands ')); roots.push(root);
  await mkdir(path.join(root, 'node_modules/typescript/bin'), { recursive: true });
  await mkdir(path.join(root, 'packages/core/bin'), { recursive: true });
  const record = `import { appendFileSync } from 'node:fs'; appendFileSync('order.txt', process.argv.slice(2).join(' ') + '\\n');`;
  await writeFile(path.join(root, 'record.ts'), `${record} if (process.argv[2] === ${JSON.stringify(fail)}) process.exit(9);`);
  await writeFile(path.join(root, 'node_modules/typescript/bin/tsc'), "require('node:fs').appendFileSync('order.txt', 'types ' + process.argv.at(-1) + '\\n');");
  await writeFile(path.join(root, 'packages/core/bin/atlas.mjs'), record);
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ scripts: Object.fromEntries(['docs', 'test', 'build', 'smoke'].map((task) => [task, `bun record.ts ${task}`])) }));
  return root;
}

test('check preserves every verification group and stops before later groups after a failure', async () => {
  const root = await fixture();
  expect(await checkMain([], root)).toBe(0);
  const order = (await readFile(path.join(root, 'order.txt'), 'utf8')).trim().split('\n');
  expect(order).toEqual(['docs --check', 'types packages/core', 'types scripts', 'types scripts/docs', 'types examples/todo', 'test', 'build', 'client build --no-data --out .atlas-workspace/site', 'smoke']);
  const failed = await fixture('test');
  expect(await checkMain([], failed)).toBe(9);
  expect(await readFile(path.join(failed, 'order.txt'), 'utf8')).not.toContain('build');
});

test('check can select one group, and invalid groups cannot silently skip verification', async () => {
  const root = await fixture();
  expect(await checkMain(['--only', 'test'], root)).toBe(0);
  expect(await readFile(path.join(root, 'order.txt'), 'utf8')).toBe('test\n');
  expect(await checkMain(['--only', 'typo'], root)).toBe(2);
});

test('the consolidated example runner keeps both suites and their failure status', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'atlas examples ')); roots.push(root);
  await mkdir(path.join(root, 'examples/todo'), { recursive: true });
  await mkdir(path.join(root, 'packages/core/bin'), { recursive: true });
  const log = path.join(root, 'suites.txt');
  const record = (name: string, code: number) => `import { appendFileSync } from 'node:fs'; appendFileSync(${JSON.stringify(log)}, '${name}\\n'); process.exit(${code});`;
  await writeFile(path.join(root, 'packages/core/bin/atlas.mjs'), record('clients', 7));
  await writeFile(path.join(root, 'examples/todo/run-all.ts'), record('run', 0));
  const script = path.join(import.meta.dir, 'examples.ts');
  const all = Bun.spawn([process.execPath, script, 'all'], { cwd: root, stdout: 'ignore', stderr: 'ignore' });
  expect(await all.exited).toBe(7);
  expect(await readFile(log, 'utf8')).toBe('clients\nrun\n');
  await writeFile(log, '');
  const single = Bun.spawn([process.execPath, script, 'run'], { cwd: root, stdout: 'ignore', stderr: 'ignore' });
  expect(await single.exited).toBe(0);
  expect(await readFile(log, 'utf8')).toBe('run\n');
});
