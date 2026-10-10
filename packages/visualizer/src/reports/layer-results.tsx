import type { LayerResult } from '@crvouga/atlas-reports/layer-types';
import { useState } from 'react';

export function LayerResults({ results, open, loading = false, filtered = false }: { results: readonly LayerResult[]; open: (result: LayerResult) => void; loading?: boolean; filtered?: boolean }) {
  const [page, setPage] = useState(0);
  const pages = Math.max(1, Math.ceil(results.length / 64));
  const current = Math.min(page, pages - 1);
  return <section className="report-results" aria-label="Recorded outcomes">
    <div className="report-section-heading"><h3>Recorded outcomes <span className="report-count">{results.length}</span></h3>{loading && <span className="report-muted" role="status">Loading evidence…</span>}</div>
    {!results.length ? <div className="report-empty" role="status"><h3>{loading ? 'Gathering report layers' : filtered ? 'No results match these filters' : 'No recorded evidence yet'}</h3><p>{loading ? 'Available results will appear as the layers arrive.' : filtered ? 'Try another search or clear the filters.' : 'Browse a spec to read its promises. Completed runs will fill in the outcomes here.'}</p></div> :
    <table className="report-result-table"><thead><tr><th scope="col">Check</th><th scope="col">Outcome</th><th scope="col">Evidence</th></tr></thead><tbody>{results.slice(current * 64, (current + 1) * 64).map(result => <tr key={result.key}>
      <td><strong className="report-result-title">{result.check.title}</strong><span className="report-muted report-result-kind">{result.kind}</span><div className="report-tags">{Object.entries(result.parameters).map(([name, value]) => <span key={name}>{name}: {value}</span>)}</div></td>
      <td><span className="report-status" data-status={result.check.status}>{result.check.status.replace('-', ' ')}</span>{result.warning && <span className="report-freshness" title={result.warning}>{result.warning.startsWith('Potentially') ? 'Potentially outdated' : 'Freshness unknown'}</span>}</td>
      <td>{result.testId && <button className="report-open" onClick={() => open(result)}>Open recording</button>}<details className="report-result-detail"><summary>Details & origin</summary>
        {result.warning && <p className="report-notice" role="note">{result.warning}</p>}
        <p>{result.check.detail || 'No additional detail recorded.'}</p>
        {result.check.measurements.map((measurement, i) => <p key={i}>{measurement.name}: <strong>{measurement.value} {measurement.unit}</strong></p>)}
        <dl className="report-provenance"><dt>Branch</dt><dd>{result.layer.branch ?? 'Unknown'}</dd><dt>Revision</dt><dd><code>{result.layer.sha?.slice(0, 12) ?? 'Unknown'}</code></dd><dt>Recorded</dt><dd><time>{new Date(result.layer.recordedAtMs).toISOString()}</time></dd><dt>Producer</dt><dd>{result.layer.producer}</dd><dt>Layer</dt><dd><code>{result.layer.id.slice(0, 12)}</code></dd></dl>
      </details></td>
    </tr>)}</tbody></table>}
    {pages > 1 && <nav className="report-pagination" aria-label="Result pages"><button disabled={current === 0} onClick={() => setPage(current - 1)}>Previous results</button><span>{current + 1} / {pages}</span><button disabled={current + 1 === pages} onClick={() => setPage(current + 1)}>Next results</button></nav>}
  </section>;
}
