#!/usr/bin/env node
if (!globalThis.Bun) {
  const { register } = await import('tsx/esm/api');
  register();
}
const { main } = await import('../src/cli.ts');
process.exitCode = await main();
