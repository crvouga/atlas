import { describe, expect, test } from 'bun:test';

import { checkDetailOf, summarizeEvidence } from '../src/evidence-detail';
import { effectiveScope, matchesScope, scopeBadges, scopeCaveats, scopeFacts, scopeKey, scopeTokens, UNKNOWN_SCOPE } from '../src/evidence-scope';
import { parseLayerDocument } from '../../schema/src/layer';
import { publishChecks } from '../src/publish-checks';
import { ReportIndex } from '../src/report-index';
import { catalogModel, historyMarkdown, parseTestQuery, testCatalog } from '../src/test-catalog';
import { memoryStore } from './memory-store';

const bytes = (text: string) => new TextEncoder().encode(text);
const video = (name: string, extra: Record<string, unknown> = {}) => ({ name, contentType: 'video/webm', data: bytes(name), ...extra });

const browserClip = { surface: 'browser', syntheticData: true, dependencies: 'scripted', audioCaptured: false, pacing: 'paced', asserted: ['the receipt is shown'], limitations: ['No sound; replies are scripted'] };
const simulator = { surface: 'native-app', deviceKind: 'simulator', syntheticData: true, audioCaptured: false };
const phone = { surface: 'native-app', deviceKind: 'physical', syntheticData: true, audioCaptured: true, verified: ['deviceKind'], verifiedBy: 'device farm log', provenance: [{ url: 'https://farm.example/session/1', name: 'Device session' }] };

describe('what a scope states', () => {
  test('a silent, paced, scripted browser recording says so before it is played and claims nothing more', () => {
    const texts = scopeBadges(browserClip).map(badge => badge.text);
    expect(texts).toEqual(['Surface: Browser', 'Synthetic data', 'Scripted dependencies', 'Silent', 'Paced']);
    const caveats = scopeCaveats(browserClip).join('\n');
    expect(caveats).toContain('Only these were asserted: the receipt is shown');
    expect(caveats).toContain('not verified');
    expect(caveats).toContain('Silent: nothing audible was recorded');
    expect(caveats).toContain('The kind of device is not declared');
    expect(caveats).toContain('No sound; replies are scripted');
    expect(texts.some(text => /live|physical|audible|end.to.end/i.test(text))).toBe(false);
  });

  test('a missing scope, and a scope that says nothing readable, is unknown and never live, physical or end to end', () => {
    for (const scope of [undefined, {}, { limitations: ['only a note'] }]) {
      expect(scopeTokens(scope)).toEqual([UNKNOWN_SCOPE]);
      expect(scopeBadges(scope).map(badge => badge.text)).toEqual(['Scope unknown']);
    }
    expect(scopeCaveats(undefined)[0]).toContain('do not assume');
    expect(scopeFacts(undefined).every(fact => fact.basis === 'undeclared' && fact.value === 'Not declared')).toBe(true);
  });

  test('a declaration is told from an independently checked fact', () => {
    const facts = Object.fromEntries(scopeFacts(phone).map(fact => [fact.dimension, fact.basis]));
    expect(facts).toEqual({ surface: 'declared', deviceKind: 'verified', syntheticData: 'declared', dependencies: 'undeclared', audioCaptured: 'declared', pacing: 'undeclared' });
    // Naming a field that has no value verifies nothing.
    expect(scopeFacts({ verified: ['pacing'] }).find(fact => fact.dimension === 'pacing')!.basis).toBe('undeclared');
  });

  test('a simulator and a physical phone stay distinct tokens', () => {
    expect(scopeTokens(simulator)).toContain('device:simulator');
    expect(scopeTokens(phone)).toContain('device:physical');
    expect(matchesScope(scopeTokens(simulator), ['device:physical'])).toBe(false);
    expect(matchesScope(scopeTokens(phone), ['Device:Physical', 'audio:recorded'])).toBe(true);
    expect(matchesScope(scopeTokens(simulator), ['device:simulator', 'audio:recorded'])).toBe(false);
    expect(matchesScope([UNKNOWN_SCOPE], ['audio:recorded'])).toBe(false);
    expect(matchesScope([UNKNOWN_SCOPE], [UNKNOWN_SCOPE])).toBe(true);
  });

  test('the nearest declaration wins as a whole, and equal declarations have one key however their keys are ordered', () => {
    expect(effectiveScope(undefined, simulator, phone)).toBe(simulator);
    expect(effectiveScope(undefined, undefined)).toBeUndefined();
    expect(scopeKey({ surface: 'a', pacing: 'b' })).toBe(scopeKey({ pacing: 'b', surface: 'a' }));
    expect(scopeKey(undefined)).toBe(UNKNOWN_SCOPE);
  });
});

