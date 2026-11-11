import { describe, expect, test } from 'bun:test';

import { publishChecks } from '../src/publish-checks';
import { ReportIndex } from '../src/report-index';
import { filterUiCatalog, pageUiCatalog, uiCatalog } from '../src/ui-catalog';
import { redactFailureMessage, uiCatalogFailureGroups, uiCatalogFailuresMarkdown } from '../src/ui-catalog-failures';
import { uiStateLayer, type UiStateCapture } from '../src/ui-catalog-publish';
import { scopeUiCatalog } from '../src/ui-catalog-scope';
import { memoryStore } from './memory-store';
import { migrated } from './ui-catalog-scope-fixture';

const PROFILES = [
  { environment: 'desktop-web', profile: { viewport: '1280x800' } },
  { environment: 'mobile-web', profile: { viewport: '390x844' } }
] as const;

async function catalogOf(layers: { at: number; profile: number; producer?: string; states: UiStateCapture[] }[]) {
  const store = memoryStore();
  for (const layer of layers) {
    const where = PROFILES[layer.profile]!;
    await publishChecks(store, uiStateLayer({ producer: layer.producer ?? 'capture', recordedAtMs: layer.at, environment: where.environment, profile: where.profile, states: layer.states }));
  }
  const index = new ReportIndex([{ id: 'ci', store }]);
  await index.refresh();
  const snapshot = index.snapshot();
  return uiCatalog(snapshot.layers, { backends: snapshot.backends, notices: snapshot.notices });
}

const fail = (id: string, detail: string, labels: Record<string, string> = {}): UiStateCapture => ({ id, title: id, status: 'failed', detail, labels });

