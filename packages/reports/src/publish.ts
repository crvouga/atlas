/**
 * @module Publishing commit-keyed recordings
 *
 * The write side of the older, commit-keyed shared store: what CI runs after a spec suite recorded timelines with
 * screenshots. `openCommit` starts a commit, `publishSource` copies one package bucket's recorded tests into the store
 * (and also archives it as an immutable layer, so it composes with every other layer), and `closeCommit` finishes the
 * commit. Pure over two injected `ObjectStore`s, the local report bucket a test run wrote and the shared store, so it
 * runs the same against a directory, S3 or memory. Writes go content first, then the record that names it, so a
 * reader that sees a record can read everything it names. Plain checks from JUnit, CTRF or a checks file do not go
 * through here: they use `publishChecks`.
 *
 * @see docs/report-backends.md
 */
import { archiveSourceLayer } from './layer-source';
import { normalizeEnvironment } from './layer-axes';
import type { LayerParameters } from './layer-types';
import { performancePart } from './performance-part';
import type { HtmlReportTest } from './recording-bundle';
import {
  applyJunitOutcomes,
  parseJunit,
} from './junit';
import {
  testFrameKey,
  testPrefix,
  testReportKey,
} from './recording-keys';
import { suiteStatus } from './status';
import type {
  ReportTestStatus,
  RunReport,
} from './report-types';
import { capturedFiles } from './frames';
import { readUtf8, writeUtf8 } from './object-io';
import type { ObjectStore } from './object-store';

import { bundleIndexKey, writeBundle, type BundleIndex } from './bundle';
import { eachLimited } from './completion-order';
import type { ReportPartOutput } from './explorer-types';
import {
  commitIndexKey,
  commitKey,
  frameCssKey,
  sourceId,
  sourceKey,
  sourceOfKey,
  sourcesPrefix,
} from './keys';
import type { CommitRecord, SourceRecord } from './protocol';
import { publicationStore } from './publication';
import { readCommit } from './read';
import { validatePart } from './report-parts';
import { publishSnapshotBundle } from './snapshot-bundle';
import type { SourceIdentity } from './source-content';
import {
  attachSource,
  readStoredSource,
  sourceContentPrefix,
} from './source-content';
import { sourceEntries } from './source-entries';

/** The run id every spec suite writes its bucket under. */
export const SPEC_RUN_ID = 'latest';
/** Parallel uploads per source. */
const WRITE_WIDTH = 32;
const JSON_TYPE = 'application/json; charset=utf-8';

/** What `openCommit` needs to start a commit's run. */
export type OpenCommitArgs = {
  /** The full 40-hex commit sha. */
  readonly sha: string;
  readonly branch: string;
  /** The CI run publishing this commit, or `null`. */
  readonly runUrl: string | null;
  /** When the run started, epoch milliseconds; it also orders the commit list (newest first). */
  readonly startedAtMs: number;
  /** Stylesheet the commit's HTML snapshots render with. */
  readonly frameCss: string;
  /** Concurrent CI attempts own independent commit-local files. Letters, digits, `.`, `_`, `:` and `-`; see `publicationStore`. */
  readonly publicationId?: string;
};

/**
 * Marks a commit's run as started and lists it (newest first), returning the `running` record.
 *
 * Writes the snapshot stylesheet first, so a test is viewable the moment it lands, then `commit.json`, then the
 * `index/` entry that lists the commit, and, only when `publicationId` is given, last the pointer that tells readers
 * to look under that attempt. With a `publicationId` the stylesheet and record are written in the attempt's scope, not
 * the shared one. Calling it again for the same sha and attempt rewrites the same keys. Store errors reject.
 */
export async function openCommit(
  store: ObjectStore,
  args: OpenCommitArgs
): Promise<CommitRecord> {
  const { frameCss, publicationId, ...fields } = args;
  const target =
    publicationId === undefined
      ? store
      : publicationStore(store, publicationId);
  await writeUtf8(
    target,
    frameCssKey(args.sha),
    frameCss,
    'text/css; charset=utf-8'
  );
  const commit: CommitRecord = {
    ...fields,
    state: 'running',
    endedAtMs: null,
    status: null,
  };
  await writeUtf8(
    target,
    commitKey(args.sha),
    JSON.stringify(commit),
    JSON_TYPE
  );
  await writeUtf8(
    store,
    commitIndexKey(args.sha, args.startedAtMs),
    JSON.stringify({ sha: args.sha }),
    JSON_TYPE
  );
  if (publicationId !== undefined)
    await writeUtf8(
      store,
      commitKey(args.sha),
      JSON.stringify({ publicationId }),
      JSON_TYPE
    );
  return commit;
}

