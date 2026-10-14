import { execFile } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

import { isStatechartFile } from '../../schema/src/spec';
import type { SpecEntry } from './explorer-types';
import { textFingerprint } from './layer-merge';
import type { ReportOutline } from './layer-types';

const exec = promisify(execFile);
const SKIPPED = new Set(['node_modules', 'dist', '.git', '.cache']);
const MAX_BYTES = 2 * 1024 * 1024;

/** Every file the viewer reads from a specs directory: charts, journeys, notations and notes. */
export function isSpecFile(file: string): boolean {
  return /\.scxml$/i.test(file) || /(^|\/)([\w.-]+\.)?machine\.(ya?ml|json)$/.test(file) || isStatechartFile(file) || /\.(feature|qnt|dmn|als|md|ya?ml|json|xml|csv|txt)$/i.test(file);
}

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

export function specTitleOf(file: string, text: string): string {
  if (/\.feature$/i.test(file)) return /^\s*Feature:\s*(.+)$/m.exec(text)?.[1]?.trim() || path.posix.basename(file);
  if (/\.qnt$/i.test(file)) return /^\s*module\s+(\w+)/m.exec(text)?.[1] || path.posix.basename(file);
  return path.posix.basename(file);
}

export type SpecFileText = { readonly path: string; readonly text: string };

/**
 * The spec files of a directory, named `specs/<path inside it>`: the one definition of what a spec is,
 * shared by the outline a report is laid over and by the specs that are published. Hidden, large and
 * unrelated files (pictures, build output) are left out.
 */
export async function collectSpecFiles(directory: string): Promise<SpecFileText[]> {
  const root = path.resolve(directory);
  const found: SpecFileText[] = [];
  async function walk(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || SKIPPED.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) {
        const relative = path.relative(root, full).split(path.sep).join('/');
        if (isSpecFile(relative) && (await stat(full)).size <= MAX_BYTES) found.push({ path: `specs/${relative}`, text: await readFile(full, 'utf8') });
      }
    }
  }
  await walk(root);
  return found.sort((a, b) => (a.path < b.path ? -1 : 1));
}

async function git(cwd: string, args: string[]): Promise<string | null> {
  try {
    return (await exec('git', args, { cwd })).stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * The specs of a directory as the outline a report is laid over. Each spec is named
 * `specs/<its path inside the directory>`: that is the `specPath` a check uses to say which spec it
 * belongs to. `domain` groups specs in the viewer; it defaults to the project's folder name.
 */
export async function loadDirectoryOutline(directory: string, options: { readonly domain?: string; readonly repoRoot?: string } = {}): Promise<ReportOutline & { readSpec: (specPath: string) => Promise<string | null> }> {
  const root = path.resolve(directory);
  const files = await collectSpecFiles(root);
  const texts = new Map(files.map(file => [file.path, file.text]));
  const domain = options.domain ?? (path.basename(options.repoRoot ?? root) || 'product');
  const specs: SpecEntry[] = files.map(file => ({ path: file.path, domain, kind: specKindOf(file.path), title: specTitleOf(file.path, file.text), fingerprint: textFingerprint(file.text) }));
  const cwd = options.repoRoot ?? root;
  const sha = await git(cwd, ['rev-parse', 'HEAD']);
  return { specs, sha: sha && /^[0-9a-f]{40}$/.test(sha) ? sha : null, changedFiles: [], readSpec: async specPath => texts.get(specPath) ?? null };
}
