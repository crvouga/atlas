import type { HtmlReportBundle } from './recording-bundle';

/** Bundle plus document title for the standalone / Solid report viewer. */
export type ReportData = HtmlReportBundle & {
  readonly title: string;
};
