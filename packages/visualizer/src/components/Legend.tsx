import { KindIcon } from './labels';
import styles from './Legend.module.css';

export function Legend({ showTime }: { showTime: boolean }) {
  return (
    <div className={styles.legend} role="group" aria-label="Legend">
      <span className={styles.item}>
        <span className={styles.chip} data-kind="user">
          <KindIcon kind="user" size={11} />
        </span>
        User action
      </span>
      <span className={styles.item}>
        <span className={styles.chip} data-kind="system">
          <KindIcon kind="system" size={11} />
        </span>
        System event
      </span>
      {showTime && (
        <span className={styles.item}>
          <span className={styles.chip} data-kind="time">
            <KindIcon kind="time" size={11} />
          </span>
          Time passes
        </span>
      )}
      <span className={styles.item}>
        <span className={styles.chip} data-kind="none" />
        Not reached or not run
      </span>
      <span className={styles.sep} aria-hidden="true" />
      <span className={styles.item}>
        <span className={styles.frame} data-status="passed" />
        Working
      </span>
      <span className={styles.item}>
        <span className={styles.frame} data-status="flaky" />
        Unreliable
      </span>
      <span className={styles.item}>
        <span className={styles.frame} data-status="failed" />
        Broken
      </span>
      <span className={styles.item}>
        <span className={styles.frame} data-status="none" />
        Not checked
      </span>
    </div>
  );
}