/** `runs/<runId>/tests/<testId>/report.json` → `<testId>`, else null. */
function reportTestId(runId: string, key: string): string | null {
  const head = testPrefix(runId, '');
  const tail = '/report.json';
  if (!key.startsWith(head) || !key.endsWith(tail)) return null;
  const testId = key.slice(head.length, key.length - tail.length);
  return testId.length > 0 && !testId.includes('/') ? testId : null;
}

async function readTests(
  bucket: ObjectStore,
  runId: string
): Promise<HtmlReportTest[]> {
  const ids = (await bucket.listKeys(testPrefix(runId, '')))
    .map((key) => reportTestId(runId, key))
    .filter((id): id is string => id !== null);
  const tests: HtmlReportTest[] = [];
  for (const id of ids) {
    const text = await readUtf8(bucket, testReportKey(runId, id));
    if (text === null) continue;
    tests.push({ report: JSON.parse(text) as RunReport, blobs: {} });
  }
  const junit = await readUtf8(bucket, 'junit.xml');
  if (junit === null) return tests;
  return [
    ...applyJunitOutcomes(
      { runId, status: 'passed', updatedAtMs: 0, tests },
      parseJunit(junit)
    ).tests,
  ];
}

/** What `publishSource` needs to publish one package bucket of recorded tests. */
export type PublishSourceArgs = {
  /** Execution completion time, separate from a virtual timeline clock. Epoch milliseconds. Default: the latest test's `endedAtMs`. */
  readonly recordedAtMs?: number;
  /** Recorded on the layer: `modified` when the run was from a checkout with uncommitted changes, `unknown` when its origin is unknown. */
  readonly freshness?: 'unknown' | 'modified';
  /** The client this run checked: desktop web, mobile web, iOS, Android, or another recorded name. */
  readonly environment?: string;
  /** Choices other than the client that make this its own slot (see `LayerParameters`). */
  readonly parameters?: LayerParameters;
  /** The full 40-hex commit sha the run is for. */
  readonly sha: string;
  /** Repo-relative package dir; with `bucket` it forms the source id (`libs-chess--part-2`). */
  readonly packageDir: string;
  /** The bucket under the package's report dir (`part-2`, `all`). */
  readonly bucket: string;
  /** The package's local report bucket (`.cache/harness-report/<bucket>`). */
  readonly local: ObjectStore;
  /** The run id the tests were written under in `local`. Default: `latest` (`SPEC_RUN_ID`). */
  readonly runId?: string;
  /** Only a passing execution is reusable under its exact task hash. */
  readonly identity?: SourceIdentity;
  /** Forces the source's status to `failed`; any other value is ignored and the status is computed from the tests. */
  readonly status?: ReportTestStatus;
};

async function publishSnapshots(
  store: ObjectStore,
  args: PublishSourceArgs,
  tests: readonly HtmlReportTest[],
  contentPrefix: string
): Promise<void> {
  const runId = args.runId ?? SPEC_RUN_ID;
  await eachLimited(tests, 8, async ({ report }) => {
    const files = new Set(capturedFiles(report));
    await publishSnapshotBundle({
      local: args.local,
      remote: store,
      localPrefix: testFrameKey(runId, report.meta.testId, ''),
      remotePrefix: `${contentPrefix}${report.meta.testId}/`,
      files: [...files],
    });
  });
}

/**
 * Copies one package bucket into the store: every test (runner outcomes from the bucket's `junit.xml` applied) and its
 * frame files, then the source record last, so a reader that sees the record can read every test it names; finally it
 * archives the source as an immutable layer. Returns the record, or `null` when the bucket recorded no test and
 * neither `identity` nor `status` was given.
 *
 * The source's status is `failed` when `args.status` is `failed`, else `failed` if any test failed, `skipped` if all
 * were skipped, else `passed`. A passing source with an `identity` is stored once, content-addressed by its task
 * hash, and referenced from the commit; any other source gets its files in the commit's bundle. When the bucket has no
 * `ui-quality` or `performance` part of its own, a `performance` part with a 50 ms allowance is derived from the
 * tests. Throws on a source id that is not a valid key segment, a part that fails `validatePart`, or a store error;
 * a failure part-way leaves unreferenced content, never a record that names missing content.
 */
