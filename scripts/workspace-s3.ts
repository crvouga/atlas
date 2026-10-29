/** @module Workspace S3 emulator
 * Development-only S3 endpoint owned by the workspace runner, never an Atlas storage fallback.
 */
import { signRequest, sha256Hex, amzDate } from '../packages/reports/src/sigv4';

/** Start an isolated, ephemeral Mockingbird bucket unless any S3 configuration was supplied.
 * Partial external configuration is preserved so the server reports missing or invalid values.
 * Throws on emulator or bucket creation failure; the caller must stop the returned server on teardown.
 */
export async function workspaceStorage(env: NodeJS.ProcessEnv) {
  if (Object.keys(env).some((key) => key.startsWith('ATLAS_S3_') && env[key] !== undefined))
    return { env, url: undefined, stop: async () => {} };
  const { createRuntime } = await import('@crvouga/mockingbird-service-s3');
  const credentials = { accessKeyId: 'fixture', secretAccessKey: 'fixture' };
  const emulator = createRuntime({ authentication: 'strict', credentials: { fixture: 'fixture' } });
  const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: (request) => emulator.fetch(request) });
  const url = `http://127.0.0.1:${server.port}`;
  const bucket = 'atlas-local';
  try {
    const at = new Date();
    const payloadHash = await sha256Hex('');
    const headers = await signRequest({ method: 'PUT', url: new URL(`${url}/${bucket}`),
      headers: { 'x-amz-date': amzDate(at).datetime, 'x-amz-content-sha256': payloadHash },
      payloadHash, credentials, region: 'us-east-1', service: 's3', at });
    const response = await fetch(`${url}/${bucket}`, { method: 'PUT', headers });
    if (!response.ok) throw new Error(`Mockingbird bucket creation failed (${response.status}): ${await response.text()}`);
    await response.body?.cancel();
    return {
      env: { ...env, ATLAS_S3_ENDPOINT: url, ATLAS_S3_BUCKET: bucket, ATLAS_S3_REGION: 'us-east-1',
        ATLAS_S3_ACCESS_KEY_ID: credentials.accessKeyId, ATLAS_S3_SECRET_ACCESS_KEY: credentials.secretAccessKey,
        ATLAS_S3_PATH_STYLE: '1' },
      url,
      stop: async () => { await server.stop(true); }
    };
  } catch (error) {
    await server.stop(true);
    throw error;
  }
}
