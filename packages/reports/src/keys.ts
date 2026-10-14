/**
 * @module Commit-keyed object-store key layout
 *
 * Builds and validates the keys of the commit-addressed layout of the shared reports store. Historical recording
 * addresses use the full commit sha. Immutable report layers (`layers/…`, see `docs/report-contract.md`) combine
 * across those addresses:
 *
 *   index/<13-digit inverted start ms>-<sha>.json   one per published commit;
 *                                                   sorted keys = newest first
 *   commits/<sha>/commit.json                       the commit's run record
 *   commits/<sha>/frame.css                         stylesheet for its snapshots
 *   commits/<sha>/sources/<source>.json             one source's test metas
 *   commits/<sha>/bundles/<source>.json              logical file locations
 *   commits/<sha>/blobs/<content hash>.gz            compressed chunks
 *
 * Logical test and frame keys below are entries in the bundle indexes.
 *
 * A source is one report bucket of one package (`libs-chess--part-2`).
 * Writers put a source's tests first and its `sources/` record last, so a
 * reader that sees the record can read every test it names.
 *
 * Every builder validates its inputs (a full 40-hex sha, path-safe segments) and throws on a bad one, so a key
 * made here can never climb out of its prefix.
 */

/**
 * Where the reports live in their bucket. Every reader and writer scopes its
 * store to it, so the keys below are relative to it.
 */
export const REPORTS_ROOT_PREFIX = 'spec-reports';

const SHA = /^[0-9a-f]{40}$/;
/** `sanitizeTestId` output: what the harness names tests and runs. */
const SEGMENT = /^[a-zA-Z0-9._-]+$/;
/** Inverted start times sort newest first while there are 13-digit ms. */
const INVERT_FROM = 9_999_999_999_999;

/** The prefix of the per-commit catalog entries, `index/`. */
export const COMMITS_INDEX_PREFIX = 'index/';

/** Whether the value is a full 40-digit lowercase hex commit sha (an abbreviated sha is not). */
export function isCommitSha(value: string): boolean {
  return SHA.test(value);
}

/** One path segment the harness could have written (never `.` or `..`). */
export function isKeySegment(value: string): boolean {
  return SEGMENT.test(value) && value !== '.' && value !== '..';
}

/** A frame file relative to its test (`frames/f-0001.state.json`). */
export function isFramePath(value: string): boolean {
  const parts = value.split('/');
  return parts.length > 0 && parts.every(isKeySegment);
}

function assertSha(sha: string): void {
  if (!isCommitSha(sha)) {
    throw new Error(`report key needs a full 40-hex commit sha, got "${sha}"`);
  }
}

/** The id of a source (one report bucket of one package): `libs/chess` + `part-2` → `libs-chess--part-2`. Throws `not a report source` when the result is not a safe key segment. */
export function sourceId(packageDir: string, bucket: string): string {
  const id = `${packageDir.replaceAll('/', '-')}--${bucket}`;
  if (!isKeySegment(id)) throw new Error(`not a report source: "${id}"`);
  return id;
}

/** The catalog key of a commit, `index/<13-digit inverted start ms>-<sha>.json`: the time is inverted so a listing is newest first. Negative times count as 0. Throws for a sha that is not 40 hex digits. */
export function commitIndexKey(sha: string, startedAtMs: number): string {
  assertSha(sha);
  const inverted = String(INVERT_FROM - Math.max(0, Math.floor(startedAtMs)));
  return `${COMMITS_INDEX_PREFIX}${inverted.padStart(13, '0')}-${sha}.json`;
}

/** The sha an index key names, or null for anything else. */
export function shaOfIndexKey(key: string): string | null {
  const m = /^index\/\d{13}-([0-9a-f]{40})\.json$/.exec(key);
  return m === null ? null : (m[1] ?? null);
}

/** The folder of everything recorded for a commit, `commits/<sha>/`. Throws for a sha that is not 40 hex digits. */
export function commitPrefix(sha: string): string {
  assertSha(sha);
  return `commits/${sha}/`;
}

/** The key of the commit's run record, `commits/<sha>/commit.json`. */
export function commitKey(sha: string): string {
  return `${commitPrefix(sha)}commit.json`;
}

/** The key of the stylesheet the commit's snapshots render with, `commits/<sha>/frame.css`. */
export function frameCssKey(sha: string): string {
  return `${commitPrefix(sha)}frame.css`;
}

/** The folder of a commit's source records, `commits/<sha>/sources/`. */
export function sourcesPrefix(sha: string): string {
  return `${commitPrefix(sha)}sources/`;
}

/** The key of one source's record, `commits/<sha>/sources/<source>.json`; written last, after the source's tests. Throws `not a source` for an unsafe name. */
export function sourceKey(sha: string, source: string): string {
  if (!isKeySegment(source)) throw new Error(`not a source: "${source}"`);
  return `${sourcesPrefix(sha)}${source}.json`;
}

/** The source a `sources/` key names, or null for anything else. */
export function sourceOfKey(sha: string, key: string): string | null {
  const head = sourcesPrefix(sha);
  if (!key.startsWith(head) || !key.endsWith('.json')) return null;
  const source = key.slice(head.length, -'.json'.length);
  return isKeySegment(source) ? source : null;
}

/** The folder of one recorded test, `commits/<sha>/tests/<source>/<testId>/`. Throws for an unsafe source or test id. */
export function remoteTestPrefix(
  sha: string,
  source: string,
  testId: string
): string {
  if (!isKeySegment(source)) throw new Error(`not a source: "${source}"`);
  if (!isKeySegment(testId)) throw new Error(`not a test id: "${testId}"`);
  return `${commitPrefix(sha)}tests/${source}/${testId}/`;
}

/** The key of a recorded test's report, `<test folder>/report.json`. */
export function remoteTestReportKey(
  sha: string,
  source: string,
  testId: string
): string {
  return `${remoteTestPrefix(sha, source, testId)}report.json`;
}

/** The key of a file a recorded test captured (a frame, a snapshot), inside its folder. A leading `/` is dropped; throws `not a frame file` for a path with an unsafe segment (`..`, empty or odd characters). */
export function remoteTestFileKey(
  sha: string,
  source: string,
  testId: string,
  file: string
): string {
  const rel = file.replace(/^\/+/, '');
  if (!isFramePath(rel)) throw new Error(`not a frame file: "${file}"`);
  return `${remoteTestPrefix(sha, source, testId)}${rel}`;
}

/**
 * The id a viewer shows for a test of a source (`libs-chess--part-2/monkey`):
 * unique across the commit, since two packages may both name a test `monkey`.
 */
export function viewerTestId(source: string, testId: string): string {
  return `${source}/${testId}`;
}

/** The inverse of {@link viewerTestId}: splits at the first `/`; null when either side is not a safe key segment. */
export function splitViewerTestId(
  id: string
): { readonly source: string; readonly testId: string } | null {
  const slash = id.indexOf('/');
  if (slash < 0) return null;
  const source = id.slice(0, slash);
  const testId = id.slice(slash + 1);
  return isKeySegment(source) && isKeySegment(testId)
    ? { source, testId }
    : null;
}
