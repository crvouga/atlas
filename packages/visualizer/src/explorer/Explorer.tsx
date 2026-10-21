/**
 * @module Test explorer
 *
 * The home of a project without statecharts: every test the report holds, found by searching and filtering, grouped
 * by spec (or domain, environment, status, producer), with what was recorded about each at a glance: where it ran and
 * how it went there, how long it takes, how often it passes, how many runs it was in. Above the list, the report in
 * numbers; beside it, the open test; in a second tab, the CI runs that produced the results.
 */
import { durationStats, formatMs, matchesQuery, testCatalog, TEST_SORTS, type CatalogModel, type TestQuery, type TestSort, type TestSummary } from '@crvouga/atlas/reports/test-catalog';
import type { CheckSlot } from '@crvouga/atlas/reports/evidence-view';
import { environmentLabel } from '@crvouga/atlas/reports/layer-axes';
import { Link } from '@tanstack/react-router';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';

import { useEvidence } from '../evidence/evidence-context';
import { ago, plural, useNow } from '../evidence/format';
import { Meter, StatusMark } from '../evidence/marks';
import { SPEC_KINDS } from '../spec-kind';
import { useRunDetail, useTestCatalog } from './catalog';
import styles from './explorer.module.css';
import { groupTests, tally, type TestGroupView } from './groups';
import { Badges, EnvironmentChips, projectTitle, runName } from './parts';
import { patched, useExplorerNavigate, useExplorerSearch } from './navigate';
import { RunsView } from './RunsView';
import { narrowed, queryOf, toggled, values, TEST_GROUPS, type ExplorerSearch, type TestGroup } from './search';
import { TestDetail } from './TestDetail';

/** Groups start closed when there are more of them than this, unless the list is short. */
const OPEN_GROUPS = 40;
const OPEN_TESTS = 300;
/** Rows a group shows before "Show more". */
const GROUP_ROWS = 50;

const GROUP_LABEL: Record<TestGroup, string> = { spec: 'Spec', domain: 'Domain', environment: 'Environment', status: 'Status', producer: 'Producer', none: 'None' };
const SORT_LABEL: Record<TestSort, string> = { spec: 'Spec', title: 'Title', recent: 'Most recent', slowest: 'Slowest', failures: 'Most failures', flaky: 'Flakiest', runs: 'Most runs' };
const STATUS_FILTERS = [
  { id: '', label: 'All' },
  { id: 'failed', label: 'Failed' },
  { id: 'flaky', label: 'Flaky' },
  { id: 'passed', label: 'Passed' },
  { id: 'not-run', label: 'Not run' },
  { id: 'running', label: 'Running' }
] as const;

