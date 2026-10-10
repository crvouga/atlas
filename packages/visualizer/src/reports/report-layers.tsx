import type { LayerSummary } from '@crvouga/atlas-reports/layer-types';
import { useState } from 'react';

export function ReportLayers({ layers, excluded, toggle }: { layers: readonly LayerSummary[]; excluded: Set<string>; toggle: (id: string) => void }) {
  const [page, setPage] = useState(0);
  const current = Math.min(page, Math.max(0, Math.ceil(layers.length / 64) - 1));
  return <details className="report-layer-panel"><summary>Contributing layers <span className="report-count">{layers.filter(layer => !excluded.has(layer.id)).length} enabled</span></summary>
    <p className="report-muted">Uncheck a layer to reveal earlier evidence. Each result keeps its recorded origin.</p>
    {!layers.length && <p className="report-empty-hint">No report layers are available yet.</p>}
    <ul className="report-layer-list">{layers.slice(current * 64, (current + 1) * 64).map(layer => <li key={layer.id}><label>
      <input type="checkbox" checked={!excluded.has(layer.id)} onChange={() => toggle(layer.id)} />
      <span><strong>{layer.producer}</strong><span className="report-spec-meta"><span>{layer.branch ?? 'Branch unknown'}</span><code>{layer.sha?.slice(0, 12) ?? 'No revision'}</code><time>{new Date(layer.recordedAtMs).toISOString()}</time></span></span>
    </label></li>)}</ul>
    {layers.length > 64 && <nav className="report-pagination" aria-label="Layer pages"><button disabled={current === 0} onClick={() => setPage(current - 1)}>Previous layers</button><button disabled={(current + 1) * 64 >= layers.length} onClick={() => setPage(current + 1)}>Next layers</button></nav>}
  </details>;
}
