import { addSummaries, NO_EVIDENCE, type SpecSummary } from '@crvouga/atlas/reports/evidence-view';
import { Link, useSearch } from '@tanstack/react-router';
import { useMemo } from 'react';

import { folderOf, outlinePath, specFile, type SpecKind } from '../spec-kind';
import { useUiStore, type ResultFilter } from '../state/ui-store';
import { useEvidence } from './evidence-context';
import styles from './evidence.module.css';
import { StatusMark, Tally } from './marks';

const FILTERS: readonly { readonly id: ResultFilter; readonly label: string; readonly keeps: (summary: SpecSummary) => boolean }[] = [
  { id: 'all', label: 'All', keeps: () => true },
  { id: 'results', label: 'Results', keeps: (summary) => summary.status !== 'none' },
  { id: 'failed', label: 'Failing', keeps: (summary) => summary.counts.failed > 0 },
  { id: 'none', label: 'None', keeps: (summary) => summary.status === 'none' }
];

/** Every spec of one kind, grouped by folder, each with what the combined report holds for it. */
export function SpecIndex({ kind }: { kind: SpecKind }) {
  const evidence = useEvidence();
  const search = useSearch({ strict: false });
  const filter = useUiStore((s) => s.resultFilter);
  const setFilter = useUiStore((s) => s.setResultFilter);
  const open = typeof search.spec === 'string' ? specFile(search.spec) : '';
  const rows = useMemo(
    () => evidence.files.filter(kind.accepts).map((file) => ({ file, title: evidence.titleOf(file), summary: evidence.view.specs.get(outlinePath(file))?.summary ?? NO_EVIDENCE })),
    // `titleOf` reads the outline the view was built from.
    [evidence.files, evidence.view, kind]
  );
  const keeps = FILTERS.find((entry) => entry.id === filter)!.keeps;
  const visible = rows.filter((row) => keeps(row.summary));
  const groups = useMemo(() => {
    const byFolder = new Map<string, typeof visible>();
    for (const row of visible) byFolder.set(folderOf(row.file), [...(byFolder.get(folderOf(row.file)) ?? []), row]);
    return [...byFolder];
  }, [visible]);
  return (
    <nav className={styles.index} aria-label={`${kind.label} ${kind.many}`}>
      <div className={styles.filters} role="group" aria-label="Show">
        {FILTERS.map((entry) => (
          <button key={entry.id} type="button" aria-pressed={filter === entry.id} onClick={() => setFilter(entry.id)}>
            {entry.label} <span>{rows.filter((row) => entry.keeps(row.summary)).length}</span>
          </button>
        ))}
      </div>
      {evidence.filesPending && <p className={styles.indexNote}>Loading…</p>}
      {evidence.filesError && <p className={styles.indexNote}>The file list could not be loaded.</p>}
      {!evidence.filesPending && !evidence.filesError && visible.length === 0 && (
        <p className={styles.indexNote}>
          {rows.length === 0 ? `No ${kind.many} in this spec set.` : filter === 'failed' ? `No failing ${kind.many}.` : filter === 'results' ? `No ${kind.many} with results yet.` : `Every ${kind.one} has results.`}
        </p>
      )}
      {groups.map(([folder, entries]) => (
        <section key={folder || kind.id}>
          <h3>
            <span>{folder || kind.label}</span>
            <Tally summary={addSummaries(entries.map((row) => row.summary))} />
          </h3>
          <ul>
            {entries.map((row) => (
              <li key={row.file}>
                <Link className={styles.indexRow} to="/specs/$kind" params={{ kind: kind.id }} search={{ spec: row.file }} title={row.file} aria-current={open === row.file ? 'page' : undefined} data-result={row.summary.status}>
                  <StatusMark status={row.summary.status} size={14} />
                  <span className={styles.indexName}>{row.title}</span>
                  {row.summary.status !== 'none' && <Tally summary={row.summary} />}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </nav>
  );
}
