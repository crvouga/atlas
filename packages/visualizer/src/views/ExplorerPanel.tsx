import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';

import type { AtlasView } from '../data/model';
import { contractCatalog, contractText } from '../data/model/contracts';
import type { ChartSimulation, ExplorationResult, RouteResult } from '../data/model/simulation';
import { CloseIcon } from '../components/icons';
import { RuleCards } from './RuleCards';
import styles from './explorer.module.css';

const KIND_LABEL = { user: 'Person chooses', system: 'Outside outcome', time: 'Time passes', 'hand-off': 'Automatic hand-off' };

export function ExplorerPanel({ view, chartId, simulation, result, choices, cursor }: {
  view: AtlasView; chartId: string; simulation: ChartSimulation | null; result: ExplorationResult | null; choices: string[]; cursor: number;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');
  const [goal, setGoal] = useState('');
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [shareMessage, setShareMessage] = useState('');
  const sessionKey = JSON.stringify([choices, cursor]);
  useEffect(() => { setRoute(null); }, [sessionKey]);
  const needle = query.trim().toLowerCase();
  const catalog = useMemo(() => contractCatalog(view, simulation?.rootId ?? chartId), [view, simulation, chartId]);
  const ruleMatches = needle ? catalog.filter(({ contract }) => contractText(contract).toLowerCase().includes(needle)) : [];
  const matchingRules = ruleMatches.slice(0, 12);
  const names = useMemo(() => {
    const known = new Set<string>();
    const visit = (id: string) => {
      if (known.has(id)) return;
      known.add(id);
      view.charts.get(id)?.childChartIds.forEach(visit);
    };
    visit(simulation?.rootId ?? chartId);
    return [...view.states.values()].filter((s) => known.has(s.chartId));
  }, [view, simulation, chartId]);
  const stateMatches = needle ? names.filter((s) => `${s.name} ${s.description}`.toLowerCase().includes(needle)) : [];
  const states = stateMatches.slice(0, 12);
  const go = (events: string[], position = events.length) => {
    if (events.length > 1000) { setShareMessage('This exploration reached 1000 choices. Reset to start a new exploration.'); return; }
    setRoute(null);
    setShareMessage('');
    void navigate({ to: '/chart/$chartId', params: { chartId: simulation?.rootId ?? chartId }, search: (prev) => ({ run: prev.run, explore: true, choices: events, cursor: position }) });
  };
  const inspect = (name: string) => void navigate({ to: '/chart/$chartId', params: { chartId }, search: (prev) => ({ ...prev, explore: true, choices, cursor, screen: name, event: undefined }) });
  const askRoute = (name: string) => {
    setGoal(name);
    setRoute(simulation && result ? simulation.route(result.config, name) : { status: 'invalid', events: [], visited: 0 });
  };
  const enabled = simulation && result && !result.error ? simulation.enabled(result.config).map((event) => {
    const next = simulation.advance(result.config, event);
    const ids = next.steps[0]?.transitionIds ?? [];
    const transition = ids.map((id) => view.transitions.get(id)).find(Boolean);
    return { event, next, kind: transition?.kind ?? 'user', timeSpan: transition?.timeSpan };
  }).filter((action) => (kind === 'all' || action.kind === kind) && `${action.event} ${action.next.config.active.join(' ')}`.toLowerCase().includes(needle)) : [];
  const last = result?.steps.at(-1);
  const recent = result?.steps.findLast((step) => !step.handOff) ?? last;
  const active = result && simulation ? simulation.leaves(result.config) : [];

  return (
    <aside className={styles.explorer} aria-label="Free exploration">
      <div className={styles.head}>
        <Link to="/chart/$chartId" params={{ chartId }} search={(prev) => ({ run: prev.run })} className={styles.close} aria-label="Exit exploration"><CloseIcon size={16} /></Link>
        <span className={styles.kicker}>Explore the model</span>
        <h2>Choose what happens next</h2>
        <p>Follow the product’s choices, outside outcomes and time. Conditions are written into outcome names and source rules. This is the specified model; app verification is shown separately.</p>
        <div className={styles.controls} role="group" aria-label="Exploration history">
          <button type="button" onClick={() => go(choices, cursor - 1)} disabled={!cursor}>Undo</button>
          <button type="button" onClick={() => go(choices, cursor + 1)} disabled={cursor >= choices.length}>Redo</button>
          <button type="button" onClick={() => go([])} disabled={!choices.length && !result?.error}>Reset</button>
          <button type="button" onClick={() => {
            void navigator.clipboard?.writeText(window.location.href).then(() => setShareMessage('Exploration link copied.'), () => setShareMessage('Copy the address from your browser to share this exploration.'));
            if (!navigator.clipboard) setShareMessage('Copy the address from your browser to share this exploration.');
          }}>Share</button>
        </div>
        <span className={styles.progress} role="status">{cursor} of {choices.length} choices{shareMessage ? ` · ${shareMessage}` : ''}</span>
      </div>
      <div className={styles.body}>
        {view.issues.some((issue) => issue.severity !== 'info' && !issue.file.startsWith('runs/')) && <p className={styles.warning}>The spec has data issues. Some descriptions or paths may be incomplete; inspect the issues in the header.</p>}
        {!simulation && <p role="alert">This chart cannot be explored. Check the spec’s data issues for missing states or destinations.</p>}
        {result?.error && <p className={styles.warning} role="alert">{result.error} Undo or reset to continue from a valid point.</p>}
        <section aria-label="Current model states">
          <h3>Now active together</h3>
          <ul className={styles.current}>{active.map((name) => <li key={name}><button type="button" onClick={() => inspect(name)}><strong>{name}</strong><small>{view.states.get(name)?.description}</small></button></li>)}</ul>
        </section>
        {last && <section className={styles.outcome} aria-label="Last model outcome">
          <h3>What changed</h3>
          <p>{choices[cursor - 1] ?? last.event}</p>
          <dl><dt>Entered</dt><dd>{last.to.filter((name) => !recent?.from.includes(name)).join(', ') || 'The active states stayed the same.'}</dd><dt>Left</dt><dd>{recent?.from.filter((name) => !last.to.includes(name)).join(', ') || 'No active state was left.'}</dd></dl>
          {last.handOff && <small>Automatic hand-off: {last.event}</small>}
        </section>}
        <label className={styles.search}><span>Search choices, states and rules · {catalog.length} source examples</span><input value={query} onChange={(event) => { setQuery(event.target.value); setRoute(null); }} type="search" placeholder="For example: offline, blocked, rematch" /></label>
        <label className={styles.search}><span>Show events from</span><select value={kind} onChange={(event) => setKind(event.target.value)}><option value="all">Everyone and time</option><option value="user">A person</option><option value="system">Outside the person’s control</option><option value="time">Time passing</option></select></label>
        <section aria-label="Available model events">
          <h3>Available now · {enabled.length}</h3>
          {(['user', 'system', 'time', 'hand-off'] as const).map((eventKind) => {
            const actions = enabled.filter((action) => action.kind === eventKind);
            return actions.length ? <div key={eventKind} className={styles.actionGroup}><h4>{KIND_LABEL[eventKind]}</h4><ul>{actions.map((action) => <li key={action.event}><button type="button" onClick={() => go([...choices.slice(0, cursor), action.event])}><strong>{action.event}</strong><small>{simulation?.leaves(action.next.config).filter((name) => !active.includes(name)).join(', ') || 'Keeps the current states'}{action.timeSpan ? ` · ${action.timeSpan}` : ''}</small></button></li>)}</ul></div> : null;
          })}
          {!enabled.length && !result?.error && <p>{needle || kind !== 'all' ? 'No available events match. Change the search or filter.' : 'This model configuration has no further events.'}</p>}
        </section>
        {states.length > 0 && <section aria-label="Matching model states"><h3>Find a route to a state</h3>{stateMatches.length > states.length && <p>Showing {states.length} of {stateMatches.length} states. Narrow your search for more specific results.</p>}<ul className={styles.results}>{states.map((state) => <li key={state.name}><button type="button" onClick={() => askRoute(state.name)}>{state.name}</button><button type="button" onClick={() => inspect(state.name)}>Inspect</button></li>)}</ul></section>}
        {matchingRules.length > 0 && <section aria-label="Matching business rules"><h3>Rules matching your search</h3>{ruleMatches.length > matchingRules.length && <p>Showing {matchingRules.length} of {ruleMatches.length} examples. Narrow your search for more specific results.</p>}{matchingRules.map(({ contract, state }) => <div key={contract.id}><RuleCards contracts={[contract]} owner={state ?? view.title} />{state && <button type="button" onClick={() => askRoute(state)}>Find route to {state}</button>}</div>)}</section>}
        {route && <section className={styles.outcome} aria-label="Route search result" role="status"><h3>Route to {goal}</h3>{route.status === 'found' ? <><p>{route.events.length ? `${route.events.length} choices from here.` : 'This state is already active.'}{route.transient ? ' This state is visited before an automatic hand-off completes.' : ''}</p><ol>{route.events.map((event, index) => <li key={index}>{event}</li>)}</ol>{route.events.length > 0 && <button type="button" onClick={() => go([...choices.slice(0, cursor), ...route.events])}>Follow this route</button>}</> : <p>{route.status === 'limit' ? `Search stopped after ${route.visited} configurations. Reachability is unknown; choose a nearer state or continue from another point.` : route.status === 'unreachable' ? `No route exists from this point after searching all ${route.visited} reachable configurations. Reset to search from the beginning.` : 'This state is outside the composed chart.'}</p>}</section>}
        {choices.length > 0 && <details className={styles.history}><summary>Choice history</summary><ol>{choices.map((event, index) => <li key={index} data-future={index >= cursor}><button type="button" onClick={() => go(choices, index + 1)} aria-current={index + 1 === cursor ? 'step' : undefined}>{event}</button></li>)}</ol></details>}
      </div>
    </aside>
  );
}
