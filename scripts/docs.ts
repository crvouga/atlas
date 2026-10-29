/** @module Documentation command
 * Generate documentation and schemas, or verify all documentation contracts with --check.
 */
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) { console.log('Usage: bun run docs [--check [test options]]'); process.exit(0); }
if (args.length && args[0] !== '--check') {
  console.error('Usage: bun run docs [--check]');
  process.exit(2);
}
const command = args.length
  ? ['test', 'scripts/docs', 'scripts/release/docs-links.test.ts', 'packages/schema/tests/schemas.test.ts', 'packages/server/tests/openapi.test.ts', 'packages/server/tests/settings.test.ts', ...args.slice(1)]
  : ['scripts/docs/generate.ts'];
const child = Bun.spawn([process.execPath, ...command], { stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' });
process.exitCode = await child.exited;

export {};
