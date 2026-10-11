import { eachLimited } from './completion-order';
import { recordingPaths, type EvidencePage, type LayerRows } from './evidence-types';
import { distinctHeaders } from './layer-merge';
import type { ReportOutline } from './layer-types';
import { writeUtf8 } from './object-io';
import type { ObjectStore } from './object-store';
import type { RunReport, ReportStep } from './report-types';

export function evidenceFile(path: string): string {
  const url = new URL(path || '/', 'http://atlas');
  if (url.pathname === '/') return 'index.json';
  if (url.pathname === '/evidence' && url.searchParams.has('cursor')) return `evidence/pages/${encodeURIComponent(url.searchParams.get('cursor')!)}.json`;
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
  const pages: { path: string; page: EvidencePage }[] = [];
  do {
    const path = `/evidence${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`;
    if (seen.has(path)) throw new Error('Layer catalog repeated a page');
    seen.add(path);
    const response = await args.fetch(path);
    if (!response.ok) throw new Error(`Cannot export report layers: ${response.status}`);
    const page = await response.json() as EvidencePage;
    pages.push({ path, page });
    cursor = page.cursor;
  } while (cursor);
  // A static site has no running suite: only collected layers are exported, each execution once.
  const kept = new Set(distinctHeaders(pages.flatMap(({ page }) => page.layers.filter(layer => !layer.live))).map(layer => `${layer.backend}|${layer.id}`));
  let layers = 0;
  for (const { path, page } of pages) {
    const exported: EvidencePage = { ...page, active: [], layers: page.layers.filter(layer => kept.has(`${layer.backend}|${layer.id}`)) };
    await eachLimited(exported.layers, 4, async layer => {
      layers++;
      if (layer.sha) revisions.add(layer.sha);
      const rowsText = await copy(`/evidence/rows/${encodeURIComponent(layer.backend)}/${encodeURIComponent(layer.id)}`);
      const recording = layer.recording;
      if (!rowsText || !recording) return;
      const tests = new Set((JSON.parse(rowsText) as LayerRows).rows.flatMap(row => row.testId ? [row.testId] : []));
      for (const testId of tests) {
        const paths = recordingPaths(recording, testId);
        await copy(paths.css);
        const raw = await copy(paths.report);
        if (!raw) continue;
        await eachLimited([...frameFiles((JSON.parse(raw) as RunReport).steps)], 4, file => copy(paths.file(file)).then(() => {}));
      }
    });
    await writeUtf8(args.target, evidenceFile(path), JSON.stringify(exported), 'application/json');
  }
  return { revisions: revisions.size, layers, missing };
}
function frameFiles(steps: readonly ReportStep[], files = new Set<string>()): Set<string> {
  for (const step of steps) {
    for (const frame of step.frames) for (const blob of frame.snapshots) files.add(blob.file);
    frameFiles(step.steps, files);
  }
  return files;
}
