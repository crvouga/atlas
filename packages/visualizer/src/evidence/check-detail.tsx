import { recordingPaths } from '@crvouga/atlas/reports/evidence-types';
import { checkHistory, type CheckSlot, type HistoryEntry } from '@crvouga/atlas/reports/evidence-view';
import { flattenFrames } from '@crvouga/atlas/reports/frames';
import type { ReportStep, RunReport } from '@crvouga/atlas/reports/report-types';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState, type ReactNode } from 'react';

import { reportJson } from './api';
import { useEvidence } from './evidence-context';
import styles from './evidence.module.css';
import { ago, duration, plural, statusWord, useNow } from './format';
import type { FeatureExamples, FeatureStep } from './gherkin';
import { Bounded, Origin, StatusMark } from './marks';
import { ModelTrace } from './model-trace';
import { recordedModelStates } from './quint';

/** What the address says is open: a check, and optionally one particular layer's record of it. */
export type CheckSelection = { readonly check?: string; readonly layer?: string };
export type SelectCheck = (patch: { check?: string | null; layer?: string | null; view?: 'recording' | null }) => void;

/** The recorded timeline of one result, read only when someone opens it. */
export function useRecordedReport(entry: HistoryEntry | null, enabled = true) {
  const address = entry?.layer.recording ?? null;
  const testId = entry?.row.testId ?? null;
  const paths = address && testId ? recordingPaths(address, testId) : null;
  const report = useQuery({
    queryKey: ['evidence-test', paths?.report ?? ''],
    queryFn: ({ signal }) => reportJson<RunReport>(paths!.report, signal),
    enabled: enabled && paths !== null,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false
  });
  return { paths, report };
}

/** One check in a list: its outcome at a glance, and everything recorded for it when opened. */
export function ResultRow({ label, slot, open, onToggle, children }: { label: string; slot: CheckSlot | null; open: boolean; onToggle: () => void; children: ReactNode }) {
  const now = useNow();
  const newest = slot?.outcomes[0];
  const failure = slot?.status === 'failed' ? slot.outcomes.find((outcome) => outcome.row.status === 'failed')?.row.detail.split('\n')[0] : '';
  return (
    <li className={styles.result} data-status={slot?.status ?? 'none'} data-open={open || undefined}>
      <button type="button" className={styles.resultHead} aria-expanded={open} onClick={onToggle}>
        <StatusMark status={slot?.status ?? 'none'} />
        <span className={styles.resultName}>{label}</span>
        {slot?.live && <span className={styles.liveTag}>Running now</span>}
        <span className={styles.resultAside}>
          {newest ? [duration(newest.row.durationMs), slot.live ? '' : ago(slot.latestAtMs, now)].filter(Boolean).join(' · ') : 'No result'}
        </span>
        <span className={styles.chevron} aria-hidden="true" />
      </button>
      {!open && failure && <p className={styles.excerpt}>{failure}</p>}
      {open && <div className={styles.resultBody}>{children}</div>}
    </li>
  );
}

const KEYWORD = /^(Given|When|Then|And|But|\*)\s+/;

function StepLine({ title }: { title: string }) {
  const keyword = KEYWORD.exec(title)?.[1];
  return keyword ? (
    <span className={styles.stepText}>
      <span className={styles.keyword}>{keyword}</span> {title.slice(keyword.length + 1)}
    </span>
  ) : (
    <span className={styles.stepText}>{title}</span>
  );
}

