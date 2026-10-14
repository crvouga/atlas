import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import { contentTypeOf } from './media-types';

type Loose = Record<string, unknown>;

export type AttachmentFileResult = { readonly value: Loose; readonly attached: number; readonly bytes: number; readonly warnings: readonly string[] };

/** A budget shared by every call of one publish, so many files cannot add up to more than can be held. */
export type AttachmentBudget = { remaining: number };

export type ReadOptions = {
  /** Largest single file, in bytes. */
  readonly maxBytes?: number;
  readonly budget?: AttachmentBudget;
  /**
   * A path the person running the command typed (`--attach`) is theirs to choose. A path inside a *report* is
   * data from a test run, which is not: it may name only files inside `roots`, never a hidden file, and never a
   * link that leads out.
   */
  readonly trusted?: boolean;
};

/**
 * Read the files that attachments name (`path`), at every level, and hand their bytes over as `data`.
 * A file that is missing, not allowed or too large is left out with a warning: evidence that could not be
 * found never stops the results from being published.
 */
export async function readAttachmentFiles(holder: Loose, roots: readonly string[], options: ReadOptions = {}): Promise<AttachmentFileResult> {
  const warnings: string[] = [];
  const maxBytes = options.maxBytes ?? 512 * 1024 * 1024;
  let attached = 0, bytes = 0;
  async function walk(value: Loose): Promise<Loose> {
    const out: Loose = { ...value };
    if (Array.isArray(out.attachments)) {
      const kept: Loose[] = [];
      for (const given of out.attachments as Loose[]) {
        const file = typeof given.path === 'string' ? given.path : undefined;
        if (file === undefined) { kept.push(given); continue; }
        const name = String(given.name ?? file);
        const { path: _path, ...rest } = given;
        const found = await locate(file, roots, options.trusted === true);
        if (found.problem) { warnings.push(`${name}: ${found.problem}`); continue; }
        const size = (await stat(found.file!)).size;
        if (size > maxBytes) { warnings.push(`${name}: ${(size / 1024 / 1024).toFixed(0)} MiB is over the limit of ${Math.round(maxBytes / 1024 / 1024)} MiB`); continue; }
        if (options.budget && size > options.budget.remaining) { warnings.push(`${name}: the total size of attachments would pass the budget (raise --max-total-attachment-mb, or attach a uri)`); continue; }
        if (options.budget) options.budget.remaining -= size;
        attached += 1; bytes += size;
        kept.push({ ...rest, data: new Uint8Array(await readFile(found.file!)), ...(rest.contentType ? {} : { contentType: contentTypeOf(found.file!) }) });
      }
      out.attachments = kept;
    }
    if (Array.isArray(out.steps)) { const steps: Loose[] = []; for (const step of out.steps as Loose[]) steps.push(await walk(step)); out.steps = steps; }
    if (Array.isArray(out.attempts)) { const attempts: Loose[] = []; for (const attempt of out.attempts as Loose[]) attempts.push(await walk(attempt)); out.attempts = attempts; }
    return out;
  }
  return { value: await walk(holder), attached, bytes, warnings };
}

/** Is `file` inside `root`, once both are real paths (so a link cannot lead out)? */
function inside(file: string, root: string): boolean {
  const relative = path.relative(root, file);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

async function locate(file: string, roots: readonly string[], trusted: boolean): Promise<{ file?: string; problem?: string }> {
  const candidates = path.isAbsolute(file) ? [file] : [...roots.map(root => path.resolve(root, file)), ...(trusted ? [path.resolve(file)] : [])];
  let outside = false;
  for (const candidate of candidates) {
    let real: string;
    try {
      real = await realpath(candidate);
      if (!(await stat(real)).isFile()) continue;
    } catch { continue; }
    if (trusted) return { file: real };
    const root = await firstRootHolding(real, roots);
    // A hidden file or folder (.env, .aws, .git, .ssh) is never attached on a report's say-so.
    if (!root || path.relative(root, real).split(path.sep).some(part => part.startsWith('.'))) { outside = true; continue; }
    return { file: real };
  }
  return { problem: outside ? `${file} is outside the folders reports may attach from (the report's own folder and each --attach-root), or is a hidden file: pass --attach-root <dir> to allow a folder` : `file not found (${file})` };
}

async function firstRootHolding(real: string, roots: readonly string[]): Promise<string | null> {
  for (const root of roots) {
    try {
      if (inside(real, await realpath(root))) return await realpath(root);
    } catch { /* a root that is not there holds nothing */ }
  }
  return null;
}
