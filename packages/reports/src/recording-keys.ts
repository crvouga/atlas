/**
 * @module Key layout of one report bucket
 *
 * Where a test run writes its recordings inside one local report bucket (an `ObjectStore`): `runs/index.json`,
 * `runs/<runId>/manifest.json` and `runs/<runId>/tests/<testId>/report.json` plus the test's frame files beside it.
 * Pure string functions. Neither id is validated here; callers sanitise them (`sanitizeRunId`, `sanitizeTestId`).
 */

/** The key of the index of the runs in a bucket. */
export const RUNS_INDEX_KEY = 'runs/index.json';

/** The key prefix of one run, without a trailing slash: `runs/<runId>`. */
export function runPrefix(runId: string): string {
  return `runs/${runId}`;
}

/** The key of a run's manifest: `runs/<runId>/manifest.json`. */
export function runManifestKey(runId: string): string {
  return `${runPrefix(runId)}/manifest.json`;
}

/** The key prefix of one test, without a trailing slash: `runs/<runId>/tests/<testId>`. With an empty `testId` it ends in `/tests/`, which lists all tests of the run. */
export function testPrefix(runId: string, testId: string): string {
  return `${runPrefix(runId)}/tests/${testId}`;
}

/** The key of a test's timeline: `runs/<runId>/tests/<testId>/report.json`. */
export function testReportKey(runId: string, testId: string): string {
  return `${testPrefix(runId, testId)}/report.json`;
}

/** The key of one frame file of a test: the test prefix and `frameFile` with any leading `/` removed. With an empty `frameFile` it is the test's prefix with a trailing slash. */
export function testFrameKey(
  runId: string,
  testId: string,
  frameFile: string
): string {
  const rel = frameFile.replace(/^\/+/, '');
  return `${testPrefix(runId, testId)}/${rel}`;
}

/** The file extension for a snapshot media kind (`html`, `png`, `json`, `txt`, `bin`, `mp4`); an unknown kind is `bin`. */
export function mediaExtension(media: string): string {
  switch (media) {
    case 'html':
      return 'html';
    case 'png':
      return 'png';
    case 'json':
      return 'json';
    case 'text':
      return 'txt';
    case 'bytes':
      return 'bin';
    case 'video':
      return 'mp4';
    default:
      return 'bin';
  }
}

/** The media type for a snapshot media kind (`html`, `png`, `json`, `text`, `bytes`, `video`); an unknown kind is `application/octet-stream`. */
export function contentTypeForMedia(media: string): string {
  switch (media) {
    case 'html':
      return 'text/html; charset=utf-8';
    case 'png':
      return 'image/png';
    case 'json':
      return 'application/json; charset=utf-8';
    case 'text':
      return 'text/plain; charset=utf-8';
    case 'bytes':
      return 'application/octet-stream';
    case 'video':
      return 'video/mp4';
    default:
      return 'application/octet-stream';
  }
}
