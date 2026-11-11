import { describe, expect, test } from 'bun:test';

import { differentRevisions, serverBuild, supportSummary, viewerBuild } from './provenance';

const VIEWER = { version: null, revision: 'aaaa111', builtAt: '2026-11-10T09:00:00.000Z' };
const SERVER = {
  name: 'atlas', version: null, role: 'admin', open: false, ready: true, write: 's3',
  build: { version: null, revision: 'bbbb222', builtAt: '2026-11-09T09:00:00.000Z', imageDigest: `sha256:${'c'.repeat(64)}` },
  backends: [{ id: 's3', label: 's3://private-bucket/prefix at https://minio.internal.example:9000', available: true, write: true }],
  capabilities: { events: true, store: true, catalogIndex: true, removed: false },
  token: 'secret-admin-token-123', projects: ['geviti'], evidence: [{ id: 'checkout/pay', detail: 'card 4242' }]
};

describe('deployment provenance (#86)', () => {
  test('2. a viewer and a server from different builds are each named, not folded into one version', () => {
    const summary = supportSummary(VIEWER, { reachable: true, info: SERVER });
    expect(summary).toContain('Viewer\n  version: unknown\n  revision: aaaa111');
    expect(summary).toContain('Server\n  version: unknown\n  revision: bbbb222');
    expect(summary).toContain('different revisions');
    expect(differentRevisions(VIEWER, serverBuild(SERVER))).toBe(true);
  });

  test('3. an old server without build metadata, and a bundle that recorded none, read as unknown', () => {
    expect(viewerBuild()).toEqual({ version: null, revision: null, builtAt: null });
    expect(serverBuild({ version: '1.20.0' })).toEqual({ version: '1.20.0', revision: null, builtAt: null, imageDigest: null });
    const summary = supportSummary(viewerBuild(), { reachable: true, info: { version: null } });
    expect(summary).toContain('revision: unknown');
    expect(summary).toContain('capabilities: unknown');
    // Unknown on either side is not a difference.
    expect(differentRevisions(viewerBuild(), serverBuild(SERVER))).toBe(false);
  });

  test('4. the support summary carries no credentials, storage configuration or project evidence', () => {
    const summary = supportSummary(VIEWER, { reachable: true, info: SERVER as never }, 'Mozilla/5.0 test');
    for (const secret of ['secret-admin-token', 'private-bucket', 'minio.internal', 'geviti', 'checkout/pay', '4242', 's3://', 'removed']) expect(summary).not.toContain(secret);
    expect(summary).toContain('capabilities: catalogIndex, events, store');
    expect(summary).toContain(`image digest: sha256:${'c'.repeat(64)}`);
    expect(summary).toContain('Browser: Mozilla/5.0 test');
    expect(supportSummary(VIEWER, { reachable: false })).toContain('no server');
  });
});
