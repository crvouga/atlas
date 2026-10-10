import type { ReportSnapshotBlob, ReportStepHit } from '@crvouga/atlas-reports/report-types';
import { cleanSnapshotHtml } from '@crvouga/atlas-reports/phone';
import { drawHit } from '@crvouga/atlas-reports/snapshot-surface';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ModelTrace, traceStates } from './trace';
import { reportResponse } from './api';

export function snapshotDocument(html: string, css: string) {
  const policy = "default-src 'none'; style-src 'unsafe-inline' https:; img-src data: https:; font-src data: https:";
  return `<!doctype html><meta http-equiv="Content-Security-Policy" content="${policy}"><style>${css.replaceAll('</style', '<\\/style')}</style>${cleanSnapshotHtml(html)}`;
}

export function highlightRecordedSnapshot(doc: Document, hit: ReportStepHit | null) {
  return drawHit(doc, hit);
}

export function Snapshot({ base, blob, css, hit }: { base: string; blob: ReportSnapshotBlob; css: string; hit: ReportStepHit | null }) {
  const [hitState, setHitState] = useState('none');
  const content = useQuery({ queryKey: ['evidence-blob', base, blob.file], queryFn: async ({ signal }) => {
    const response = await reportResponse(`${base}/files/${blob.file.split('/').map(encodeURIComponent).join('/')}`, signal);
    if (blob.media === 'png' || blob.media === 'bytes') {
      const bytes = new Uint8Array(await response.arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
      return `data:${response.headers.get('content-type') ?? 'application/octet-stream'};base64,${btoa(binary)}`;
    }
    return response.text();
  }, retry: false });
  return <section><h4>{blob.nodeId ?? blob.name} · {blob.name}</h4>
    {content.isPending && <p>Loading recorded snapshot…</p>}
    {content.isError && <p role="alert">{String(content.error)} <button onClick={() => void content.refetch()}>Try again</button></p>}
    {content.data !== undefined && (blob.media === 'html' ? <iframe title={`Recorded ${blob.nodeId ?? blob.name}`} sandbox="allow-same-origin" onLoad={event => { const doc = event.currentTarget.contentDocument; if (doc) { setHitState(highlightRecordedSnapshot(doc, hit)); } }} srcDoc={snapshotDocument(content.data, css)} /> : blob.media === 'png' ? <img alt={`Recorded ${blob.nodeId ?? blob.name}`} src={content.data} /> : blob.media === 'bytes' ? <a download={blob.file.split('/').at(-1)} href={content.data}>Download captured data</a> : <SnapshotData text={content.data} />)}
    {hitState === 'missing' && <p>The recorded control cannot be found in this picture.</p>}
  </section>;
}

export function SnapshotData({ text }: { text: string }) {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return <pre>{text}</pre>; }
  const states = traceStates(value);
  return states ? <ModelTrace states={states} /> : <DataValue value={value} />;
}
function DataValue({ value }: { value: unknown }) {
  if (value === null || typeof value !== 'object') return <span>{JSON.stringify(value)}</span>;
  return <dl>{Object.entries(value).map(([key, item]) => <div key={key}><dt>{key}</dt><dd>{item !== null && typeof item === 'object' ? <details><summary>{Array.isArray(item) ? `${item.length} items` : `${Object.keys(item).length} fields`}</summary><DataValue value={item} /></details> : <DataValue value={item} />}</dd></div>)}</dl>;
}
