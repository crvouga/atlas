/** @module Repository verification
 * The complete CI/workspace verification workflow, with individually selectable groups.
 */
import { readdir } from 'node:fs/promises';
import path from 'node:path';

const groups = ['docs', 'types', 'test', 'build', 'client', 'smoke'] as const;
type Group = typeof groups[number];
const help = `Usage: bun run check [--only ${groups.join('|')}]
Without arguments, runs every group in order. Stops at the first failure.
`;

/** Resolve the actual compiler projects rather than relying on shell glob expansion. */
export async function typeProjects(root: string): Promise<string[]> {
  const packages = await readdir(path.join(root, 'packages'), { withFileTypes: true });
  return [...packages.filter((entry) => entry.isDirectory()).map((entry) => `packages/${entry.name}`).sort(), 'scripts', 'scripts/docs', 'examples/todo'];
}

/** Run the selected verification groups and return the first failing exit code. */
export async function checkMain(args: string[], root = process.cwd()): Promise<number> {
  if (args.includes('--help') || args.includes('-h')) { console.log(help); return 0; }
  if (args.length && (args.length !== 2 || args[0] !== '--only' || !groups.includes(args[1] as Group))) {
    console.error(help); return 2;
  }
  const selected = args.length ? [args[1] as Group] : groups;
  for (const group of selected) {
    const commands = group === 'types'
      ? (await typeProjects(root)).map((project) => [path.join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '-p', project])
      : group === 'client'
        ? [['packages/core/bin/atlas.mjs', 'client', 'build', '--no-data', '--out', '.atlas-workspace/site']]
        : [['run', group, ...(group === 'docs' ? ['--check'] : [])]];
    console.log(`Checking ${group}…`);
    for (const command of commands) {
      const child = Bun.spawn([process.execPath, ...command], { cwd: root, stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' });
      const code = await child.exited;
      if (code !== 0) return code;
    }
  }
  return 0;
}
if (import.meta.main) process.exitCode = await checkMain(process.argv.slice(2));
