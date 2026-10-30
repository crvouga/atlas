/**
 * @module Generated documentation tests
 *
 * Hold the documentation to the code: every generated file is current, every guide is listed for agents, every
 * relative link and anchor in the Markdown resolves, and what the agent guide names (schemas, commands) exists.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import YAML from 'yaml';

import { DOCUMENTED_ROOTS, REPO } from './coverage';
import { BLOCK_FILES, drift, GUIDES, obsoleteOutputs, renderDocument } from './generate';

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
  const out = ['README.md', 'AGENTS.md', ...readdirSync(path.join(REPO, 'docs'), { recursive: true, encoding: 'utf8' }).filter(name => name.endsWith('.md')).map(name => `docs/${name}`)];
  for (const pkg of readdirSync(path.join(REPO, 'packages'))) if (existsSync(path.join(REPO, 'packages', pkg, 'README.md'))) out.push(`packages/${pkg}/README.md`);
  return out;
}

describe('generated files', () => {
  test('are what the code generates (run `bun run docs`)', () => {
    expect(drift().map(item => item.file)).toEqual([]);
  });

  test('deleting both markers cannot silently opt a document out of regeneration', () => {
    for (const [name, files] of Object.entries(BLOCK_FILES)) {
      for (const file of files) {
        const removed = read(file).replace(`<!-- generated:${name} -->`, '').replace(`<!-- /generated:${name} -->`, '');
        expect(() => renderDocument(file, removed), `${file}: ${name}`).toThrow('Missing required generated blocks');
      }
    }
  });

  test('adding a generated block must register it so future marker removal is detected', () => {
    expect(() => renderDocument('README.md', `${read('README.md')}\n<!-- generated:package-managers -->\n<!-- /generated:package-managers -->`)).toThrow('not registered for this file in BLOCK_FILES');
  });

  test('detects obsolete references and schemas instead of leaving stale agent documentation', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'atlas-docs-inventory-'));
    try {
      for (const directory of ['docs/reference', 'packages/schema/schemas']) mkdirSync(path.join(root, directory), { recursive: true });
      writeFileSync(path.join(root, 'docs/reference/current.md'), 'current');
      writeFileSync(path.join(root, 'docs/reference/removed.md'), 'stale');
      writeFileSync(path.join(root, 'packages/schema/schemas/removed.json'), '{}');
      expect(obsoleteOutputs(new Set(['docs/reference/current.md']), root)).toEqual(['docs/reference/removed.md', 'packages/schema/schemas/removed.json']);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('every library source folder is covered and source/published public exports agree', () => {
    const libraries = readdirSync(path.join(REPO, 'packages')).filter(name => existsSync(path.join(REPO, 'packages', name, 'src')));
    // The visualizer is an application, documented separately from the public library API.
    expect(libraries.filter(name => name !== 'visualizer').sort()).toEqual(DOCUMENTED_ROOTS.map(root => path.basename(path.dirname(root))).sort());
    const pkg = JSON.parse(read('package.json'));
    expect(Object.keys(pkg.exports).sort()).toEqual(Object.keys(pkg.publishConfig.exports).sort());
  });

  test('CI explicitly gates checked commits and releases on the documentation contracts', () => {
    const workflow = YAML.parse(read('.github/workflows/ci.yml'));
    const step = workflow.jobs.check.steps.find((step: { run?: string }) => step.run === 'bun run docs --check');
    expect(step).toBeDefined();
    expect(step.if).toBeUndefined();
    expect(step['continue-on-error']).toBeUndefined();
    expect(workflow.jobs.release.needs).toBe('check');
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

  test('Atlas imports in documentation examples resolve through real public exports to existing source files', () => {
    const pkg = JSON.parse(read('package.json')) as { name: string; exports: Record<string, string | { default: string }> };
    const broken: string[] = [];
    for (const file of markdownFiles()) {
      for (const match of read(file).matchAll(/(?:from\s+|import\s*\(|require\s*\()\s*['"](@crvouga\/atlas(?:\/[^'"]*)?)['"]/g)) {
        const specifier = match[1]!;
        if (/[<*>]/.test(specifier)) continue; // documented module/schema placeholders, not literal imports
        const subpath = specifier === pkg.name ? '.' : `.${specifier.slice(pkg.name.length)}`;
        const entry = Object.entries(pkg.exports).find(([key]) => key === subpath || (key.includes('*') && subpath.startsWith(key.split('*')[0]!) && subpath.endsWith(key.split('*')[1]!)));
        if (!entry) { broken.push(`${file}: ${specifier} is not a public export`); continue; }
        const [key, value] = entry;
        const target = typeof value === 'string' ? value : value.default;
        const [before, after] = key.split('*');
        const resolved = key.includes('*') ? target.replace('*', subpath.slice(before!.length, after ? -after.length : undefined)) : target;
        if (!existsSync(path.join(REPO, resolved))) broken.push(`${file}: ${specifier} resolves to missing ${resolved}`);
      }
    }
    expect(broken).toEqual([]);
  });
});
