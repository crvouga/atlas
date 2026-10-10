import { Link, useLocation, useParams, useSearch } from '@tanstack/react-router';
import { createContext, useContext, useState, type ReactNode } from 'react';

import { STATUS_LABEL, type AtlasView, type StateView } from '../data/model';
import { useAtlas } from './atlas-context';
import styles from './gazetteer.module.css';

type QueryValue = { query: string; setQuery: (value: string) => void };
const QueryContext = createContext<QueryValue>({ query: '', setQuery: () => {} });

export function useGazetteerQuery() {
  return useContext(QueryContext);
}

export function GazetteerQuery({ children }: { children: ReactNode }) {
  const [query, setQuery] = useState('');
  const value = { query, setQuery };
  return <QueryContext.Provider value={value}>{children}</QueryContext.Provider>;
}

function hit(query: string, text: string) {
  const needle = query.trim().toLowerCase();
  return needle.length === 0 || text.toLowerCase().includes(needle);
}

function screensOf(view: AtlasView, chartId: string) {
  const chart = view.charts.get(chartId);
  if (!chart) return [];
  return chart.states
    .map((key) => view.states.get(key))
    .filter((state): state is StateView => Boolean(state && (state.kind === 'screen' || state.kind === 'final')));
}

export function Gazetteer() {
  const { query } = useGazetteerQuery();
  const { view } = useAtlas();
  const params = useParams({ strict: false });
  const search = useSearch({ strict: false });
  const { pathname } = useLocation();
  const screen = typeof search.screen === 'string' ? search.screen : undefined;
  const journeyId = typeof search.journey === 'string' ? search.journey : undefined;
  const group = typeof search.group === 'string' ? search.group : undefined;
  const journeys = (view?.journeys ?? []).filter((journey) => journey.chartIds.length > 0 && hit(query, journey.name));
  return (
    <nav className={styles.index} aria-label="Gazetteer">
      <h2>Places</h2>
      {!view && <p className={styles.empty}>Loading the spec…</p>}
      {view?.contexts.map((context) => (
        <section key={context.id}>
          <h3>{context.name}</h3>
          {context.chartIds.map((chartId) => {
            const chart = view.charts.get(chartId);
            if (!chart) return null;
            const screens = screensOf(view, chartId).filter((state) => hit(query, `${state.name} ${chart.name} ${context.name}`));
            const chartHit = hit(query, `${chart.name} ${context.name}`);
            if (query.trim() && screens.length === 0 && !chartHit) return null;
            return (
              <div key={chartId}>
                <Link className={styles.chart} to="/chart/$chartId" params={{ chartId }} search={(prev) => ({ run: prev.run, screen: undefined, journey: undefined, group: undefined })} activeOptions={{ includeSearch: true, explicitUndefined: true }} aria-current={params.chartId === chartId && !screen && !journeyId && !group ? 'page' : undefined}>
                  {chart.name}
                </Link>
                <ul>
                  {screens.map((state) => (
                    <li key={state.key}>
                      <Link
                        className={styles.row}
                        data-status={state.status}
                        to="/chart/$chartId"
                        params={{ chartId }}
                        search={(prev) => ({ run: prev.run, screen: state.name, journey: prev.journey })}
                        aria-current={params.chartId === chartId && screen === state.name ? 'page' : undefined}
                      >
                        <span>{state.name}</span>
                        <span className={styles.status}>{STATUS_LABEL[state.status]}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </section>
      ))}
      {journeys.length > 0 && (
        <section>
          <h3>Journeys</h3>
          <ul>
            {journeys.map((journey) => (
              <li key={journey.id}>
                <Link
                  className={styles.row}
                  data-status={journey.status}
                  to="/chart/$chartId"
                  params={{ chartId: journey.chartIds[0] ?? '' }}
                  search={(prev) => ({ run: prev.run, journey: journey.id })}
                  aria-current={journeyId === journey.id && pathname.startsWith('/chart') ? 'page' : undefined}
                >
                  <span>{journey.name}</span>
                  <span className={styles.status}>{STATUS_LABEL[journey.status]}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {view && view.excluded.length > 0 && (
        <section>
          <h2>Not in the spec yet</h2>
          <ul>
            {view.excluded.filter((item) => hit(query, item)).map((item) => (
              <li key={item} className={styles.excluded}>{item}</li>
            ))}
          </ul>
        </section>
      )}
    </nav>
  );
}
