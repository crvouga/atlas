/**
 * Serve an attachment's bytes safely. A producer chose the media type, and the bytes come from a test
 * run, so they are treated as untrusted: never sniffed, never allowed to run scripts, never embedded by
 * another site. Videos can be sought (HTTP range requests).
 */
/** Headers for bytes that came from a test run: never sniffed, never run, never embedded by another site. */
export const UNTRUSTED_HEADERS: Readonly<Record<string, string>> = {
  'x-content-type-options': 'nosniff',
  // If a page is ever navigated to or framed from this address, it runs as a locked-down document.
  'content-security-policy': "sandbox; default-src 'none'; img-src data:; media-src 'self'; style-src 'unsafe-inline'",
  'cross-origin-resource-policy': 'same-origin'
};

export function attachmentResponse(request: Request, entry: { readonly bytes: Uint8Array; readonly contentType: string }, etag: string): Response {
  // A media type is a short token list; anything with line breaks or odd characters is not one.
  const type = /^[\w.+-]+\/[\w.+-]+(?:\s*;\s*[\w.-]+=[\w.\-"]+)*$/.test(entry.contentType) ? entry.contentType : 'application/octet-stream';
  const headers: Record<string, string> = {
    'content-type': type,
    ...UNTRUSTED_HEADERS,
    'cache-control': 'public, max-age=31536000, immutable',
    'accept-ranges': 'bytes',
    etag
  };
  if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
  const size = entry.bytes.length;
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '');
  if (!range || (range[1] === '' && range[2] === '')) return new Response(entry.bytes as BodyInit, { headers: { ...headers, 'content-length': String(size) } });
  // `bytes=-500` is the last 500 bytes; `bytes=500-` is from 500 on.
  const start = range[1] === '' ? Math.max(0, size - Number(range[2])) : Number(range[1]);
  const end = range[1] === '' || range[2] === '' ? size - 1 : Math.min(Number(range[2]), size - 1);
  if (start >= size || start > end) return new Response(null, { status: 416, headers: { ...headers, 'content-range': `bytes */${size}` } });
  return new Response(entry.bytes.slice(start, end + 1) as BodyInit, { status: 206, headers: { ...headers, 'content-range': `bytes ${start}-${end}/${size}`, 'content-length': String(end - start + 1) } });
}
