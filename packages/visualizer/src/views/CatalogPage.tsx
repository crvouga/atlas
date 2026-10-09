import { useState } from 'react';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';

import type { AtlasView } from '../data/model';
import { useAtlas } from '../app/atlas-context';
import { ChevronIcon, RouteIcon } from '../components/icons';
import { ScreenImage } from '../components/Screen';
import { StatusBadge } from '../components/Status';
import { ITEM_STATUSES, STATUS_LABEL } from '../data/model';
import styles from './application.module.css';

function useCatalogFilters() {
  const search = useSearch({ strict: false });
  const navigate = useNavigate();
  const update = (value: { q?: string; context?: string; status?: (typeof ITEM_STATUSES)[number] }) =>
    void navigate({ to: '.', replace: true, search: (prev) => ({ ...prev, ...value }) });
  return { search, update };
}

function CatalogFilters({ view, noun, count }: { view: AtlasView | null; noun: string; count: number }) {
  const { search, update } = useCatalogFilters();
  return (
    <div className={styles.filters}>
      <input
        type="search"
        aria-label={`Search ${noun}`}
        placeholder={`Search ${noun}…`}
        value={search.q ?? ''}
        onChange={(event) => update({ q: event.target.value || undefined })}
      />
      <select
        aria-label="Product area"
        value={search.context ?? ''}
        onChange={(event) => update({ context: event.target.value || undefined })}
      >
        <option value="">All product areas</option>
        {view?.contexts.map((context) => (
          <option key={context.id} value={context.id}>
            {context.name}
          </option>
        ))}
      </select>
      <select
        aria-label="Result status"
        value={search.status ?? ''}
        onChange={(event) => update({ status: ITEM_STATUSES.find((status) => status === event.target.value) })}
      >
        <option value="">All statuses</option>
        {ITEM_STATUSES.map((status) => (
          <option key={status} value={status}>
            {STATUS_LABEL[status]}
          </option>
        ))}
      </select>
      <span className={styles.resultCount}>
        {count} {noun}
      </span>
    </div>
  );
}

function NoMatches() {
  const { update } = useCatalogFilters();
  return (
    <div className={styles.empty}>
      <h2>No matches</h2>
      <p>Try a different search or product area.</p>
      <button type="button" onClick={() => update({ q: undefined, context: undefined, status: undefined })}>
        Clear filters
      </button>
    </div>
  );
}

export function ScreensPage() {
  const { view } = useAtlas();
  const { search } = useCatalogFilters();
  const [limit, setLimit] = useState(60);
  const query = search.q?.toLowerCase().trim() ?? '';
  const screens = [...(view?.states.values() ?? [])].filter(
    (state) =>
      (state.kind === 'screen' || state.kind === 'final') &&
      (!search.context || state.contextId === search.context) &&
      (!search.status || state.status === search.status) &&
      `${state.name} ${state.description} ${state.owner ?? ''} ${state.hints.join(' ')}`.toLowerCase().includes(query)
  );
  return (
    <div className={styles.page}>
      <div className={styles.pageHead}>
        <span className={styles.eyebrow}>PRODUCT LIBRARY</span>
        <h1>Screens</h1>
        <p>Every place the product can take you, with the latest evidence beside the intended behavior.</p>
      </div>
      <CatalogFilters view={view} noun="screens" count={screens.length} />
      {!view ? (
        <p className={styles.empty} role="status">
          Loading screens…
        </p>
      ) : !screens.length ? (
        <NoMatches />
      ) : (
        <div className={styles.screenGrid}>
          {screens.slice(0, limit).map((state) => (
            <article key={state.key} className={styles.screenCard}>
              <div className={styles.screenPreview}>
                <ScreenImage state={state} size="thumb" />
              </div>
              <div className={styles.screenCopy}>
                <span className={styles.cardArea}>{view.contexts.find((context) => context.id === state.contextId)?.name}</span>
                <Link to="/chart/$chartId" params={{ chartId: state.chartId }} search={(prev) => ({ run: prev.run, screen: state.name })}>
                  {state.name}
                  <ChevronIcon />
                </Link>
                <p>{state.description || 'Open the map to explore this screen’s events and checks.'}</p>
                <StatusBadge status={state.status} />
              </div>
            </article>
          ))}
        </div>
      )}
      {screens.length > limit && (
        <button type="button" className={styles.loadMore} onClick={() => setLimit((value) => value + 60)}>
          Show more screens ({screens.length - limit} remaining)
        </button>
      )}
    </div>
  );
}

export function JourneysPage() {
  const { view } = useAtlas();
  const { search } = useCatalogFilters();
  const query = search.q?.toLowerCase().trim() ?? '';
  const journeys = (view?.journeys ?? []).filter(
    (journey) =>
      (!search.context || journey.chartIds.some((id) => view?.charts.get(id)?.contextId === search.context)) &&
      (!search.status || journey.status === search.status) &&
      `${journey.name} ${journey.description} ${journey.events.join(' ')}`.toLowerCase().includes(query)
  );
  return (
    <div className={styles.page}>
      <div className={styles.pageHead}>
        <span className={styles.eyebrow}>PATHS THROUGH THE PRODUCT</span>
        <h1>Journeys</h1>
        <p>Follow complete experiences across screens, product areas, and client hand-offs.</p>
      </div>
      <CatalogFilters view={view} noun="journeys" count={journeys.length} />
      {!view ? (
        <p className={styles.empty} role="status">
          Loading journeys…
        </p>
      ) : !journeys.length ? (
        <NoMatches />
      ) : (
        <div className={styles.journeyGrid}>
          {journeys.map((journey) => {
            let chart = view.charts.get(journey.chartIds[0] ?? '');
            const visited = new Set<string>();
            while (chart?.parent && !visited.has(chart.id)) {
              visited.add(chart.id);
              chart = view.charts.get(chart.parent.chartId) ?? chart;
            }
            return (
              <article key={journey.id} className={styles.journeyCard}>
                <div className={styles.cardTop}>
                  <RouteIcon size={22} />
                  <StatusBadge status={journey.status} />
                </div>
                <h2>{journey.name}</h2>
                <p>{journey.description || 'A named path through the product.'}</p>
                <ol className={styles.journeyStops}>
                  {journey.steps.slice(0, 4).map((step) => (
                    <li key={step.index}>
                      <span>{step.index + 1}</span>
                      {step.event}
                    </li>
                  ))}
                  {journey.steps.length > 4 && <li className={styles.moreStops}>+ {journey.steps.length - 4} more steps</li>}
                </ol>
                <div className={styles.cardFoot}>
                  <span>
                    {journey.steps.length} steps · {journey.chartIds.length} {journey.chartIds.length === 1 ? 'chart' : 'charts'}
                  </span>
                  {chart && (
                    <Link to="/chart/$chartId" params={{ chartId: chart.id }} search={(prev) => ({ run: prev.run, journey: journey.id })}>
                      Explore journey
                      <ChevronIcon />
                    </Link>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
