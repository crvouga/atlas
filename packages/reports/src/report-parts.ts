/**
 * @module Report parts of a commit
 *
 * Reads, writes and validates "parts": one producer's checks for one commit, stored under
 * `commits/<sha>/parts/<producer>/` in the older commit-keyed layout. Publishing a part also publishes it as an
 * immutable layer, so it composes with everything else; reading parts picks the latest per producer for the explorer.
 * A part that is corrupt or belongs to another commit fails visibly instead of being skipped.
 */
import { normalizeEnvironment } from './layer-axes';
import { publishLayer } from './layer-store';
import { readCommit } from './read';
import { readInventory } from './spec-inventory';
import { readUtf8, writeUtf8 } from './object-io';
import type { ObjectStore } from './object-store';
import { inCompletionOrder } from './completion-order';
import type { EvidenceStatus, ReportPart } from './explorer-types';
import { recordExplorerVersion } from './explorer-versions';
import { isCommitSha, isKeySegment } from './keys';

const STATUSES = new Set(['passed', 'failed', 'running', 'not-run']);

/** The status of a whole part: `failed` if any check failed, else `running` if any is running, else `not-run` if it has no checks or any is `not-run`, else `passed`. */
export function partStatus(part: ReportPart): EvidenceStatus {
  const statuses = part.checks.map((check) => check.status);
  if (statuses.includes('failed')) return 'failed';
  if (statuses.includes('running')) return 'running';
  if (statuses.length === 0 || statuses.includes('not-run')) return 'not-run';
  return 'passed';
}

/**
 * Throws unless `part` is well formed: a 40-hex `sha`, an `id` usable as a key segment, a non-empty `kind` and
 * `title`, a non-negative safe-integer `recordedAtMs`, string `parameters` values, and checks with a unique non-empty
 * `id`, non-empty `title`, a string `detail`, one of the four statuses and finite-number measurements with a name and
 * unit. The error is `Invalid report part`, `Invalid report parameters`, `Invalid evidence check` or `Invalid evidence
 * measurement`; it does not say which field.
 */
export function validatePart(part: ReportPart): void {
  if (
    !isCommitSha(part.sha) ||
    !isKeySegment(part.id) ||
    typeof part.kind !== 'string' ||
    !part.kind ||
    typeof part.title !== 'string' ||
    !part.title ||
    !Number.isSafeInteger(part.recordedAtMs) ||
    part.recordedAtMs < 0 ||
    !Array.isArray(part.checks)
  )
    throw new Error('Invalid report part');
  if (part.parameters && Object.values(part.parameters).some(value => typeof value !== 'string')) throw new Error('Invalid report parameters');
  const ids = new Set<string>();
  for (const check of part.checks) {
    if (
      typeof check.id !== 'string' ||
      !check.id ||
      ids.has(check.id) ||
      typeof check.title !== 'string' ||
      !check.title ||
      typeof check.detail !== 'string' ||
      !STATUSES.has(check.status) ||
      !Array.isArray(check.measurements)
    )
      throw new Error('Invalid evidence check');
    ids.add(check.id);
    for (const measurement of check.measurements) {
      if (
        typeof measurement.name !== 'string' ||
        !measurement.name ||
        typeof measurement.unit !== 'string' ||
        !measurement.unit ||
        !Number.isFinite(measurement.value) ||
        (measurement.limit !== undefined && !Number.isFinite(measurement.limit))
      )
        throw new Error('Invalid evidence measurement');
    }
  }
}

function partsPrefix(sha: string): string {
  if (!isCommitSha(sha)) throw new Error('Invalid commit');
  return `commits/${sha}/parts/`;
}

/**
 * Stores a part and publishes it as a layer. Validates first (`validatePart`, which throws and writes nothing).
 *
 * Each producer owns a separate key, `commits/<sha>/parts/<id>/<recordedAtMs>-<sha256 of the JSON>.json`, independent
 * of the spec-run attempt, so republishing identical content rewrites the same key. It then records the commit as an
 * explorer version and publishes a layer (producer `part.id`, environment from the `environment` parameter, the
 * commit's branch and run URL when a commit record exists, the commit's spec inventory) with no captured files.
 */
export async function publishPart(
  store: ObjectStore,
  part: ReportPart
): Promise<void> {
  validatePart(part);
  const json = JSON.stringify(part);
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(json))
  );
  const hash = [...digest]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  await writeUtf8(
    store,
    `${partsPrefix(part.sha)}${part.id}/${part.recordedAtMs}-${hash}.json`,
    json,
    'application/json'
  );
  await recordExplorerVersion(store, part.sha);
  const commit = await readCommit(store, part.sha);
  const environment = normalizeEnvironment(part.parameters?.environment);
  await publishLayer(store, {
    ...(part.freshness ? { freshness: part.freshness } : {}), producer: part.id, recordedAtMs: part.recordedAtMs, sha: part.sha, branch: commit?.branch ?? null, runUrl: commit?.runUrl ?? null,
    ...(environment ? { environment } : {}),
    parameters: part.parameters ?? {}, specs: (await readInventory(store, part.sha))?.entries ?? [], parts: [part], source: null, recording: null,
  }, (async function* () {})());
}

/**
 * Reads the latest part of every producer for a commit (see `latestParts`), sorted by kind then id.
 *
 * Throws `Invalid commit` for a sha that is not 40 hex, a validation error (see `validatePart`) or a `SyntaxError` for
 * a part that is corrupt, `Report part disappeared` when a listed part vanishes, and `Report part belongs to another
 * commit` when a part's `sha` or `id` does not match its key. Corrupt evidence fails visibly; it is never skipped.
 */
export async function readParts(
  store: ObjectStore,
  sha: string
): Promise<readonly ReportPart[]> {
  const keys = await store.listKeys(partsPrefix(sha));
  const parts: ReportPart[] = [];
  const tasks = keys.map((key) => async () => {
    const raw = await readUtf8(store, key);
    if (raw === null) throw new Error('Report part disappeared');
    const part = JSON.parse(raw) as ReportPart;
    validatePart(part);
    if (part.sha !== sha || !key.startsWith(`${partsPrefix(sha)}${part.id}/`))
      throw new Error('Report part belongs to another commit');
    return part;
  });
  for await (const part of inCompletionOrder(tasks, 16)) parts.push(part);
  return latestParts(parts);
}

/**
 * Keeps one part per producer id and sorts by kind then id. The newer `recordedAtMs` wins; at the same time the more
 * severe status wins (`failed`, then `running`, then `not-run`, then `passed`); at the same status the greater JSON
 * text wins, so the answer is independent of write and list order. This is not the layer winner rule: here a newer
 * unfinished part replaces an older completed one.
 */
export function latestParts(
  parts: readonly ReportPart[]
): readonly ReportPart[] {
  const latest = new Map<string, ReportPart>();
  const rank = { passed: 0, 'not-run': 1, running: 2, failed: 3 };
  for (const part of parts) {
    const previous = latest.get(part.id);
    if (
      !previous ||
      part.recordedAtMs > previous.recordedAtMs ||
      (part.recordedAtMs === previous.recordedAtMs &&
        (rank[partStatus(part)] > rank[partStatus(previous)] ||
          (rank[partStatus(part)] === rank[partStatus(previous)] &&
            JSON.stringify(part) > JSON.stringify(previous))))
    )
      latest.set(part.id, part);
  }
  return [...latest.values()].sort(
    (a, b) => compare(a.kind, b.kind) || compare(a.id, b.id)
  );
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
