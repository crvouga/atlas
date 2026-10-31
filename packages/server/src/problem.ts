/**
 * @module Problem documents
 *
 * Every error the server answers is an [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) problem document
 * (`application/problem+json`): `type`, `title`, `status`, `detail`, and `error`, a copy of `detail` for clients
 * written before the standard was adopted. Handlers answer however is natural (`{ error }`); one place,
 * {@link asProblem}, makes every error response a problem document, so none can differ.
 */
import { STATUS_CODES } from 'node:http';

const RECOVERY: Readonly<Record<number, string>> = {
  400: 'Correct the request using /api/openapi.json; /llms.txt explains the agent workflow.',
  401: 'Send Authorization: Bearer <read-token> for reads or a publish token for uploads. See /llms.txt.',
  403: 'Check the token role and request origin. Do not retry unchanged; see /llms.txt.',
  404: 'Check the project at /api/projects and the endpoint at /api/openapi.json. Missing evidence is unknown, never passed.',
  413: 'Reduce the upload size or split it into smaller layers before retrying.',
  429: 'Wait for Retry-After when provided, then retry with backoff.',
  503: 'The report or storage is unavailable. Check /readyz and retry with backoff; do not treat this as an empty or passing report.'
};

/** A response for a problem, built directly (used where no handler is involved, such as authentication). */
export function problemResponse(status: number, detail: string, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ type: 'about:blank', title: STATUS_CODES[status] ?? 'Error', status, detail, error: detail, ...(RECOVERY[status] ? { hint: RECOVERY[status] } : {}) }), {
    status,
    headers: { 'content-type': 'application/problem+json', ...headers }
  });
}

/**
 * The response made into a problem document when it is an error (status 400 or more) with a JSON body naming an
 * `error`. Headers (`WWW-Authenticate`, `Retry-After`, `Allow`) and any other body fields are kept. Anything else,
 * including every success, is returned as it is.
 */
export async function asProblem(response: Response): Promise<Response> {
  if (response.status < 400 || !/\bjson\b/.test(response.headers.get('content-type') ?? '') || /problem\+json/.test(response.headers.get('content-type') ?? '')) return response;
  let body: unknown;
  try { body = await response.clone().json(); } catch { return response; }
  if (typeof body !== 'object' || body === null || typeof (body as { error?: unknown }).error !== 'string') return response;
  const { error, ...rest } = body as { error: string } & Record<string, unknown>;
  const headers = new Headers(response.headers);
  headers.set('content-type', 'application/problem+json');
  headers.delete('content-length');
  return new Response(JSON.stringify({ type: 'about:blank', title: STATUS_CODES[response.status] ?? 'Error', status: response.status, detail: error, error, ...(RECOVERY[response.status] ? { hint: RECOVERY[response.status] } : {}), ...rest }), { status: response.status, headers });
}
