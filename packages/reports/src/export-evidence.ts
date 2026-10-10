import { layerExecutionKey } from './layer-merge';
import type { ObjectStore } from './object-store';
import { writeUtf8 } from './object-io';
import type { LayerPage, ReportOutline } from './layer-types';
import type { RunReport, ReportStep } from './report-types';
import { eachLimited } from './completion-order';

export function evidenceFile(path: string): string {
  const url = new URL(path || '/', 'http://atlas');
  if (url.pathname === '/') return 'index.json';
  if (url.pathname === '/layers' && url.searchParams.has('cursor')) return `layers/pages/${encodeURIComponent(url.searchParams.get('cursor')!)}.json`;
  if (url.pathname.endsWith('/spec')) return `${url.pathname.slice(1, -5)}/specs/${encodeURIComponent(url.searchParams.get('path') ?? '')}.txt`;
  if (url.pathname.includes('/files/') || url.pathname.endsWith('/frame.css') || url.pathname.endsWith('/report.json')) return url.pathname.slice(1);
  return `${url.pathname.slice(1)}.json`;
}

/** Export the combined report, preserving layer provenance and lazy recording addresses. */
export async function exportEvidence(args: { fetch: (path: string) => Promise<Response>; target: ObjectStore }) {
  const missing: string[] = [];
  const copied = new Map<string, Promise<string | null>>();
  function copy(path: string): Promise<string | null> {
    let pending = copied.get(path);
    if (!pending) {
      pending = (async () => {
        const response = await args.fetch(path);
        if (response.status === 404 || response.status === 503) { missing.push(path); return null; }
        if (!response.ok) throw new Error(`Evidence export failed at ${path}: ${response.status}`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        await args.target.put(evidenceFile(path), bytes, response.headers.get('content-type') ?? 'application/octet-stream');
        return new TextDecoder().decode(bytes);
      })();
      copied.set(path, pending);
    }
    return pending;
  }
  const outlineText = await copy('/outline');
  if (outlineText) await eachLimited((JSON.parse(outlineText) as ReportOutline).specs, 8, entry => copy(`/outline/spec?path=${encodeURIComponent(entry.path)}`).then(() => {}));
  let cursor: string | null = null;
  const revisions = new Set<string>();
  const seen = new Set<string>();
  let layers = 0;
  const archived = new Set<string>();
  do {
    const path = `/layers${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`;
    if (seen.has(path)) throw new Error('Layer catalog repeated a page');
    seen.add(path);
    const response = await args.fetch(path);
    if (!response.ok) throw new Error(`Cannot export report layers: ${response.status}`);
    const incoming = await response.json() as LayerPage;
    for (const layer of incoming.layers) if (/^[0-9a-f]{64}$/.test(layer.id)) archived.add(layerExecutionKey(layer));
    const page: LayerPage = { ...incoming, layers: incoming.layers.filter(layer => /^[0-9a-f]{64}$/.test(layer.id) || !archived.has(layerExecutionKey(layer))) };
    await eachLimited(page.layers, 4, async layer => {
      layers++;
      if (layer.sha) revisions.add(layer.sha);
      if (!layer.recording || !layer.source) return;
      const base = layer.recording.type === 'layer' ? `/layers/${layer.id}` : `/${layer.recording.sha}`;
      await copy(`${base}/frame.css`);
      for (const test of layer.source.tests) {
        const testBase = layer.recording.type === 'layer' ? `${base}/tests/${encodeURIComponent(test.testId)}` : `${base}/tests/${encodeURIComponent(layer.source.source)}/${encodeURIComponent(test.testId)}`;
        const raw = await copy(layer.recording.type === 'layer' ? `${testBase}/report.json` : testBase);
        if (!raw) continue;
        await eachLimited([...frameFiles((JSON.parse(raw) as RunReport).steps)], 4, file => copy(`${testBase}/files/${file.split('/').map(encodeURIComponent).join('/')}`).then(() => {}));
      }
    });
    await writeUtf8(args.target, evidenceFile(path), JSON.stringify(page), 'application/json');
    cursor = page.cursor;
  } while (cursor);
  return { revisions: revisions.size, layers, missing };
}
function frameFiles(steps: readonly ReportStep[], files = new Set<string>()): Set<string> {
  for (const step of steps) {
    for (const frame of step.frames) for (const blob of frame.snapshots) files.add(blob.file);
    frameFiles(step.steps, files);
  }
  return files;
}