describe('where a recording takes its scope from', () => {
  test('its own, else its try, check, part and layer in that order, never mixing two declarations', () => {
    const summary = summarizeEvidence({
      scope: { deviceKind: 'check' },
      attachments: [{ name: 'own.webm', scope: { deviceKind: 'own' } }, { name: 'plain.webm' }],
      attempts: [
        { index: 0, status: 'failed', scope: { deviceKind: 'try' }, attachments: [{ name: 'try.webm' }], steps: [{ name: 'Pay', attachments: [{ name: 'step.webm' }] }] },
        { index: 1, status: 'passed', attachments: [{ name: 'second.webm' }] },
      ],
    });
    expect(summary!.videos!.map(item => [item.name, item.scope?.deviceKind])).toEqual([
      ['own.webm', 'own'], ['plain.webm', 'check'], ['try.webm', 'try'], ['step.webm', 'try'], ['second.webm', 'check'],
    ]);
    const bare = summarizeEvidence({ attachments: [{ name: 'a.webm' }] });
    expect(bare!.videos![0]!.scope).toBeUndefined();
  });
});

const modelOf = (index: ReportIndex) => catalogModel(index.snapshot().layers, { history: index.history, version: 'v', now: 20 });

describe('through a published layer', () => {
  async function published() {
    const store = memoryStore();
    const base = { producer: 'mobile', environment: 'ios', runUrl: 'https://ci.example/runs/1', recordedAtMs: 1_000 };
    const layer = await publishChecks(store, {
      ...base, scope: { surface: 'native-app', limitations: ['run-wide note'] },
      checks: [
        { id: 'sim', title: 'On a simulator', status: 'passed', attachments: [video('sim.webm', { scope: simulator })] },
        { id: 'phone', title: 'On a phone', status: 'passed', attachments: [video('phone.webm', { scope: phone })] },
        { id: 'plain', title: 'No claim', status: 'passed', attachments: [video('plain.webm')] },
        { id: 'checkwide', title: 'Check wide', status: 'passed', scope: { deviceKind: 'emulator', audioCaptured: false }, attachments: [video('wide.webm')] },
        {
          id: 'retried', title: 'Retried', status: 'passed',
          attempts: [
            { index: 0, status: 'failed', attachments: [video('first.webm', { scope: simulator })] },
            { index: 1, status: 'passed', attachments: [video('second.webm', { scope: phone })] },
          ],
        },
        { id: 'photo', title: 'Screenshot only', status: 'passed', attachments: [{ name: 'a.png', contentType: 'image/png', data: bytes('png'), scope: phone }] },
      ],
    });
    const index = new ReportIndex([{ id: 'one', store }]);
    await index.refresh();
    return { index, store, layer, catalog: () => modelOf(index) };
  }
  const ids = (catalog: ReturnType<typeof testCatalog>) => catalog.tests.map(test => test.id).sort();

  test('a producer can declare scope at every level and the stored layer keeps it', async () => {
    const { layer } = await published();
    expect(layer.scope?.surface).toBe('native-app');
    expect(layer.parts[0]!.checks.find(check => check.id === 'sim')!.attachments![0]!.scope?.deviceKind).toBe('simulator');
    expect(layer.parts[0]!.checks.find(check => check.id === 'checkwide')!.scope?.deviceKind).toBe('emulator');
  });

  test('the catalog narrows to physical, audible evidence without including unknown or simulated recordings', async () => {
    const { catalog } = await published();
    const model = catalog();
    expect(ids(testCatalog(model))).toHaveLength(6);
    expect(ids(testCatalog(model, { scope: ['device:physical'] }))).toEqual(['phone', 'retried']);
    expect(ids(testCatalog(model, { scope: ['device:simulator'] }))).toEqual(['retried', 'sim']);
    expect(ids(testCatalog(model, { scope: ['device:physical', 'audio:recorded'] }))).toEqual(['phone', 'retried']);
    // One recording must satisfy every token: the retried check has a silent simulator clip and an audible phone clip, never an audible simulator.
    expect(ids(testCatalog(model, { scope: ['device:simulator', 'audio:recorded'] }))).toEqual([]);
    expect(ids(testCatalog(model, { scope: ['audio:recorded'] }))).toEqual(['phone', 'retried']);
    // A recording that declared nothing about audio is not silent and not audible; a screenshot is not a recording.
    expect(ids(testCatalog(model, { scope: ['audio:silent'] }))).toEqual(['checkwide', 'retried', 'sim']);
    expect(ids(testCatalog(model, { scope: ['unknown'] }))).toEqual([]);
  });

  test('a recording under a run-wide scope is not unknown, one with no declaration anywhere is', async () => {
    const { catalog } = await published();
    const model = catalog();
    const plain = model.tests.find(test => test.id === 'plain')!;
    expect(plain.scopeProfiles).toEqual([['surface:native-app']]);
    const { store } = await published();
    await publishChecks(store, { producer: 'web', environment: 'desktop-web', runUrl: 'https://ci.example/runs/2', recordedAtMs: 2_000, checks: [{ id: 'bare', title: 'Bare', status: 'passed', attachments: [video('bare.webm')] }] });
    const next = new ReportIndex([{ id: 'one', store }]);
    await next.refresh();
    expect(ids(testCatalog(modelOf(next), { scope: ['unknown'] }))).toEqual(['bare']);
    expect(ids(testCatalog(modelOf(next), { scope: ['surface:native-app'] }))).not.toContain('bare');
  });

  test('conflicting qualifications across tries each stay with their own recording', async () => {
    const { catalog } = await published();
    const retried = catalog().tests.find(test => test.id === 'retried')!;
    const videos = retried.outcomes[0]!.evidence!.videos!;
    expect(videos.map(item => [item.name, item.attempt, item.scope?.deviceKind])).toEqual([['first.webm', 0, 'simulator'], ['second.webm', 1, 'physical']]);
  });

  test('the facets count the tokens, the history names them, and the query reads from an address', async () => {
    const { catalog: model } = await published();
    const catalog = testCatalog(model());
    const facet = Object.fromEntries(catalog.facets.scopes!.map(item => [item.value, item.count]));
    expect(facet['device:physical']).toBe(2);
    expect(facet['device:simulator']).toBe(2);
    const phoneTest = model().tests.find(test => test.id === 'phone')!;
    expect(historyMarkdown({ schemaVersion: 1, version: 'v', test: phoneTest, history: phoneTest.outcomes })).toContain('Recording scope: ');
    expect(parseTestQuery(new URLSearchParams('scope=device:physical,audio:recorded&scope=data:synthetic')).scope).toEqual(['device:physical', 'audio:recorded', 'data:synthetic']);
    // Search finds a test by what its recording declares.
    expect(ids(testCatalog(model(), { q: 'physical' }))).toEqual(['phone', 'retried']);
  });

  test('a check detail carries the scope it inherits from its part or layer', async () => {
    const { layer } = await published();
    const detail = checkDetailOf(layer as never, 'plain')!;
    expect(detail.inheritedScope?.surface).toBe('native-app');
    expect((detail.run as { scope?: { surface?: string } }).scope?.surface).toBe('native-app');
  });
});

