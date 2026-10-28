/**
 * @module Reading the files attachments name
 *
 * Turns an attachment that names a file on disk (`path`) into one that carries its bytes (`data`), just before a
 * layer is published. It owns the safety rules for doing so: a path that came from a test report may only name
 * files inside the allowed roots, never a hidden file, and never a link that leads out; a path the person running
 * the command typed is trusted. It does not upload anything. Node-only (reads the file system).
 *
 * @see docs/report-contract.md (evidence rule 7: paths inside a report are data from a test run)
 */
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import { contentTypeOf } from './media-types';
import { isVideoAttachment } from './recording-receipt';

type Loose = Record<string, unknown>;

/** What {@link readAttachmentFiles} found. */
export type AttachmentFileResult = {
  /** A copy of the holder in which every readable `path` attachment became a `data` attachment (and `path` is gone). The input is not mutated. */
  readonly value: Loose;
  /** How many files were read. */
  readonly attached: number;
  /** The total size of those files, in bytes. */
  readonly bytes: number;
  /** One line per attachment that was left out (missing, not allowed, too large, over budget), prefixed with its name. */
  readonly warnings: readonly string[];
};

/** A budget shared by every call of one publish, so many files cannot add up to more than can be held. */
export type AttachmentBudget = {
  /** Bytes still available; each file read subtracts its size. A file larger than this is left out, not truncated. */
  remaining: number;
};

/** Options of {@link readAttachmentFiles}. */
export type ReadOptions = {
  /** Largest single file, in bytes. Default 512 MiB. */
  readonly maxBytes?: number;
  /** Shared total-size budget; mutated as files are read. Omit for no total limit. */
  readonly budget?: AttachmentBudget;
  /**
   * A path the person running the command typed (`--attach`) is theirs to choose. A path inside a *report* is
   * data from a test run, which is not: it may name only files inside `roots`, never a hidden file, and never a
   * link that leads out.
   */
  readonly trusted?: boolean;
};

/**
 * Reads the files that attachments name (`path`), at every level (the holder, its `steps` and its `attempts`,
 * recursively), and hands their bytes over as `data` with a `contentType` guessed from the file name when the
 * attachment gave none.
 *
 * A file that is missing, not allowed or too large is left out with a warning: evidence that could not be
 * found never stops the results from being published. The exception in kind is a video of a check that declared
 * `recordingExpectation: "required"`: it stays as an attachment without bytes whose `omitted` says why (`not-found`,
 * `not-allowed`, `too-large`, `over-budget`), so the recording receipt can name the gap. Attachments without a `path` are kept untouched.
 *
 * @param holder A check, step, attempt or any object that may have `attachments`, `steps` and `attempts`.
 * @param roots Folders a relative path is resolved against (in order), and the only folders an untrusted path may name.
 * @returns The rewritten copy, counts and warnings; never throws for a bad file.
 */
export async function readAttachmentFiles(holder: Loose, roots: readonly string[], options: ReadOptions = {}): Promise<AttachmentFileResult> {
  const warnings: string[] = [];
  const maxBytes = options.maxBytes ?? 512 * 1024 * 1024;
  let attached = 0, bytes = 0;
  async function walk(value: Loose, expectsRecording = value.recordingExpectation === 'required'): Promise<Loose> {
    const out: Loose = { ...value };
    if (Array.isArray(out.attachments)) {
      const kept: Loose[] = [];
      for (const given of out.attachments as Loose[]) {
        const file = typeof given.path === 'string' ? given.path : undefined;
        if (file === undefined) { kept.push(given); continue; }
        const name = String(given.name ?? file);
        const { path: _path, ...rest } = given;
        const found = await locate(file, roots, options.trusted === true);
        // A video that a check was expected to have stays in the layer as metadata with the reason it was left out
        // (never the path), so the recording receipt can name the gap instead of the file vanishing.
        const left = (reason: string) => { if (expectsRecording && isVideoAttachment({ ...rest, contentType: rest.contentType ?? contentTypeOf(name) })) kept.push({ ...rest, omitted: reason }); };
        if (found.problem) { warnings.push(`${name}: ${found.problem}`); left(found.problem.startsWith('file not found') ? 'not-found' : 'not-allowed'); continue; }
        const size = (await stat(found.file!)).size;
        if (size > maxBytes) { warnings.push(`${name}: ${(size / 1024 / 1024).toFixed(0)} MiB is over the limit of ${Math.round(maxBytes / 1024 / 1024)} MiB`); left('too-large'); continue; }
        if (options.budget && size > options.budget.remaining) { warnings.push(`${name}: the total size of attachments would pass the budget (raise --max-total-attachment-mb, or attach a uri)`); left('over-budget'); continue; }
        if (options.budget) options.budget.remaining -= size;
        attached += 1; bytes += size;
        kept.push({ ...rest, data: new Uint8Array(await readFile(found.file!)), ...(rest.contentType ? {} : { contentType: contentTypeOf(found.file!) }) });
      }
      out.attachments = kept;
    }
    if (Array.isArray(out.steps)) { const steps: Loose[] = []; for (const step of out.steps as Loose[]) steps.push(await walk(step, expectsRecording)); out.steps = steps; }
    if (Array.isArray(out.attempts)) { const attempts: Loose[] = []; for (const attempt of out.attempts as Loose[]) attempts.push(await walk(attempt, expectsRecording)); out.attempts = attempts; }
    return out;
  }
  return { value: await walk(holder), attached, bytes, warnings };
}

/** Is `file` inside `root`, once both are real paths (so a link cannot lead out)? */
function inside(file: string, root: string): boolean {
  const relative = path.relative(root, file);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

// Resolves a named file to a real path, or says why not. A trusted path may also be relative to the working
// directory; an untrusted one must land, after resolving links, inside a root and under no dot-named part.
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
