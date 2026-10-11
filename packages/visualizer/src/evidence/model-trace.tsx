import { useState } from 'react';

import type { ModelState } from './quint';
import styles from './recording.module.css';

function shown(value: unknown) {
  if (value === undefined) return '—';
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

/** The states a model run went through, one at a time, with what each step changed. */
export function ModelTrace({ states }: { states: readonly ModelState[] }) {
  const [selected, setSelected] = useState(0);
  if (!states.length) return <p className={styles.quietLine}>No model states were recorded.</p>;
  const at = Math.min(selected, states.length - 1);
  const state = states[at]!;
  const previous = states[at - 1];
  const variables = [...new Set([...Object.keys(previous ?? {}), ...Object.keys(state)])].filter((name) => !name.startsWith('#'));
  const changed = (name: string) => previous !== undefined && JSON.stringify(previous[name]) !== JSON.stringify(state[name]);
  return (
    <div className={styles.trace}>
      <ol className={styles.traceStates} aria-label="Model trace states">
        {states.map((entry, index) => (
          <li key={index}>
            <button type="button" aria-label={`State ${index + 1}`} aria-pressed={at === index} onClick={() => setSelected(index)}>
              <span className={styles.traceNo}>{index + 1}</span>
              <span>{typeof entry['#action'] === 'string' ? entry['#action'] : index === 0 ? 'Start' : 'Step'}</span>
            </button>
          </li>
        ))}
      </ol>
      <div className={styles.tableScroll}>
        <table className={styles.traceTable}>
          <thead>
            <tr>
              <th scope="col">Variable</th>
              <th scope="col">Before</th>
              <th scope="col">State {at + 1}</th>
            </tr>
          </thead>
          <tbody>
            {variables.map((name) => (
              <tr key={name} data-changed={changed(name) || undefined}>
                <th scope="row">
                  {name}
                  {changed(name) && <span className={styles.changed}>Changed</span>}
                </th>
                <td><pre>{previous ? shown(previous[name]) : '—'}</pre></td>
                <td><pre>{shown(state[name])}</pre></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
