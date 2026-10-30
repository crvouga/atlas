import { describe, expect, test } from 'bun:test';

import type { LayerEvidence } from '../src/evidence-types';
import { uiCatalog } from '../src/ui-catalog';
import { catalogPlanLayers, catalogVersion, CatalogDefinitionError, checkWhere, defineCatalog, expandCatalog, parseWhere, resolveCatalog, uiItemKey, unitMatches } from '../src/ui-catalog-definition';
import { latestUiResults, pickUnits, rankUnits, tierOf, UI_CLAIM_LABEL } from '../src/ui-catalog-queue';
import { uiProfile } from '../src/ui-catalog';

const states = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

/** A layer as the report holds it: a header and rows of one kind. */
function layer(input: { id: string; kind?: string; producer?: string; at: number; environment?: string | null; parameters?: Record<string, string>; rows: { id: string; status: 'passed' | 'failed' | 'running' | 'not-run'; claim?: string }[] }): LayerEvidence {
  return {
    id: input.id, fingerprints: {},
    layer: { id: input.id, backend: 'data', producer: input.producer ?? 'capture', packageDir: null, recordedAtMs: input.at, sha: null, branch: null, environment: input.environment ?? null, runUrl: null, parameters: input.parameters ?? {}, bundle: null } as unknown as LayerEvidence['layer'],
    rows: input.rows.map(row => ({
      kind: input.kind ?? 'ui-state', id: row.id, title: row.id, status: row.status, specPath: null, detail: '', measurements: [], testId: null, variant: {}, durationMs: null,
      ...(row.claim ? { evidence: { labels: { [UI_CLAIM_LABEL]: row.claim } } as never } : {})
    }))
  };
}

