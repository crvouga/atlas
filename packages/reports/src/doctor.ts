/**
 * @module Store doctor and IAM policy
 *
 * `inspectStore` checks that a store works end to end (credentials, listing, what it holds, writing and reading back a
 * scratch object) and says what to fix when it does not; `iamPolicy` prints the least-privilege AWS policy for publishers
 * and readers. Used by `atlas report doctor` and `atlas report policy`, for folders, S3-compatible buckets and Atlas
 * servers alike.
 *
 * @see docs/deploying.md
 */

import { LAYER_INDEX } from './layer-store';
import { verifyObjectStore } from './object-store-conformance';
import type { CliBackend } from './cli-stores';

/** One thing `inspectStore` checked: its `name` (`store`, `list`, `contents`, `write`, …), whether it is `ok`, what was seen, and, when it is not, what to `fix`. */
export type Check = { readonly ok: boolean; readonly name: string; readonly detail: string; readonly fix?: string };

/** The least an account needs, as an AWS IAM policy. R2, MinIO and the rest have their own policy languages: grant the same actions. */
export function iamPolicy(location: { bucket: string; prefix: string }, role: 'publisher' | 'reader' | 'both'): object {
  const base = location.prefix ? `${location.prefix}/` : '';
  const bucketArn = `arn:aws:s3:::${location.bucket}`;
  const statements: object[] = [];
  if (role !== 'reader') {
    statements.push(
      { Sid: 'AtlasPublish', Effect: 'Allow', Action: ['s3:PutObject', 's3:GetObject'], Resource: `${bucketArn}/${base}layers/*` },
      { Sid: 'AtlasDoctorCleanup', Effect: 'Allow', Action: 's3:DeleteObject', Resource: `${bucketArn}/${base}layers/doctor-*` }
    );
  }
  if (role !== 'publisher') {
    statements.push({ Sid: 'AtlasRead', Effect: 'Allow', Action: 's3:GetObject', Resource: `${bucketArn}/${base}layers/*` });
  }
  // Publishers need this too: without it S3 answers 403, not 404, when asked whether a layer exists yet.
  statements.push({ Sid: 'AtlasList', Effect: 'Allow', Action: 's3:ListBucket', Resource: bucketArn, // IfExists: a listing always carries a prefix and is held to it; a HEAD or GET of one object carries none, and
    // must still be answered "not found" rather than "forbidden".
    ...(base ? { Condition: { StringLikeIfExists: { 's3:prefix': [base, `${base}*`] } } } : {}) });
  return { Version: '2012-10-17', Statement: statements };
}

const when = (inverted: string | undefined) => {
  const time = inverted ? Number.MAX_SAFE_INTEGER - Number(inverted) : NaN;
  return Number.isFinite(time) ? new Date(time).toISOString() : 'unknown';
};

/** What the account being checked is for: `publisher` (writes layers), `reader` (reads them) or `both`. It decides which checks run. */
export type Role = 'publisher' | 'reader' | 'both';

/** Is this store usable for Atlas, and if not, what exactly is wrong? Each step says what to do. */
export async function inspectStore(backend: CliBackend, options: { readonly role?: Role } = {}): Promise<Check[]> {
  const role = options.role ?? 'both';
  const checks: Check[] = [];
  const add = (check: Check) => { checks.push(check); return check.ok; };
  const store = backend.store;
  const s3 = backend.s3;
  add({ ok: true, name: 'store', detail: s3?.label ?? backend.label ?? backend.id });

  if (s3 && role !== 'publisher') {
    const ping = await s3.ping();
    add(ping.ok
      ? { ok: true, name: 'list', detail: `${ping.ms} ms${s3.credentialSource() ? `, credentials from ${s3.credentialSource()}` : ''}` }
      : { ok: false, name: 'list', detail: ping.error ?? 'failed', fix: 'Check the bucket, region and endpoint in the store URL, and the credentials. `atlas report policy --store <url>` prints the permissions needed.' });
    if (!ping.ok) return checks;
  }
  if (role !== 'publisher') {
    try {
      const keys = await store.listKeys(LAYER_INDEX);
      const [sets, runs] = await Promise.all([store.listKeys('layers/specs/index/'), store.listKeys('layers/runs/index/')]);
      add({ ok: true, name: 'contents', detail: `${keys.length} layer${keys.length === 1 ? '' : 's'}${keys.length ? ` (newest ${when(/\/(\d{16})-/.exec(keys[0]!)?.[1])})` : ''}, ${sets.length} spec set${sets.length === 1 ? '' : 's'}, ${runs.length} run${runs.length === 1 ? '' : 's'}` });
    } catch (error) {
      add({ ok: false, name: 'contents', detail: error instanceof Error ? error.message : String(error) });
      return checks;
    }
  }
  if (role === 'reader') return checks;
  const scratch = `layers/doctor-${Math.random().toString(36).slice(2, 10)}/`;
  if (role === 'both') {
    const verification = await verifyObjectStore(store, scratch);
    add(verification.ok
      ? { ok: true, name: 'write', detail: 'wrote, listed, read back and deleted a scratch object: the store meets the ObjectStore contract' }
      : { ok: false, name: 'write', detail: verification.failures.join('; '), fix: 'Publishers need s3:PutObject and s3:GetObject on layers/*, and the doctor s3:DeleteObject on layers/doctor-*. To check a publisher-only or read-only account, pass --role publisher or --role reader.' });
    return checks;
  }
  // A publisher cannot list: prove what it does, which is put, head and get.
  const key = `${scratch}probe.txt`;
  try {
    await store.put(key, new TextEncoder().encode('atlas'), 'text/plain');
    const found = await store.head(key);
    await store.delete(key).catch(() => {});
    add(found ? { ok: true, name: 'write', detail: 'wrote and found a scratch object' } : { ok: false, name: 'write', detail: 'an object was written but could not be found again', fix: 'The account needs s3:GetObject (HeadObject) on layers/*.' });
  } catch (error) {
    add({ ok: false, name: 'write', detail: error instanceof Error ? error.message : String(error), fix: 'Publishers need s3:PutObject and s3:GetObject on layers/*, and s3:ListBucket on the bucket (S3 answers 403 instead of 404 for a missing object without it).' });
  }
  return checks;
}
