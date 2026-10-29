import { expect, test } from 'bun:test';
import { workspaceStorage } from '../../../scripts/workspace-s3';
import { s3Store } from '../../reports/src/s3-store';
import { resolveS3Config } from '../src/storage';

test('Mockingbird speaks signed S3, isolates buckets and starts empty after teardown', async () => {
  const one = await workspaceStorage({});
  const two = await workspaceStorage({});
  const store = (env: NodeJS.ProcessEnv) => {
    const config = resolveS3Config(env);
    return s3Store({ endpoint: config.endpoint, bucket: config.bucket, region: config.region,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, retries: 0 });
  };
  try {
    const first = store(one.env), second = store(two.env);
    const bytes = new Uint8Array([0, 255, 42]);
    await first.put('reports/example.bin', bytes, 'application/octet-stream');
    const object = await first.get('reports/example.bin');
    expect(object).not.toBeNull();
    expect(new Uint8Array(await new Response(object!.body).arrayBuffer())).toEqual(bytes);
    expect(await first.listKeys('reports/')).toEqual(['reports/example.bin']);
    expect(await second.get('reports/example.bin')).toBeNull();
    expect((await fetch(`${one.url}/atlas-local/reports/example.bin`)).status).toBe(403);
    await first.delete('reports/example.bin');
    expect(await first.get('reports/example.bin')).toBeNull();
  } finally {
    await one.stop();
    await two.stop();
  }
  const fresh = await workspaceStorage({});
  try { expect(await store(fresh.env).listKeys()).toEqual([]); }
  finally { await fresh.stop(); }
});

test('external S3, including partial and empty configuration, is never replaced', async () => {
  for (const env of [{ ATLAS_S3_ENDPOINT: 'http://custom.test' }, { ATLAS_S3_BUCKET: '' }, { ATLAS_S3_PREFIX: 'custom' }]) {
    const storage = await workspaceStorage(env);
    expect(storage.env).toBe(env);
    expect(storage.url).toBeUndefined();
    expect(() => resolveS3Config(storage.env)).toThrow();
    await storage.stop();
  }
});
