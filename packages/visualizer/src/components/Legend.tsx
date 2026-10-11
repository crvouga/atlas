import { KindIcon } from './labels';
import styles from './Legend.module.css';

export function Legend({ showTime, showHandOff = false }: { showTime: boolean; showHandOff?: boolean }) {
  return (
    <div className={styles.legend} role="group" aria-label="Legend">
      <div className={styles.group}>
        <span className={styles.heading}>Events, by who sends them</span>
        <span className={styles.item}>
          <span className={styles.chip} data-kind="user">
            <KindIcon kind="user" size={10} />
          </span>
          User action
        </span>
        <span className={styles.item}>
          <span className={styles.chip} data-kind="system">
            <KindIcon kind="system" size={10} />
          </span>
          System event
        </span>
        {showTime && (
          <span className={styles.item}>
            <span className={styles.chip} data-kind="time">
              <KindIcon kind="time" size={10} />
            </span>
            Time passes
          </span>
        )}
        {showHandOff && (
          <span className={styles.item}>
            <span className={styles.chip} data-kind="hand-off">
              <KindIcon kind="hand-off" size={10} />
            </span>
            Hand-off
          </span>
        )}
        <span className={styles.item}>
          <span className={styles.chip} data-kind="none" />
          Not reached or not run
        </span>
      </div>
      <div className={styles.group}>
        <span className={styles.heading}>Screens, by the latest result</span>
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
      <div className={styles.group}>
        <span className={styles.heading}>Moving around</span>
        <span className={styles.hint}>Drag to pan, scroll or pinch to zoom.</span>
        <span className={styles.hint}>
          <kbd>/</kbd> find a state, <kbd>F</kbd> fit the map
        </span>
      </div>
    </div>
  );
}
