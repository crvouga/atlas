import { ITEM_STATUSES, STATUS_LABEL, type ItemStatus, type StatusCounts } from '../data/model';
import styles from './Status.module.css';

export function StatusDot({ status }: { status: ItemStatus }) {
  return <span className={styles.dot} data-status={status} aria-hidden="true" />;
}

export function StatusBadge({ status, label }: { status: ItemStatus; label?: string }) {
  return (
    <span className={styles.badge} data-status={status}>
      <StatusDot status={status} />
      {label ?? STATUS_LABEL[status]}
    </span>
  );
}

const BAR_ORDER: ItemStatus[] = ['passed', 'flaky', 'failed', 'not-reached', 'not-yet-run', 'spec-only'];

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * A segmented bar: working, unreliable, broken, not reached, then whatever the run didn't cover.
 * With no run at all it shows the spec's count in the same shape. `inline` sets the count beside
 * a short bar, for the header.
 */
export function SummaryBar({
  noun,
  nounPlural,
  counts,
  verb,
  variant = 'stacked'
}: {
  noun: string;
  nounPlural: string;
  counts: StatusCounts;
  verb: string;
  variant?: 'stacked' | 'inline';
}) {
  const unrun = counts['spec-only'] === counts.total;
  const pct = (n: number) => (counts.total ? (n / counts.total) * 100 : 0);
  const description = unrun
    ? `${plural(counts.total, noun, nounPlural)}, not yet run`
    : `${counts.passed} of ${counts.total} ${nounPlural} ${verb}` +
      (counts.failed ? `, ${counts.failed} broken` : '') +
      (counts.flaky ? `, ${counts.flaky} unreliable` : '') +
      (counts['not-reached'] ? `, ${counts['not-reached']} not reached` : '') +
      (counts['not-yet-run'] ? `, ${counts['not-yet-run']} not in this run` : '');
  const problem = counts.failed ? 'failed' : counts.flaky ? 'flaky' : null;
  return (
    <div className={styles.summary} data-variant={variant} data-problem={problem ?? undefined} title={description}>
      <div className={styles.summaryLabel}>
        {unrun ? (
          <>
            <strong>{counts.total}</strong> {counts.total === 1 ? noun : nounPlural}
            {variant === 'stacked' && <span className={styles.summaryVerb}>, not yet run</span>}
          </>
        ) : (
          <>
            <strong>
              {counts.passed + counts.flaky}
              <span className={styles.of}>/{counts.total}</span>
            </strong>{' '}
            {nounPlural}
            {variant === 'stacked' && <span className={styles.summaryVerb}> {verb}</span>}
          </>
        )}
      </div>
      <div className={styles.bar} role="img" aria-label={description} data-unrun={unrun}>
        {!unrun &&
          BAR_ORDER.map((status) =>
            counts[status] ? <span key={status} className={styles.seg} data-status={status} style={{ width: `${pct(counts[status])}%` }} /> : null
          )}
      </div>
    </div>
  );
}

export { ITEM_STATUSES };
