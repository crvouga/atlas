import { Link, useLocation, useParams, useSearch } from '@tanstack/react-router';

import { ScreenImage } from '../components/Screen';
import { STATUS_LABEL, type AtlasView, type StateView } from '../data/model';
import { useAtlas } from './atlas-context';
import styles from './gazetteer.module.css';

function openingScreen(view: AtlasView, steps: readonly { transitionIds: readonly string[] }[]) {
  for (const step of steps) {
    const transition = view.transitions.get(step.transitionIds[0] ?? '');
    const landing = transition?.target ? view.states.get(transition.target) : undefined;
    if (landing && (landing.kind === 'screen' || landing.kind === 'final')) return landing;
  }
  return undefined;
}

function screensOf(view: AtlasView, chartId: string) {
  const chart = view.charts.get(chartId);
  if (!chart) return [];
  return chart.states
    .map((key) => view.states.get(key))
    .filter((state): state is StateView => Boolean(state && (state.kind === 'screen' || state.kind === 'final')));
}

export function Gazetteer() {
  const { view } = useAtlas();
  const params = useParams({ strict: false });
  const search = useSearch({ strict: false });
  const { pathname } = useLocation();
  const screen = typeof search.screen === 'string' ? search.screen : undefined;
  const journeyId = typeof search.journey === 'string' ? search.journey : undefined;
  const group = typeof search.group === 'string' ? search.group : undefined;
  const journeys = (view?.journeys ?? []).filter((journey) => journey.chartIds.length > 0);
  return (
    <nav className={styles.index} aria-label="Places">
      <h2>Places</h2>
      {!view && <p className={styles.empty}>Loading the spec…</p>}
      {view?.contexts.map((context) => (
        <section key={context.id}>
          <h3>{context.name}</h3>
          {context.chartIds.map((chartId) => {
            const chart = view.charts.get(chartId);
            if (!chart) return null;
            const screens = screensOf(view, chartId);
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
                        <span className={styles.thumb} aria-hidden="true">
                          <ScreenImage state={state} size="thumb" description={false} lines={false} caption={false} />
                        </span>
                        <span className={styles.name}>{state.name}</span>
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
            {journeys.map((journey) => {
              const opening = view ? openingScreen(view, journey.steps) : undefined;
              return (
                <li key={journey.id}>
                  <Link
                    className={styles.row}
                    data-status={journey.status}
                    to="/chart/$chartId"
                    params={{ chartId: journey.chartIds[0] ?? '' }}
                    search={(prev) => ({ run: prev.run, journey: journey.id })}
                    aria-current={journeyId === journey.id && pathname.startsWith('/chart') ? 'page' : undefined}
                  >
                    {opening && (
                      <span className={styles.thumb} aria-hidden="true">
                        <ScreenImage state={opening} size="thumb" description={false} lines={false} caption={false} />
                      </span>
                    )}
                    <span className={styles.name}>{journey.name}</span>
                    <span className={styles.status}>{STATUS_LABEL[journey.status]}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {view && view.excluded.length > 0 && (
        <section>
          <h2>Not in the spec yet</h2>
          <ul>
            {view.excluded.map((item) => (
              <li key={item} className={styles.excluded}>{item}</li>
            ))}
          </ul>
        </section>
      )}
    </nav>
  );
}
