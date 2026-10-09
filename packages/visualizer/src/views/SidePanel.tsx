import * as Collapsible from '@radix-ui/react-collapsible';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { STATUS_DESCRIPTION, type AtlasView, type StateView, type TransitionView } from '../data/model';
import { ChevronIcon, CloseIcon } from '../components/icons';
import { KIND_LABEL, KindIcon } from '../components/labels';
import { ScreenImage } from '../components/Screen';
import { StatusBadge, StatusDot } from '../components/Status';
import type { MapSelection } from '../map/ChartMap';
import styles from './views.module.css';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      {children}
    </section>
  );
}

function EventLink({ t, view, direction }: { t: TransitionView; view: AtlasView; direction: 'in' | 'out' }) {
  const other = direction === 'in' ? t.source : t.target;
  const otherState = other ? view.states.get(other) : undefined;
  return (
    <Link
      to="/chart/$chartId"
      params={{ chartId: view.states.get(direction === 'in' ? t.target ?? t.source : t.source)?.chartId ?? t.chartId }}
      search={(prev) => ({ run: prev.run, event: t.id, journey: prev.journey })}
      className={styles.eventRow}
    >
      <span className={styles.inlineChip} data-kind={t.kind} data-status={t.status}>
        <KindIcon kind={t.kind} size={10} />
        {t.event}
      </span>
      {otherState && (
        <span className={styles.eventTarget}>
          {direction === 'in' ? 'from' : 'to'} {otherState.name}
        </span>
      )}
    </Link>
  );
}

