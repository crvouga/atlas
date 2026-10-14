/**
 * @module Reading commit-keyed recordings
 *
 * The read side of the older, commit-keyed shared store: what the reports API serves for a commit (its record, its
 * sources, each test's timeline and frame files) and the event streams that deliver them. Pure over an injected
 * `ObjectStore`, `Clock` and `Timers`; nothing here imports a runtime or an HTTP framework. Every read goes through
 * `reportStore`, so a commit published by an attempt (`publicationId`) is read from that attempt's records.
 *
 * @see docs/report-backends.md
 */

import type { Clock, Timers } from './clock';
import type { HtmlReportBlob } from './recording-bundle';
import type {
  ReportStep,
  RunReport,
  SnapshotMedia,
} from './report-types';
import { readUtf8 } from './object-io';
import type {
  ObjectStore,
  StoredObject,
} from './object-store';

import type { BundleEntry } from './bundle';
import { inCompletionOrder } from './completion-order';
import {
  COMMITS_INDEX_PREFIX,
  commitKey,
  frameCssKey,
  isFramePath,
  shaOfIndexKey,
  sourceOfKey,
  sourcesPrefix,
} from './keys';
import type {
  CommitEvent,
  CommitPage,
  CommitRecord,
  SourceRecord,
  TestEvent,
} from './protocol';
import { reportStore } from './publication';
import { readBundledSnapshot, readBundledSnapshots } from './snapshot-bundle';
import { readStoredSource, sourceTestPrefix } from './source-content';
import { sourceReader } from './source-reader';

/** Parallel object reads per stream. */
const READ_WIDTH = 16;
const TEXT_MEDIA: ReadonlySet<string> = new Set(['html', 'json', 'text']);

