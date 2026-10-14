/**
 * @module Report viewer data
 *
 * The data shape the standalone and Solid report viewers render: a recorded run plus its title.
 */
import type { HtmlReportBundle } from './recording-bundle';

/** A run's tests (`HtmlReportBundle`) plus the document title shown for them, for the standalone / Solid report viewer. */
export type ReportData = HtmlReportBundle & {
  readonly title: string;
};