/** The steps a test recorded, each with what happened to it. */
export function RecordedSteps({ steps, nested = false }: { steps: readonly ReportStep[]; nested?: boolean }) {
  return (
    <ol className={styles.steps} data-nested={nested || undefined}>
      {steps.map((step) => (
        <li key={step.index} data-status={step.status}>
          <div className={styles.stepRow}>
            <StatusMark status={step.status} size={14} />
            <StepLine title={step.title} />
            <span className={styles.stepTime}>{duration(step.durationMs)}</span>
          </div>
          {step.error && !step.steps.some((inner) => inner.status === 'failed' && inner.error) && <pre className={styles.error}>{step.error}</pre>}
          {step.steps.length > 0 && (
            <details className={styles.actions} open={step.status === 'failed'}>
              <summary>{plural(step.steps.length, 'recorded action', 'recorded actions')}</summary>
              <RecordedSteps steps={step.steps} nested />
            </details>
          )}
        </li>
      ))}
    </ol>
  );
}

/** A scenario as written, for when nothing has been recorded against it. */
export function PlainSteps({ steps, examples = [] }: { steps: readonly FeatureStep[]; examples?: readonly FeatureExamples[] }) {
  return (
    <>
      <ol className={styles.steps}>
        {steps.map((step, index) => (
          <li key={index}>
            <div className={styles.stepRow}>
              <span className={styles.stepText}>
                <span className={styles.keyword}>{step.keyword}</span> {step.text}
              </span>
            </div>
            {step.docString !== null && <pre className={styles.pre}>{step.docString}</pre>}
            {step.table.length > 0 && <Cells rows={step.table} />}
          </li>
        ))}
      </ol>
      {examples.map((example, index) => (
        <div key={index} className={styles.examples}>
          <p className={styles.aside}>Examples{example.name ? `: ${example.name}` : ''}</p>
          <Cells header={example.header} rows={example.rows} />
        </div>
      ))}
    </>
  );
}

