import { createReadStream, existsSync, statSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import path from 'node:path';

import type { Plugin, ViteDevServer } from 'vite';

import type { AtlasChange, ReportSource } from '@crvouga/atlas-schema';

import { isSpecFile, publicReportSources, resolveReportSources, resolveRoots, runsIndex, safeJoin, specIndex, type AtlasRoots } from './atlas-files';

export const ATLAS_DEV_PREFIX = '/__atlas';
export const ATLAS_CHANGE_EVENT = 'atlas:change';

export type { AtlasChange } from '@crvouga/atlas-schema';

const CONTENT_TYPES: Record<string, string> = {
  '.json': 'application/json; charset=utf-8',
  '.yaml': 'text/yaml; charset=utf-8',
  '.yml': 'text/yaml; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.scxml': 'application/scxml+xml; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.mmd': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.vtt': 'text/vtt; charset=utf-8',
  '.zip': 'application/zip'
};

function sendJson(res: ServerResponse, body: unknown) {
  res.statusCode = 200;
  res.setHeader('Content-Type', CONTENT_TYPES['.json']!);
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function notFound(res: ServerResponse) {
  res.statusCode = 404;
  res.end('Not found');
}

function pipe(file: string, res: ServerResponse, range?: { start: number; end: number }) {
  createReadStream(file, range)
    .on('error', () => res.destroy())
    .pipe(res);
}

/** A file with HTTP range support, so videos stream and seek instead of downloading whole. */
function sendFile(res: ServerResponse, file: string, range: string | undefined, immutable: boolean) {
  const stat = statSync(file);
  res.setHeader('Content-Type', CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', immutable ? 'public, max-age=300' : 'no-store');
  const match = range?.match(/^bytes=(\d*)-(\d*)$/);
  if (match && (match[1] || match[2])) {
    const start = match[1] ? Number(match[1]) : Math.max(0, stat.size - Number(match[2]));
    const end = match[1] && match[2] ? Math.min(Number(match[2]), stat.size - 1) : stat.size - 1;
    if (start >= stat.size || start > end) {
      res.statusCode = 416;
      res.setHeader('Content-Range', `bytes */${stat.size}`);
      res.end();
      return;
    }
    res.statusCode = 206;
    res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
    res.setHeader('Content-Length', String(end - start + 1));
    pipe(file, res, { start, end });
    return;
  }
  res.statusCode = 200;
  res.setHeader('Content-Length', String(stat.size));
  pipe(file, res);
}

function watch(server: ViteDevServer, roots: AtlasRoots, sourceId = 'workspace') {
  const pending = { specs: new Set<string>(), runs: new Set<string>() };
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    timer = null;
    for (const scope of ['specs', 'runs'] as const) {
      if (pending[scope].size === 0) continue;
      const files = [...pending[scope]];
      pending[scope].clear();
      const runIds = scope === 'runs' ? [...new Set(files.map((f) => f.split('/')[0]!).filter(Boolean))] : [];
      const change: AtlasChange = { scope, files, runIds, sourceId };
      server.ws.send({ type: 'custom', event: ATLAS_CHANGE_EVENT, data: change });
    }
  };
  const onFs = (file: string) => {
    for (const scope of ['specs', 'runs'] as const) {
      if (scope === 'specs' && sourceId !== 'workspace') continue;
      const rel = path.relative(roots[scope], file);
      if (rel.startsWith('..') || path.isAbsolute(rel)) continue;
      const relPosix = rel.split(path.sep).join('/');
      if (scope === 'specs' && !isSpecFile(relPosix) && relPosix.includes('.')) return;
      if (relPosix.split('/').some((part) => part.startsWith('.'))) return;
      pending[scope].add(relPosix);
      timer ??= setTimeout(flush, 200);
    }
  };
  server.watcher.add([roots.specs, roots.runs]);
  for (const event of ['add', 'change', 'unlink', 'addDir', 'unlinkDir'] as const) server.watcher.on(event, onFs);
  server.httpServer?.once('close', () => {
    if (timer) clearTimeout(timer);
    for (const event of ['add', 'change', 'unlink', 'addDir', 'unlinkDir'] as const) server.watcher.off(event, onFs);
  });
}

/**
 * The dev adapter: serves the specs and runs folders under `/__atlas`, in the same layout the
 * static build publishes, and tells the browser over Vite's HMR channel when either changes.
 */
export function atlasDevPlugin(options: { roots?: AtlasRoots; sources?: ReportSource[] } = {}): Plugin {
  let roots: AtlasRoots;
  let sources: ReportSource[];
  return {
    name: 'atlas-dev',
    apply: 'serve',
    configResolved() {
      roots = options.roots ?? resolveRoots();
      sources = options.sources ?? resolveReportSources(roots);
    },
    configureServer(server) {
      server.config.logger.info(`  atlas  specs ${roots.specs}\n         runs  ${roots.runs}  (${roots.label})`);
      watch(server, roots);
      for (const source of sources) if (source.type === 'directory' && source.id !== 'workspace') watch(server, { ...roots, runs: source.runs }, source.id);
      server.middlewares.use(ATLAS_DEV_PREFIX, (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        let pathname = url.pathname;
        let servedRoots = roots;
        if (pathname === '/sources.json') return sendJson(res, { schemaVersion: 1, sources: publicReportSources(sources) });
        const sourced = pathname.match(/^\/sources\/([a-zA-Z0-9_-]+)(\/.*)$/);
        if (sourced) {
          const source = sources.find((item) => item.id === sourced[1]);
          if (source?.type !== 'directory') return notFound(res);
          servedRoots = { ...roots, runs: source.runs };
          pathname = sourced[2]!;
          if (!pathname.startsWith('/runs/')) return notFound(res);
        }
        if (pathname === '/specs/index.json') return sendJson(res, specIndex(roots.specs, null));
        if (pathname === '/runs/index.json') return sendJson(res, runsIndex(servedRoots.runs));
        const [, scope, ...rest] = pathname.split('/');
        if (scope !== 'specs' && scope !== 'runs') return next();
        const relative = rest.join('/');
        if (scope === 'specs' && !isSpecFile(safeDecode(relative))) return notFound(res);
        const file = safeJoin(servedRoots[scope], relative);
        if (!file || !existsSync(file) || !statSync(file).isFile()) return notFound(res);
        const immutable = scope === 'runs' && !relative.endsWith('manifest.json');
        try {
          sendFile(res, file, req.headers.range, immutable);
        } catch {
          notFound(res);
        }
      });
    }
  };
}
