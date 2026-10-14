/**
 * @module Source file entries
 *
 * Streams the files of a recorded source (each test's timeline and its captured frame files) as bundle entries ready to
 * be packed into blobs. Entries come in a fixed order (tests by id, files by name) so the same source always packs into
 * the same blobs.
 */
import type { HtmlReportTest } from './recording-bundle';
import { testFrameKey } from './recording-keys';
import { capturedFiles } from './frames';
import type { BundleEntry } from './bundle';
import { remoteTestFileKey, remoteTestReportKey } from './keys';
import type { PublishSourceArgs } from './publish';

const JSON_TYPE = 'application/json; charset=utf-8';

/**
 * Yields, for each test of `tests` in `testId` order, its `report.json` and then each file the report names (sorted by
 * name), keyed by the commit-relative layout `commits/<sha>/tests/<source>/<testId>/...`. Frame files are read from
 * `args.local` under `runId` as the generator is consumed, one at a time. Throws `Missing report snapshot: <file>` when
 * a named file is absent locally, and a `not a ...` error for an unsafe source, test id or file name.
 */
export async function* sourceEntries(
  args: PublishSourceArgs,
  source: string,
  tests: readonly HtmlReportTest[],
  runId: string
): AsyncGenerator<BundleEntry> {
  for (const { report } of [...tests].sort((a, b) =>
    a.report.meta.testId < b.report.meta.testId ? -1 : 1
  )) {
    const { testId } = report.meta;
    yield {
      key: remoteTestReportKey(args.sha, source, testId),
      bytes: new TextEncoder().encode(JSON.stringify(report)),
      contentType: JSON_TYPE,
    };
    for (const file of capturedFiles(report).sort()) {
      const obj = await args.local.get(testFrameKey(runId, testId, file));
      if (obj === null) throw new Error(`Missing report snapshot: ${file}`);
      yield {
        key: remoteTestFileKey(args.sha, source, testId, file),
        bytes: new Uint8Array(await new Response(obj.body).arrayBuffer()),
        contentType: obj.contentType,
      };
    }
  }
}
