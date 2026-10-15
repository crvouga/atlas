import { evidenceFile } from '@crvouga/atlas/reports/export-evidence';

import { runtimeConfig } from '../runtime';

/**
 * An Atlas server writes its address book into the page it serves (`atlas serve`, and `atlas dev` through
 * Vite), so one build of the viewer works for every project. A build can instead be pointed at a reports
 * API when it is made.
 */
const runtime = runtimeConfig;

/** A built site without a reports API reads the evidence exported beside it. */
export const staticEvidence = !import.meta.env.DEV && !import.meta.env.VITE_ATLAS_REPORTS_URL && !runtime()?.reportsUrl;
export const reportsBase = (import.meta.env.VITE_ATLAS_REPORTS_URL as string | undefined)?.replace(/\/$/, '') ?? runtime()?.reportsUrl?.replace(/\/$/, '') ?? (staticEvidence ? './data/evidence' : '/api/reports');

/** Does the server answer `/evidence/effective`: the whole report in one request, without per-layer history? */
export const effectiveEvidence = () => runtime()?.effective === true;

export class ReportsError extends Error {
  constructor(
    readonly status: number | null,
    message: string
  ) {
    super(message);
  }
}

function explain(status: number) {
  if (status === 503) return 'The reports store is unavailable. Configure a reports storage adapter or read credential.';
  if (status === 404) return 'This evidence is not in the report store.';
  return `Evidence could not be read (${status}).`;
}

/** A captured file's address in the browser. Pictures and video use it directly; fetches use the same address. */
export function reportAssetUrl(path: string): string {
  const base = runtime()?.reportsUrl?.replace(/\/$/, '') ?? reportsBase;
  return staticEvidence ? `${base}/${evidenceFile(path).split('/').map(encodeURIComponent).join('/')}` : `${base}${path}`;
}

export async function reportResponse(path: string, signal?: AbortSignal) {
  const url = reportAssetUrl(path);
  let response: Response;
  try {
    response = await fetch(url, { signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ReportsError(null, 'The reports server could not be reached.');
  }
  if (!response.ok) throw new ReportsError(response.status, explain(response.status));
  return response;
}

export async function reportJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  return (await reportResponse(path, signal)).json() as Promise<T>;
}

export async function reportText(path: string, signal?: AbortSignal) {
  return (await reportResponse(path, signal)).text();
}
