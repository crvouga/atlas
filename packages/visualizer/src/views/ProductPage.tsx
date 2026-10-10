import { Navigate, useSearch } from '@tanstack/react-router';

import { useAtlas } from '../app/atlas-context';
import type { AtlasView } from '../data/model';
import styles from './views.module.css';

function openingPlace(view: AtlasView) {
  const screens = [...view.states.values()].filter((state) => state.kind === 'screen' || state.kind === 'final');
  const withFailedEvent = screens.find((state) => state.outgoing.some((id) => view.transitions.get(id)?.status === 'failed'));
  return withFailedEvent ?? screens.find((state) => state.status === 'failed') ?? screens[0] ?? null;
}

export function ProductPage() {
  const { view } = useAtlas();
  const search = useSearch({ strict: false });
  const run = typeof search.run === 'string' ? search.run : undefined;
  if (!view) return <div className={styles.plateScroll} role="status">Loading the spec…</div>;
  const place = openingPlace(view);
  if (!place) {
    return (
      <article className={styles.plateScroll}>
        <h1 className={styles.plateTitle}>{view.title}</h1>
        <p className={styles.lead}>This spec has no screens yet.</p>
      </article>
    );
  }
  return (
    <Navigate
      to="/chart/$chartId"
      params={{ chartId: place.chartId }}
      search={{ ...(run ? { run } : {}), screen: place.name }}
      replace
    />
  );
}