function Cells({ header, rows }: { header?: readonly string[]; rows: readonly (readonly string[])[] }) {
  return (
    <div className={styles.tableScroll}>
      <table className={styles.table}>
        {header && (
          <thead>
            <tr>
              {header.map((cell, index) => (
                <th key={index} scope="col">{cell}</th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {row.map((cell, at) => (
                <td key={at}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function qualification(warning: string | null) {
  // The origin line already says a checkout had local changes or an unknown origin.
  if (!warning || warning.includes('modified checkout') || warning.includes('origin was not captured')) return null;
  return warning;
}

type Props = {
  slot: CheckSlot;
  /** The layer whose record to read. Without it, the result that won the combined report. */
  layerId: string | undefined;
  select: SelectCheck;
  /** How this kind of check reads its recording. */
  reads: 'steps' | 'trace';
  /** The check as written, shown until a recording is read or when there is none. */
  written?: ReactNode;
};

/** Everything recorded for one check: the chosen result, how it went, and every other run of it. */
export function CheckDetail({ slot, layerId, select, reads, written }: Props) {
  const { evidence, backends } = useEvidence();
  const now = useNow();
  const [variant, setVariant] = useState(0);
  const history = useMemo(() => checkHistory(evidence, slot.specPath, slot.id), [evidence, slot.specPath, slot.id]);
  const winner = slot.outcomes[Math.min(variant, slot.outcomes.length - 1)]!;
  const earlier = layerId ? history.find((entry) => entry.layer.id === layerId) : undefined;
  const chosen: HistoryEntry = earlier ?? { layer: winner.layer, row: winner.row };
  const superseded = !slot.outcomes.some((outcome) => outcome.layer.id === chosen.layer.id);
  const { paths, report } = useRecordedReport(chosen);
  const moments = report.data ? flattenFrames(report.data.steps).length : 0;
  const timings = superseded ? [] : slot.diagnostics.filter((entry) => entry.layer.id === chosen.layer.id || slot.diagnostics.length === 1);
  const note = superseded ? 'An earlier result. A newer run replaced it in the combined report.' : qualification(winner.warning);
  const states = reads === 'trace' && report.data ? recordedModelStates(report.data.steps).map((entry) => entry.state) : [];
  const stepsShown = report.data !== undefined && report.data.steps.length > 0 && (reads === 'steps' || states.length === 0);
  // The failed step carries its own message when the steps are on screen.
  const failure = chosen.row.status === 'failed' && !(stepsShown && report.data?.steps.some((step) => step.error)) ? (report.data?.meta.error ?? chosen.row.detail) : '';

  return (
    <div className={styles.detail}>
      {slot.outcomes.length > 1 && !earlier && (
        <div className={styles.variants} role="group" aria-label="Parameter sets">
          {slot.outcomes.map((outcome, index) => (
            <button key={outcome.key} type="button" aria-pressed={index === variant} onClick={() => setVariant(index)}>
              <StatusMark status={outcome.row.status} size={12} />
              {Object.entries(outcome.layer.parameters).map(([name, value]) => `${name}: ${value}`).join(', ') || outcome.layer.producer}
            </button>
          ))}
        </div>
      )}
      <p className={styles.detailMeta}>
        <strong data-status={chosen.row.status}>{statusWord(chosen.row.status)}</strong>
        {chosen.row.durationMs !== null && <span>{duration(chosen.row.durationMs)}</span>}
        <Origin layer={chosen.layer} backends={backends} now={now} />
      </p>
      {note && <p className={styles.note}>{note}</p>}
      {failure && <pre className={styles.error}>{failure}</pre>}
      {report.isLoading && <p className={styles.aside} role="status">Loading what was recorded…</p>}
      {report.isError && (
        <p className={styles.notice} role="alert">
          The recording could not be read. {report.error.message}{' '}
          <button type="button" className={styles.link} onClick={() => void report.refetch()}>Try again</button>
        </p>
      )}
      {report.data && stepsShown && <RecordedSteps steps={report.data.steps} />}
      {states.length > 0 && <ModelTrace states={states} />}
      {!report.data && written}
      {!paths && !written && <p className={styles.aside}>This check has an outcome and no recorded timeline.</p>}
      {timings.flatMap((entry) => entry.row.measurements.map((measurement, index) => {
        const over = measurement.limit !== undefined && measurement.value > measurement.limit;
        return (
          <p key={`${entry.key}:${index}`} className={styles.timingLine} data-over={over || undefined}>
            {measurement.name}: <strong>{Number(measurement.value.toFixed(1))} {measurement.unit}</strong>
            {measurement.limit !== undefined && <span> against an allowance of {measurement.limit} {measurement.unit}</span>}
          </p>
        );
      }))}
      {(moments > 0 || chosen.layer.runUrl) && (
        <p className={styles.actionsLine}>
          {moments > 0 && (
            <button type="button" className={styles.primary} onClick={() => select({ view: 'recording', check: slot.id, layer: earlier ? chosen.layer.id : null })}>
              Open recording <span>{plural(moments, 'moment', 'moments')}</span>
            </button>
          )}
          {chosen.layer.runUrl && <a className={styles.link} href={chosen.layer.runUrl} target="_blank" rel="noreferrer">Open the run</a>}
        </p>
      )}
      {history.length > 1 && (
        <section className={styles.history} aria-label="Other runs of this check">
          <h4>Recorded in {plural(history.length, 'run', 'runs')}</h4>
          <ul>
            <Bounded items={history} size={6} more="Earlier runs">
              {(entry) => {
                const current = entry.layer.id === chosen.layer.id && entry.row.kind === chosen.row.kind;
                return (
                  <li key={`${entry.layer.backend}|${entry.layer.id}|${entry.row.kind}`}>
                    <button type="button" aria-current={current || undefined} onClick={() => select({ layer: slot.outcomes.some((outcome) => outcome.layer.id === entry.layer.id) ? null : entry.layer.id })}>
                      <StatusMark status={entry.row.status} size={14} />
                      <span>{statusWord(entry.row.status)}</span>
                      <Origin layer={entry.layer} backends={backends} now={now} />
                    </button>
                  </li>
                );
              }}
            </Bounded>
          </ul>
        </section>
      )}
    </div>
  );
}
