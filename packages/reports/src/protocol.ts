/**
 * @module Commit-keyed recording protocol
 *
 * The shapes of what the reports store holds for a commit (`commits/<sha>/commit.json`, `sources/<source>.json`) and of
 * the Server-Sent Events a reports API streams about them, plus the codec for those events. These are the older,
 * commit-keyed recordings that layers are composed beside; layers themselves are described by the layer document.
 * Types and a small codec only, so it is safe in a Worker, a CLI and a browser alike.
 *
 * @see docs/report-backends.md
 */

import type { HtmlReportBlob } from './recording-bundle';
import type {
  ReportTestStatus,
  RunReport,
  RunReportMeta,
} from './report-types';
import type { ReportPartOutput, WorkspaceVersion } from './explorer-types';

/** `running` until the run that publishes the commit closes it. */
export type CommitState = 'running' | 'complete';

/** `commits/<sha>/commit.json`: one published run of every spec of a commit. */
export type CommitRecord = {
  /** The full 40-hex commit sha. */
  readonly sha: string;
  readonly branch: string;
  /** The CI run that published it, or `null`. */
  readonly runUrl: string | null;
  readonly state: CommitState;
  /** When the run started, epoch milliseconds. */
  readonly startedAtMs: number;
  /** When the run closed, epoch milliseconds; `null` while running. */
  readonly endedAtMs: number | null;
  /** Worst status over every source; null while running. */
  readonly status: ReportTestStatus | null;
};

/** `commits/<sha>/sources/<source>.json`: one package bucket's tests. */
export type SourceRecord = {
  /** Producer measurements travel with reusable source content. */
  readonly evidence?: readonly ReportPartOutput[];
  /** The source id: the package dir with `/` as `-`, `--`, and the bucket (`libs-chess--part-2`). */
  readonly source: string;
  /** Repo-relative package dir (`libs/chess`). */
  readonly packageDir: string;
  /** The bucket under the package's report dir (`part-2`, `all`). */
  readonly bucket: string;
  /** `failed` if any test failed, `skipped` if all were skipped, else `passed`. */
  readonly status: ReportTestStatus;
  /** When the source was last updated, epoch milliseconds; the layer made from it is recorded at this time (or the commit's start if later). */
  readonly updatedAtMs: number;
  /** The client this source checked, when the run said. */
  readonly environment?: string;
  /** Recorded choices other than the client, such as an example or a device size. */
  readonly parameters?: Readonly<Record<string, string>>;
  /** Each test's meta, test-runner outcomes already applied. */
  readonly tests: readonly RunReportMeta[];
};

/** One page of the commit list (`GET /` of the reports API), newest commit first. */
export type CommitPage = {
  readonly commits: readonly CommitRecord[];
  /** Pass back as `?cursor=` for the next, older page; null on the last. */
  readonly cursor: string | null;
  /** The checkout the host serves, when it serves one. */
  readonly workspace?: WorkspaceVersion;
  /** Why the list is partial or empty, for a person to read. */
  readonly notice?: string;
  /** Versions that have evidence in the stores, on the first page only. */
  readonly evidenceVersions?: readonly string[];
};

/** `GET …/:sha/events`: the commit, then each source as it is read. */
export type CommitEvent =
  | { readonly type: 'commit'; readonly commit: CommitRecord | null }
  | { readonly type: 'source'; readonly source: SourceRecord }
  | { readonly type: 'end'; readonly state: CommitState | 'missing' };

/** `GET …/:sha/tests/:source/:testId/events`: a test, then its frame files. */
export type TestEvent =
  | { readonly type: 'report'; readonly report: RunReport }
  | {
      readonly type: 'blob';
      readonly file: string;
      readonly blob: HtmlReportBlob;
    }
  | { readonly type: 'end'; readonly found: boolean };

/** The `content-type` of an event stream response. */
export const EVENT_STREAM_CONTENT_TYPE = 'text/event-stream; charset=utf-8';

/** Encodes one event as one SSE message: `event:` is the event's `type`, `data:` its JSON, ended by a blank line. */
export function encodeSseEvent(event: CommitEvent | TestEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * Incremental SSE decoder: feed it text as it arrives, get back each
 * complete message's parsed `data`. Only `data:` lines matter here (every
 * event repeats its type in its JSON); comments and other fields are skipped.
 */
export class SseDecoder<T> {
  #buffer = '';

  /**
   * Adds `chunk` (any split of the stream, `\r\n` and `\r` read as `\n`) and returns the parsed `data` of every
   * message it completes, in order. An unfinished message is kept for the next call. A message with no `data:`
   * line is skipped. Throws a `SyntaxError` when a message's data is not JSON; that message is already consumed.
   */
  push(chunk: string): T[] {
    this.#buffer += chunk.replace(/\r\n?/g, '\n');
    const out: T[] = [];
    for (;;) {
      const end = this.#buffer.indexOf('\n\n');
      if (end < 0) return out;
      const message = this.#buffer.slice(0, end);
      this.#buffer = this.#buffer.slice(end + 2);
      const data = message
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(line.startsWith('data: ') ? 6 : 5))
        .join('\n');
      if (data.length > 0) out.push(JSON.parse(data) as T);
    }
  }
}
