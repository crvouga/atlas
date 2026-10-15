import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runConfig } from '@crvouga/atlas';
import { expect, it } from 'bun:test';

import config from './atlas.config';

// Requires Chromium: ATLAS_TEST_BROWSER=1 bun test examples/todo/atlas.config.test.ts
it.skipIf(!process.env.ATLAS_TEST_BROWSER)('runs every journey without interference on the shared todo server', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'atlas-todo-browser-'));
  const driver = typeof config.driver === 'function' ? await config.driver() : config.driver;
  try {
    const { manifest, ok } = await runConfig({
      ...config,
      driver: { ...driver, screenshot: undefined },
      stepTimeoutMs: 3_000
    }, { output, workers: 6, retry: false, reporting: false });

    expect(ok).toBe(true);
    expect(manifest.paths).toHaveLength(6);
    expect(manifest.paths.map(({ id, status, attempts }) => ({ id, status, attempts: attempts.length }))).toEqual(
      manifest.paths.map(({ id }) => ({ id, status: 'passed', attempts: 1 }))
    );
  } finally {
    await driver.dispose?.();
    await rm(output, { recursive: true, force: true });
  }
}, 60_000);
