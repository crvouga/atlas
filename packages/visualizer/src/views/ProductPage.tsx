import { Link } from '@tanstack/react-router';

import { useAtlas } from '../app/atlas-context';
import { ChevronIcon } from '../components/icons';
import { KindIcon } from '../components/labels';
import { StatusBadge, StatusDot, SummaryBar } from '../components/Status';
import { worstOf } from '../data/model';
import styles from './views.module.css';
import application from './application.module.css';

export function ProductPage() {
  const { view, sources, reports } = useAtlas();
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
          <span className={application.eyebrow}>YOUR PRODUCT, MAPPED</span>
          <h1>{view.title}</h1>
          <p>
            {view.description ||
              'How the product behaves, part by part: every screen a user can see, every event that moves them on, and whether the latest run of the app did what the spec says.'}
          </p>
          {[...view.charts.values()].filter((chart) => !chart.parent).map((chart) => <Link key={chart.id} to="/chart/$chartId" params={{ chartId: chart.id }} search={(prev) => ({ run: prev.run, explore: true })} className={styles.button}>Explore {chart.name}</Link>)}
        </div>
        <div className={application.overviewMetrics}>
          <Link to="/screens" search={(prev) => ({ run: prev.run })}><span>Screens</span><strong>{view.totals.screens.total}</strong><small>{view.totals.screens.passed} working · {view.totals.screens.failed} broken</small></Link>
          <Link to="/journeys" search={(prev) => ({ run: prev.run })}><span>Journeys</span><strong>{view.journeys.length}</strong><small>{view.totals.journeys.passed} verified paths through the product</small></Link>
          <Link to="/runs" search={(prev) => ({ run: prev.run })}><span>Reports</span><strong>{reports.length}</strong><small>{reports.filter((report) => report.progress === 'running').length} in progress</small></Link>
          <Link to="/sources" search={(prev) => ({ run: prev.run })}><span>Sources</span><strong>{sources.filter((source) => source.enabled).length}</strong><small>Evidence from every backend</small></Link>
        </div>
        {[...view.states.values()].some((state) => state.status === 'failed') && <section className={application.attention} aria-label="Needs attention"><strong>Needs attention</strong><div>{[...view.states.values()].filter((state) => state.status === 'failed' && (state.kind === 'screen' || state.kind === 'final')).slice(0, 5).map((state) => <Link key={state.key} to="/chart/$chartId" params={{ chartId: state.chartId }} search={(prev) => ({ run: prev.run, screen: state.name })}><StatusDot status="failed" />{state.name}<ChevronIcon /></Link>)}</div></section>}
        <div className={application.sectionHead}><div><h2>Product areas</h2><p>{view.contexts.length} areas · {view.charts.size} connected charts · {view.handOffs.length} hand-offs</p></div><Link to="/journeys" search={(prev) => ({ run: prev.run })}>Explore journeys<ChevronIcon /></Link></div>
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
