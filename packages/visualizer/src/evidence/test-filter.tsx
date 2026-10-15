import type { CheckSlot } from '@crvouga/atlas/reports/evidence-view';
import { useUiStore } from '../state/ui-store';
import styles from './evidence.module.css';

/** Filter actual test rows as well as the spec index. Counts always describe the whole document. */
export function TestFilter({ slots }: { slots: readonly CheckSlot[] }) {
  const filter = useUiStore(s => s.resultFilter);
  const setFilter = useUiStore(s => s.setResultFilter);
  const running = slots.filter(slot => slot.status === 'running').length;
  return <>
    <div className={styles.filters} role="group" aria-label="Test status">
      <button type="button" aria-pressed={filter !== 'running'} onClick={() => setFilter('all')}>All tests <span>{slots.length}</span></button>
      <button type="button" aria-pressed={filter === 'running'} onClick={() => setFilter('running')}>Running <span>{running}</span></button>
    </div>
    {filter === 'running' && running === 0 && <p className={styles.aside} role="status">No running tests.</p>}
  </>;
}

export function useRunningFilter() {
  return useUiStore(s => s.resultFilter === 'running');
}
