/**
 * @module In-memory recorded test
 *
 * Types for a recorded test with its frame files held in memory, which is what a viewer renders and what a publisher
 * copies: text media inline, binary media as base64.
 */

import type { ReportTestStatus, RunReport } from './report-types';

/** One embedded frame file: text media inline, binary media as base64. */
export type HtmlReportBlob = {
  /** The media type of the file. */
  readonly contentType: string;
  /** The file's content for text media. */
  readonly text?: string;
  /** The file's content for binary media, base64-encoded. */
  readonly base64?: string;
};

/** One recorded test: its timeline and its frame files. */
export type HtmlReportTest = {
  /** The test's timeline. */
  readonly report: RunReport;
  /** Keyed by the blob's `file` (relative to the test dir). */
  readonly blobs: Readonly<Record<string, HtmlReportBlob>>;
};

/** The tests of one run held in memory. */
export type HtmlReportBundle = {
  readonly runId: string;
  /** The run's overall outcome. */
  readonly status: ReportTestStatus;
  /** When the run was last updated, epoch milliseconds. */
  readonly updatedAtMs: number;
  /** The run's tests. */
  readonly tests: readonly HtmlReportTest[];
};
