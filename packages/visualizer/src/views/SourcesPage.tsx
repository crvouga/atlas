import { RemoteReportSourceSchema } from '@crvouga/atlas-schema';
import { useState, type FormEvent } from 'react';

import { useAtlas } from '../app/atlas-context';
import { useReportSources } from '../app/report-sources';
import { SlidersIcon } from '../components/icons';
import styles from './application.module.css';

export function SourcesPage() {
  const registry = useReportSources();
  const { sources, refresh } = useAtlas();
  const [label, setLabel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [eventsUrl, setEventsUrl] = useState('');
  const [type, setType] = useState<'http' | 'api'>('http');
  const [error, setError] = useState<string | null>(null);
  const add = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const parsed = RemoteReportSourceSchema.safeParse({ id: `browser_${crypto.randomUUID()}`, label: label.trim(), baseUrl: baseUrl.trim(), type, eventsUrl: eventsUrl.trim() || undefined });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? 'Check the source details.'); return; }
    try {
      registry.add(parsed.data);
      setLabel(''); setBaseUrl(''); setEventsUrl(''); setError(null);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'The source could not be added.');
    }
  };
  return (
    <div className={styles.page}>
      <div className={styles.pageHead}><span className={styles.eyebrow}>ONE PRODUCT, MANY SOURCES</span><h1>Report sources</h1><p>Bring local runs, published artifacts, and streaming reports into the same product atlas.</p></div>
      {registry.error && <div className={styles.warning} role="alert">{registry.error} <button type="button" onClick={registry.retry}>Retry configuration</button></div>}
      <div className={styles.sourceGrid}>{registry.entries.map((entry) => {
        const health = sources.find((source) => source.id === entry.backend.id);
        const status = !entry.enabled ? 'Disabled' : health?.loading ? 'Connecting…' : health?.error ? 'Unavailable' : 'Connected';
        return <article key={entry.backend.id} className={styles.sourceCard} data-disabled={!entry.enabled}>
          <div className={styles.cardTop}><SlidersIcon size={22} /><span className={health?.error && entry.enabled ? styles.errorPill : entry.enabled ? styles.runningPill : styles.completePill}>{status}</span></div>
          <h2>{entry.backend.label}</h2><span className={styles.cardArea}>{entry.backend.kind === 'directory' ? 'Local directory · live file updates' : entry.backend.kind === 'api' ? 'Report API' : 'Published report files'}{entry.config.eventsUrl ? ' · event stream' : ''}</span>
          <p className={styles.sourceUrl}>{entry.config.baseUrl}</p>
          <div className={styles.sourceMetrics}><span><strong>{health?.count ?? 0}</strong> reports</span><span><strong>{health?.running ?? 0}</strong> in progress</span></div>
          {entry.enabled && health?.error && <div className={styles.sourceProblem} role="status"><p>{health.error}</p><button type="button" onClick={refresh}>Retry connection</button></div>}
          <div className={styles.cardFoot}><label><input type="checkbox" checked={entry.enabled} onChange={() => registry.toggle(entry.backend.id)} />Include reports</label>{entry.custom && <button type="button" onClick={() => registry.remove(entry.backend.id)}>Remove</button>}</div>
        </article>;
      })}</div>
      <section className={styles.addSource} aria-labelledby="add-source-title">
        <div><span className={styles.eyebrow}>CONNECT A BACKEND</span><h2 id="add-source-title">Add a report source</h2><p>Browser sources are saved on this device. Shared sources and additional local directories can be configured with <code>atlas-visualizer --sources</code>.</p></div>
        <form onSubmit={add}>
          <label>Name<input required maxLength={120} value={label} onChange={(event) => setLabel(event.target.value)} placeholder="e.g. CI reports" /></label>
          <label>Backend type<select value={type} onChange={(event) => setType(event.target.value === 'api' ? 'api' : 'http')}><option value="http">Published files over HTTP</option><option value="api">Report API</option></select></label>
          <label className={styles.fullField}>Base URL<input required type="url" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://reports.example.com/atlas/" /></label>
          <label className={styles.fullField}>Live event URL (optional)<input type="url" value={eventsUrl} onChange={(event) => setEventsUrl(event.target.value)} placeholder="https://reports.example.com/events" /></label>
          <p className={styles.formHint}>{type === 'http' ? 'Reads runs/index.json and each run’s manifest and media.' : 'Reads /runs, /runs/:id/manifest, and /runs/:id/files. Optional server events announce new snapshots.'}</p>
          {error && <p className={styles.sourceProblem} role="alert">{error}</p>}
          <button type="submit" className={styles.primaryButton}>Connect source</button>
        </form>
      </section>
    </div>
  );
}