function percent(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`;
}

/** What the explorer lists for an address: the tests shown, and the scope the insight strip and filter counts describe. */
function useListing(model: CatalogModel | null, search: ExplorerSearch, q: string | undefined) {
  const run = useRunDetail(search.inRun);
  const inRun = useMemo(() => (search.inRun ? new Set(run.data?.results.map((result) => result.key) ?? []) : null), [search.inRun, run.data]);
  return useMemo(() => {
    if (!model) return null;
    const query: TestQuery = { ...queryOf(search), ...(q ? { q } : { q: undefined }) };
    const shown = testCatalog(model, { ...query, limit: 20_000 }).tests.filter((test) => !inRun || inRun.has(test.key));
    // The strip and the status and environment counts describe what the other filters leave.
    const scope = model.tests.filter((test) => matchesQuery(model, test, { ...query, status: [], environment: [] }, inRun));
    const byEnvironment = scope.filter((test) => matchesQuery(model, test, { environment: query.environment }));
    const byStatus = scope.filter((test) => matchesQuery(model, test, { status: query.status }));
    return { shown, scope, byEnvironment, byStatus, runPending: !!search.inRun && run.isPending, runMissing: !!search.inRun && run.isSuccess && run.data === null };
  }, [model, search, q, inRun, run.isPending, run.isSuccess, run.data]);
}

/** The project home: the published spec kinds, the insight strip, the toolbar, the grouped list and the open test. */
export function Explorer() {
  const evidence = useEvidence();
  const catalog = useTestCatalog();
  const search = useExplorerSearch();
  const go = useExplorerNavigate();
  const q = useDeferredValue(search.q);
  const listing = useListing(catalog.model, search, q);
  const kinds = SPEC_KINDS.map((kind) => ({ kind, files: evidence.files.filter(kind.accepts) })).filter((entry) => entry.files.length);
  const slots = useMemo(() => {
    const map = new Map<string, CheckSlot>();
    for (const entry of evidence.view.specs.values()) for (const slot of entry.slots) map.set(slot.key, slot);
    for (const slot of evidence.view.unassigned) map.set(slot.key, slot);
    return map;
  }, [evidence.view]);
  const model = catalog.model;
  const selected = search.test ? model?.byKey.get(search.test) ?? null : null;
  const empty = model !== null && model.tests.length === 0;
  const split = !!search.test && search.tab !== 'runs';

  return (
    <div className={styles.explorer} data-split={split || undefined}>
      <article className={styles.main} aria-label="Test explorer">
        <header className={styles.head}>
          <h1 className={styles.title}>{projectTitle()}</h1>
          {model && model.tests.length > 0 && (
            <div className={styles.tabs} role="tablist" aria-label="Explorer view">
              <Link role="tab" aria-selected={search.tab !== 'runs'} to="/" search={patched({ tab: undefined, openRun: undefined })} resetScroll={false} activeOptions={{ exact: true }}>Tests <span>{model.tests.length}</span></Link>
              <Link role="tab" aria-selected={search.tab === 'runs'} to="/" search={patched({ tab: 'runs', test: undefined })} resetScroll={false} activeOptions={{ exact: true }}>Runs <span>{model.summary.runs}</span></Link>
            </div>
          )}
        </header>
        {evidence.unavailable && <p role="alert" className={styles.notice}>{evidence.unavailable}</p>}
        {catalog.notice && <p role="status" className={styles.notice}>The server’s test history could not be read ({catalog.notice}). Showing what this page holds.</p>}
        {kinds.length > 0 && (
          <section className={styles.kinds} aria-label="Published specs">
            <h2 className={styles.label}>Specs</h2>
            <ul>
              {kinds.map(({ kind, files }) => (
                <li key={kind.id}>
                  <Link to="/specs/$kind" params={{ kind: kind.id }} search={{}}><strong>{kind.label}</strong> <span>{files.length} {files.length === 1 ? kind.one : kind.many}</span></Link>
                </li>
              ))}
            </ul>
          </section>
        )}
        {!model && !evidence.unavailable && <p className={styles.quiet} role="status">Loading tests…</p>}
        {empty && !kinds.length && <p className={styles.quiet}>No reports yet. Publish tests and specs to this project to populate its report.</p>}
        {empty && kinds.length > 0 && <p className={styles.quiet}>No test results recorded yet.</p>}
        {model && !empty && listing && (search.tab === 'runs'
          ? <RunsView />
          : <>
              <InsightStrip model={model} scope={listing.scope} search={search} />
              <Toolbar model={model} search={search} listing={listing} onSearch={(value) => go({ q: value || undefined }, { replace: true })} />
              {listing.runPending && <p className={styles.quiet} role="status">Reading the tests of this run…</p>}
              {listing.runMissing && <p className={styles.notice} role="status">That run is not in the report any more.</p>}
              <TestList tests={listing.shown} search={search} total={model.tests.length} />
            </>)}
      </article>
      {split && (
        <aside className={styles.side} aria-label="Test detail">
          {selected ? <TestDetail test={selected} slot={slots.get(selected.key)} /> : model ? (
            <div className={styles.detailEmpty}>
              <p className={styles.notice}>This test is not in the report any more. A source may be switched off, or its results were removed.</p>
              <Link to="/" search={patched({ test: undefined })} resetScroll={false} activeOptions={{ exact: true }}>Close</Link>
            </div>
          ) : <p className={styles.quiet} role="status">Loading the test…</p>}
        </aside>
      )}
    </div>
  );
}

function InsightStrip({ model, scope, search }: { model: CatalogModel; scope: readonly TestSummary[]; search: ExplorerSearch }) {
  const now = useNow();
  const go = useExplorerNavigate();
  const { counts } = tally(scope);
  const flaky = scope.filter((test) => test.stats.flaky).length;
  const averages = scope.flatMap((test) => (test.stats.durations ? [test.stats.durations.avgMs] : []));
  const durations = durationStats(averages);
  const environments = useMemo(() => groupTests(scope, 'environment', false).sort((a, b) => b.tests.length - a.tests.length), [scope]);
  const statuses = values(search.status);
  const envs = values(search.env);
  const last = scope.reduce((latest, test) => Math.max(latest, test.lastRecordedAtMs), 0);
  const status = (id: string) => go({ status: statuses.length === 1 && statuses[0] === id ? undefined : id });
  return (
    <section className={styles.insights} aria-label="Insights">
      <div className={styles.tile}>
        <span className={styles.tileLabel}>Tests</span>
        <strong className={styles.tileValue}>{scope.length.toLocaleString()}</strong>
        <Meter counts={counts} />
        <span className={styles.tileCounts}>
          <button type="button" aria-pressed={statuses.includes('failed')} data-status="failed" disabled={!counts.failed} onClick={() => status('failed')}>{counts.failed} failed</button>
          <button type="button" aria-pressed={statuses.includes('passed')} onClick={() => status('passed')}>{counts.passed} passed</button>
          {counts['not-run'] > 0 && <button type="button" aria-pressed={statuses.includes('not-run')} onClick={() => status('not-run')}>{counts['not-run']} not run</button>}
          {counts.running > 0 && <button type="button" aria-pressed={statuses.includes('running')} data-status="running" onClick={() => status('running')}>{counts.running} running</button>}
        </span>
      </div>
      <button type="button" className={styles.tile} aria-pressed={statuses.includes('flaky')} aria-label={`${flaky} flaky tests`} onClick={() => status('flaky')}>
        <span className={styles.tileLabel}>Flaky</span>
        <strong className={styles.tileValue} data-warn={flaky > 0 || undefined}>{flaky}</strong>
        <span className={styles.tileNote}>{flaky ? 'Passed and failed on one commit, or needed a retry' : 'None recorded'}</span>
      </button>
      <div className={styles.tile}>
        <span className={styles.tileLabel}>Duration</span>
        {durations ? (
          <>
            <strong className={styles.tileValue}>{formatMs(durations.avgMs)}</strong>
            <span className={styles.tileNote}>average · p95 {formatMs(durations.p95Ms)} · {averages.length.toLocaleString()} measured</span>
          </>
        ) : (
          <>
            <strong className={styles.tileValue} data-none>—</strong>
            <span className={styles.tileNote}>No durations recorded. Producers can send <code>durationMs</code> with each check.</span>
          </>
        )}
      </div>
      <div className={styles.tile} data-wide>
        <span className={styles.tileLabel}>Environments</span>
        <ul className={styles.envList}>
          {environments.map((group) => (
            <li key={group.key}>
              <button type="button" aria-pressed={envs.includes(group.key)} onClick={() => go({ env: toggled(search.env, group.key) })} title={`Show only ${group.label}`}>
                <span className={styles.envName}>{group.label}</span>
                <span>{plural(group.tests.length, 'test', 'tests')}</span>
                {group.counts.failed > 0 && <span data-status="failed">{group.counts.failed} failed</span>}
                <span>{group.counts.passed} passed</span>
                {group.counts['not-run'] > 0 && <span>{group.counts['not-run']} not run</span>}
                {group.avgMs !== null && <span>avg {formatMs(group.avgMs)}</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
      <Link className={styles.tile} to="/" search={patched({ tab: 'runs', test: undefined })} resetScroll={false} activeOptions={{ exact: true }} aria-label={`${model.summary.runs} runs`}>
        <span className={styles.tileLabel}>Runs</span>
        <strong className={styles.tileValue}>{model.summary.runs.toLocaleString()}</strong>
        <span className={styles.tileNote}>{last ? `Last recorded ${ago(last, now)}` : 'Nothing recorded yet'}</span>
      </Link>
      <MoreInsights scope={scope} />
    </section>
  );
}

/** The slowest, flakiest and failing tests of the scope, each one click from its detail. */
function MoreInsights({ scope }: { scope: readonly TestSummary[] }) {
  const slowest = useMemo(() => scope.filter((test) => test.stats.durations).sort((a, b) => b.stats.durations!.avgMs - a.stats.durations!.avgMs).slice(0, 5), [scope]);
  const flakiest = useMemo(() => scope.filter((test) => test.stats.flaky).sort((a, b) => b.stats.flips - a.stats.flips).slice(0, 5), [scope]);
  const failing = useMemo(() => scope.filter((test) => test.status === 'failed').sort((a, b) => b.lastRecordedAtMs - a.lastRecordedAtMs).slice(0, 5), [scope]);
  if (!slowest.length && !flakiest.length && !failing.length) return null;
  const list = (title: string, tests: readonly TestSummary[], value: (test: TestSummary) => string) => tests.length > 0 && (
    <div>
      <h3 className={styles.label}>{title}</h3>
      <ol>
        {tests.map((test) => (
          <li key={test.key}>
            <Link to="/" search={patched({ test: test.key })} resetScroll={false} activeOptions={{ exact: true }}>
              <StatusMark status={test.status} size={12} />
              <span className={styles.insightName}>{test.title}</span>
              <span className={styles.insightValue}>{value(test)}</span>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
  return (
    <details className={styles.more}>
      <summary>Slowest, flakiest and failing tests</summary>
      <div className={styles.moreLists}>
        {list('Failing', failing, (test) => plural(test.stats.failed, 'failure', 'failures'))}
        {list('Flakiest', flakiest, (test) => (test.stats.flips ? plural(test.stats.flips, 'flip', 'flips') : 'flaky'))}
        {list('Slowest', slowest, (test) => formatMs(test.stats.durations?.avgMs))}
      </div>
    </details>
  );
}

type Listing = NonNullable<ReturnType<typeof useListing>>;

function Toolbar({ model, search, listing, onSearch }: { model: CatalogModel; search: ExplorerSearch; listing: Listing; onSearch: (value: string) => void }) {
  const go = useExplorerNavigate();
  const [draft, setDraft] = useState(search.q ?? '');
  // The address may change from elsewhere (a link, the index, back): follow it.
  useEffect(() => setDraft((current) => (current.trim() === (search.q ?? '').trim() ? current : search.q ?? '')), [search.q]);
  const statuses = values(search.status);
  const envs = values(search.env);
  const statusCount = (id: string) => (id === '' ? listing.byEnvironment.length : listing.byEnvironment.filter((test) => (id === 'flaky' ? test.stats.flaky : test.status === id)).length);
  const envCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const test of listing.byStatus) for (const env of test.environments.length ? test.environments : ['(none)']) counts.set(env, (counts.get(env) ?? 0) + 1);
    return counts;
  }, [listing.byStatus]);
  const specTitle = (path: string) => model.facets.specs.find((spec) => spec.path === path)?.title ?? path;
  const chips = [
    ...values(search.spec).map((path) => ({ label: `Spec: ${specTitle(path)}`, clear: { spec: toggled(search.spec, path) } })),
    ...values(search.tag).map((tag) => ({ label: `Tag: ${tag}`, clear: { tag: toggled(search.tag, tag) } })),
    ...(search.inRun ? [{ label: `Run: ${runName(search.inRun)}`, clear: { inRun: undefined } }] : [])
  ];
  return (
    <section className={styles.toolbar} aria-label="Find tests">
      <div className={styles.searchRow}>
        <input
          type="search"
          className={styles.searchBox}
          aria-label="Search tests"
          placeholder="Search titles, specs, domains, tags, environments…"
          value={draft}
          onChange={(event) => { setDraft(event.target.value); onSearch(event.target.value.trim()); }}
        />
        <label className={styles.select}>
          <span>Group by</span>
          <select aria-label="Group by" value={search.group ?? 'spec'} onChange={(event) => go({ group: event.target.value === 'spec' ? undefined : (event.target.value as TestGroup) })}>
            {TEST_GROUPS.map((group) => <option key={group} value={group}>{GROUP_LABEL[group]}</option>)}
          </select>
        </label>
        <label className={styles.select}>
          <span>Sort</span>
          <select aria-label="Sort" value={search.sort ?? 'spec'} onChange={(event) => go({ sort: event.target.value === 'spec' ? undefined : (event.target.value as TestSort) })}>
            {TEST_SORTS.map((sort) => <option key={sort} value={sort}>{SORT_LABEL[sort]}</option>)}
          </select>
        </label>
      </div>
      <div className={styles.segments} role="group" aria-label="Test status">
        {STATUS_FILTERS.map((filter) => {
          const count = statusCount(filter.id);
          if (filter.id === 'running' && count === 0 && !statuses.includes('running')) return null;
          const pressed = filter.id === '' ? statuses.length === 0 : statuses.length === 1 && statuses[0] === filter.id;
          return (
            <button key={filter.id || 'all'} type="button" aria-pressed={pressed} data-status={(count > 0 && filter.id) || undefined} onClick={() => go({ status: filter.id || undefined })}>
              {filter.label} <span>{count.toLocaleString()}</span>
            </button>
          );
        })}
      </div>
      <div className={styles.filterRow}>
        {model.facets.environments.length > 0 && (
          <div className={styles.chips} role="group" aria-label="Environments">
            {model.facets.environments.map(({ value }) => (
              <button key={value} type="button" aria-pressed={envs.includes(value)} onClick={() => go({ env: toggled(search.env, value) })}>
                {environmentLabel(value)} <span>{(envCounts.get(value) ?? 0).toLocaleString()}</span>
              </button>
            ))}
          </div>
        )}
        {model.facets.producers.length > 1 && (
          <label className={styles.select}>
            <span className="sr-only">Producer</span>
            <select aria-label="Producer" value={values(search.producer)[0] ?? ''} onChange={(event) => go({ producer: event.target.value || undefined })}>
              <option value="">All producers</option>
              {model.facets.producers.map(({ value, count }) => <option key={value} value={value}>{value} ({count})</option>)}
            </select>
          </label>
        )}
        {model.facets.domains.length > 1 && (
          <label className={styles.select}>
            <span className="sr-only">Domain</span>
            <select aria-label="Domain" value={values(search.domain)[0] ?? ''} onChange={(event) => go({ domain: event.target.value || undefined, spec: undefined })}>
              <option value="">All domains</option>
              {model.facets.domains.map(({ value, count }) => <option key={value} value={value}>{value === '(no spec)' ? 'No spec' : value} ({count})</option>)}
            </select>
          </label>
        )}
      </div>
      <p className={styles.showing} role="status">
        <span>{listing.shown.length === model.tests.length ? plural(model.tests.length, 'test', 'tests') : `${listing.shown.length.toLocaleString()} of ${plural(model.tests.length, 'test', 'tests')}`}</span>
        {chips.map((chip) => (
          <button key={chip.label} type="button" className={styles.activeChip} onClick={() => go(chip.clear)} aria-label={`Remove ${chip.label}`}>{chip.label} <span aria-hidden="true">×</span></button>
        ))}
        {narrowed(search) && <button type="button" className={styles.link} onClick={() => { setDraft(''); go({ q: undefined, status: undefined, env: undefined, producer: undefined, domain: undefined, spec: undefined, tag: undefined, inRun: undefined }); }}>Clear filters</button>}
      </p>
    </section>
  );
}

function TestList({ tests, search, total }: { tests: readonly TestSummary[]; search: ExplorerSearch; total: number }) {
  const by = search.group ?? 'spec';
  const groups = useMemo(() => groupTests(tests, by, (search.sort ?? 'spec') === 'spec'), [tests, by, search.sort]);
  const [overrides, setOverrides] = useState<ReadonlyMap<string, boolean>>(new Map());
  const defaultOpen = groups.length <= OPEN_GROUPS || tests.length <= OPEN_TESTS;
  const isOpen = (group: TestGroupView) => by === 'none' || (overrides.get(`${by}|${group.key}`) ?? defaultOpen);
  const setAll = (open: boolean) => setOverrides(new Map(groups.map((group) => [`${by}|${group.key}`, open])));
  if (!tests.length) return <p className={styles.quiet} role="status">{total ? 'No test matches these filters.' : 'No tests recorded yet.'}</p>;
  let parent: string | null = null;
  return (
    <section className={styles.list} aria-label="Tests">
      <div className={styles.listHead}>
        <span>{by === 'none' ? '' : `${plural(groups.length, GROUP_LABEL[by].toLowerCase(), by === 'status' ? 'statuses' : `${GROUP_LABEL[by].toLowerCase()}s`)}`}</span>
        {by !== 'none' && (
          <span className={styles.listTools}>
            <button type="button" className={styles.link} onClick={() => setAll(true)}>Expand all</button>
            <button type="button" className={styles.link} onClick={() => setAll(false)}>Collapse all</button>
          </span>
        )}
        <span className={styles.columns} aria-hidden="true"><span>Avg</span><span>Pass</span><span>Runs</span><span>Last</span></span>
      </div>
      {groups.map((group) => {
        const heading = by === 'spec' && group.parent !== parent ? group.parent : null;
        parent = group.parent;
        return (
          <div key={group.key} className={styles.groupWrap}>
            {heading && <h3 className={styles.domainHeading}>{heading === '(no spec)' ? 'No spec' : heading}</h3>}
            <TestGroupSection group={group} by={by} open={isOpen(group)} selected={search.test} onToggle={() => setOverrides(new Map(overrides).set(`${by}|${group.key}`, !isOpen(group)))} />
          </div>
        );
      })}
    </section>
  );
}

function TestGroupSection({ group, by, open, selected, onToggle }: { group: TestGroupView; by: TestGroup; open: boolean; selected: string | undefined; onToggle: () => void }) {
  const [shown, setShown] = useState(by === 'none' ? 100 : GROUP_ROWS);
  const now = useNow();
  return (
    <section className={styles.group} data-open={open || undefined} aria-label={group.label}>
      {by !== 'none' && (
        <button type="button" className={styles.groupHead} aria-expanded={open} onClick={onToggle}>
          <span className={styles.chevron} aria-hidden="true" />
          <span className={styles.groupName}>
            <span>{group.label}</span>
            {group.detail && <code>{group.detail}</code>}
          </span>
          <span className={styles.groupMeter}><Meter counts={group.counts} /></span>
          <span className={styles.groupTally}>
            {group.counts.failed > 0 && <strong>{group.counts.failed} failed</strong>}
            {group.counts['not-run'] > 0 && <span>{group.counts['not-run']} not run</span>}
            <span>{plural(group.tests.length, 'test', 'tests')}</span>
            {group.avgMs !== null && <span>avg {formatMs(group.avgMs)}</span>}
          </span>
        </button>
      )}
      {open && (
        <ul className={styles.rows}>
          {group.tests.slice(0, shown).map((test) => <TestRow key={test.key} test={test} selected={selected === test.key} now={now} />)}
          {group.tests.length > shown && (
            <li className={styles.moreRow}>
              <button type="button" className={styles.link} onClick={() => setShown(shown + (by === 'none' ? 100 : GROUP_ROWS))}>Show more ({group.tests.length - shown} more)</button>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

function TestRow({ test, selected, now }: { test: TestSummary; selected: boolean; now: number }) {
  const failure = test.status === 'failed' ? test.outcomes.find((outcome) => outcome.status === 'failed')?.detail.split('\n')[0] : '';
  return (
    <li className={styles.row} data-status={test.status}>
      <Link to="/" search={patched({ test: selected ? undefined : test.key })} resetScroll={false} activeOptions={{ exact: true }} aria-current={selected ? 'true' : undefined} className={styles.rowLink}>
        <StatusMark status={test.status} size={14} />
        <span className={styles.rowMain}>
          <span className={styles.rowTitle}>{test.title}</span>
          <span className={styles.rowMeta}>
            <EnvironmentChips test={test} />
            <Badges test={test} />
          </span>
          {failure && <span className={styles.rowError}>{failure}</span>}
        </span>
        <span className={styles.columns}>
          <span title="Average duration">{formatMs(test.stats.durations?.avgMs)}</span>
          <span title="Pass rate" data-low={test.stats.passRate !== null && test.stats.passRate < 1 || undefined}>{percent(test.stats.passRate)}</span>
          <span title="Runs">{test.stats.runs || '—'}</span>
          <span title="Last recorded">{test.live ? 'now' : test.lastRecordedAtMs ? ago(test.lastRecordedAtMs, now).replace(' ago', '') : '—'}</span>
        </span>
      </Link>
    </li>
  );
}
