import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Undo temporary release edits without recreating a checkout that disappeared mid-run. A `null`
 * original means the file did not exist before the release wrote it, so it is removed.
 */
export function restoreOriginals(originals: ReadonlyMap<string, string | null>): number {
  let skipped = 0;
  for (const [path, raw] of originals) {
    if (!existsSync(dirname(path))) {
      skipped += 1;
      continue;
    }
    if (raw === null) rmSync(path, { force: true });
    else writeFileSync(path, raw);
  }
  return skipped;
}
