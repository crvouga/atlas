import type { EvidenceStatus } from '@crvouga/atlas/reports/explorer-types';
import type { SpecStatus } from '@crvouga/atlas/reports/evidence-view';
import { useEffect, useState } from 'react';

export const STATUS_WORD: Record<SpecStatus, string> = {
  passed: 'Passed',
  failed: 'Failed',
  running: 'Running',
  'not-run': 'Not run',
  none: 'No results'
};

export function statusWord(status: EvidenceStatus | SpecStatus) {
  return STATUS_WORD[status];
}

const UNITS: readonly [number, string][] = [[86_400_000, 'd'], [3_600_000, 'h'], [60_000, 'min']];

/** How long ago something was recorded, in the largest whole unit. */
export function ago(atMs: number, nowMs: number) {
  const elapsed = Math.max(0, nowMs - atMs);
  for (const [size, unit] of UNITS) if (elapsed >= size) return `${Math.floor(elapsed / size)} ${unit} ago`;
  return 'just now';
}

const dateTime = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function exactTime(atMs: number) {
  return Number.isFinite(atMs) ? dateTime.format(new Date(atMs)) : 'Unknown time';
}

export function duration(ms: number | null | undefined) {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '';
  if (ms < 1) return '<1 ms';
  if (ms < 1_000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(ms < 10_000 ? 1 : 0)} s`;
  return `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1_000)} s`;
}

export function shortSha(sha: string | null) {
  return sha ? sha.slice(0, 7) : null;
}

export function plural(count: number, one: string, many: string) {
  return `${count} ${count === 1 ? one : many}`;
}

/** The current time, refreshed often enough for "3 min ago" to stay true. */
export function useNow(everyMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}
