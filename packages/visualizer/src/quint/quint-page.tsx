import type { RunReport } from '@crvouga/atlas-reports/report-types';
import { useQuery } from '@tanstack/react-query';
import { useSearch } from '@tanstack/react-router';
import { keys, useAdapter } from '../data/queries';
import { RecordedChecks } from '../inspect/recorded-checks';
import { SpecFileIndex, useSpecFiles } from '../inspect/spec-file-index';
import { reportJson } from '../reports/api';
import { useReportLocation } from '../reports/location';
import { ModelTrace, recordedModelStates } from '../reports/trace';
import { inspectorFor } from '../spec-kind';
import styles from '../views/views.module.css';
import { QuintDocument } from './quint-document';
import '../reports/reports.css';

function specFile(path: string) {
  return path.replace(/^specs\//, '');
}

export function QuintIndex() {
  const index = useSpecFiles((path) => inspectorFor(path) === 'quint');
  return <SpecFileIndex label="Modules" files={index.files} pending={index.isPending} error={index.isError} empty="No Quint modules in this spec set." to="/quint" />;
}

function QuintTrace({ layer, id, onClose }: { layer: string; id: string; onClose: () => void }) {
  const base = `/layers/${layer}/tests/${encodeURIComponent(id)}`;
  const report = useQuery({ queryKey: ['evidence-test', base], queryFn: ({ signal }) => reportJson<RunReport>(`${base}/report.json`, signal), retry: false });
  const states = report.data ? recordedModelStates(report.data.steps).map((entry) => entry.state) : [];
  return (
    <article className={styles.plateScroll} aria-label="Quint trace">
      <h1 className={styles.plateTitle}>{report.data?.meta.title ?? 'Trace'}</h1>
      {report.isPending && <p className={styles.lead}>Loading the trace…</p>}
      {report.isError && <p role="alert">The trace could not be read.</p>}
      {report.data && <ModelTrace states={states} />}
      <button type="button" className={styles.button} onClick={onClose}>Close trace</button>
    </article>
  );
}

export function QuintPage() {
  const adapter = useAdapter();
  const search = useSearch({ strict: false });
  const [location, updateLocation] = useReportLocation();
  const file = typeof search.spec === 'string' ? specFile(search.spec) : '';
  const text = useQuery({ queryKey: keys.specFile(file), queryFn: () => adapter.specFile(file), enabled: file.length > 0 && inspectorFor(file) === 'quint', retry: false });
  const close = () => updateLocation({ layer: null, test: null, moment: null });
  if (location.layer && location.test) return <QuintTrace layer={location.layer} id={location.test} onClose={close} />;
  if (!file) {
    return (
      <article className={styles.plateScroll}>
        <h1 className={styles.plateTitle}>Quint</h1>
        <p className={styles.lead}>Pick a module in the index. Each module is state, actions, and definitions.</p>
      </article>
    );
  }
  if (inspectorFor(file) !== 'quint') {
    return (
      <article className={styles.plateScroll}>
        <h1 className={styles.plateTitle}>Quint</h1>
        <p className={styles.lead}>This file is not a Quint module.</p>
      </article>
    );
  }
  return (
    <article className={styles.plateScroll}>
      {text.isPending && <p className={styles.lead}>Loading the module…</p>}
      {text.isError && <p role="alert">The module could not be read.</p>}
      {text.data !== undefined && <QuintDocument path={file} text={text.data} />}
      <RecordedChecks file={file} heading="Traces" openLabel="Open trace" onOpen={(layerId, testId) => updateLocation({ layer: layerId, test: testId, moment: null })} />
    </article>
  );
}