describe('older and malformed metadata', () => {
  const layer = (scope: unknown) => ({
    schemaVersion: 1, id: 'a'.repeat(64), producer: 'p', recordedAtMs: 1, sha: null, branch: null, runUrl: null,
    parts: [{ id: 'p', kind: 'checks', title: 't', recordedAtMs: 1, sha: '', checks: [{ id: 'c', title: 'C', status: 'passed', attachments: [{ name: 'a.webm', scope }], scope }] }],
    scope
  });

  test('a layer without a scope still reads, and its scope is unknown', () => {
    const parsed = parseLayerDocument(layer(undefined));
    expect(parsed.ok).toBe(true);
  });

  test('a scope that cannot be read is dropped and the result and its file are kept', () => {
    const parsed = parseLayerDocument(layer({ deviceKind: 7, audioCaptured: 'yes' }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const check = parsed.layer.parts[0]!.checks[0]!;
    expect(check.status).toBe('passed');
    expect(check.scope).toBeUndefined();
    expect(check.attachments![0]!.name).toBe('a.webm');
    expect(check.attachments![0]!.scope).toBeUndefined();
    expect(parsed.layer.scope).toBeUndefined();
  });

  test('a scope from the future keeps the fields this reader does not know', () => {
    const parsed = parseLayerDocument(layer({ deviceKind: 'physical', futureField: { nested: true } }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect((parsed.layer.parts[0]!.checks[0]!.scope as Record<string, unknown>).futureField).toEqual({ nested: true });
  });

  test('a scope never changes a status', async () => {
    const store = memoryStore();
    const shared = { producer: 'p', environment: 'web', recordedAtMs: 1 };
    await publishChecks(store, { ...shared, checks: [{ id: 'c', title: 'C', status: 'failed', scope: phone }] });
    const index = new ReportIndex([{ id: 'one', store }]);
    await index.refresh();
    expect(modelOf(index).tests[0]!.status).toBe('failed');
  });
});
