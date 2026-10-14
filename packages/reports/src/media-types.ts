/** Media types by file extension, for attachments whose producer did not say. Anything unknown is `application/octet-stream`. */
const TYPES: Readonly<Record<string, string>> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml', ico: 'image/x-icon', bmp: 'image/bmp',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska', ogv: 'video/ogg',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', flac: 'audio/flac',
  vtt: 'text/vtt', srt: 'application/x-subrip', txt: 'text/plain; charset=utf-8', log: 'text/plain; charset=utf-8', md: 'text/markdown; charset=utf-8', csv: 'text/csv', html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8', css: 'text/css',
  json: 'application/json', ndjson: 'application/x-ndjson', har: 'application/json', xml: 'application/xml', yaml: 'application/yaml', yml: 'application/yaml', pdf: 'application/pdf',
  zip: 'application/zip', gz: 'application/gzip', tgz: 'application/gzip', tar: 'application/x-tar', mmd: 'text/plain; charset=utf-8', diff: 'text/x-diff', patch: 'text/x-diff'
};

export function contentTypeOf(file: string): string {
  return TYPES[file.split('.').at(-1)?.toLowerCase() ?? ''] ?? 'application/octet-stream';
}
