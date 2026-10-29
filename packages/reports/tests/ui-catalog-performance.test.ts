import { describe, expect, test } from 'bun:test';

import type { LayerEvidence } from '../src/evidence-types';
import { publishChecks } from '../src/publish-checks';
import { ReportIndex } from '../src/report-index';
import { filterUiCatalog, pageUiCatalog, uiCatalog } from '../src/ui-catalog';
import { catalogEntries } from '../src/ui-catalog-entries';
import { uiPlanLayer, uiStateLayer } from '../src/ui-catalog-publish';
import { memoryStore } from './memory-store';

const PROFILES = [
  { environment: 'desktop-web', profile: { viewport: '1280x800', scheme: 'light' } },
  { environment: 'mobile-web', profile: { viewport: '390x844', scheme: 'dark' } }
] as const;

/** `states` states in two profiles, captured by `shards` collectors that know nothing of each other, with a plan. */
async function layersOf(states: number, shards = 8): Promise<readonly LayerEvidence[]> {
  const store = memoryStore();
  for (const where of PROFILES) {
    await publishChecks(store, uiPlanLayer({ producer: 'plan', recordedAtMs: 1, ...where, states: Array.from({ length: states }, (_, n) => ({ id: `area${n % 30}/screen${n}`, covers: [`surface${n % 100}`] })) }));
    for (let shard = 0; shard < shards; shard++) {
      const captured = [];
      for (let n = shard; n < states; n += shards) captured.push({ id: `area${n % 30}/screen${n}`, route: `/${n}`, area: `area${n % 30}`, flags: [`flag${n % 4}`], covers: [`surface${n % 100}`], attributes: { locale: n % 2 ? 'en' : 'de' }, screenshot: { data: new TextEncoder().encode(`${n}:${where.environment}`), width: 10, height: 10 } });
      await publishChecks(store, uiStateLayer({ producer: `capture-${shard}`, recordedAtMs: 10 + shard, ...where, shard: `${shard + 1}/${shards}`, states: captured }));
    }
  }
  const index = new ReportIndex([{ id: 'a', store }]);
  await index.refresh();
  return index.snapshot().layers;
}

/** The least CPU time of a few runs, which is what the code costs and not what else the machine was doing. */
function cost(run: () => unknown, runs = 9): number {
  let best = Infinity;
  for (let i = 0; i < runs; i++) {
    const before = process.cpuUsage();
    run();
    const used = process.cpuUsage(before);
    best = Math.min(best, (used.user + used.system) / 1000);
  }
  return best;
}

describe('the catalog grows in step with what it holds', () => {
  test('eight times the states cost about eight times as much, never sixty-four: building, filtering, paging and listing entries', async () => {
    const small = await layersOf(250), large = await layersOf(2000);
    const smallCatalog = uiCatalog(small), largeCatalog = uiCatalog(large);
    expect(largeCatalog.summary.cells).toBe(4000);
    // Linear is 8 and quadratic is 64; the bound is far from both, so a busy machine does not fail it and a quadratic step cannot pass.
    const ratio = (a: () => unknown, b: () => unknown) => cost(b) / Math.max(cost(a), 0.05);
    expect(ratio(() => uiCatalog(small), () => uiCatalog(large))).toBeLessThan(24);
    expect(ratio(() => catalogEntries(small), () => catalogEntries(large))).toBeLessThan(24);
    // One filter takes well under a millisecond, too little to time alone.
    const filtered = (catalog: typeof smallCatalog) => () => { for (let i = 0; i < 40; i++) filterUiCatalog(catalog, { q: 'screen4', attribute: ['locale=en'] }); };
    expect(ratio(filtered(smallCatalog), filtered(largeCatalog))).toBeLessThan(24);
  });

  test('a page of the catalog holds only the page, whatever the catalog holds', async () => {
    const catalog = uiCatalog(await layersOf(1000));
    const page = pageUiCatalog(catalog, { limit: 20 });
    expect(page.states).toHaveLength(20);
    expect(page.total).toBe(1000);
    // The page is a few kilobytes per state, and the whole catalog never has to be sent to look at it.
    expect(JSON.stringify(page).length).toBeLessThan(JSON.stringify(catalog).length / 20);
  });

  test('the same layers in another order give the same catalog, at a size where a shortcut would show', async () => {
    const layers = await layersOf(600);
    const a = JSON.stringify(uiCatalog(layers)), b = JSON.stringify(uiCatalog([...layers].reverse()));
    expect(b).toBe(a);
  });
});
