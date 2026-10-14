/**
 * @module Explorer version markers
 *
 * Marker files `versions/<sha>.json` that list which commits a store has anything recorded for, so the explorer can
 * show a commit that has parts or specs but no spec run. A store layout older than layers; the markers are small,
 * immutable and idempotent to write, and are read in place by newer readers.
 *
 * @see docs/report-contract.md (stores written before layers existed)
 */
import { readUtf8, writeUtf8 } from './object-io';
import type { ObjectStore } from './object-store';
import { isCommitSha } from './keys';

/**
 * Writes the marker `versions/<sha>.json` (`{"sha": "<sha>"}`) so an independent producer's commit appears without
 * a spec run. Writing it again is harmless. Throws `Invalid commit` when `sha` is not a 40-hex-digit commit.
 */
export async function recordExplorerVersion(
  store: ObjectStore,
  sha: string
): Promise<void> {
  if (!isCommitSha(sha)) throw new Error('Invalid commit');
  await writeUtf8(
    store,
    `versions/${sha}.json`,
    JSON.stringify({ sha }),
    'application/json'
  );
}

/**
 * Lists the commits that have a marker, in key order. Keys under `versions/` that are not `<40 hex>.json` are
 * ignored. A marker that is missing at read time or whose content does not name its own sha is not skipped:
 * it throws `Invalid explorer version`, so corrupt data fails visibly.
 */
export async function listExplorerVersions(
  store: ObjectStore
): Promise<readonly string[]> {
  const versions: string[] = [];
  for (const key of await store.listKeys('versions/')) {
    const sha = /^versions\/([0-9a-f]{40})\.json$/.exec(key)?.[1];
    if (sha === undefined) continue;
    const body = await readUtf8(store, key);
    if (body === null || (JSON.parse(body) as { sha?: unknown }).sha !== sha)
      throw new Error('Invalid explorer version');
    versions.push(sha);
  }
  return versions;
}
