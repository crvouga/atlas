import { Link } from '@tanstack/react-router';
import { lazy, Suspense, useState } from 'react';
import { isStatechartFile } from '@crvouga/atlas/schema';
import { useEvidence } from './evidence-context';
import { CheckDetail, ResultRow, type CheckSelection } from './check-detail';
import { TestFilter, useRunningFilter } from './test-filter';
import { Bounded } from './marks';
import { SPEC_KINDS, kindOfFile } from '../spec-kind';
import { currentProject } from '../runtime';
import styles from './evidence.module.css';
const RecordingPage = lazy(() => import('./recording-page').then(module => ({ default: module.RecordingPage })));

/** A project can contain any test runner or spec notation; statecharts are optional. */
export function ProjectHome() {
  const evidence = useEvidence();
  const runningOnly = useRunningFilter();
  const [selection, setSelection] = useState<CheckSelection>({});
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [moment, setMoment] = useState<number | null>(null);
  const kinds = SPEC_KINDS.map(kind => ({ kind, files: evidence.files.filter(kind.accepts) })).filter(entry => entry.files.length);
  const checks = [...evidence.view.unassigned, ...[...evidence.view.specs].filter(([file]) => !kindOfFile(file) && !isStatechartFile(file)).flatMap(([, entry]) => entry.slots)];
  const visible = checks.filter(slot => !runningOnly || slot.status === 'running');
  return <article className={styles.page}>
    <header className={styles.specHead}><h1 className={styles.title}>{currentProject()?.split('-').map(word => word[0]?.toUpperCase() + word.slice(1)).join(' ') || 'Project reports'}</h1></header>
    {evidence.unavailable && <p role="alert" className={styles.notice}>{evidence.unavailable}</p>}
    {kinds.length > 0 && <section className={styles.block}><h2 className={styles.blockTitle}>Specs</h2><ul className={styles.list}>{kinds.map(({ kind, files }) => <li key={kind.id}>
      <Link className={styles.listRow} to="/specs/$kind" params={{ kind: kind.id }} search={{}}><strong>{kind.label}</strong><span>{files.length} {files.length === 1 ? kind.one : kind.many}</span></Link>
    </li>)}</ul></section>}
    {checks.length > 0 && <section className={styles.block}><h2 className={styles.blockTitle}>Tests</h2><TestFilter slots={checks} /><ul className={styles.results}>
      <Bounded items={visible} size={40} more="More tests">{slot => <ResultRow key={slot.key} label={slot.title} slot={slot} open={selectedKey === slot.key} onToggle={() => { setSelectedKey(selectedKey === slot.key ? null : slot.key); setSelection({ check: slot.id }); setRecording(false); }}>
        {recording ? <Suspense fallback={<p role="status">Loading the recording…</p>}><RecordingPage slot={slot} layerId={selection.layer} label={slot.title} back="Test report" moment={moment} onMoment={setMoment} onClose={() => setRecording(false)} /></Suspense>
          : <CheckDetail slot={slot} layerId={selection.layer} reads="steps" select={patch => { setSelection({ check: patch.check ?? slot.id, layer: patch.layer ?? undefined }); if (patch.view === 'recording') { setRecording(true); setMoment(null); } }} />}
      </ResultRow>}</Bounded>
    </ul></section>}
    {!kinds.length && !checks.length && <p className={styles.aside}>No reports yet. Publish tests and specs to this project to populate its report.</p>}
  </article>;
}

export function ProjectSpecIndex() {
  const { files } = useEvidence();
  return <nav className={styles.index} aria-label="Project specs"><h2>Specs</h2><ul>{SPEC_KINDS.filter(kind => files.some(kind.accepts)).map(kind => <li key={kind.id}>
    <Link className={styles.indexRow} to="/specs/$kind" params={{ kind: kind.id }} search={{}}>{kind.label}</Link>
  </li>)}</ul></nav>;
}
