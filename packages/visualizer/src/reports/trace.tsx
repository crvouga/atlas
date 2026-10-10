import type { ReportStep } from '@crvouga/atlas-reports/report-types';
import { flattenSteps } from '@crvouga/atlas-reports/frames';
import { useState } from 'react';

export function traceStates(value: unknown): Record<string, unknown>[] | null {
  if (!value || typeof value !== 'object' || !('states' in value) || !Array.isArray(value.states)) return null;
  if (!value.states.every(state => state !== null && typeof state === 'object' && !Array.isArray(state))) return null;
  return value.states as Record<string, unknown>[];
}
/** Read recorded assignment text without evaluating Quint or inventing states. */
export function recordedModelStates(steps: readonly ReportStep[]) {
  return flattenSteps(steps).filter(({ step }) => step.kind === 'quint' && step.detail).map(({ step }) => {
    const state: Record<string, unknown> = { '#action': step.title };
    const assignments = [...step.detail!.matchAll(/^([A-Za-z_]\w*) = ([\s\S]*?)(?=^[A-Za-z_]\w* = |$(?![\s\S]))/gm)];
    for (const match of assignments) state[match[1]!] = match[2]!.trimEnd();
    return { step, state };
  }).filter(({ state }) => Object.keys(state).length > 1);
}
export function ModelTrace({ states, onSelect }: { states: Record<string, unknown>[]; onSelect?: (index: number) => void }) {
  const [selected, setSelected] = useState(0);
  const state = states[selected];
  const previous = states[selected - 1];
  const variables = [...new Set([...Object.keys(previous ?? {}), ...Object.keys(state ?? {})])].filter(name => !name.startsWith('#'));
  return <section><h4>Model trace · {states.length} states</h4>
    {!states.length && <p>No model states were recorded.</p>}
    <nav aria-label="Model trace states">{states.map((_, index) => <span key={index}>{index > 0 && ' → '}<button aria-pressed={selected === index} onClick={() => { setSelected(index); onSelect?.(index); }}>State {index + 1}</button></span>)}</nav>
    {typeof state?.['#action'] === 'string' && <p>{String(state['#action'])}</p>}
    <table><thead><tr><th>Variable</th><th>Previous state</th><th>Selected state</th><th>Change</th></tr></thead><tbody>{variables.map(name => <tr key={name}><th>{name}</th><td><pre>{JSON.stringify(previous?.[name], null, 2) ?? '—'}</pre></td><td><pre>{JSON.stringify(state?.[name], null, 2) ?? '—'}</pre></td><td>{previous && JSON.stringify(previous[name]) !== JSON.stringify(state?.[name]) ? 'Changed' : '—'}</td></tr>)}</tbody></table>
  </section>;
}
