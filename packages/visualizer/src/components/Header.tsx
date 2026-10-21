import { Link, useLocation, useNavigate, useSearch } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, type ReactNode } from 'react';

import { useAtlas } from '../app/atlas-context';
import { setFinderOpen } from '../find/open';
import type { AtlasView } from '../data/model';
import { LATEST } from '../data/queries';
import { useEvidence } from '../evidence/evidence-context';
import { plural } from '../evidence/format';
import { excludedCount } from '../evidence/sources-panel';
import { useLiveStatus } from '../live/live-stream';
import { kindOfAddress, outlinePath, SPEC_KINDS } from '../spec-kind';
import { runtimeConfig } from '../runtime';
import { useUiStore } from '../state/ui-store';
import { DataIssues } from './DataIssues';
import { ActivityIndicator } from './ActivityIndicator';
import styles from './Header.module.css';
import { ProjectPicker, ProjectNotice } from './ProjectPicker';
import { isStatechartFile } from '@crvouga/atlas/schema';
import { SearchIcon, ChevronDownIcon } from './icons';

const dateTime = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function formatRunTime(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'Unknown time' : dateTime.format(d);
}

/** The product's own name, without the subtitle a spec title may carry: "Gamezilla — the whole product" is Gamezilla. */
export function productName(title: string | undefined) {
  const name = title?.split(/\s+[—–|-]\s+|:\s+/)[0]?.trim();
  return name || 'Atlas';
}

function RunPicker({ view }: { view: AtlasView }) {
  const search = useSearch({ strict: false });
  const navigate = useNavigate();
  const { latestRunId } = useAtlas();
  if (view.runs.length === 0) return null;
  const latest = view.runs.find((run) => run.id === latestRunId);
  return (
    <label className={styles.picker}>
      <span className="sr-only">Run</span>
      <select
        className={styles.select}
        value={search.run ?? LATEST}
        onChange={(event) => void navigate({ to: '.', search: (prev) => ({ ...prev, run: event.target.value === LATEST ? undefined : event.target.value }) })}
      >
        <option value={LATEST}>Latest{latest ? ` · ${formatRunTime(latest.startedAt)}` : ''}</option>
        {view.runs.map((run) => (
          <option key={run.id} value={run.id} disabled={run.progress === 'running'}>
            {formatRunTime(run.startedAt)} · {run.progress === 'running' ? 'still running' : run.mode === 'showcase' ? 'with videos' : 'quick check'}
          </option>
        ))}
      </select>
    </label>
  );
}

function runOnly(prev: { run?: unknown }) {
  return typeof prev.run === 'string' ? { run: prev.run } : {};
}

/** Spec runs writing results right now. Their results are already in the lists below. */
function LiveRuns() {
  const { active } = useEvidence();
  if (!active.length) return null;
  const results = active.reduce((sum, run) => sum + run.completed, 0);
  return (
    <span className={styles.live} role="status" title={active.map((run) => run.packageDir).join(', ')}>
      <span className={styles.liveDot} aria-hidden="true" />
      Running {active.length === 1 ? active[0]!.packageDir.split('/').at(-1) : plural(active.length, 'suite', 'suites')} · {plural(results, 'result', 'results')}
    </span>
  );
}

