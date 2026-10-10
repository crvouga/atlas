import type { SpecEntry } from '@crvouga/atlas-reports/explorer-types';
import { combineLayers, distinctLayers, specPath } from '@crvouga/atlas-reports/layer-merge';
import type { LayerPage, LayerResult, ReportOutline } from '@crvouga/atlas-reports/layer-types';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { reportJson, reportText } from './api';
import { SpecDocument } from './document';
import { LayerResults } from './layer-results';
import { useReportLocation } from './location';
import { Recording } from './recording';
import { SpecOutline } from './spec-outline';
import { ReportLayers } from './report-layers';

export function EvidenceBrowser({ fallbackSpecs = [], readSpec }: { fallbackSpecs?: readonly SpecEntry[]; readSpec?: (path: string) => Promise<string> }) {
  const [query, setQuery] = useState('');
  const [outcome, setOutcome] = useState('all');
  const [selected, setSelected] = useState('');
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [location, updateLocation] = useReportLocation();
  const outline = useQuery({ queryKey: ['report-outline'], queryFn: ({ signal }) => reportJson<ReportOutline>('/outline', signal), staleTime: 30_000, retry: false });
  const evidence = useInfiniteQuery({ queryKey: ['report-layers'], initialPageParam: null as string | null, queryFn: ({ pageParam, signal }) => reportJson<LayerPage>(`/layers${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ''}`, signal), getNextPageParam: page => page.cursor, staleTime: 30_000, retry: false });
  // Show cached/new results immediately, then fill gaps from older pages in the background.
  useEffect(() => { if (evidence.hasNextPage && !evidence.isFetching && !evidence.isError) void evidence.fetchNextPage(); }, [evidence.hasNextPage, evidence.isFetching, evidence.isError, evidence.fetchNextPage]);
  const layers = useMemo(() => distinctLayers(evidence.data?.pages.flatMap(page => page.layers) ?? []), [evidence.data]);
  const current = useMemo(() => outline.data ?? { specs: fallbackSpecs, sha: null, changedFiles: [] }, [outline.data, fallbackSpecs]);
  const combined = useMemo(() => combineLayers(current, layers.filter(layer => !excluded.has(layer.id))), [current, layers, excluded]);
  const all = useMemo(() => [...combined.specs.flatMap(entry => entry.results), ...combined.unassigned], [combined]);
  const matches = (text: string) => text.toLowerCase().includes(query.toLowerCase());
  const results = all.filter(result => (!selected || specPath(result.check.specPath ?? '') === specPath(selected)) && (outcome === 'all' || result.check.status === outcome) && matches(`${result.check.title} ${result.check.specPath ?? ''} ${result.layer.branch ?? ''} ${Object.values(result.parameters).join(' ')}`));
  const document = useQuery({ queryKey: ['outline-document', selected], queryFn: () => readSpec ? readSpec(selected) : reportText(`/outline/spec?path=${encodeURIComponent(selected)}`), enabled: !!selected, retry: false });
  const opened = layers.find(layer => layer.id === location.layer);
  const open = (result: LayerResult) => updateLocation({ layer: result.layer.id, test: result.testId, moment: null, revision: null, source: null });
  const notices = [...new Set(evidence.data?.pages.flatMap(page => page.notices) ?? [])];
  const visibleSpecs = combined.specs.filter(({ spec, results }) => matches(`${spec.path} ${spec.title}`) || results.some(result => matches(result.check.title)));
  const selectedSpec = current.specs.find(spec => spec.path === selected);
  const filtered = !!query || outcome !== 'all';
  return <section className="atlas-reports" aria-label="Specs and evidence">
    <header className="report-heading"><div><h1>Specs & evidence</h1><p className="report-muted">One outline. Evidence from every run.</p></div>
      <button disabled={evidence.isFetching || outline.isFetching} onClick={() => { void outline.refetch(); void evidence.refetch(); }}>{evidence.isFetching || outline.isFetching ? 'Refreshing…' : 'Refresh layers'}</button>
    </header>
    <div className="report-summary" aria-label="Report summary"><span><strong>{current.specs.length}</strong> specs</span><span><strong>{layers.length}</strong> layers</span><span><strong>{all.length}</strong> combined results</span><small>Earlier results stay visible. This is accumulated evidence, not a fresh verification.</small></div>
    <div className="report-controls"><label className="report-search">Find specs or results<input type="search" placeholder="Search names, paths, branches…" value={query} onChange={event => setQuery(event.target.value)} /></label><label>Outcome<select value={outcome} onChange={event => setOutcome(event.target.value)}><option value="all">All outcomes</option><option value="failed">Failed</option><option value="passed">Passed</option><option value="not-run">Not run</option><option value="running">Running</option></select></label>{filtered && <button onClick={() => { setQuery(''); setOutcome('all'); }}>Clear filters</button>}</div>
    {outline.isError && <p className="report-notice" role="alert">Freshness information is unavailable. Available specs and loaded layers remain visible.</p>}
    {evidence.isError && <p className="report-notice" role="alert">Some evidence could not be loaded. <button onClick={() => void (evidence.data ? evidence.fetchNextPage() : evidence.refetch())}>Try again</button></p>}
    {notices.map(notice => <p className="report-notice" role="status" key={notice}>{notice}</p>)}
    <div className="atlas-report-columns"><SpecOutline entries={visibleSpecs} selected={selected} select={setSelected} searching={!!query} />
      <section className="report-workspace" aria-label="Spec details and results"><header className="report-content-heading"><div><h2>{selectedSpec?.title ?? 'All evidence'}</h2><p className="report-muted">{selectedSpec?.path ?? 'Latest completed outcomes for each check and parameter set.'}</p></div>{selected && <button onClick={() => setSelected('')}>All specs</button>}</header>
        {selected && <details className="report-document" key={selected} open><summary>Current spec <span className="report-count">{selectedSpec?.kind}</span></summary>{document.isError ? <p className="report-notice" role="alert">The spec could not be read. <button onClick={() => void document.refetch()}>Retry document</button></p> : document.data !== undefined ? <SpecDocument path={selected} text={document.data} /> : <p role="status">Loading spec…</p>}</details>}
        <LayerResults results={results} open={open} loading={evidence.isFetching} filtered={filtered} />
        {!!combined.unassigned.length && !selected && <p className="report-muted">{combined.unassigned.length} results refer to specs outside the current outline.</p>}
        <ReportLayers layers={layers} excluded={excluded} toggle={id => setExcluded(previous => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; })} />
        {opened && location.test && <section className="report-recording"><button onClick={() => updateLocation({ layer: null, test: null, moment: null })}>Close recording</button><Recording layer={opened.recording?.type === 'layer' ? opened.id : undefined} sha={opened.sha ?? ''} source={opened.source?.source ?? ''} id={location.test} /></section>}
      </section>
    </div>
  </section>;
}
