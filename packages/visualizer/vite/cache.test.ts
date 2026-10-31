import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer, type ViteDevServer } from 'vite';
import { viewerCacheDir } from './cache';

test('a second viewer optimizer cannot replace the React graph held by a running viewer', async () => {
  const root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'atlas-viewer-cache-')));
  const app = path.join(root, 'packages/visualizer');
  mkdirSync(app, { recursive: true });
  // Optimize real installed React dependencies, with separate dependency sets as server and preview discover them.
  symlinkSync(path.resolve(import.meta.dir, '../../../node_modules'), path.join(root, 'node_modules'), 'dir');
  writeFileSync(path.join(app, 'index.html'), '<script type="module" src="/entry.js"></script>');
  writeFileSync(path.join(app, 'entry.js'), 'import React from "react"; console.log(React.version);');
  const servers: ViteDevServer[] = [];
  const start = async (context: string, include: string[]) => {
    // Keep the cache inside the fixture, so this regression cannot affect a real developer's running viewer.
    const cacheDir = path.join(root, path.basename(viewerCacheDir(app, [context])));
    const server = await createServer({ configFile: false, root: app, cacheDir, logLevel: 'silent',
      optimizeDeps: { include, noDiscovery: true }, server: { host: '127.0.0.1', port: 0 } });
    servers.push(server);
    await server.listen();
    const origin = server.resolvedUrls!.local[0]!;
    const entry = (await server.transformRequest('/entry.js'))!.code;
    const react = entry.match(/from "([^"]*\/react\.js[^\"]*)"/);
    if (!react) throw new Error(`React import missing from transformed entry: ${entry.slice(0, 2000)}`);
    // An optimized dependency request waits for prebundling to complete.
    expect((await fetch(new URL(react![1]!, origin))).ok).toBe(true);
    return path.join(cacheDir, 'deps');
  };
  try {
    const held = await start('server', ['react', 'react-dom/client']);
    const renderer = path.join(held, 'react-dom_client.js');
    const before = readFileSync(renderer, 'utf8');
    const chunks = [...before.matchAll(/from "\.\/(chunk-[^"]+)"/g)].map(match => match[1]!);
    expect(chunks.length).toBeGreaterThan(0);
    const heldChunks = chunks.map(name => [name, readFileSync(path.join(held, name), 'utf8')] as const);
    const preview = await start('preview', ['react', 'zustand']);
    expect(readFileSync(path.join(preview, 'zustand.js'), 'utf8')).toContain('require_react');
    expect(readFileSync(renderer, 'utf8')).toBe(before);
    for (const [name, content] of heldChunks) expect(readFileSync(path.join(held, name), 'utf8')).toBe(content);
  } finally {
    await Promise.all(servers.map(server => server.close()));
    rmSync(root, { recursive: true, force: true });
  }
}, 30_000);
