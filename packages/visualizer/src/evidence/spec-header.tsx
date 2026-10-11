import type { SpecEvidence } from '@crvouga/atlas-reports/evidence-view';
import { NO_EVIDENCE } from '@crvouga/atlas-reports/evidence-view';
import type { ReactNode } from 'react';

import type { SpecKind } from '../spec-kind';
import { useEvidence } from './evidence-context';
import styles from './evidence.module.css';
import { useNow } from './format';
import { CountLine, Meter, Origin } from './marks';

/** A spec's name, where it lives, and what the combined report holds for it. */
export function SpecHeader({ title, file, kind, entry, planned, children }: { title: string; file: string; kind: SpecKind; entry: SpecEvidence | undefined; planned?: number; children?: ReactNode }) {
  const { backends, ready, unavailable, pending } = useEvidence();
  const now = useNow();
  const summary = entry?.summary ?? NO_EVIDENCE;
  const newest = entry?.slots.flatMap((slot) => slot.outcomes).reduce<(typeof entry.slots)[number]['outcomes'][number] | null>((best, result) => (!best || result.layer.recordedAtMs > best.layer.recordedAtMs ? result : best), null);
  const missing = planned === undefined ? 0 : Math.max(0, planned - summary.total);
  return (
    <header className={styles.specHead}>
      <p className={styles.path}>specs/{file}</p>
      <h1 className={styles.title}>{title}</h1>
      {children}
      <div className={styles.summary}>
        <Meter counts={summary.counts} missing={missing} />
        <p className={styles.summaryLine}>
          {unavailable ? (
            <span>Recorded results are unavailable.</span>
          ) : !ready ? (
            <span role="status">Loading recorded results…</span>
          ) : summary.status === 'none' ? (
            <span>{pending > 0 ? 'Loading recorded results…' : `No completed test report for this ${kind.one} yet.`}</span>
          ) : (
            <>
              <CountLine summary={summary} noun={kind.check} nouns={`${kind.check}s`} />
              {missing > 0 && <span>{missing} without a result</span>}
            </>
          )}
        </p>
        {newest && (
          <p className={styles.summaryOrigin}>
            Latest from <Origin layer={newest.layer} backends={backends} now={now} />
          </p>
        )}
      </div>
    </header>
  );
}

/** The document as written, folded away under what was understood from it. */
export function SourceText({ text, label = 'Source', open = false }: { text: string; label?: string; open?: boolean }) {
  return (
    <details className={styles.source} open={open}>
      <summary>{label}</summary>
      <pre className={styles.code}>
        {text.split('\n').map((line, index) => (
          <span id={`line-${index + 1}`} key={index}>
            {line}
            {'\n'}
          </span>
        ))}
      </pre>
    </details>
  );
}
