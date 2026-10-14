import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';

import { keys, specKey, useAdapter } from '../data/queries';
import { outlinePath, specFile, specKind } from '../spec-kind';
import type { SelectCheck } from './check-detail';
import { useEvidence } from './evidence-context';
import styles from './evidence.module.css';
import { Overview } from './overview';

// Each kind of spec has a page with a parser of its own (Gherkin, Quint, DMN); a page loads only the one it shows.
const DocumentPage = lazy(() => import('./document-page').then((m) => ({ default: m.DocumentPage })));
const FeaturePage = lazy(() => import('./feature-page').then((m) => ({ default: m.FeaturePage })));
const ModelPage = lazy(() => import('./model-page').then((m) => ({ default: m.ModelPage })));
const RecordingPage = lazy(() => import('./recording-page').then((m) => ({ default: m.RecordingPage })));

function Loading({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<article className={styles.page}><p className={styles.aside} role="status">Loading…</p></article>}>{children}</Suspense>;
}

/** One spec tab: its overview, one of its documents, or a recording opened from that document. */
export function SpecPage() {
  const params = useParams({ from: '/specs/$kind' });
  const search = useSearch({ from: '/specs/$kind' });
  const navigate = useNavigate({ from: '/specs/$kind' });
  const adapter = useAdapter();
  const evidence = useEvidence();
  const kind = specKind(params.kind);
  const file = search.spec ? specFile(search.spec) : '';
  const readable = kind !== null && file.length > 0 && kind.accepts(file);
  const text = useQuery({ queryKey: keys.specFile(specKey(adapter), file), queryFn: () => adapter.specFile(file), enabled: readable, retry: false });

  if (!kind) {
    return (
      <article className={styles.page}>
        <h1 className={styles.title}>No such kind of spec</h1>
        <p className={styles.aside}>Pick a tab above.</p>
      </article>
    );
  }
  if (!file) return <Overview kind={kind} />;
  if (!readable) {
    return (
      <article className={styles.page}>
        <h1 className={styles.title}>{kind.label}</h1>
        <p className={styles.aside}>This file is not a {kind.one}.</p>
      </article>
    );
  }

  const entry = evidence.view.specs.get(outlinePath(file));
  const select: SelectCheck = (patch) => {
    const value = <T,>(next: T | null | undefined, current: T | undefined) => (next === undefined ? current : (next ?? undefined));
    void navigate({
      search: (prev) => ({
        ...prev,
        check: value(patch.check, prev.check),
        layer: value(patch.layer, prev.layer),
        view: value(patch.view, prev.view),
        // Opening or leaving a recording starts from its usual moment.
        moment: patch.view === undefined ? prev.moment : undefined
      })
    });
  };

  if (search.view === 'recording' && search.check) {
    const slot = entry?.slots.find((candidate) => candidate.id === search.check);
    // The way back already names the spec; the heading is the check itself.
    const spec = `${evidence.titleOf(file)}: `;
    const label = slot ? (slot.title.startsWith(spec) ? slot.title.slice(spec.length) : slot.title) : 'Recorded test';
    return (
      <Loading>
        <RecordingPage
          slot={slot}
          layerId={search.layer}
          label={label}
          back={evidence.titleOf(file)}
          moment={search.moment ?? null}
          onMoment={(moment, replace) => void navigate({ search: (prev) => ({ ...prev, moment }), replace })}
          onClose={() => select({ view: null })}
        />
      </Loading>
    );
  }
  if (text.isPending) return <article className={styles.page}><p className={styles.aside} role="status">Loading the {kind.one}…</p></article>;
  if (text.isError) {
    return (
      <article className={styles.page}>
        <p className={styles.notice} role="alert">
          The {kind.one} could not be read.{' '}
          <button type="button" className={styles.link} onClick={() => void text.refetch()}>Try again</button>
        </p>
      </article>
    );
  }
  const page = { file, text: text.data, kind, entry, selection: { check: search.check, layer: search.layer }, select };
  return <Loading>{kind.id === 'gherkin' ? <FeaturePage {...page} /> : kind.id === 'quint' ? <ModelPage {...page} /> : <DocumentPage {...page} />}</Loading>;
}
