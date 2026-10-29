/**
 * `bun packages/server/bench/ui-catalog-bench.ts [states] [shards]`: how the UI catalog behaves at scale.
 * Not a test (it measures, it asserts nothing) and not shipped. Prints one line per thing measured.
 * States are captured in four profiles, divided among `shards` layers per profile.
 */
import { publishChecks } from '../../reports/src/publish-checks';
import { ReportIndex } from '../../reports/src/report-index';
import { catalogEntries } from '../../reports/src/ui-catalog-entries';
import { filterUiCatalog, pageUiCatalog, uiCatalog, uiCatalogMarkdown } from '../../reports/src/ui-catalog';
import { uiPlanLayer, uiStateLayer } from '../../reports/src/ui-catalog-publish';
import { memoryStore } from '../../reports/tests/memory-store';

const STATES = Number(process.argv[2] ?? 5000);
const SHARDS = Number(process.argv[3] ?? 10);
const PROFILES = [
  { environment: 'desktop-web', profile: { viewport: '1280x800', scheme: 'light' } },
  { environment: 'desktop-web', profile: { viewport: '1280x800', scheme: 'dark' } },
  { environment: 'mobile-web', profile: { viewport: '390x844', scheme: 'light' } },
  { environment: 'mobile-web', profile: { viewport: '390x844', scheme: 'dark' } }
] as const;

const ms = (start: number) => `${(performance.now() - start).toFixed(1)} ms`;
const line = (name: string, value: string) => console.log(`${name.padEnd(46)} ${value}`);
const time = <T>(name: string, run: () => T): T => { const start = performance.now(); const value = run(); line(name, ms(start)); return value; };

const store = memoryStore();
let started = performance.now();
const id = (n: number) => `area${n % 40}/screen${n}`;
for (const where of PROFILES) {
  await publishChecks(store, uiPlanLayer({ producer: 'plan', recordedAtMs: 1, ...where, states: Array.from({ length: STATES }, (_, n) => ({ id: id(n), covers: [`surface${n % 300}`] })) }));
  for (let shard = 0; shard < SHARDS; shard++) {
    const states = [];
    for (let n = shard; n < STATES; n += SHARDS) states.push({ id: id(n), title: `Screen ${n}`, route: `/area${n % 40}/${n}`, area: `area${n % 40}`, cohort: n % 3 ? 'new' : 'old', flags: [`flag${n % 5}`], covers: [`surface${n % 300}`], kind: 'screen', status: n % 50 === 0 ? 'failed' as const : 'passed' as const, screenshot: { data: new TextEncoder().encode(`png:${n}:${where.profile.scheme}:${where.profile.viewport}`), width: 390, height: 844 } });
    await publishChecks(store, uiStateLayer({ producer: `capture-${shard}`, recordedAtMs: 100 + shard, ...where, shard: `${shard + 1}/${SHARDS}`, states }));
  }
}
line(`publish ${STATES} states × ${PROFILES.length} profiles in ${SHARDS} shards`, ms(started));

const index = new ReportIndex([{ id: 'bench', store }]);
started = performance.now();
await index.refresh();
line('read the layers into the report', ms(started));
const snapshot = index.snapshot();
const catalog = time('uiCatalog (whole)', () => uiCatalog(snapshot.layers, { version: snapshot.version }));
line('  states / cells', `${catalog.states.length} / ${catalog.summary.cells}`);
time('uiCatalog (again)', () => uiCatalog(snapshot.layers, { version: snapshot.version }));
time('filter: words', () => filterUiCatalog(catalog, { q: 'screen4' }));
time('filter: coverage + profile', () => filterUiCatalog(catalog, { coverage: ['failed'], profile: [catalog.profiles[0]!.key] }));
time('filter: area + flag', () => filterUiCatalog(catalog, { area: ['area3'], flag: ['flag2'] }));
const page = time('page (200)', () => pageUiCatalog(catalog, { limit: 200 }));
const json = time('JSON.stringify page', () => JSON.stringify(page));
line('  page bytes', `${(json.length / 1024).toFixed(0)} KiB`);
line('  whole bytes', `${(JSON.stringify(catalog).length / 1024 / 1024).toFixed(1)} MiB`);
time('markdown', () => uiCatalogMarkdown(page));
const entries = time('catalogEntries', () => catalogEntries(snapshot.layers));
line('  entries', String(entries.entries.length));
