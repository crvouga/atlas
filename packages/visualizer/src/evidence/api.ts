import { evidenceFile } from '@crvouga/atlas/reports/export-evidence';

/** A built site without a reports API reads the evidence exported beside it. */
export const staticEvidence = !import.meta.env.DEV && !import.meta.env.VITE_ATLAS_REPORTS_URL;
export const reportsBase = (import.meta.env.VITE_ATLAS_REPORTS_URL as string | undefined)?.replace(/\/$/, '') ?? (staticEvidence ? './data/evidence' : '/api/reports');

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

export async function reportResponse(path: string, signal?: AbortSignal) {
  const url = staticEvidence ? `${reportsBase}/${evidenceFile(path).split('/').map(encodeURIComponent).join('/')}` : `${reportsBase}${path}`;
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
