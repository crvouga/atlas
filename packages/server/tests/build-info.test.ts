/**
 * @module Build provenance tests
 *
 * Issue #86: a deployed server says which build it is (`GET /api/server`, `build`) even when it does not know its package
 * version, says `null` (unknown) for what it was not told instead of guessing, and keeps every field older clients read.
 */
import { describe, expect, test } from 'bun:test';

import { memoryStore } from '../../reports/tests/memory-store';
import { ServerInfoSchema } from '../../schema/src/api';
import { createAtlasServer } from '../src/app';
import { buildInfo, cleanBuildTime, cleanImageDigest, cleanRevision, installedPackageVersion } from '../src/build-info';
import { loadServerConfig } from '../src/config';
import { openConfiguredBackends, serverOptionsOf } from '../src/main';
import { S3_TEST_ENV } from './fake-s3';

const SHA = '8a5f0907f2c1d4e5b6a7980a1b2c3d4e5f607182';
const DIGEST = `ghcr.io/crvouga/atlas@sha256:${'ab'.repeat(32)}`;

async function serverInfo(options: Parameters<typeof createAtlasServer>[0]) {
  const server = createAtlasServer(options);
  await server.ready;
  try {
    return await (await server.fetch(new Request('http://atlas.test/api/server'))).json() as Record<string, unknown>;
  } finally {
    server.close();
  }
}

describe('build provenance', () => {
  test('1. an image built from a known commit names its revision on /api/server even though its package version is unknown', async () => {
    const config = loadServerConfig([], { ...S3_TEST_ENV, ATLAS_REVISION: SHA, ATLAS_BUILD_TIME: '2026-11-10T09:30:00Z' }, '/work', () => '{}');
    const options = serverOptionsOf({ ...config, build: { ...config.build, version: null } }, openConfiguredBackends(config));
    const info = await serverInfo({ ...options, backends: [{ id: 's3', store: memoryStore() }] });
    expect(info.version).toBeNull();
    expect(info.build).toEqual({ version: null, revision: SHA, builtAt: '2026-11-10T09:30:00.000Z', imageDigest: null });
    expect(ServerInfoSchema.safeParse(info).success).toBe(true);
  });

  test('a digest is reported only when the deployment injects one, and the package version when the package knows it', async () => {
    const info = await serverInfo({ backends: [{ id: 'data', store: memoryStore() }], write: 'data', version: '1.25.0', build: buildInfo({ ATLAS_IMAGE_DIGEST: DIGEST }, '1.25.0') });
    expect(info.version).toBe('1.25.0');
    expect(info.build).toEqual({ version: '1.25.0', revision: null, builtAt: null, imageDigest: DIGEST });
  });

  test('3. a build that recorded nothing says unknown (null) for every field, and keeps every field older clients read', async () => {
    const info = await serverInfo({ backends: [{ id: 'data', store: memoryStore() }], write: 'data' });
    expect(info.build).toEqual({ version: null, revision: null, builtAt: null, imageDigest: null });
    for (const field of ['name', 'version', 'role', 'open', 'write', 'ready', 'viewers', 'time', 'backends', 'layers', 'slots', 'capabilities']) expect(info).toHaveProperty(field);
    // A reader written before `build` existed still reads the answer, and one reading an older server's answer finds it optional.
    const { build: _build, ...older } = info;
    expect(ServerInfoSchema.safeParse(older).success).toBe(true);
  });

  test('placeholders and malformed values are unknown, never guessed', () => {
    expect(cleanRevision('unknown')).toBeNull();
    expect(cleanRevision('')).toBeNull();
    expect(cleanRevision('abc 123')).toBeNull();
    expect(cleanRevision(` ${SHA} `)).toBe(SHA);
    expect(cleanBuildTime('yesterday')).toBeNull();
    expect(cleanBuildTime('1762767000')).toBe('2025-11-10T09:30:00.000Z');
    expect(cleanImageDigest('latest')).toBeNull();
    expect(cleanImageDigest(`sha256:${'0'.repeat(63)}`)).toBeNull();
    expect(cleanImageDigest(DIGEST)).toBe(DIGEST);
    // This checkout's package.json holds the release placeholder, which means unknown.
    expect(installedPackageVersion()).toBeNull();
    expect(installedPackageVersion(() => JSON.stringify({ name: '@crvouga/atlas', version: '1.25.0' }))).toBe('1.25.0');
    expect(installedPackageVersion(() => JSON.stringify({ name: 'something-else', version: '1.25.0' }))).toBeNull();
    expect(installedPackageVersion(() => { throw new Error('missing'); })).toBeNull();
  });
});
