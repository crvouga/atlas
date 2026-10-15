/** @module Regression for the instructions an integrating agent receives, using real Bun test results. */
import { test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { probeAgentInstructions } from './agent-smoke';
import { REPO } from './coverage';

test('generated AGENTS.md commands detect a real failure and a later fix, and init/publish are repeatable', async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), 'atlas-agent-instructions-'));
  try {
    await probeAgentInstructions({ cwd, command: [process.execPath, path.join(REPO, 'packages/core/bin/atlas.mjs')], runtime: 'bun' });
  } finally { await rm(cwd, { recursive: true, force: true }); }
}, 30_000);