describe('the definition and its matrix', () => {
  test('1: three dimensions of two values give eight profiles, with environment and parameters from the profile functions and every value a parameter', async () => {
    const { document, version } = await resolveCatalog(defineCatalog({
      name: 'web',
      matrix: { dimensions: {
        device: { values: ['mobile', 'desktop'], profile: device => ({ environment: `${device}-web`, viewport: device === 'mobile' ? '390x844' : '1440x1000' }) },
        scheme: { values: ['light', 'dark'] },
        deployment: { values: async () => ['development', 'production'] }
      } },
      states
    }));
    const expanded = expandCatalog(document, version);
    expect(expanded.profiles).toHaveLength(8);
    expect(expanded.items).toHaveLength(24);
    const mobileDark = expanded.profiles.find(profile => profile.values.device === 'mobile' && profile.values.scheme === 'dark' && profile.values.deployment === 'production')!;
    expect(mobileDark.environment).toBe('mobile-web');
    expect(mobileDark.parameters).toEqual({ device: 'mobile', scheme: 'dark', deployment: 'production', viewport: '390x844' });
    expect(mobileDark.key).toBe(uiProfile({ environment: 'mobile-web', parameters: mobileDark.parameters }).key);
    // 6: the async values were resolved once and recorded.
    expect(document.dimensions.find(item => item.name === 'deployment')!.values.map(item => item.value)).toEqual(['development', 'production']);
  });

  test('1: the plan layers make the catalog expect every state in every profile', async () => {
    const { document, version } = await resolveCatalog({ name: 'web', matrix: { dimensions: { device: { values: ['mobile', 'desktop'] }, scheme: { values: ['light', 'dark'] }, tenant: { values: ['a', 'b'] } } }, states });
    const plans = catalogPlanLayers(expandCatalog(document, version), 10);
    expect(plans).toHaveLength(8);
    const layers = plans.map((plan, i) => layer({ id: `p${i}`, kind: 'ui-plan', producer: plan.producer, at: 10, environment: plan.environment ?? null, parameters: plan.parameters as Record<string, string>, rows: plan.checks.map(check => ({ id: check.id, status: 'not-run' as const })) }));
    const catalog = uiCatalog(layers);
    expect(catalog.summary).toMatchObject({ states: 3, profiles: 8, cells: 24, planned: true });
    expect(catalog.summary.coverage.missing).toBe(24);
    expect(plans[0]!.producer).toBe('ui-catalog:web');
  });

  test('2: dimension names Atlas has never seen behave like any others', async () => {
    const { document, version } = await resolveCatalog({ name: 'x', matrix: { dimensions: { tenant: { values: ['a', 'b'] }, role: { values: ['admin', 'viewer'] } } }, states: [{ id: 'home' }] });
    const expanded = expandCatalog(document, version);
    expect(expanded.profiles.map(profile => profile.values)).toEqual([{ tenant: 'a', role: 'admin' }, { tenant: 'a', role: 'viewer' }, { tenant: 'b', role: 'admin' }, { tenant: 'b', role: 'viewer' }]);
    expect(expanded.profiles[0]!.environment).toBeNull();
  });

  test('3: an excluded combination is not expected', async () => {
    const { document, version } = await resolveCatalog({ name: 'x', matrix: { dimensions: { device: { values: ['mobile', 'desktop'] }, scheme: { values: ['light', 'dark'] } }, exclude: [{ device: 'desktop', scheme: 'dark' }] }, states });
    const expanded = expandCatalog(document, version);
    expect(expanded.profiles).toHaveLength(3);
    expect(expanded.profiles.some(profile => profile.values.device === 'desktop' && profile.values.scheme === 'dark')).toBe(false);
  });

  test('4: an exclusion or a where naming an unknown dimension or value is refused, listing what is declared', async () => {
    const matrix = { dimensions: { device: { values: ['mobile', 'desktop'] } } };
    await expect(resolveCatalog({ name: 'x', matrix: { ...matrix, exclude: [{ colour: 'red' }] }, states })).rejects.toThrow(/dimension "colour".*Dimensions: "device"/);
    await expect(resolveCatalog({ name: 'x', matrix: { ...matrix, exclude: [{ device: 'tablet' }] }, states })).rejects.toThrow(/device="tablet".*"mobile", "desktop"/);
    const { document } = await resolveCatalog({ name: 'x', matrix, states });
    expect(() => checkWhere(document, parseWhere(['device=tablet']))).toThrow(CatalogDefinitionError);
    expect(() => checkWhere(document, parseWhere(['scheme=dark']))).toThrow(/dimension "scheme".*"device"/);
    expect(() => parseWhere(['device'])).toThrow(/dimension=value/);
    expect(() => checkWhere(document, parseWhere(['device=mobile', 'device=desktop']))).not.toThrow();
  });

  test('5: two dimensions that set the environment for one profile are refused with both values named; differing parameters too', async () => {
    await expect(resolveCatalog({ name: 'x', matrix: { dimensions: {
      device: { values: ['mobile'], profile: () => ({ environment: 'mobile-web' }) },
      platform: { values: ['ios'], profile: () => ({ environment: 'ios' }) }
    } }, states })).rejects.toThrow(/device="mobile" \(environment "mobile-web"\).*platform="ios" \(environment "ios"\)/);
    await expect(resolveCatalog({ name: 'x', matrix: { dimensions: {
      device: { values: ['mobile'], profile: () => ({ viewport: '390x844' }) },
      orientation: { values: ['landscape'], profile: () => ({ viewport: '844x390' }) }
    } }, states })).rejects.toThrow(/parameter "viewport"/);
    // An exclusion resolves the conflict: the combination is never a profile.
    await expect(resolveCatalog({ name: 'x', matrix: { dimensions: {
      device: { values: ['mobile', 'desktop'], profile: device => (device === 'mobile' ? { environment: 'mobile-web' } : {}) },
      platform: { values: ['ios', 'web'], profile: platform => (platform === 'ios' ? { environment: 'ios' } : {}) }
    }, exclude: [{ device: 'mobile', platform: 'ios' }] }, states })).resolves.toBeDefined();
  });

  test('7: a new value adds profiles and a new version; the old profiles keep their keys', async () => {
    const before = await resolveCatalog({ name: 'x', matrix: { dimensions: { device: { values: ['mobile', 'desktop'] } } }, states });
    const after = await resolveCatalog({ name: 'x', matrix: { dimensions: { device: { values: ['mobile', 'desktop', 'tablet'] } } }, states });
    expect(after.version).not.toBe(before.version);
    const keys = (resolved: typeof before) => expandCatalog(resolved.document, resolved.version).items.map(item => item.key);
    expect(keys(after)).toEqual(expect.arrayContaining(keys(before)));
    expect(keys(after)).toHaveLength(9);
  });

  test('9: the same definition resolved twice is the same version, whatever the key order', async () => {
    const one = await resolveCatalog({ name: 'x', matrix: { dimensions: { device: { values: ['mobile'], profile: () => ({ environment: 'm', viewport: '1' }) } } }, states: [{ id: 'a', route: '/a', area: 'x' }] });
    const two = await resolveCatalog({ name: 'x', matrix: { dimensions: { device: { values: ['mobile'], profile: () => ({ viewport: '1', environment: 'm' }) } } }, states: [{ area: 'x', route: '/a', id: 'a' }] });
    expect(two.version).toBe(one.version);
    expect(await catalogVersion(one.document)).toBe(one.version);
    expect(one.version).toMatch(/^[a-f0-9]{64}$/);
  });

  test('a repeated state, a repeated value and a definition without a name are refused', async () => {
    await expect(resolveCatalog({ name: 'x', states: [{ id: 'a' }, { id: 'a' }] })).rejects.toThrow(/"a" appears twice/);
    await expect(resolveCatalog({ name: 'x', matrix: { dimensions: { d: { values: ['v', 'v'] } } }, states })).rejects.toThrow(/lists "v" twice/);
    expect(() => defineCatalog({ name: '', states })).toThrow(/needs a name/);
  });

  test('groups: items a collector captures together are one unit, and where matches a unit only when every item matches', async () => {
    const { document, version } = await resolveCatalog({
      name: 'x', matrix: { dimensions: { device: { values: ['mobile', 'desktop'] }, scheme: { values: ['light', 'dark'] } } }, states: [{ id: 'a' }],
      group: item => `${item.state.id}|${item.profile.device}`
    });
    const expanded = expandCatalog(document, version);
    expect(expanded.units.map(unit => [unit.key, unit.items.length])).toEqual([['a|desktop', 2], ['a|mobile', 2]]);
    expect(unitMatches(expanded, expanded.units[1]!, { device: ['mobile'] })).toBe(true);
    expect(unitMatches(expanded, expanded.units[1]!, { scheme: ['dark'] })).toBe(false);
  });
});

