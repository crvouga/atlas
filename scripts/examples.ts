/** @module Example workflow
 * The existing multi-client and single-client/document suites, also used independently by CI.
 */
const mode = process.argv[2] ?? 'all';
if (!['all', 'run', 'clients'].includes(mode) || process.argv.length > 3) {
  console.error('Usage: bun scripts/examples.ts [all|run|clients]');
  process.exit(2);
}
const commands: string[][] = [];
if (mode !== 'run') commands.push(['--cwd', 'examples/todo', '../../packages/core/bin/atlas.mjs', 'run', '--config', 'clients/atlas.config.ts', '--mode', 'showcase']);
if (mode !== 'clients') commands.push(['examples/todo/run-all.ts']);
let status = 0;
for (const args of commands) {
  const child = Bun.spawn([process.execPath, ...args], { stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' });
  const code = await child.exited;
  if (code !== 0) status = code;
}
process.exitCode = status;

export {};
