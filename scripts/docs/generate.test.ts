/**
 * @module Generated documentation tests
 *
 * Hold the documentation to the code: every generated file is current, every guide is listed for agents, every
 * relative link and anchor in the Markdown resolves, and what the agent guide names (schemas, commands) exists.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { REPO } from './coverage';
import { drift, GUIDES } from './generate';

const read = (file: string) => readFileSync(path.join(REPO, file), 'utf8');

/** GitHub's anchor for a heading: lowercase, punctuation dropped, spaces to hyphens. */
const slug = (heading: string) => heading.toLowerCase().replace(/[`*_]/g, '').replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s/g, '-');

function anchorsOf(file: string): Set<string> {
  const seen = new Map<string, number>();
  const anchors = new Set<string>();
  let fenced = false;
  for (const line of read(file).split('\n')) {
    if (/^```/.test(line)) fenced = !fenced;
    const heading = !fenced && /^#{1,6}\s+(.*)$/.exec(line)?.[1];
    if (!heading) continue;
    const base = slug(heading);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    anchors.add(n ? `${base}-${n}` : base);
  }
  return anchors;
}

function markdownFiles(): string[] {
  const out = ['README.md', 'AGENTS.md', ...readdirSync(path.join(REPO, 'docs')).filter(name => name.endsWith('.md')).map(name => `docs/${name}`)];
  for (const pkg of readdirSync(path.join(REPO, 'packages'))) if (existsSync(path.join(REPO, 'packages', pkg, 'README.md'))) out.push(`packages/${pkg}/README.md`);
  return out;
}

describe('generated files', () => {
  test('are what the code generates (run `bun run docs`)', () => {
    expect(drift().map(item => item.file)).toEqual([]);
  });
});

describe('the guides', () => {
  test('every guide in docs/ is listed for agents in llms.txt, or is a generated reference', () => {
    const listed = new Set(GUIDES.map(guide => guide.file));
    const guides = readdirSync(path.join(REPO, 'docs')).filter(name => name.endsWith('.md')).map(name => `docs/${name}`);
    expect(guides.filter(file => !listed.has(file))).toEqual([]);
    for (const file of listed) expect(existsSync(path.join(REPO, file)), file).toBe(true);
  });

  test('every relative link and anchor in the Markdown resolves', () => {
    const broken: string[] = [];
    for (const file of markdownFiles()) {
      let fenced = false;
      for (const line of read(file).split('\n')) {
        if (/^```/.test(line)) { fenced = !fenced; continue; }
        if (fenced) continue;
        for (const match of line.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
          const target = match[1]!;
          if (/^(https?:|mailto:|#$)/.test(target)) continue;
          const [rawPath, anchor] = target.split('#') as [string, string | undefined];
          const resolved = rawPath ? path.posix.normalize(path.posix.join(path.posix.dirname(file), rawPath)) : file;
          if (!existsSync(path.join(REPO, resolved))) { broken.push(`${file}: ${target} (no such file)`); continue; }
          if (anchor && resolved.endsWith('.md') && !anchorsOf(resolved).has(anchor)) broken.push(`${file}: ${target} (no such heading)`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  test('what the agent guide names exists: the schemas of each command, and the generated references', () => {
    const guide = read('docs/agents.md');
    for (const schema of [...guide.matchAll(/^\| .*? \| `([\w-]+)` \|$/gm)].map(match => match[1]!)) {
      expect(existsSync(path.join(REPO, 'packages/schema/schemas', `${schema}.schema.json`)), schema).toBe(true);
    }
    for (const file of ['llms.txt', 'llms-full.txt', 'packages/server/openapi.json', 'docs/reference/cli.md', 'docs/reference/http-api.md']) expect(existsSync(path.join(REPO, file)), file).toBe(true);
  });

  test('llms.txt links only to files that exist in the repository', () => {
    const missing = [...read('llms.txt').matchAll(/\]\(https:\/\/raw\.githubusercontent\.com\/crvouga\/atlas\/main\/([^)]+)\)/g)].map(match => match[1]!).filter(file => !existsSync(path.join(REPO, file)));
    expect(missing).toEqual([]);
  });
});
