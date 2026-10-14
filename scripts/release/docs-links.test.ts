import { describe, expect, it } from 'bun:test';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

/**
 * The documentation ships in the package, so a project that installed it reads it from
 * `node_modules`. A relative link to a file that is not in the package is dead there. Links to
 * anything that does not ship must be absolute, to the repository.
 */
const root = path.resolve(import.meta.dirname, '..', '..');
const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { files: string[] };
const ALWAYS = ['README.md', 'LICENSE', 'package.json', 'CHANGELOG.md'];

function pattern(glob: string): RegExp {
  return new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')}$`);
}
const patterns = manifest.files.map((entry) => ({ entry, expression: pattern(entry) }));

function shipsFile(relative: string): boolean {
  return ALWAYS.includes(relative) || patterns.some(({ entry, expression }) => expression.test(relative) || relative.startsWith(`${entry}/`));
}

function shipsAnythingUnder(relative: string): boolean {
  const walk = (directory: string): string[] => readdirSync(path.join(root, directory)).flatMap((name) => {
    const child = path.posix.join(directory, name);
    return statSync(path.join(root, child)).isDirectory() ? (name === 'node_modules' ? [] : walk(child)) : [child];
  });
  return walk(relative).some(shipsFile);
}

// CHANGELOG.md is written by the release, so it is not in the repository to check.
const SHIPPED_DOCS = manifest.files.filter((entry) => entry.endsWith('.md') && !entry.includes('*') && existsSync(path.join(root, entry)));
const documents = [
  'README.md',
  ...SHIPPED_DOCS,
  ...readdirSync(path.join(root, 'packages')).map((name) => `packages/${name}/README.md`).filter((file) => existsSync(path.join(root, file)))
];

describe('links in the shipped documentation', () => {
  it('lists the documents that ship', () => {
    expect(documents).toContain('docs/integrating.md');
    expect(documents).toContain('docs/report-contract.md');
  });

  for (const document of documents) {
    it(`${document} links only to files that ship, or to the repository by URL`, () => {
      const text = readFileSync(path.join(root, document), 'utf8').replace(/```[\s\S]*?```/g, '');
      const dead: string[] = [];
      for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
        if (/^(https?:|mailto:|#)/.test(target!)) continue;
        const relative = path.posix.normalize(path.posix.join(path.posix.dirname(document), target!.split('#')[0]!));
        if (!existsSync(path.join(root, relative))) dead.push(`${target} does not exist`);
        else if (statSync(path.join(root, relative)).isDirectory() ? !shipsAnythingUnder(relative) : !shipsFile(relative)) dead.push(`${target} is not in the package`);
      }
      expect(dead).toEqual([]);
    });
  }
});
