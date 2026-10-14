/**
 * @module Test as a catalog row
 *
 * Maps a recorded test to the flat row the viewer's searchable, groupable list draws.
 */
import type { HtmlReportTest } from './recording-bundle';
import type { CatalogEntity } from './catalog';
import { fileLabel } from './format';

function packageOf(testId: string): string {
  const source = testId.split('/')[0] ?? '';
  const cut = source.indexOf('--');
  const name = cut < 0 ? source : source.slice(0, cut);
  return name.length > 0 ? name : 'report';
}

/**
 * Flattens a recorded test into a `CatalogEntity`: its id, title, status and duration; the base name of its source
 * file; the package (the part of the viewer test id's source before `--`, or `report`); its runtime; and the first
 * line of its error as the detail. `search` joins the title, ids, paths, system, runtime, package and error for text
 * matching. `href` is `null`; the caller sets where a row links to.
 */
export function testCatalogEntity(test: HtmlReportTest): CatalogEntity {
  const meta = test.report.meta;
  const file = fileLabel(meta.sourceFile);
  const packageName = packageOf(meta.testId);
  const error = meta.error?.split('\n')[0] ?? '';
  return {
    id: meta.testId,
    title: meta.title,
    status: meta.status,
    durationMs: meta.durationMs,
    file,
    packageName,
    runtime: meta.runtime,
    detail: error,
    search: [
      meta.title,
      meta.testId,
      meta.sourceFile ?? '',
      file,
      meta.system,
      meta.runtime,
      packageName,
      error,
    ].join(' '),
    href: null,
  };
}
