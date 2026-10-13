import { Link, useLocation, useNavigate, useSearch } from '@tanstack/react-router';
import { useEffect, useMemo } from 'react';

import { useAtlas } from '../app/atlas-context';
import { commandKey } from '../find/Finder';
import { setFinderOpen } from '../find/open';
import type { AtlasView } from '../data/model';
import { LATEST } from '../data/queries';
import { useEvidence } from '../evidence/evidence-context';
import { plural } from '../evidence/format';
import { excludedCount } from '../evidence/sources-panel';
import { kindOfAddress, outlinePath, SPEC_KINDS } from '../spec-kind';
import { useUiStore } from '../state/ui-store';
import { DataIssues } from './DataIssues';
import styles from './Header.module.css';

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
  useEffect(() => {
    document.title = product;
  }, [product]);
  const tabs = useMemo(
    () =>
      SPEC_KINDS.map((entry) => {
        const files = evidence.files.filter(entry.accepts);
        return { kind: entry, files: files.length, failing: files.filter((file) => (evidence.view.specs.get(outlinePath(file))?.summary.counts.failed ?? 0) > 0).length };
      }).filter((tab) => tab.files > 0 || tab.kind === kind),
    [evidence.files, evidence.view, kind]
  );
  return (
    <header className={styles.header}>
      <Link to="/" search={(prev) => runOnly(prev)} className={styles.home}>
        {product}
      </Link>
      <nav className={styles.tabs} aria-label="Spec type">
        <Link to="/" search={(prev) => runOnly(prev)} aria-current={pathname.startsWith('/specs/') ? undefined : 'page'}>
          Statecharts
        </Link>
        {tabs.map((tab) => (
          <Link key={tab.kind.id} to="/specs/$kind" params={{ kind: tab.kind.id }} search={{}} aria-current={tab.kind === kind ? 'page' : undefined}>
            {tab.kind.label}
            {tab.failing > 0 && <span className={styles.failing} aria-label={`${plural(tab.failing, tab.kind.one, tab.kind.many)} failing`}>{tab.failing}</span>}
          </Link>
        ))}
      </nav>
      <div className={styles.tools}>
        <LiveRuns />
        {!kind && view && <RunPicker view={view} />}
        {!kind && view && <DataIssues issues={view.issues} />}
        <SourcesButton />
        <button type="button" className={styles.search} aria-keyshortcuts="Meta+K Control+K" onClick={() => setFinderOpen(true)}>
          Find a flow
          <kbd>{commandKey()}</kbd>
        </button>
      </div>
    </header>
  );
}
