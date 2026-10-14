/**
 * @module Static export of a report
 *
 * Copies what a running reports API serves (outline, spec texts, layer pages, rows, per-result evidence, recorded
 * files) into an {@link ObjectStore}, one file per URL, so the viewer can be hosted statically. {@link evidenceFile}
 * is the single mapping from an API path to the exported file name; the exporter writes with it and a static host
 * must read with it. Only collected layers are exported (a static site has no running suite).
 */
import { eachLimited } from './completion-order';
import { bundleKeysOf, type CheckDetail } from './evidence-detail';
import { recordingPaths, type EvidencePage, type LayerRows } from './evidence-types';
import { distinctHeaders } from './layer-merge';
import type { ReportOutline } from './layer-types';
import { writeUtf8 } from './object-io';
import type { ObjectStore } from './object-store';
import { capturedFiles } from './frames';
import type { RunReport } from './report-types';

/**
 * Maps a report API path (with its query) to the file an export stores it under, for example `/evidence?cursor=x`
 * to `evidence/pages/x.json` and `/` to `index.json`. Files a layer carries (`/blobs/`, `/files/`, `frame.css`,
 * `report.json`) keep their path so their type stays known by name; everything else gets `.json` appended. Pure.
 */
export function evidenceFile(path: string): string {
  const url = new URL(path || '/', 'http://atlas');
  if (url.pathname === '/') return 'index.json';
  if (url.pathname === '/evidence' && url.searchParams.has('cursor')) return `evidence/pages/${encodeURIComponent(url.searchParams.get('cursor')!)}.json`;
  // One result's evidence: a file per result, named by its check (and kind), beside its layer's own.
  const detail = /^\/evidence\/detail\/([^/]+)\/([^/]+)$/.exec(url.pathname);
  if (detail) {
    const check = url.searchParams.get('check');
    const kind = url.searchParams.get('kind');
    return `evidence/detail/${detail[1]}/${detail[2]}${check === null ? '' : `/${encodeURIComponent(check)}${kind ? `~${encodeURIComponent(kind)}` : ''}`}.json`;
  }
  // A file a layer carries: kept as it is, with its type known by its name.
  if (url.pathname.includes('/blobs/')) return url.pathname.slice(1);
  if (url.pathname.endsWith('/spec')) return `${url.pathname.slice(1, -5)}/specs/${encodeURIComponent(url.searchParams.get('path') ?? '')}.txt`;
  if (url.pathname.includes('/files/') || url.pathname.endsWith('/frame.css') || url.pathname.endsWith('/report.json')) return url.pathname.slice(1);
  return `${url.pathname.slice(1)}.json`;
}

/**
 * Exports the combined report, preserving layer provenance and lazy recording addresses.
 *
 * `args.fetch` answers report API paths (`/outline`, `/evidence?cursor=`, ...), for example the reports app's own
 * `request`. Every response is stored in `args.target` under {@link evidenceFile}, each path once. A 404 or 503 for
 * a path is recorded in `missing` and skipped; any other failure throws, as does a layer catalog that repeats a
 * page. Live runs are left out and each execution is exported once. Nothing in `target` is deleted.
 *
 * @returns `revisions` (distinct commits among the exported layers), `layers` (layers exported) and `missing`
 * (paths that were not there).
 */
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
      // Evidence a result carries: what it says, and every file it points to.
      if (rowsText) {
        const withEvidence = (JSON.parse(rowsText) as LayerRows).rows.filter(row => row.evidence);
        const copyDetail = async (path: string) => {
          const text = await copy(path);
          if (!text) return;
          const read = JSON.parse(text) as CheckDetail | { run: CheckDetail['run'] };
          const keys = new Set([...bundleKeysOf('check' in read ? read.check : {}), ...bundleKeysOf(read.run)]);
          await eachLimited([...keys], 4, key => copy(`/layers/${encodeURIComponent(layer.id)}/blobs/${key.split('/').map(encodeURIComponent).join('/')}`).then(() => {}));
        };
        const base = `/evidence/detail/${encodeURIComponent(layer.backend)}/${encodeURIComponent(layer.id)}`;
        if (layer.evidence) await copyDetail(base);
        for (const row of withEvidence) await copyDetail(`${base}?check=${encodeURIComponent(row.id)}&kind=${encodeURIComponent(row.kind)}`);
      }
      const recording = layer.recording;
      if (!rowsText || !recording) return;
      const tests = new Set((JSON.parse(rowsText) as LayerRows).rows.flatMap(row => row.testId ? [row.testId] : []));
      for (const testId of tests) {
        const paths = recordingPaths(recording, testId);
        await copy(paths.css);
        const raw = await copy(paths.report);
        if (!raw) continue;
        await eachLimited(capturedFiles(JSON.parse(raw) as RunReport), 4, file => copy(paths.file(file)).then(() => {}));
      }
    });
    await writeUtf8(args.target, evidenceFile(path), JSON.stringify(exported), 'application/json');
  }
  return { revisions: revisions.size, layers, missing };
}