describe('#93 failure groups', () => {
  test('1: cells that share an explicit fingerprint are one group that links to every affected cell, with phase, attempts and occurrence', async () => {
    const catalog = await catalogOf([
      { at: 1_000, profile: 0, states: [fail('a', 'Login timed out after 3012ms', { fingerprint: 'auth-timeout', phase: 'navigate', attempts: '2' }), fail('b', 'Login timed out after 2990ms', { fingerprint: 'auth-timeout', phase: 'navigate', attempts: '3' }), { id: 'ok', title: 'ok' }] },
      { at: 2_000, profile: 1, states: [fail('a', 'Login timed out after 3100ms', { fingerprint: 'auth-timeout', phase: 'navigate', attempts: '1' })] }
    ]);
    const failures = uiCatalogFailureGroups(catalog);
    expect(failures.total).toEqual({ failed: 3, groups: 1, fingerprinted: 3, inferred: 0 });
    expect(failures.complete).toBe(true);
    const [group] = failures.groups;
    expect(group).toMatchObject({ basis: 'fingerprint', inferred: false, fingerprint: 'auth-timeout', count: 3, states: 2, profiles: 2, phases: ['navigate'], attempts: { min: 1, max: 3 }, firstRecordedAtMs: 1_000, lastRecordedAtMs: 2_000, sample: 'Login timed out after 3100ms' });
    expect(group!.cells.map(cell => [cell.state, cell.profileLabel])).toEqual([['a', 'Mobile web · 390x844'], ['a', 'Desktop web · 1280x800'], ['b', 'Desktop web · 1280x800']]);
    expect(uiCatalogFailuresMarkdown(failures, { link: cell => `https://atlas.example/#/catalog?state=${cell.state}&image=${encodeURIComponent(cell.profile)}` })).toContain('[a (a, Mobile web · 390x844)](<https://atlas.example/#/catalog?state=a&image=');
  });

  test('2: the same text with different fingerprints stays apart; fingerprints of different producers never merge', async () => {
    const catalog = await catalogOf([
      { at: 1_000, profile: 0, states: [fail('a', 'Element not found', { fingerprint: 'selector-x' }), fail('b', 'Element not found', { fingerprint: 'selector-y' })] },
      { at: 1_000, profile: 1, producer: 'other', states: [fail('a', 'Element not found', { fingerprint: 'selector-x' })] }
    ]);
    const failures = uiCatalogFailureGroups(catalog);
    expect(failures.groups.map(group => [group.fingerprint, group.producers, group.count])).toEqual([['selector-x', ['capture'], 1], ['selector-y', ['capture'], 1], ['selector-x', ['other'], 1]]);
  });

  test('5: without fingerprints, exact normalized messages group and are marked inferred, never a shared cause', async () => {
    const catalog = await catalogOf([
      { at: 1_000, profile: 0, states: [fail('a', 'GET  https://api.example.com/v1/cart?token=abc  failed'), fail('b', 'GET https://api.example.com/v1/cart?session=zzz failed'), fail('c', 'Something else')] }
    ]);
    const failures = uiCatalogFailureGroups(catalog);
    expect(failures.total).toMatchObject({ failed: 3, groups: 2, fingerprinted: 0, inferred: 3 });
    expect(failures.groups[0]).toMatchObject({ basis: 'message', inferred: true, fingerprint: null, count: 2, sample: 'GET https://api.example.com/v1/cart?[redacted] failed' });
    const text = uiCatalogFailuresMarkdown(failures);
    expect(text).toContain('inferred grouping, not a shared cause');
    expect(text).not.toContain('token=abc');
  });

  test('3: the groups and drilldowns are exactly the scope and filters given', async () => {
    const { b, whole } = await migrated();
    const all = uiCatalogFailureGroups(whole);
    expect(all.total.failed).toBe(5); // legacy in A's four profiles, home in one of B's
    const underB = uiCatalogFailureGroups(scopeUiCatalog(whole, { kind: 'definition', version: b.version, document: b.document }));
    expect(underB.total.failed).toBe(1);
    expect(underB.groups[0]!.cells.map(cell => cell.state)).toEqual(['home']);
    expect(underB.scope).toMatchObject({ kind: 'definition', status: 'applied' });
    expect(uiCatalogFailureGroups(filterUiCatalog(whole, { q: 'legacy' })).total.failed).toBe(4);
  });

  test('4: unreadable backends, notices, an unavailable scope, captures in progress and a page are disclosed as incomplete', async () => {
    const { whole } = await migrated();
    const unavailable = uiCatalogFailureGroups({ ...whole, sources: { ...whole.sources, backends: [{ id: 'x', label: 'archive', available: false } as never], notices: ['layer y could not be read'] } });
    expect(unavailable.complete).toBe(false);
    expect(unavailable.incomplete).toEqual(['archive could not be read: failures held there are not counted.', 'layer y could not be read']);
    const page = uiCatalogFailureGroups(pageUiCatalog(whole, { limit: 1 }));
    expect(page.complete).toBe(false);
    expect(page.incomplete.at(-1)).toContain('Only 1 of 4 states');
    const scoped = uiCatalogFailureGroups(scopeUiCatalog(whole, { kind: 'definition', version: 'e'.repeat(64), document: null }));
    expect(scoped.complete).toBe(false);
    expect(scoped.incomplete.some(reason => reason.includes('scope is unavailable'))).toBe(true);
    const running = await catalogOf([{ at: 1, profile: 0, states: [{ id: 'a', title: 'a', status: 'running' }] }]);
    expect(uiCatalogFailureGroups(running).incomplete).toEqual(['1 cell is still being captured and may yet fail.']);
  });

  test('a large catalog lists a bounded number of cells per group and keeps the whole count', async () => {
    const states = Array.from({ length: 500 }, (_, i) => fail(`s${i}`, 'boom', { fingerprint: 'same' }));
    const failures = uiCatalogFailureGroups(await catalogOf([{ at: 1, profile: 0, states }]), { maxCells: 10 });
    expect(failures.groups[0]).toMatchObject({ count: 500, states: 500 });
    expect(failures.groups[0]!.cells).toHaveLength(10);
  });

  test('redaction removes credentials, query strings, long secrets and directories, conservatively', () => {
    expect(redactFailureMessage('Authorization: Bearer abc.def.ghi failed')).toBe('Authorization: Bearer [redacted] failed');
    expect(redactFailureMessage('token=s3cr3t password: hunter2')).toBe('token=[redacted] password: [redacted]');
    expect(redactFailureMessage('at /home/ci/work/app/src/login.ts:12')).toBe('at …/login.ts:12');
    expect(redactFailureMessage('https://user:pw@host.example/path?q=1#x')).toBe('https://host.example/path?[redacted]');
    expect(redactFailureMessage(`id ${'a1'.repeat(20)} gone`)).toBe('id [redacted] gone');
    expect(redactFailureMessage('Element   not\nfound')).toBe('Element not found');
  });
});
