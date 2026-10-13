import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'bun:test';

const SRC = path.dirname(fileURLToPath(import.meta.url));
const ENTRY = path.join(SRC, 'main.tsx');
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*|@import\s+(?:url\(\s*)?|\burl\(\s*|new URL\(\s*)['"]([^'"]+)['"]/g;
const SUFFIXES = ['', '.ts', '.tsx', '.css', '/index.ts', '/index.tsx'];

function filesUnder(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(file) : [file];
  });
}

function resolve(from: string, specifier: string): string | null {
  if (!specifier.startsWith('.')) return null;
  const base = path.resolve(path.dirname(from), specifier.split('?')[0]!);
  for (const suffix of SUFFIXES) if (fs.statSync(base + suffix, { throwIfNoEntry: false })?.isFile()) return base + suffix;
  return null;
}

function reachableFrom(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  for (let file = queue.pop(); file; file = queue.pop()) {
    if (seen.has(file)) continue;
    seen.add(file);
    if (!/\.(tsx?|css)$/.test(file)) continue;
    for (const match of fs.readFileSync(file, 'utf8').matchAll(SPECIFIER)) {
      const next = resolve(file, match[1]!);
      if (next) queue.push(next);
    }
  }
  return seen;
}

/** Test support and license texts are never part of the page. */
function isExempt(file: string): boolean {
  return /\.test\.tsx?$/.test(file) || /\.d\.ts$/.test(file) || /\.(txt|md)$/.test(file) || file.split(path.sep).includes('testing');
}

it('every module of the viewer is part of the page it serves', () => {
  // regression: atlas-explorer-old-shell
  // A merge that keeps one side's shell leaves the other side's interface in the tree, unused and unseen.
  const reachable = reachableFrom(ENTRY);
  const unused = filesUnder(SRC)
    .filter((file) => !isExempt(file) && !reachable.has(file))
    .map((file) => path.relative(SRC, file).split(path.sep).join('/'))
    .sort();
  expect(unused).toEqual([]);
});
