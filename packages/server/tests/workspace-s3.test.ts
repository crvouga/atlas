import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { startWorkspaceS3 } from '../../../scripts/workspace-s3';
import { s3Store } from '../../reports/src/s3-store';
import { resolveS3Config } from '../src/storage';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

async function checkout() {
  const root = await mkdtemp(path.join(tmpdir(), 'atlas-workspace-s3-'));
  roots.push(root);
  return root;
}

const store = (env: NodeJS.ProcessEnv) => {
  const config = resolveS3Config(env);
  return s3Store({ endpoint: config.endpoint, bucket: config.bucket, region: config.region,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, retries: 0 });
};

test('Mockingbird speaks signed S3, isolates checkouts and keeps a checkout\'s data across restarts', async () => {
  const [rootOne, rootTwo] = [await checkout(), await checkout()];
  const one = await startWorkspaceS3(rootOne);
  const two = await startWorkspaceS3(rootTwo);
  const bytes = new Uint8Array([0, 255, 42]);
  try {
    const first = store(one.env), second = store(two.env);
    await first.put('reports/example.bin', bytes, 'application/octet-stream');
    const object = await first.get('reports/example.bin');
    expect(object).not.toBeNull();
    expect(new Uint8Array(await new Response(object!.body).arrayBuffer())).toEqual(bytes);
    expect(await first.listKeys('reports/')).toEqual(['reports/example.bin']);
    expect(await second.get('reports/example.bin')).toBeNull();
    // Unsigned requests are refused.
    expect((await fetch(`${one.storage.endpoint}/${one.storage.bucket}/reports/example.bin`)).status).toBe(403);
  } finally {
    await one.close();
    await two.close();
  }
  // Closing never deletes the bucket or its objects.
  const again = await startWorkspaceS3(rootOne);
  try {
    const object = await store(again.env).get('reports/example.bin');
    expect(new Uint8Array(await new Response(object!.body).arrayBuffer())).toEqual(bytes);
  } finally { await again.close(); }
});