function Developer({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <Collapsible.Root className={styles.dev}>
      <Collapsible.Trigger className={styles.devTrigger}>
        <ChevronIcon size={12} className={styles.devChevron} />
        For developers
      </Collapsible.Trigger>
      <Collapsible.Content>
        <dl className={styles.devList}>
          {rows
            .filter(([, v]) => v !== null && v !== undefined && v !== '')
            .map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
        </dl>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

function Questions({ view, ids }: { view: AtlasView; ids: string[] }) {
  if (ids.length === 0) return null;
  return (
    <Section title="Open questions">
      <ul className={styles.notes}>
        {ids.map((id) => {
          const q = view.questions.get(id);
          if (!q) return null;
          return (
            <li key={id} className={styles.note}>
              <strong>{q.title}</strong> {q.body}
              {q.specToday && <span className={styles.noteMeta}>Spec today: {q.specToday}</span>}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function ScreenDetails({ view, state }: { view: AtlasView; state: StateView }) {
  const checks = state.result?.checks.length ? state.result.checks : state.specChecks.map((check) => ({ check, passed: null as boolean | null, expected: undefined, actual: undefined }));
  const events = state.result?.businessEvents;
  const incoming = state.incoming.map((id) => view.transitions.get(id)).filter((t): t is TransitionView => Boolean(t) && !t!.carriedBy);
  const outgoing = state.outgoing.map((id) => view.transitions.get(id)).filter((t): t is TransitionView => Boolean(t));
  return (
    <>
      <div className={styles.panelHead}>
        <span className={styles.eyebrow}>Screen</span>
        <StatusBadge status={state.status} />
        {state.confidence === 'assumed' && <span className={styles.assumedBadge}>Assumed, not confirmed</span>}
        <h2 className={styles.panelTitle}>{state.name}</h2>
      </div>
      {state.description && <p className={styles.lead}>{state.description}</p>}
      <p className={styles.statusNote}>{STATUS_DESCRIPTION[state.status]}</p>
      {(state.kind === 'screen' || state.kind === 'final') && (
        <div className={styles.bigShot}>
          <ScreenImage key={state.name} state={state} size="full" />
        </div>
      )}
      {checks.length > 0 && (
        <Section title="What should be on the screen">
          <ul className={styles.checks}>
            {checks.map((c) => (
              <li key={c.check} data-passed={c.passed === null ? 'unknown' : c.passed}>
                <span className={styles.checkMark} aria-hidden="true">
                  {c.passed === null ? '○' : c.passed ? '✓' : '✗'}
                </span>
                <span>
                  {c.check}
                  {c.passed === false && (c.expected || c.actual) && (
                    <span className={styles.expected}>
                      Expected {c.expected ?? 'something else'}, saw {c.actual ?? 'nothing'}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}
      {(state.specBusinessEvents.length > 0 || events) && (
        <Section title="What happens behind the scenes">
          <ul className={styles.checks}>
            {(events?.expected ?? state.specBusinessEvents).map((e) => {
              const missing = events?.missing.includes(e);
              const noSignal = events?.noSignal.includes(e);
              const seen = events?.observed.includes(e);
              return (
                <li key={e} data-passed={missing ? false : seen ? true : 'unknown'}>
                  <span className={styles.checkMark} aria-hidden="true">
                    {missing ? '✗' : seen ? '✓' : '○'}
                  </span>
                  <span>
                    {e}
                    {missing && <span className={styles.expected}>Didn’t happen in this run</span>}
                    {noSignal && <span className={styles.expected}>Can’t be checked yet</span>}
                  </span>
                </li>
              );
            })}
          </ul>
        </Section>
      )}
      {state.knownIssues.length > 0 && (
        <Section title="Known issues">
          <ul className={styles.notes}>
            {state.knownIssues.map((n) => (
              <li key={n.body} className={styles.note}>
                {n.body}
              </li>
            ))}
          </ul>
        </Section>
      )}
      <Questions view={view} ids={state.questionIds} />
      {incoming.length > 0 && (
        <Section title="How users get here">
          <div className={styles.eventList}>
            {incoming.map((t) => (
              <EventLink key={t.id} t={t} view={view} direction="in" />
            ))}
          </div>
        </Section>
      )}
      {outgoing.length > 0 && (
        <Section title="Where they go next">
          <div className={styles.eventList}>
            {outgoing.map((t) => (
              <EventLink key={t.id} t={t} view={view} direction="out" />
            ))}
          </div>
        </Section>
      )}
      {state.deadEnd && <p className={styles.note}>This is where the journey stops: {state.deadEnd}</p>}
      <Developer
        rows={[
          ['State ID', <code key="id">{state.name}</code>],
          ['Spec file', <code key="f">{state.file}</code>],
          ['Snapshot name', state.snapshot ? <code key="s">{state.snapshot}</code> : null],
          ['Sources', state.sources.length ? <ul key="src">{state.sources.map((s) => <li key={s}><code>{s}</code></li>)}</ul> : null],
          ['Quint', state.quint ? <code key="q">{state.quint}</code> : null],
          ['Gherkin', state.gherkin.length ? <ul key="g">{state.gherkin.map((s) => <li key={s}><code>{s}</code></li>)}</ul> : null],
          ['Owner', state.owner],
          ['Tier', state.tier],
          [
            'CloudEvents seen',
            events?.events?.length ? (
              <ul key="ce">
                {events.events.map((e) => (
                  <li key={e.id}>
                    <code>{e.type}</code> from <code>{e.source}</code>
                  </li>
                ))}
              </ul>
            ) : null
          ]
        ]}
      />
    </>
  );
}

/** The run's recording of the event, with the steps it took as captions when the run wrote them. */
function Clip({ t }: { t: TransitionView }) {
  const clip = t.result?.clip;
  if (!clip || clip.state === 'missing') return null;
  if (clip.state === 'processing' || !clip.src) return <p className={styles.clipPending}>The video of this event is still processing.</p>;
  return (
    <figure className={styles.clip}>
      <video key={clip.src} className={styles.video} src={clip.src} poster={clip.poster ?? undefined} controls preload="metadata" playsInline>
        {clip.captions && <track kind="captions" src={clip.captions} srcLang="en" label="Steps" default />}
      </video>
      <figcaption>What the run did{clip.captions ? ', step by step in the captions' : ''}.</figcaption>
    </figure>
  );
}

function EventDetails({ view, t }: { view: AtlasView; t: TransitionView }) {
  const from = view.states.get(t.source);
  const to = t.target ? view.states.get(t.target) : undefined;
  return (
    <>
      <div className={styles.panelHead}>
        <span className={styles.eyebrow} data-kind={t.kind}>
          <KindIcon kind={t.kind} size={11} /> {KIND_LABEL[t.kind]}
        </span>
        <StatusBadge status={t.status} />
        <h2 className={styles.panelTitle}>{t.event}</h2>
      </div>
      <p className={styles.lead}>
        From <strong>{from?.name ?? t.source}</strong> to <strong>{to?.name ?? 'a screen not in the spec'}</strong>.
      </p>
      <p className={styles.statusNote}>{t.result?.reason ?? STATUS_DESCRIPTION[t.status]}</p>
      <Clip t={t} />
      <div className={styles.beforeAfter}>
        {from && (
          <figure>
            <ScreenImage state={from} size="full" />
            <figcaption>Before: {from.name}</figcaption>
          </figure>
        )}
        {to && (
          <figure>
            <ScreenImage state={to} size="full" />
            <figcaption>After: {to.name}</figcaption>
          </figure>
        )}
      </div>
      <Questions view={view} ids={t.questionIds} />
      <Developer
        rows={[
          ['Transition ID', <code key="id">{t.id}</code>],
          ['Who sends it', `${KIND_LABEL[t.kind]} (${t.kindSource === 'guess' ? 'guessed from the wording' : `from the ${t.kindSource}`})`],
          ['How the run drives it', t.result?.how ?? null]
        ]}
      />
    </>
  );
}

function JourneyDetails({ view, journeyId, chartId }: { view: AtlasView; journeyId: string; chartId: string }) {
  const j = view.journeys.find((x) => x.id === journeyId);
  if (!j) return <p className={styles.lead}>This journey isn’t in the spec.</p>;
  return (
    <>
      <div className={styles.panelHead}>
        <span className={styles.eyebrow}>Journey</span>
        <StatusBadge status={j.status} />
        <h2 className={styles.panelTitle}>{j.name}</h2>
      </div>
      {j.description && <p className={styles.lead}>{j.description}</p>}
      {!j.replay.ok && <p className={styles.warn}>The chart can’t follow this journey past “{j.replay.failedAt ?? j.replay.missingEnds.join(', ')}”.</p>}
      <ol className={styles.steps}>
        {j.steps.map((step, i) => {
          const t = view.transitions.get(step.transitionIds[0] ?? '');
          if (!t) return null;
          const here = view.transitions.get(t.id)?.chartId === chartId || [...view.transitions.values()].some((x) => x.carriedBy === t.id && x.chartId === chartId);
          return (
            <li key={i} data-here={here}>
              <Link to="/chart/$chartId" params={{ chartId: t.chartId }} search={(prev) => ({ run: prev.run, journey: j.id, event: t.id })} className={styles.step}>
                <span className={styles.stepNo}>{i + 1}</span>
                <span className={styles.inlineChip} data-kind={t.kind} data-status={t.status}>
                  <KindIcon kind={t.kind} size={10} />
                  {t.event}
                </span>
                <StatusDot status={t.status} />
              </Link>
            </li>
          );
        })}
      </ol>
    </>
  );
}

export function SidePanel({ view, chartId, selection }: { view: AtlasView; chartId: string; selection: MapSelection }) {
  const state = selection.screen ? view.states.get(selection.screen) : undefined;
  const transition = selection.event ? view.transitions.get(selection.event) : undefined;
  let body: ReactNode;
  let label: string;
  if (state) {
    body = <ScreenDetails view={view} state={state} />;
    label = `Screen: ${state.name}`;
  } else if (transition) {
    body = <EventDetails view={view} t={transition} />;
    label = `Event: ${transition.event}`;
  } else if (selection.journey) {
    body = <JourneyDetails view={view} journeyId={selection.journey} chartId={chartId} />;
    label = 'Journey';
  } else {
    body = <p className={styles.lead}>This item isn’t in the spec any more. It may have been renamed or removed.</p>;
    label = 'Not found';
  }
  return (
    <aside className={styles.panel} aria-label={label}>
      <Link
        to="/chart/$chartId"
        params={{ chartId }}
        search={(prev) => ({ run: prev.run, journey: state || transition ? prev.journey : undefined })}
        className={styles.close}
        aria-label="Close panel"
      >
        <CloseIcon size={16} />
      </Link>
      <div className={styles.panelBody}>{body}</div>
    </aside>
  );
}
