/** @module Quickstart documentation exercised against the real CLI. */
import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { REPO } from './coverage';
import { probeQuickstart } from './quickstart-smoke';

test('the literal local quickstart proves publish, idempotency, failure exit 1 and recovery', async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), 'atlas-quickstart-'));
  try {
    await probeQuickstart({ guide: path.join(REPO, 'docs/quickstart.md'), command: [process.execPath, path.join(REPO, 'packages/core/bin/atlas.mjs')], cwd });
    expect(await Bun.file(path.join(cwd, 'package.json')).exists()).toBe(false);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}, 30_000);
