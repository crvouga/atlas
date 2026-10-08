import { Link } from '@tanstack/react-router';

import { useAtlas } from '../app/atlas-context';
import { MapIcon } from '../components/icons';
import { StatusBadge, SummaryBar } from '../components/Status';
import { worstOf } from '../data/model';
import styles from './views.module.css';

export function ProductPage() {
  const { view } = useAtlas();
  if (!view) {
    return (
      <div className={styles.product}>
        <div className={styles.contextGrid}>
          {[0, 1, 2].map((i) => (
            <div key={i} className={styles.contextSkeleton} />
          ))}
        </div>
      </div>
    );
  }
  const unrun = view.mode === 'spec-only' ? 'spec-only' : 'not-yet-run';
  return (
    <div className={styles.product}>
      <div className={styles.intro}>
        <h1>{view.title}</h1>
        <p>
          {view.description ||
            'How the product behaves, part by part: every screen a user can see, every event that moves them on, and whether the latest run of the app did what the spec says.'}
        </p>
      </div>
      <div className={styles.contextGrid}>
        {view.contexts.map((ctx) => {
          const status = worstOf(
            ctx.chartIds.flatMap((id) => view.charts.get(id)?.states.map((s) => view.states.get(s)!.status) ?? []),
            unrun
          );
          const handOffsOut = view.handOffs.filter((h) => h.fromContext === ctx.id && h.toContext !== ctx.id);
          return (
            <article key={ctx.id} className={styles.context}>
              <div className={styles.contextHead}>
                <h2>{ctx.name}</h2>
                <StatusBadge status={status} />
              </div>
              {ctx.description && <p className={styles.contextDescription}>{ctx.description}</p>}
              <div className={styles.contextBars}>
                <SummaryBar noun="screen" nounPlural="screens" counts={ctx.screens} verb="working" />
                <SummaryBar noun="event" nounPlural="events" counts={ctx.events} verb="exercised" />
              </div>
              <ul className={styles.chartList}>
                {ctx.chartIds.map((id) => {
                  const chart = view.charts.get(id)!;
                  return (
                    <li key={id} data-child={Boolean(chart.parent)}>
                      <Link to="/chart/$chartId" params={{ chartId: id }} search={(prev) => ({ run: prev.run })} className={styles.chartLink}>
                        <MapIcon size={14} />
                        <span>{chart.name}</span>
                        <span className={styles.chartCount}>{chart.screens.total} screens</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
              {handOffsOut.length > 0 && (
                <ul className={styles.handOffs}>
                  {handOffsOut.map((h) => (
                    <li key={`${h.event}-${h.toContext}`}>
                      <span className={styles.inlineChip} data-kind="hand-off">
                        {h.event}
                      </span>{' '}
                      → {view.contexts.find((c) => c.id === h.toContext)?.name}
                    </li>
                  ))}
                </ul>
              )}
            </article>
          );
        })}
      </div>
      {view.excluded.length > 0 && (
        <section className={styles.excluded}>
          <h2>Not in the spec yet</h2>
          <p>These parts of the product exist but aren’t described here, so the map doesn’t show them.</p>
          <ul>
            {view.excluded.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
