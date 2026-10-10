import type { SpecEntry } from '@crvouga/atlas-reports/explorer-types';
import type { LayerResult } from '@crvouga/atlas-reports/layer-types';

type Entry = { spec: SpecEntry; results: LayerResult[] };
export function SpecOutline({ entries, selected, select, searching }: { entries: readonly Entry[]; selected: string; select: (path: string) => void; searching: boolean }) {
  const groups = new Map<string, Entry[]>();
  for (const entry of entries) {
    const group = entry.spec.domain || 'Overview';
    const entries = groups.get(group) ?? [];
    entries.push(entry);
    groups.set(group, entries);
  }
  return <aside className="report-sidebar" aria-label="Spec outline">
    <details className="report-outline" open>
      <summary className="report-section-heading">Browse specs <span className="report-count">{entries.length}</span></summary>
      <nav aria-label="Specifications">
        <button className="report-spec-row" aria-pressed={!selected} onClick={() => select('')}><strong>All specs</strong><span className="report-muted">Combined evidence</span></button>
        {!entries.length && <p className="report-empty-hint">No specs match your search.</p>}
        {[...groups].map(([domain, specs]) => <details className="report-domain" key={domain} open={searching || specs.some(entry => entry.spec.path === selected)}>
          <summary>{domain.replaceAll('-', ' ')}<span className="report-count">{specs.length}</span></summary>
          {specs.map(({ spec, results }) => <button className="report-spec-row" key={spec.path} aria-pressed={selected === spec.path} onClick={() => select(spec.path)} title={spec.path}>
            <span className="report-spec-title">{spec.title}</span><span className="report-spec-meta"><span>{spec.kind}</span><span>{results.length ? `${results.length} results` : 'No recorded evidence'}</span></span>
          </button>)}
        </details>)}
      </nav>
    </details>
  </aside>;
}
