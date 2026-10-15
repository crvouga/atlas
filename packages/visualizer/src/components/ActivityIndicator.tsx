import styles from './ActivityIndicator.module.css';

/** A quiet indication of active work; reduced motion keeps a static ring. */
export function ActivityIndicator({ label = 'Working' }: { label?: string }) {
  return <span className={styles.activity} role="status" aria-label={label} title={label}><span className={styles.ring} aria-hidden="true" /></span>;
}
