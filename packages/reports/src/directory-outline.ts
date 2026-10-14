import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import type { SpecEntry } from './explorer-types';
import { textFingerprint } from './layer-merge';
import type { ReportOutline } from './layer-types';

const exec = promisify(execFile);
const SKIPPED = new Set(['node_modules', 'dist']);

/** The notation of a spec file. Anything else is named by its extension. */
export function specKindOf(file: string): string {
  if (/\.feature$/i.test(file)) return 'gherkin';
  if (/\.qnt$/i.test(file)) return 'quint';
  if (/\.dmn$/i.test(file)) return 'dmn';
  if (/\.als$/i.test(file)) return 'alloy';
  if (/\.openslo\.ya?ml$/i.test(file)) return 'openslo';
  const extension = file.split('.').at(-1);
  return extension && extension !== file ? extension.toLowerCase() : 'document';
}

function titleOf(file: string, text: string): string {
  if (/\.feature$/i.test(file)) return /^\s*Feature:\s*(.+)$/m.exec(text)?.[1]?.trim() || path.posix.basename(file);
  if (/\.qnt$/i.test(file)) return /^\s*module\s+(\w+)/m.exec(text)?.[1] || path.posix.basename(file);
  return path.posix.basename(file);
}

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async entry => {
    if (entry.name.startsWith('.') || SKIPPED.has(entry.name)) return [];
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return entry.isFile() ? [full] : [];
  }));
  return nested.flat().sort();
}

async function git(cwd: string, args: string[]): Promise<string | null> {
  try {
    return (await exec('git', args, { cwd })).stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * The specs of a directory as the outline a report is laid out on. Each spec is named
 * `specs/<its path inside the directory>`: that is the `specPath` a check uses to say which spec it
 * belongs to. `domain` groups specs in the viewer; it defaults to the project's folder name.
 */
export async function loadDirectoryOutline(directory: string, options: { readonly domain?: string; readonly repoRoot?: string } = {}): Promise<ReportOutline & { readSpec: (specPath: string) => Promise<string | null> }> {
  const root = path.resolve(directory);
  const texts = new Map<string, string>();
  const specs: SpecEntry[] = [];
  for (const file of await walk(root)) {
    const relative = path.relative(root, file).split(path.sep).join('/');
    const text = await readFile(file, 'utf8');
    const specFile = `specs/${relative}`;
    texts.set(specFile, text);
    specs.push({ path: specFile, domain: options.domain ?? (path.basename(options.repoRoot ?? root) || 'product'), kind: specKindOf(relative), title: titleOf(relative, text), fingerprint: textFingerprint(text) });
  }
  const cwd = options.repoRoot ?? root;
  const sha = await git(cwd, ['rev-parse', 'HEAD']);
  return { specs, sha: sha && /^[0-9a-f]{40}$/.test(sha) ? sha : null, changedFiles: [], readSpec: async specPath => texts.get(specPath) ?? null };
}