/** A fixed-size connection indicator; incoming results never change the header's width. */
function ServerConnection() {
  const status = useLiveStatus();
  if (status === 'off') return null;
  const label = status === 'live' ? 'Live updates connected' : status === 'connecting' ? 'Connecting to live updates' : 'Live updates disconnected; reconnecting';
  return (
    <span className={styles.connection} data-status={status} role="status" aria-label={label} title={label}>
      <span className={styles.connectionDot} aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}

function SourcesButton() {
  const { layers, ready, unavailable, excluded } = useEvidence();
  const setOpen = useUiStore((s) => s.setSourcesOpen);
  if (!ready && !unavailable) return null;
  const off = excludedCount(excluded);
  return (
    <button type="button" className={styles.sources} data-filtered={off > 0 || undefined} onClick={() => setOpen(true)}>
      Sources
      <span>{unavailable ? 'unavailable' : off > 0 ? `${off} off` : plural(layers.length, 'layer', 'layers')}</span>
    </button>
  );
}

export function Header() {
  const { view } = useAtlas();
  const evidence = useEvidence();
  const { pathname } = useLocation();
  const kind = kindOfAddress(pathname);
  const product = productName(view?.title);
  const hasCharts = evidence.files.some(isStatechartFile);
  useEffect(() => {
    document.title = product;
  }, [product]);
  const tabs = useMemo(
    () =>
      SPEC_KINDS.map((entry) => {
        const files = evidence.files.filter(entry.accepts);
        return { kind: entry, files: files.length, running: files.some(file => (evidence.view.specs.get(outlinePath(file))?.summary.counts.running ?? 0) > 0), failing: files.filter((file) => (evidence.view.specs.get(outlinePath(file))?.summary.counts.failed ?? 0) > 0).length };
      }).filter((tab) => tab.files > 0 || tab.kind === kind),
    [evidence.files, evidence.view, kind]
  );
  return (
    <header className={styles.header}>
      <Link to="/" search={(prev) => runOnly(prev)} className={styles.home}>
        Atlas
      </Link>
      <div className={styles.breadcrumbs}>
      <HeaderMenu label="Spec type" working={tabs.some(tab => tab.running)} caption={kind?.label ?? (hasCharts ? 'Statecharts' : evidence.ready && !tabs.length ? 'Tests' : 'Specs')}>
      <nav className={styles.tabs} aria-label="Spec type" onClick={event => event.currentTarget.closest('details')?.removeAttribute('open')}>
        <Link to="/" search={(prev) => runOnly(prev)} aria-current={pathname.startsWith('/specs/') ? undefined : 'page'}>
          {hasCharts || !evidence.ready ? 'Statecharts' : 'Tests'}
        </Link>
        {tabs.map((tab) => (
          <Link key={tab.kind.id} to="/specs/$kind" params={{ kind: tab.kind.id }} search={{}} aria-current={tab.kind === kind ? 'page' : undefined}>
            {tab.kind.label}
            {tab.running && <ActivityIndicator label={`${tab.kind.label} tests running`} />}
            {tab.failing > 0 && <span className={styles.failing} aria-label={`${plural(tab.failing, tab.kind.one, tab.kind.many)} failing`}>{tab.failing}</span>}
          </Link>
        ))}
      </nav>
      </HeaderMenu>
      <SpecBreadcrumb />
      </div>
      <div className={styles.tools}>
        <ServerConnection />
        <button type="button" className={styles.search} aria-label="Find a flow" title="Search (⌘K / Ctrl+K)" aria-keyshortcuts="Meta+K Control+K" onClick={() => setFinderOpen(true)}>
          <SearchIcon size={16} />
        </button>
        <HeaderMenu label="View options" caption="•••" tools>
          <div className={styles.options}>
            {!kind && view && <div className={styles.optionGroup}><span className={styles.optionLabel}>Run</span><RunPicker view={view} /></div>}
            <LiveRuns />
            <SourcesButton />
            {!kind && view && <DataIssues issues={view.issues} />}
            {runtimeConfig()?.api && <a href="/admin" className={styles.sources}>Settings</a>}
            <ProjectNotice />
          </div>
        </HeaderMenu>
        <ProjectPicker />
      </div>
    </header>
  );
}

function HeaderMenu({ label, caption, tools = false, working = false, children }: { label: string; caption: string; tools?: boolean; working?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === 'Escape' && ref.current?.open) { ref.current.open = false; ref.current.querySelector('summary')?.focus(); }
      } else if (event.target instanceof Node && !ref.current?.contains(event.target) && ref.current) ref.current.open = false;
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', close); };
  }, []);
  return <details ref={ref} className={styles.menu} data-tools={tools || undefined} onToggle={event => {
    if (event.currentTarget.open) for (const other of document.querySelectorAll<HTMLDetailsElement>('header details[open]')) if (other !== event.currentTarget) other.open = false;
  }}>
    <summary role="button" aria-label={label}>{working && <ActivityIndicator label="Specs running" />}{caption}{!tools && <ChevronDownIcon size={12} />}</summary>
    <div className={styles.dropdown}>{children}</div>
  </details>;
}

function SpecBreadcrumb() {
  const evidence = useEvidence();
  const { view } = useAtlas();
  const { pathname } = useLocation();
  const search = useSearch({ strict: false });
  const navigate = useNavigate();
  const kind = kindOfAddress(pathname);
  const chart = pathname.startsWith('/chart/') ? decodeURIComponent(pathname.split('/')[2] ?? '') : null;
  const options = kind ? evidence.files.filter(kind.accepts).map(file => ({ id: file, name: evidence.titleOf(file), running: (evidence.view.specs.get(outlinePath(file))?.summary.counts.running ?? 0) > 0 }))
    : [...(view?.charts.values() ?? [])].map(item => ({ id: item.id, name: item.name, running: (evidence.view.specs.get(outlinePath(item.file))?.summary.counts.running ?? 0) > 0 }));
  if (!options.length) return null;
  const running = options.some(option => option.running);
  return <><span aria-hidden="true">›</span><label className={styles.picker} data-running={running || undefined}><span className="sr-only">Spec</span>
    {running && <span className={styles.pickerActivity}><ActivityIndicator label="Specs running" /></span>}
    <select aria-label="Spec" className={styles.select} value={kind ? search.spec ?? '' : chart ?? ''} onChange={event => {
      const value = event.target.value;
      if (kind) void navigate({ to: '/specs/$kind', params: { kind: kind.id }, search: value ? { spec: value } : {} });
      else if (value) void navigate({ to: '/chart/$chartId', params: { chartId: value }, search: {} });
      else void navigate({ to: '/', search: {} });
    }}><option value="">All specs</option>{options.map(option => <option key={option.id} value={option.id}>{option.name}{option.running ? ' · Running' : ''}</option>)}</select>
  </label></>;
}
