import { checkHistory, type CheckSlot, type HistoryEntry } from '@crvouga/atlas-reports/evidence-view';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { reportText } from './api';
import { useRecordedReport } from './check-detail';
import { useEvidence } from './evidence-context';
import styles from './evidence.module.css';
import { duration, statusWord, useNow } from './format';
import { Origin, StatusMark } from './marks';
import { Timeline } from './recording';

type Props = {
  /** The check whose recording is open, once the combined report holds it. */
  slot: CheckSlot | undefined;
  layerId: string | undefined;
  label: string;
  back: string;
  moment: number | null;
  onMoment: (moment: number, replace: boolean) => void;
  onClose: () => void;
};

/** One recorded test, opened in place of its spec. */
export function RecordingPage({ slot, layerId, label, back, moment, onMoment, onClose }: Props) {
  const { evidence, backends, pending, ready, unavailable } = useEvidence();
  const now = useNow();
  const history = useMemo(() => (slot ? checkHistory(evidence, slot.specPath, slot.id) : []), [evidence, slot]);
  const winner = slot?.outcomes[0];
  const chosen: HistoryEntry | null = (layerId ? history.find((entry) => entry.layer.id === layerId) : undefined) ?? (winner ? { layer: winner.layer, row: winner.row } : null);
  const { paths, report } = useRecordedReport(chosen);
  const css = useQuery({ queryKey: ['evidence-css', paths?.css ?? ''], queryFn: ({ signal }) => reportText(paths!.css, signal), enabled: paths !== null, staleTime: Number.POSITIVE_INFINITY, retry: false });
  const waiting = !chosen && !unavailable && (!ready || pending > 0);
  return (
    <article className={styles.page} data-wide="true" aria-label="Recorded test">
      <button type="button" className={styles.back} onClick={onClose}>
        <span aria-hidden="true">←</span> {back}
      </button>
      <header className={styles.specHead}>
        <h1 className={styles.title}>{label}</h1>
        {chosen && (
          <p className={styles.detailMeta}>
            <StatusMark status={chosen.row.status} />
            <strong data-status={chosen.row.status}>{statusWord(chosen.row.status)}</strong>
            {chosen.row.durationMs !== null && <span>{duration(chosen.row.durationMs)}</span>}
            <Origin layer={chosen.layer} backends={backends} now={now} />
          </p>
        )}
      </header>
      {waiting && <p className={styles.aside} role="status">Loading the recording…</p>}
      {!chosen && !waiting && <p className={styles.notice}>{unavailable ?? 'This result is not in the combined report any more. A newer run may have replaced it, or its source is switched off.'}</p>}
      {chosen && !paths && <p className={styles.notice}>This result has an outcome and no recorded timeline.</p>}
      {report.isLoading && <p className={styles.aside} role="status">Loading the recording…</p>}
      {report.isError && (
        <p className={styles.notice} role="alert">
          The recording could not be read. {report.error.message}{' '}
          <button type="button" className={styles.link} onClick={() => void report.refetch()}>Try again</button>
        </p>
      )}
      {css.isError && (
        <p className={styles.notice} role="alert">
          The recorded stylesheet could not be read, so pictures appear unstyled.{' '}
          <button type="button" className={styles.link} onClick={() => void css.refetch()}>Try again</button>
        </p>
      )}
      {report.data && paths && <Timeline report={report.data} fileUrl={paths.file} css={css.data ?? ''} moment={moment} onMoment={onMoment} />}
    </article>
  );
}