describe('the priority order', () => {
  async function setup() {
    const { document, version } = await resolveCatalog({ name: 'x', states: [{ id: 'empty-1' }, { id: 'empty-2' }, { id: 'failed-1' }, { id: 'failed-2' }, { id: 'old' }, { id: 'older' }, { id: 'new' }, { id: 'skipped' }] });
    return expandCatalog(document, version);
  }
  const results = latestUiResults([
    layer({ id: 'l1', at: 100, rows: [{ id: 'failed-2', status: 'passed' }, { id: 'older', status: 'passed' }] }),
    layer({ id: 'l2', at: 200, rows: [{ id: 'failed-2', status: 'failed' }, { id: 'failed-1', status: 'failed' }, { id: 'old', status: 'passed' }, { id: 'skipped', status: 'not-run' }] }),
    layer({ id: 'l3', at: 300, rows: [{ id: 'new', status: 'passed' }] })
  ]);

  test('10: failed units first, then empty ones, then stale ones oldest first; ties by key; fresh units never', async () => {
    const expanded = await setup();
    const ranked = rankUnits(expanded, results);
    const order = pickUnits(expanded, ranked, { batchSize: 100, staleBeforeMs: 250 }).map(entry => [expanded.document.states[expanded.items[expanded.units[entry.unit]!.items[0]!]!.state]!.id, entry.tier]);
    expect(order).toEqual([['failed-1', 'failed'], ['failed-2', 'failed'], ['empty-1', 'empty'], ['empty-2', 'empty'], ['skipped', 'empty'], ['older', 'stale'], ['old', 'stale']]);
    // Without a cutoff nothing captured is due.
    expect(pickUnits(expanded, ranked, { batchSize: 100 }).map(entry => entry.tier)).not.toContain('stale');
    expect(ranked.filter(entry => tierOf(entry, 250) === 'fresh')).toHaveLength(1);
  });

  test('11: a group is as urgent as its most urgent item', async () => {
    const { document, version } = await resolveCatalog({ name: 'x', matrix: { dimensions: { scheme: { values: ['light', 'dark'] }, device: { values: ['m'] } } }, states: [{ id: 'g' }, { id: 'h' }], group: item => item.state.id });
    const expanded = expandCatalog(document, version);
    const key = (id: string, scheme: string) => uiItemKey(id, expanded.profiles.find(profile => profile.values.scheme === scheme)!.key);
    const held = new Map([
      [key('g', 'light'), { status: 'passed' as const, recordedAtMs: 1, layer: 'x', claim: null }],
      [key('g', 'dark'), { status: 'failed' as const, recordedAtMs: 1, layer: 'x', claim: null }],
      [key('h', 'light'), { status: 'passed' as const, recordedAtMs: 1, layer: 'x', claim: null }],
      [key('h', 'dark'), { status: 'passed' as const, recordedAtMs: 1, layer: 'x', claim: null }]
    ]);
    const ranked = rankUnits(expanded, held);
    expect(ranked.map(entry => [expanded.units[entry.unit]!.key, entry.tier])).toEqual([['g', 'failed'], ['h', 'captured']]);
  });

  test('21: while something could not be read, an item without a result is unknown, never empty', async () => {
    const expanded = await setup();
    const ranked = rankUnits(expanded, results, { incomplete: true });
    expect(ranked.filter(entry => entry.tier === 'unknown')).toHaveLength(2);
    expect(ranked.filter(entry => entry.tier === 'empty')).toHaveLength(1); // skipped is recorded, so it is known
  });

  test('an abandoned unit is empty until any of its items records something new', async () => {
    const expanded = await setup();
    const unit = expanded.units.findIndex(item => item.key.includes('"old"'));
    const fingerprint = 'l2';
    expect(rankUnits(expanded, results, { abandoned: new Map([[expanded.units[unit]!.key, fingerprint]]) }).find(entry => entry.unit === unit)!.tier).toBe('empty');
    expect(rankUnits(expanded, results, { abandoned: new Map([[expanded.units[unit]!.key, 'another']]) }).find(entry => entry.unit === unit)!.tier).toBe('captured');
  });

  test('two runs over the same data give the same order', async () => {
    const one = rankUnits(await setup(), results);
    const two = rankUnits(await setup(), latestUiResults([...[
      layer({ id: 'l3', at: 300, rows: [{ id: 'new', status: 'passed' }] }),
      layer({ id: 'l2', at: 200, rows: [{ id: 'failed-2', status: 'failed' }, { id: 'failed-1', status: 'failed' }, { id: 'old', status: 'passed' }, { id: 'skipped', status: 'not-run' }] }),
      layer({ id: 'l1', at: 100, rows: [{ id: 'failed-2', status: 'passed' }, { id: 'older', status: 'passed' }] })
    ]]));
    expect(two).toEqual(one);
  });
});
