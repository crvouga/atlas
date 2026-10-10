import { evidenceFile } from '@crvouga/atlas-reports/export-evidence';
export const staticEvidence = !import.meta.env.DEV && !import.meta.env.VITE_ATLAS_REPORTS_URL;
export const reportsBase = (import.meta.env.VITE_ATLAS_REPORTS_URL as string | undefined)?.replace(/\/$/, '') ?? (staticEvidence ? './data/evidence' : '/api/reports');
export async function reportResponse(path: string, signal?: AbortSignal) {
  const response = await fetch(staticEvidence ? `${reportsBase}/${evidenceFile(path).split('/').map(encodeURIComponent).join('/')}` : `${reportsBase}${path}`, { signal });
  if (!response.ok) throw new Error(response.status === 503 ? 'The reports store is unavailable. Configure a reports storage adapter or read credential.' : `Evidence could not be read (${response.status}).`);
  return response;
}
export async function reportJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  return (await reportResponse(path, signal)).json() as Promise<T>;
}
export async function reportText(path: string, signal?: AbortSignal) {
  return (await reportResponse(path, signal)).text();
}
