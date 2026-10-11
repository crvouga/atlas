import styles from './evidence.module.css';

/** A fixed-size visual summary made from the spec itself, available before any run exists. */
export function SpecSnapshot({ title, text, kind }: { title: string; text: string; kind: string }) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 4);
  return (
    <figure className={styles.specSnapshot}>
      <figcaption>Spec snapshot <span>Generated from {kind} source</span></figcaption>
      <svg className={styles.specSnapshotImage} viewBox="0 0 960 260" role="img" aria-label={`Visual summary of ${title}`}>
        <rect width="960" height="260" rx="18" />
        <text className={styles.snapshotTitle} x="32" y="52">{title}</text>
        {lines.map((line, index) => {
          const y = 90 + index * 40;
          return (
            <g key={`${index}-${line}`}>
              <circle cx="42" cy={y - 5} r="5" />
              <rect className={styles.snapshotLine} x="60" y={y - 15} width="868" height="28" rx="7" />
              <text className={styles.snapshotText} x="76" y={y + 4}>{line.slice(0, 112)}{line.length > 112 ? '…' : ''}</text>
            </g>
          );
        })}
        {lines.length === 0 && <text className={styles.snapshotText} x="32" y="112">No readable source lines</text>}
      </svg>
    </figure>
  );
}
