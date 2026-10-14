/**
 * @module Source content references
 *
 * A source (one package bucket of recorded tests in a commit) either owns commit-local files under
 * `commits/<sha>/tests/<source>/`, or references a reusable, content-addressed copy under
 * `content/v2/<generation>/<taskHash>/<source>/` that an identical earlier passing run already uploaded. This module
 * names those prefixes, writes and resolves the reference, and decides when a copy is reusable. Only a passing source
 * is ever reused, and a reference whose prefix does not fit the pattern is rejected, so a record cannot point a reader
 * at another path.
 */
import { readUtf8, writeUtf8 } from './object-io';
import type { ObjectStore } from './object-store';
import { commitPrefix, isKeySegment, sourceId, sourceKey } from './keys';
import type { SourceRecord } from './protocol';
import { reportStore } from './publication';

/** What makes a recorded source reusable: the exact task that produced it, within a retention window. */
export type SourceIdentity = {
  /** The hash of the exact task that produced the source: 16 to 64 lowercase hex digits. */
  readonly taskHash: string;
  /** The retention window the source belongs to, from `reportGeneration`. A new generation never reuses an older copy, so old content can expire. */
  readonly generation: number;
};

type SourceReference = {
  readonly record: SourceRecord;
  readonly contentPrefix: string;
};

/** The retention window index for a time: `floor(nowMs / (retentionDays * 86 400 000))`. Throws `Report time must be nonnegative` for a negative or non-finite time and `Report retention must be a positive number of days` for a non-integer or less than 1. */
export function reportGeneration(nowMs: number, retentionDays: number): number {
  if (!Number.isFinite(nowMs) || nowMs < 0)
    throw new Error('Report time must be nonnegative');
  if (!Number.isInteger(retentionDays) || retentionDays < 1)
    throw new Error('Report retention must be a positive number of days');
  return Math.floor(nowMs / (retentionDays * 86_400_000));
}

/**
 * The key prefix of a reusable source's content: `content/v2/<generation>/<taskHash>/<source>/`. Throws
 * `Report identity needs an exact task hash`, `Report generation must be a nonnegative integer` or `Invalid report
 * source` when an input is malformed.
 */
export function sourceContentPrefix(
  identity: SourceIdentity,
  source: string
): string {
  if (!/^[0-9a-f]{16,64}$/.test(identity.taskHash))
    throw new Error('Report identity needs an exact task hash');
  if (!Number.isSafeInteger(identity.generation) || identity.generation < 0)
    throw new Error('Report generation must be a nonnegative integer');
  if (!isKeySegment(source)) throw new Error('Invalid report source');
  return `content/v2/${identity.generation}/${identity.taskHash}/${source}/`;
}

/** Points a commit's source record at reusable content: writes `commits/<sha>/sources/<source>.json` as `{ record, contentPrefix }`. */
export async function attachSource(
  store: ObjectStore,
  args: {
    readonly sha: string;
    readonly record: SourceRecord;
    readonly contentPrefix: string;
  }
): Promise<void> {
  await writeUtf8(
    store,
    sourceKey(args.sha, args.record.source),
    JSON.stringify({ record: args.record, contentPrefix: args.contentPrefix }),
    'application/json; charset=utf-8'
  );
}

/**
 * Reuses an earlier passing run of the same task: when the content for `identity` is complete in the store, attaches it
 * to `sha` and returns its record; otherwise returns `null` and writes nothing. Returns `null` also when the stored
 * record is for another package or bucket, or did not pass. Throws for a malformed identity or a stored record that is
 * not JSON.
 */
export async function reuseSource(
  store: ObjectStore,
  args: {
    readonly sha: string;
    readonly packageDir: string;
    readonly bucket: string;
    readonly identity: SourceIdentity;
  }
): Promise<SourceRecord | null> {
  const source = sourceId(args.packageDir, args.bucket);
  const contentPrefix = sourceContentPrefix(args.identity, source);
  const text = await readUtf8(store, `${contentPrefix}complete.json`);
  if (text === null) return null;
  const record = JSON.parse(text) as SourceRecord;
  if (
    record.source !== source ||
    record.packageDir !== args.packageDir ||
    record.bucket !== args.bucket ||
    record.status !== 'passed'
  )
    return null;
  await attachSource(store, { sha: args.sha, record, contentPrefix });
  return record;
}

/**
 * Reads a commit's record of one source and where its test files live, or `null` when the commit has no such source.
 * A reference written by `attachSource` yields its content prefix; a plain record yields
 * `commits/<sha>/tests/<source>/`. Throws `Invalid report content reference` when a reference's prefix does not match
 * the expected pattern or names another source.
 */
export async function readStoredSource(
  store: ObjectStore,
  sha: string,
  source: string
): Promise<SourceReference | null> {
  store = await reportStore(store, sha);
  const text = await readUtf8(store, sourceKey(sha, source));
  if (text === null) return null;
  const stored = JSON.parse(text) as SourceRecord | SourceReference;
  if ('record' in stored) {
    const prefix = stored.contentPrefix;
    if (
      !/^content\/v2\/\d+\/[0-9a-f]{16,64}\/[a-zA-Z0-9._-]+\/$/.test(prefix) ||
      !prefix.endsWith(`/${source}/`) ||
      stored.record.source !== source
    )
      throw new Error('Invalid report content reference');
    return stored;
  }
  return {
    record: stored,
    contentPrefix: `${commitPrefix(sha)}tests/${source}/`,
  };
}

/** The key prefix of one test's files, `<content prefix><testId>/`, or `null` when the source is not in the commit. Throws `Invalid report test` when `testId` is not a safe key segment. */
export async function sourceTestPrefix(
  store: ObjectStore,
  args: {
    readonly sha: string;
    readonly source: string;
    readonly testId: string;
  }
): Promise<string | null> {
  if (!isKeySegment(args.testId)) throw new Error('Invalid report test');
  const stored = await readStoredSource(store, args.sha, args.source);
  return stored === null ? null : `${stored.contentPrefix}${args.testId}/`;
}
