import { Link } from '@tanstack/react-router';

import { useAtlas } from '../app/atlas-context';
import { ChevronIcon } from '../components/icons';
import { KindIcon } from '../components/labels';
import { StatusBadge, StatusDot, SummaryBar } from '../components/Status';
import { worstOf } from '../data/model';
import styles from './views.module.css';

export function ProductPage() {
  const { view } = useAtlas();
  if (!view) {
    return (
      <div className={styles.product}>
        <div className={styles.productInner}>
          <div className={styles.introSkeleton} />
          {[0, 1].map((i) => (
            <div key={i} className={styles.contextSkeleton} />
          ))}
        </div>
      </div>
    );
  }
  const unrun = view.mode === 'spec-only' ? 'spec-only' : 'not-yet-run';
  return (
    <div className={styles.product}>
      <div className={styles.productInner}>
        <div className={styles.intro}>
          <h1>{view.title}</h1>
          <p>
            {view.description ||
              'How the product behaves, part by part: every screen a user can see, every event that moves them on, and whether the latest run of the app did what the spec says.'}
          </p>
          {[...view.charts.values()].filter((chart) => !chart.parent).map((chart) => <Link key={chart.id} to="/chart/$chartId" params={{ chartId: chart.id }} search={(prev) => ({ run: prev.run, explore: true })} className={styles.button}>Explore {chart.name}</Link>)}
        </div>
        <div className={styles.contexts}>
          {view.contexts.map((ctx) => {
            const status = worstOf(
              ctx.chartIds.flatMap((id) => view.charts.get(id)?.states.map((s) => view.states.get(s)!.status) ?? []),
              unrun
            );
            const handOffsOut = view.handOffs.filter((h) => h.fromContext === ctx.id && h.toContext !== ctx.id);
            return (
              <section key={ctx.id} className={styles.context} aria-labelledby={`context-${ctx.id}`}>
                <div className={styles.contextAbout}>
                  <div className={styles.contextHead}>
                    <h2 id={`context-${ctx.id}`}>{ctx.name}</h2>
                    <StatusBadge status={status} />
                  </div>
                  {ctx.description && <p className={styles.contextDescription}>{ctx.description}</p>}
                  <div className={styles.contextBars}>
                    <SummaryBar noun="screen" nounPlural="screens" counts={ctx.screens} verb="working" />
                    <SummaryBar noun="event" nounPlural="events" counts={ctx.events} verb="exercised" />
                    {ctx.journeys.total > 0 && <SummaryBar noun="journey" nounPlural="journeys" counts={ctx.journeys} verb="passed" />}
                  </div>
                </div>
                <div className={styles.contextCharts}>
                  <h3 className={styles.listTitle}>Charts</h3>
                  <ul className={styles.chartList}>
                    {ctx.chartIds.map((id) => {
                      const chart = view.charts.get(id)!;
                      const chartStatus = worstOf(
                        chart.states.map((s) => view.states.get(s)!.status),
                        unrun
                      );
                      return (
                        <li key={id} data-child={Boolean(chart.parent)}>
                          <Link to="/chart/$chartId" params={{ chartId: id }} search={(prev) => ({ run: prev.run })} className={styles.chartLink}>
                            <StatusDot status={chartStatus} />
                            <span className={styles.chartName}>
                              {chart.name}
                              {chart.description && <small>{chart.description}</small>}
                            </span>
                            <span className={styles.chartMeter}>
                              <SummaryBar variant="inline" noun="screen" nounPlural="screens" counts={chart.screens} verb="working" />
                            </span>
                            <ChevronIcon size={14} className={styles.chartGo} />
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                  {handOffsOut.length > 0 && (
                    <>
                      <h3 className={styles.listTitle}>Hands off to</h3>
                      <ul className={styles.handOffs}>
                        {handOffsOut.map((h) => (
                          <li key={`${h.event}-${h.toContext}`}>
                            <span className={styles.inlineChip} data-kind="hand-off">
                              <KindIcon kind="hand-off" size={10} />
                              {h.event}
                            </span>
                            <span>
                              into <strong>{view.contexts.find((c) => c.id === h.toContext)?.name}</strong>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              </section>
            );
          })}
        </div>
        {view.excluded.length > 0 && (
          <section className={styles.excluded}>
            <h2>Not in the spec yet</h2>
            <p>These parts of the product exist but aren’t described, so the map doesn’t show them.</p>
            <ul>
              {view.excluded.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