async function readJson<T>(store: ObjectStore, key: string): Promise<T | null> {
  const text = await readUtf8(store, key);
  if (text === null) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** Reads a commit's record, or `null` when it is missing or not valid JSON. */
export async function readCommit(
  store: ObjectStore,
  sha: string
): Promise<CommitRecord | null> {
  return readJson<CommitRecord>(await reportStore(store, sha), commitKey(sha));
}

/** Reads the stylesheet a commit's snapshots render with, or `null` when the commit has none. */
export async function readFrameCss(
  store: ObjectStore,
  sha: string
): Promise<StoredObject | null> {
  return (await reportStore(store, sha)).get(frameCssKey(sha));
}

/**
 * Lists commits newest first, `limit` per page (at least 1).
 *
 * A commit published twice (a rerun) has two index entries; only the newer one is ever listed, on any page.
 * `cursor` is the previous page's `cursor`; `null` starts at the newest. The returned `cursor` is `null` on the last
 * page. An index entry whose commit record is missing or unreadable is left out, so a page may hold fewer than
 * `limit` commits. Store errors reject.
 */
export async function listCommits(
  store: ObjectStore,
  options: { readonly limit: number; readonly cursor: string | null }
): Promise<CommitPage> {
  const seen = new Set<string>();
  const newest: { readonly key: string; readonly sha: string }[] = [];
  for (const key of await store.listKeys(COMMITS_INDEX_PREFIX)) {
    const sha = shaOfIndexKey(key);
    if (sha === null || seen.has(sha)) continue;
    seen.add(sha);
    newest.push({ key, sha });
  }
  const after =
    options.cursor === null
      ? newest
      : newest.filter((entry) => entry.key > (options.cursor ?? ''));
  const page = after.slice(0, Math.max(1, options.limit));
  const records = await Promise.all(page.map((e) => readCommit(store, e.sha)));
  return {
    commits: records.filter((r): r is CommitRecord => r !== null),
    cursor: after.length > page.length ? (page.at(-1)?.key ?? null) : null,
  };
}

/** How `commitEvents` tails a running commit. */
export type CommitEventsOptions = {
  /** Time source for `tailMs`. */
  readonly clock: Clock;
  /** Timer functions used to wait `pollMs` between listings. */
  readonly timers: Timers;
  /** Sources the client already holds (a reconnect): never sent again. */
  readonly have?: ReadonlySet<string>;
  /** How often, in milliseconds, a running commit is re-listed for new sources. */
  readonly pollMs: number;
  /** A running commit's stream ends after this many milliseconds; the client reconnects. */
  readonly tailMs: number;
};

function sleep(timers: Timers, ms: number): Promise<void> {
  return new Promise((resolve) => {
    timers.setTimeout(resolve, ms);
  });
}

async function* newSources(
  store: ObjectStore,
  sha: string,
  sent: Set<string>
): AsyncGenerator<SourceRecord> {
  store = await reportStore(store, sha);
  const fresh = (await store.listKeys(sourcesPrefix(sha)))
    .map((key) => sourceOfKey(sha, key))
    .filter((s): s is string => s !== null && !sent.has(s));
  for (const s of fresh) sent.add(s);
  const reads = fresh.map(
    (s) => async () => (await readStoredSource(store, sha, s))?.record ?? null
  );
  for await (const record of inCompletionOrder(reads, READ_WIDTH)) {
    if (record !== null) yield record;
  }
}

/**
 * Streams a commit as events: the commit record, then every source in the order its read finishes. While the
 * commit is running, its sources are re-listed every `pollMs` and each new one is sent as it lands, until the commit
 * completes or `tailMs` passes. The state is read before each listing, so a listing after `complete` is the final
 * one. A `commit` event is sent again when the commit's state changes.
 *
 * Ends with `{ type: 'end', state }`: `missing` when there is no commit record and no source, `complete` when the
 * commit closed, `running` when `tailMs` passed first (reconnect with `have` to continue). A source is never sent
 * twice in one stream, nor one listed in `options.have`. Trap: a source is counted as sent as soon as it is listed,
 * so one whose record cannot be read at that moment is not retried in the same stream.
 */
export async function* commitEvents(
  store: ObjectStore,
  sha: string,
  options: CommitEventsOptions
): AsyncGenerator<CommitEvent> {
  const startedAt = options.clock.now();
  const sent = new Set(options.have ?? []);
  let commit = await readCommit(store, sha);
  yield { type: 'commit', commit };
  for (;;) {
    for await (const source of newSources(store, sha, sent)) {
      yield { type: 'source', source };
    }
    if (commit === null && sent.size === 0) {
      yield { type: 'end', state: 'missing' };
      return;
    }
    if (commit?.state === 'complete') {
      yield { type: 'end', state: 'complete' };
      return;
    }
    if (options.clock.now() - startedAt >= options.tailMs) {
      yield { type: 'end', state: 'running' };
      return;
    }
    await sleep(options.timers, options.pollMs);
    const latest = await readCommit(store, sha);
    if (latest !== null && latest.state !== commit?.state) {
      yield { type: 'commit', commit: latest };
    }
    commit = latest ?? commit;
  }
}

function collectFrameFiles(
  steps: readonly ReportStep[],
  out: Map<string, SnapshotMedia>
): void {
  for (const step of steps) {
    for (const frame of step.frames) {
      for (const blob of frame.snapshots) out.set(blob.file, blob.media);
    }
    collectFrameFiles(step.steps, out);
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

function frameBlob(obj: BundleEntry, media: SnapshotMedia): HtmlReportBlob {
  return TEXT_MEDIA.has(media)
    ? {
        contentType: obj.contentType,
        text: new TextDecoder().decode(obj.bytes),
      }
    : { contentType: obj.contentType, base64: bytesToBase64(obj.bytes) };
}

/**
 * Reads one test's timeline (`RunReport`) without its frame files, or `null` when the source or test is not in the
 * commit. A timeline stored as a reusable source is parsed leniently (`null` if not JSON); one in the commit's bundle
 * throws if its bytes are not JSON.
 */
export async function readTestReport(
  store: ObjectStore,
  args: {
    readonly sha: string;
    readonly source: string;
    readonly testId: string;
  }
): Promise<RunReport | null> {
  store = await reportStore(store, args.sha);
  const prefix = await sourceTestPrefix(store, args);
  if (prefix === null) return null;
  if (prefix.startsWith('content/'))
    return readJson<RunReport>(store, `${prefix}report.json`);
  const read = await sourceReader(store, args);
  const obj = await read(`${prefix}report.json`);
  return obj === null
    ? null
    : (JSON.parse(new TextDecoder().decode(obj.bytes)) as RunReport);
}

/** One frame file's content. */
export type FrameBody = {
  /** The file's bytes. */
  readonly bytes: Uint8Array;
  /** The media type the file was stored with. */
  readonly contentType: string;
};

/** Reads one frame file of a test, or `null` when the test never wrote it. Throws `Invalid report frame` when `file` is not a safe relative frame path. */
export async function readFrameBody(
  store: ObjectStore,
  args: {
    readonly sha: string;
    readonly source: string;
    readonly testId: string;
    readonly file: string;
  }
): Promise<FrameBody | null> {
  store = await reportStore(store, args.sha);
  if (!isFramePath(args.file)) throw new Error('Invalid report frame');
  const prefix = await sourceTestPrefix(store, args);
  if (prefix === null) return null;
  const key = `${prefix}${args.file}`;
  if (prefix.startsWith('content/'))
    return readBundledSnapshot(store, prefix, args.file);
  const read = await sourceReader(store, args);
  const obj = await read(key);
  return obj === null
    ? null
    : { bytes: obj.bytes, contentType: obj.contentType };
}

/** Lists every source record of a commit, in the order each read finishes. A source whose record cannot be read is left out. */
export async function listSourceRecords(
  store: ObjectStore,
  sha: string
): Promise<SourceRecord[]> {
  const out: SourceRecord[] = [];
  for await (const source of newSources(store, sha, new Set())) {
    out.push(source);
  }
  return out;
}

/**
 * Streams a test as events: its report, then each frame file the report names as its read finishes, then
 * `{ type: 'end', found: true }`. A test that is not in the commit yields only `{ type: 'end', found: false }`. A frame
 * the report names but the store lacks is skipped. Text media (`html`, `json`, `text`) arrive as inline text, the rest
 * as base64.
 */
export async function* testEvents(
  store: ObjectStore,
  args: {
    readonly sha: string;
    readonly source: string;
    readonly testId: string;
  }
): AsyncGenerator<TestEvent> {
  store = await reportStore(store, args.sha);
  const prefix = await sourceTestPrefix(store, args);
  const report = await readTestReport(store, args);
  if (report === null) {
    yield { type: 'end', found: false };
    return;
  }
  yield { type: 'report', report };
  const files = new Map<string, SnapshotMedia>();
  collectFrameFiles(report.steps, files);
  if (prefix?.startsWith('content/')) {
    for await (const frame of readBundledSnapshots(
      store,
      prefix,
      new Set(files.keys())
    )) {
      const blob = TEXT_MEDIA.has(files.get(frame.file) ?? '')
        ? {
            contentType: frame.contentType,
            text: new TextDecoder().decode(frame.bytes),
          }
        : {
            contentType: frame.contentType,
            base64: bytesToBase64(frame.bytes),
          };
      yield { type: 'blob', file: frame.file, blob };
    }
    yield { type: 'end', found: true };
    return;
  }
  const readFile = await sourceReader(store, args);
  const reads = [...files].map(([file, media]) => async () => {
    const obj = await readFile(`${prefix}${file}`);
    return { file, blob: obj === null ? null : frameBlob(obj, media) };
  });
  for await (const read of inCompletionOrder(reads, READ_WIDTH)) {
    if (read.blob !== null) {
      yield { type: 'blob', file: read.file, blob: read.blob };
    }
  }
  yield { type: 'end', found: true };
}
