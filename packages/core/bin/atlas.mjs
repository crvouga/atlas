#!/usr/bin/env node
if (!globalThis.Bun) {
  const { register } = await import('tsx/esm/api');
  register();
}
// By package name, so the CLI and the config it loads share one copy of Atlas.
const { main } = await import('@crvouga/atlas/cli');
process.exitCode = await main();
