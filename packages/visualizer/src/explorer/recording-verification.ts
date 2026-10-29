/**
 * @module Recording verification of a run
 *
 * What the server's read-back of stored videos says about one run, for the Runs tab: how many of its stored videos were
 * read back, how many passed, and which problems the others have. It is evidence about storage, kept apart from the run's
 * test outcomes: it never changes how a run is counted, and "never read back" is `null`, not "verified".
 */
import type { RecordingVerification } from '@crvouga/atlas/schema';

/** The words for each way a stored recording can be wrong; an unknown problem is still a gap and is named as it came. */
const PROBLEMS: Readonly<Record<string, string>> = {
  'blob-missing': 'file gone from storage',
  'not-in-bundle': 'file missing from the run’s bundle',
  unreadable: 'storage could not be read',
  'size-mismatch': 'size differs from what was published',
  'checksum-mismatch': 'content differs from what was published',
  undecodable: 'not the video format it claims to be'
};

/** What was read back of one run's stored recordings. */
export type RunVerification = {
  /** Videos read back: those that name a stored file. */
  readonly checked: number;
  readonly ok: number;
  /** Each problem in words, with how many videos have it, most common first. */
  readonly problems: readonly string[];
  readonly gaps: number;
  /** When the server last read the run's layers back, epoch milliseconds (the oldest of them). */
  readonly atMs: number;
};

/**
 * What the read-back found for the run with this key, or `null` when none of its layers was read back (the page then says
 * nothing about its stored files). A run is as unavailable as its worst layer: gaps add up across its layers.
 */
export function verificationOfRun(document: RecordingVerification | null | undefined, runKey: string): RunVerification | null {
  const layers = document?.layers.filter((layer) => layer.run === runKey) ?? [];
  if (!layers.length) return null;
  const counts = new Map<string, number>();
  let checked = 0, ok = 0, gaps = 0, atMs = Infinity;
  for (const layer of layers) {
    checked += layer.checked;
    ok += layer.ok;
    atMs = Math.min(atMs, layer.verifiedAtMs);
    for (const gap of layer.gaps) {
      gaps += 1;
      const word = PROBLEMS[gap.problem] ?? gap.problem;
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }
  const problems = [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([word, count]) => `${count} ${word}`);
  return { checked, ok, problems, gaps, atMs };
}

/** Whether a run's stored videos were read back and none of them can be played: its Watch action would lead nowhere. */
export function allStoredVideosGone(verification: RunVerification | null, playable: number): boolean {
  return verification !== null && verification.gaps > 0 && verification.ok === 0 && verification.checked >= playable;
}
