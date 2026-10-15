import type { CheckSlot } from '@crvouga/atlas/reports/evidence-view';
import { StatusMark } from '../evidence/marks';
import styles from '../evidence/evidence.module.css';
import { useLiveTests, type LiveTest } from './live-runs';
import { testsForSlot } from './report-progress';

export function useTestProgress(slot: CheckSlot | null) {
  const { index, error } = useLiveTests();
  return { tests: slot ? testsForSlot(index, slot) : [], error };
}

/** A test's own progress log. Historical evidence stays available below it. */
export function TestProgress({ tests, error }: { tests: readonly LiveTest[]; error?: string | null }) {
  if (!tests.length) return null;
  return <div aria-label="Test progress">
    {tests.map(({ run, check }) => {
      const running = run.status === 'running' && check.status === 'running';
      const interrupted = run.status === 'interrupted' && check.status === 'not-run';
      const status = running ? 'running' : interrupted ? 'not-run' : check.status === 'running' ? 'not-run' : check.status;
      return <div key={`${run.id}:${check.id}`}>
        <p className={styles.detailMeta} role="status"><StatusMark status={status} />
          <strong>{running ? 'Running' : interrupted ? 'Interrupted' : status === 'passed' ? 'Passed' : status === 'failed' ? 'Failed' : 'Not run'}</strong>
          <span>{run.producer}{run.environment ? ` · ${run.environment}` : ''}</span>
        </p>
        {check.detail && check.detail !== run.reason && <pre className={styles.pre}>{check.detail}</pre>}
        {!!check.steps?.length && <ol className={styles.steps} aria-label="Progress log">{check.steps.map((step, index) => <li key={index}>
          <div className={styles.stepRow}><StatusMark status={step.status === 'passed' || step.status === 'failed' || step.status === 'running' ? step.status : 'none'} size={14} /><span className={styles.stepText}>{step.name}</span></div>
        </li>)}</ol>}
        {interrupted && <p className={styles.notice} role="status">{run.reason ?? 'The test run was interrupted.'} No completed outcome was received for this test.</p>}
      </div>;
    })}
    {error && <p className={styles.notice} role="alert">{error}</p>}
  </div>;
}
