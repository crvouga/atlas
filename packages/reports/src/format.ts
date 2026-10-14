/**
 * @module Display formatting for recorded tests
 *
 * Small pure formatters the viewer uses to show durations, file names, action lines and captured blobs. Nothing
 * here reads a store or the network; missing or unreadable input becomes a placeholder, never an exception.
 */
import type { HtmlReportTest } from './recording-bundle';
import type { ReportSnapshotBlob } from './report-types';

import { blobDataUrl, blobText } from './frames';

/** Formats milliseconds compactly (`850ms`, `1.5s`, `2m 5s`); `—` for null, undefined or a non-finite number. */
export function fmtMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;
}

/** The last `/`-separated segment of a path; empty for no path. */
export function fileName(path: string | undefined): string {
  return path ? (path.split('/').pop() ?? '') : '';
}

/** The group label for a test's source file: its base name, or `Other` when it has none. */
export function fileLabel(sourceFile: string | undefined): string {
  return sourceFile ? fileName(sourceFile) : 'Other';
}

function formatArg(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value);
  if (
    value === null ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return String(value);
  }
  try {
    const text = JSON.stringify(value);
    if (text === undefined) return '?';
    return text.length > 72 ? `${text.slice(0, 69)}…` : text;
  } catch {
    return '?';
  }
}

/** Compact `arg, arg` for an action line. Empty when the step recorded none. */
export function formatArgs(args: readonly unknown[] | undefined): string {
  if (args === undefined || args.length === 0) return '';
  return args.map(formatArg).join(', ');
}

/** `action(args)`, or the step title when the step is not an action. */
export function actionLabel(step: {
  readonly action?: string | undefined;
  readonly args?: readonly unknown[] | undefined;
  readonly title: string;
}): string {
  if (step.action === undefined || step.action === '') return step.title;
  return `${step.action}(${formatArgs(step.args)})`;
}

/**
 * The text to show for a captured blob: binary blobs become a `(binary name, ~N bytes)` placeholder, JSON is
 * pretty-printed (left as is if it does not parse), anything else is shown as stored, and `(missing)` when the
 * test does not hold the blob's file.
 */
export function formatBlobBody(
  test: HtmlReportTest,
  blob: ReportSnapshotBlob
): string {
  if (blob.media === 'bytes') {
    const bin = test.blobs[blob.file];
    const n = bin?.base64 ? Math.floor(bin.base64.length * 0.75) : 0;
    return `(binary ${fileName(blob.file)}${n ? `, ~${n} bytes` : ''})`;
  }
  const text = blobText(test, blob);
  if (text === null) return '(missing)';
  if (blob.media === 'json') {
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return text;
    }
  }
  return text;
}

/** The heading line of a blob: `name · nodeId · media`, without the node when it has none. */
export function blobHeading(blob: ReportSnapshotBlob): string {
  return `${blob.name}${blob.nodeId ? ` · ${blob.nodeId}` : ''} · ${blob.media}`;
}

/** A `data:` URL for a blob stored as base64 bytes, or null when the test holds no such bytes (text blobs have none). */
export function downloadUrl(
  test: HtmlReportTest,
  blob: ReportSnapshotBlob
): string | null {
  return blobDataUrl(test, blob);
}