export async function publishSource(
  store: ObjectStore,
  args: PublishSourceArgs
): Promise<SourceRecord | null> {
  const runId = args.runId ?? SPEC_RUN_ID;
  const source = sourceId(args.packageDir, args.bucket);
  const tests = await readTests(args.local, runId);
  if (
    tests.length === 0 &&
    args.identity === undefined &&
    args.status === undefined
  )
    return null;
  const metas = tests
    .map((t) => t.report.meta)
    .sort((a, b) => (a.testId < b.testId ? -1 : a.testId > b.testId ? 1 : 0));
  const status = args.status === 'failed' ? 'failed' : suiteStatus(metas);
  const contentPrefix =
    args.identity !== undefined && status === 'passed'
      ? sourceContentPrefix(args.identity, source)
      : null;
  let bundle: BundleIndex | undefined;
  if (contentPrefix === null) {
    bundle = await writeBundle(store, sourceEntries(args, source, tests, runId), 'layers/blobs/');
    await writeUtf8(store, bundleIndexKey(args.sha, source), JSON.stringify(bundle), JSON_TYPE);
  } else {
    await publishSnapshots(store, args, tests, contentPrefix);
    await eachLimited(tests, WRITE_WIDTH, async ({ report }) => {
      await writeUtf8(
        store,
        `${contentPrefix}${report.meta.testId}/report.json`,
        JSON.stringify(report),
        JSON_TYPE
      );
    });
  }
  const environment = normalizeEnvironment(args.environment ?? args.parameters?.environment);
  const record: SourceRecord = {
    source,
    packageDir: args.packageDir,
    bucket: args.bucket,
    status,
    updatedAtMs: args.recordedAtMs ?? metas.reduce(
      (latest, meta) => Math.max(latest, meta.endedAtMs),
      0
    ),
    ...(environment ? { environment } : {}),
    ...(args.parameters && Object.keys(args.parameters).length > 0 ? { parameters: args.parameters } : {}),
    tests: metas,
    ...(await sourceEvidence(args.local, args.sha, source, tests)),
  };
  if (contentPrefix !== null) {
    await writeUtf8(
      store,
      `${contentPrefix}complete.json`,
      JSON.stringify(record),
      JSON_TYPE
    );
    await attachSource(store, { sha: args.sha, record, contentPrefix });
  } else {
    await writeUtf8(
      store,
      sourceKey(args.sha, source),
      JSON.stringify(record),
      JSON_TYPE
    );
  }
  await archiveSourceLayer(store, args, record, tests, bundle);
  return record;
}

async function sourceEvidence(
  local: ObjectStore,
  sha: string,
  source: string,
  tests: readonly HtmlReportTest[]
) {
  const raw = await readUtf8(local, 'part.json');
  const evidence: ReportPartOutput[] =
    raw === null ? [] : [JSON.parse(raw) as ReportPartOutput];
  if (
    !evidence.some(
      (part) => part.kind === 'ui-quality' || part.kind === 'performance'
    )
  ) {
    const { kind, title, checks } = performancePart({
      sha,
      recordedAtMs: 0,
      allowanceMs: 50,
      reports: tests.map((test) => test.report),
    });
    evidence.push({ kind, title, checks });
  }
  for (const part of evidence)
    validatePart({ ...part, sha, id: source, recordedAtMs: 0 });
  return { evidence };
}

/** What `closeCommit` needs to finish a commit's run. */
export type CloseCommitArgs = {
  /** The full 40-hex commit sha. */
  readonly sha: string;
  /** When the run ended, epoch milliseconds. */
  readonly endedAtMs: number;
  /** The attempt given to `openCommit`, when it was given one. */
  readonly publicationId?: string;
  /** `failed` forces the commit's status to `failed`; any other value is ignored. */
  readonly status?: ReportTestStatus;
};

/**
 * Marks a commit's run `complete` and returns the record, with the worst status of its sources: `failed` if
 * `args.status` is `failed` or any source failed, `skipped` when there are no sources or all were skipped, else
 * `passed`. Throws `no open report for <sha>; openCommit runs first` when the commit was never opened. Calling it
 * again rewrites the record with the sources present at that time.
 */
export async function closeCommit(
  store: ObjectStore,
  args: CloseCommitArgs
): Promise<CommitRecord> {
  if (args.publicationId !== undefined)
    store = publicationStore(store, args.publicationId);
  const open = await readCommit(store, args.sha);
  if (open === null) {
    throw new Error(`no open report for ${args.sha}; openCommit runs first`);
  }
  const sources = (await store.listKeys(sourcesPrefix(args.sha)))
    .map((key) => sourceOfKey(args.sha, key))
    .filter((s): s is string => s !== null);
  const statuses: SourceRecord[] = [];
  for (const s of sources) {
    const stored = await readStoredSource(store, args.sha, s);
    if (stored !== null) statuses.push(stored.record);
  }
  const closed: CommitRecord = {
    ...open,
    state: 'complete',
    endedAtMs: args.endedAtMs,
    status:
      args.status === 'failed'
        ? 'failed'
        : statuses.length === 0
          ? 'skipped'
          : suiteStatus(statuses),
  };
  await writeUtf8(
    store,
    commitKey(args.sha),
    JSON.stringify(closed),
    JSON_TYPE
  );
  return closed;
}
