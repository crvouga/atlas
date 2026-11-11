/**
 * @module Capture journals and shard bundles
 *
 * A collecting shard can keep a **journal**: before it publishes a capture layer to the server, it writes the same layer
 * (the same input, so the same content-addressed id) into a local directory store, and records in a manifest whether the
 * publish then succeeded. The folder is a **bundle** ({@link ../../schema/src/ui-catalog-bundle}): when the server stops
 * answering, or the claim is lost, or the job is killed after a capture, the bytes and what they are remain, ready to be
 * uploaded as a CI artifact.
 *
 * Later, `validateBundle` checks a bundle without trusting it (every object's digest and size, no path that leaves the
 * store, every layer the manifest names present, the definition and source it was made for); `mergeBundles` joins any
 * number of them in any order into one (layers are immutable and addressed by content, so nothing is overwritten and
 * every attempt stays named); `importBundle` copies a valid bundle's layers into any store (a server, a directory, S3).
 *
 * Replaying is not claiming: a capture whose publish never succeeded answers a claim that has since ended, so by default
 * (`reconcile: 'retain'`) it is kept in the bundle and listed, not imported into a store where it would count as current
 * evidence. `reconcile: 'accept'` is the explicit policy that imports it anyway. Node/Bun only.
 *
 * @see docs/ui-catalog.md#capture-journals-and-shard-bundles
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { PublishChecksInput } from '../../schema/src/layer';
import {
  UiBundleManifestSchema, UI_CATALOG_BUNDLE_MANIFEST, UI_CATALOG_BUNDLE_VERSION,
  type UiBundleCapture, type UiBundleManifest, type UiBundleProblem, type UiBundlePublication
} from '../../schema/src/ui-catalog-bundle';
import type { UiCatalogDefinitionDocument } from '../../schema/src/ui-catalog-queue';
import { directoryStore } from './directory-store';
import { layerCatalogKey, layerKey, readLayer } from './layer-store';
import type { ReportLayer } from './layer-types';
import { readBytes } from './object-io';
import type { ObjectStore } from './object-store';
import { publishChecks } from './publish-checks';
import { catalogPlanLayers, expandCatalog } from './ui-catalog-definition';

/** Who writes a journal: the shard id its claims carry, and optionally the participant (a CI job), attempt, refresh and source. */
export type JournalIdentity = {
  readonly shard: string;
  /** The CI job or machine; default the shard. */
  readonly participant?: string;
  /** The attempt of that participant (`GITHUB_RUN_ATTEMPT`); default `1`. */
  readonly attempt?: string;
  readonly refresh?: string | null;
  readonly collection?: string | null;
  readonly source?: { readonly sha?: string | null; readonly branch?: string | null };
  readonly now?: () => number;
};

/** One journaled capture: its layer id, and how to record whether its publish succeeded. */
export type JournalEntry = {
  readonly layer: string;
  /** Record the publish's outcome. Never throws for a journal that can no longer be written: the capture is already on disk. */
  settle(publication: Exclude<UiBundlePublication, 'pending'>, error?: string): Promise<void>;
};

/** What `collectCatalog` asks of a journal. {@link captureJournal} is the implementation; a test may give its own. */
export type CatalogJournal = {
  /** The bundle folder. */
  readonly dir: string;
  /** Called once the definition is known: writes its plan layers, so an offline export expects every item. */
  open(definition: { readonly version: string; readonly document: UiCatalogDefinitionDocument }): Promise<void>;
  /** Write a capture layer before it is published. Throws when the folder cannot be written. */
  record(input: PublishChecksInput, context: { readonly claimId: string | null; readonly units: readonly string[] }): Promise<JournalEntry>;
  /** The manifest as it stands. */
  manifest(): UiBundleManifest;
};

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const STORE = 'store';

/** Whether a manifest path may name an object of a bundle's store: relative, inside `layers/`, no `.`/`..`/empty segment or backslash. */
export function isSafeBundlePath(key: string): boolean {
  const parts = key.split('/');
  const last = parts.at(-1) ?? '';
  return key.startsWith('layers/') && !key.includes('\\') && !key.includes('\0') && !parts.some(part => part === '' || part === '.' || part === '..')
    && !last.endsWith('.content-type') && !last.startsWith('.tmp-');
}

/** Every object key of one layer in a store: its blobs, its manifest, then its catalog entry (the order to copy them in). */
export function layerObjectKeys(layer: Pick<ReportLayer, 'id' | 'recordedAtMs' | 'bundle'>): string[] {
  const blobs = [...new Set(Object.values(layer.bundle ?? {}).flatMap(file => file.parts.map(part => part.blob)))].sort(compare);
  return [...blobs, layerKey(layer.id), layerCatalogKey(layer.recordedAtMs, layer.id)];
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
    await rename(temporary, file);
  } catch (error) { await rm(temporary, { force: true }); throw error; }
}

/** Read a bundle's manifest. Throws when it is missing, not JSON or not a manifest, saying which. */
export async function readBundleManifest(dir: string): Promise<UiBundleManifest> {
  const file = path.join(dir, UI_CATALOG_BUNDLE_MANIFEST);
  let text: string;
  try { text = await readFile(file, 'utf8'); } catch { throw new Error(`${dir} has no ${UI_CATALOG_BUNDLE_MANIFEST}: it is not a bundle`); }
  let json: unknown;
  try { json = JSON.parse(text); } catch { throw new Error(`${file} is not JSON`); }
  const parsed = UiBundleManifestSchema.safeParse(json);
  if (!parsed.success) throw new Error(`${file} is not a bundle manifest: ${parsed.error.issues.slice(0, 3).map(issue => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ')}`);
  return parsed.data;
}

function emptyManifest(now: number): UiBundleManifest {
  return { schemaVersion: UI_CATALOG_BUNDLE_VERSION, kind: 'atlas-ui-catalog-bundle', definition: null, refresh: null, collection: null, source: { sha: null, branch: null }, attempts: [], plans: [], captures: [], objects: [], updatedAtMs: now };
}

/**
 * Open (or resume) a capture journal in `dir`. Pass it to `collectCatalog({ journal })`: every capture layer is written
 * here before it is published, and its manifest says whether the publish succeeded. Resuming a folder that already holds
 * a bundle keeps what is there and adds this attempt. Writes are atomic, and the manifest is rewritten after every capture,
 * so a job killed mid-collection leaves a valid bundle of what it captured. `open` throws when the folder already holds a
 * bundle of another definition.
 *
 * @example
 * ```ts
 * const journal = captureJournal('atlas-bundle', { shard, participant: 'capture-mobile', attempt: process.env.GITHUB_RUN_ATTEMPT });
 * await collectCatalog({ store, catalog, shard: { id: shard }, journal, capture });
 * ```
 */
export function captureJournal(dir: string, identity: JournalIdentity): CatalogJournal {
  const root = path.resolve(dir);
  const store = directoryStore(path.join(root, STORE));
  const now = identity.now ?? Date.now;
  const participant = identity.participant ?? identity.shard;
  const attempt = identity.attempt ?? '1';
  let manifest: UiBundleManifest = emptyManifest(now());
  let loaded: Promise<void> | null = null;
  let chain: Promise<unknown> = Promise.resolve();
  const objects = new Map<string, { sha256: string; bytes: number }>();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const run = chain.then(work, work);
    chain = run.catch(() => undefined);
    return run;
  };
  const load = () => loaded ??= (async () => {
    try { manifest = await readBundleManifest(root); } catch { manifest = emptyManifest(now()); }
    for (const item of manifest.objects) objects.set(item.path, { sha256: item.sha256, bytes: item.bytes });
    if (!manifest.attempts.some(item => item.shard === identity.shard && item.attempt === attempt)) manifest.attempts.push({ shard: identity.shard, participant, attempt, startedAtMs: now() });
    manifest.refresh ??= identity.refresh ?? null;
    manifest.collection ??= identity.collection ?? null;
    manifest.source = { sha: manifest.source.sha ?? identity.source?.sha ?? null, branch: manifest.source.branch ?? identity.source?.branch ?? null };
    await save();
  })();
  const save = async () => {
    manifest.objects = [...objects].sort(([a], [b]) => compare(a, b)).map(([key, value]) => ({ path: key, ...value }));
    manifest.updatedAtMs = now();
    await writeJson(path.join(root, UI_CATALOG_BUNDLE_MANIFEST), manifest);
  };
  // Hash what a layer holds that the manifest does not list yet (a write the store skipped because the object was there is still listed).
  const track = async (layer: ReportLayer) => {
    for (const key of layerObjectKeys(layer)) {
      if (objects.has(key)) continue;
      const stored = await store.get(key);
      if (!stored) throw new Error(`The journal lost ${key} while writing it`);
      const bytes = await readBytes(stored.body);
      objects.set(key, { sha256: sha256(bytes), bytes: bytes.byteLength });
    }
  };
  return {
    dir: root,
    manifest: () => structuredClone(manifest),
    open: definition => serial(async () => {
      await load();
      if (manifest.definition && manifest.definition.version !== definition.version) throw new Error(`${root} holds a bundle of definition ${manifest.definition.version.slice(0, 12)}, not ${definition.version.slice(0, 12)}: journal another definition into another folder`);
      if (manifest.definition && manifest.plans.length) return;
      manifest.definition = { version: definition.version, name: definition.document.name };
      for (const input of catalogPlanLayers(expandCatalog(definition.document, definition.version), now())) {
        const layer = await publishChecks(store, input);
        await track(layer);
        manifest.plans.push({ layer: layer.id, recordedAtMs: layer.recordedAtMs });
      }
      await save();
    }),
    record: (input, context) => serial(async () => {
      await load();
      const layer = await publishChecks(store, input);
      await track(layer);
      const checks = input.checks as readonly { readonly status?: string }[];
      let capture = manifest.captures.find(item => item.layer === layer.id && item.shard === identity.shard && item.attempt === attempt);
      if (!capture) {
        capture = { layer: layer.id, recordedAtMs: layer.recordedAtMs, shard: identity.shard, participant, attempt, claimId: context.claimId, units: [...context.units].sort(compare), items: checks.length, failed: checks.filter(check => check.status === 'failed').length, publication: 'pending' };
        manifest.captures.push(capture);
      }
      await save();
      const entry = capture;
      return {
        layer: layer.id,
        settle: (publication, error) => serial(async () => {
          if (entry.publication !== 'published') {
            entry.publication = publication;
            if (error && publication === 'failed') entry.error = error.slice(0, 2000); else delete entry.error;
          }
          await save().catch(() => undefined);
        })
      };
    })
  };
}

/** What `validateBundle` found. `valid` is false on any problem; an invalid bundle's captures count for nothing. */
export type BundleValidation = {
  readonly bundle: string;
  readonly valid: boolean;
  readonly manifest: UiBundleManifest | null;
  readonly problems: readonly UiBundleProblem[];
};

/** What a bundle must have been made for. */
export type BundleExpectation = { readonly definition?: string; readonly sha?: string };

/**
 * Check a bundle without trusting it: its manifest parses; every object it lists has a safe path, exists, and has the
 * listed size and SHA-256; every object in its store is listed; every plan and capture layer it names is present and
 * readable with all of its blobs; and, when `expect` says so, it was made for that definition and commit. Never throws for
 * a bad bundle: every problem is listed, and `valid` is false.
 */
export async function validateBundle(dir: string, expect: BundleExpectation = {}): Promise<BundleValidation> {
  const bundle = dir;
  const problems: UiBundleProblem[] = [];
  let manifest: UiBundleManifest;
  try { manifest = await readBundleManifest(dir); } catch (error) {
    return { bundle, valid: false, manifest: null, problems: [{ code: 'manifest', bundle, message: error instanceof Error ? error.message : String(error) }] };
  }
  const root = path.resolve(dir, STORE);
  const listed = new Set<string>();
  for (const item of manifest.objects) {
    if (!isSafeBundlePath(item.path)) { problems.push({ code: 'unsafe-path', bundle, path: item.path, message: `The manifest names ${JSON.stringify(item.path)}, which is not a safe path inside the bundle's layers` }); continue; }
    const file = path.resolve(root, item.path);
    if (!file.startsWith(root + path.sep)) { problems.push({ code: 'unsafe-path', bundle, path: item.path, message: `${item.path} leaves the bundle` }); continue; }
    listed.add(item.path);
    let bytes: Uint8Array;
    try { bytes = await readFile(file); } catch { problems.push({ code: 'missing', bundle, path: item.path, message: `${item.path} is listed but not in the bundle` }); continue; }
    if (bytes.byteLength !== item.bytes || sha256(bytes) !== item.sha256) problems.push({ code: 'digest', bundle, path: item.path, message: `${item.path} does not match its listed size and SHA-256: it was changed or truncated` });
  }
  const store = directoryStore(root);
  let present: readonly string[] = [];
  try { present = await store.listKeys(''); } catch (error) { problems.push({ code: 'missing', bundle, message: `The bundle's store cannot be listed: ${error instanceof Error ? error.message : String(error)}` }); }
  for (const key of present) if (!listed.has(key)) problems.push({ code: 'unlisted', bundle, path: key, message: `${key} is in the bundle but not in its manifest, so its integrity cannot be checked` });
  const layers = new Map<string, number>();
  for (const plan of manifest.plans) layers.set(plan.layer, plan.recordedAtMs);
  for (const capture of manifest.captures) layers.set(capture.layer, capture.recordedAtMs);
  for (const [id, recordedAtMs] of layers) {
    let layer: ReportLayer | null = null;
    try { layer = listed.has(layerKey(id)) ? await readLayer(store, id) : null; } catch (error) {
      problems.push({ code: 'layer', bundle, path: layerKey(id), message: `Layer ${id.slice(0, 12)} cannot be read: ${error instanceof Error ? error.message : String(error)}` });
      continue;
    }
    if (!layer || layer.recordedAtMs !== recordedAtMs) { problems.push({ code: 'layer', bundle, path: layerKey(id), message: `Layer ${id.slice(0, 12)} is named by the manifest but is not in the bundle as listed` }); continue; }
    for (const key of layerObjectKeys(layer)) if (!listed.has(key)) problems.push({ code: 'missing', bundle, path: key, message: `Layer ${id.slice(0, 12)} needs ${key}, which the manifest does not list` });
  }
  if (expect.definition && manifest.definition?.version !== expect.definition) problems.push({ code: 'incompatible', bundle, message: `The bundle was made for definition ${manifest.definition?.version.slice(0, 12) ?? '(none)'}, not ${expect.definition.slice(0, 12)}` });
  if (expect.sha && manifest.source.sha !== null && manifest.source.sha !== expect.sha) problems.push({ code: 'incompatible', bundle, message: `The bundle was made at ${manifest.source.sha.slice(0, 12)}, not ${expect.sha.slice(0, 12)}` });
  // Problems in a stable order, so the same bundle is the same answer.
  problems.sort((a, b) => compare(a.code, b.code) || compare(a.path ?? '', b.path ?? ''));
  return { bundle, valid: problems.length === 0, manifest, problems };
}

/** Find bundles: each path that is a bundle, or the bundles found under it (up to four levels down, as downloaded CI artifacts are laid out). Sorted. */
export async function findBundles(paths: readonly string[]): Promise<string[]> {
  const found = new Set<string>();
  const walk = async (dir: string, depth: number) => {
    if (await stat(path.join(dir, UI_CATALOG_BUNDLE_MANIFEST)).then(info => info.isFile(), () => false)) { found.add(dir); return; }
    if (depth >= 4) return;
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== STORE) await walk(path.join(dir, entry.name), depth + 1);
  };
  for (const given of paths) {
    if (!(await stat(given).then(info => info.isDirectory(), () => false))) throw new Error(`${given} is not a folder`);
    await walk(given, 0);
  }
  return [...found].sort(compare);
}

const RANK: Record<UiBundlePublication, number> = { pending: 0, failed: 1, published: 2 };

/** What `mergeBundles` did. Nothing is written unless every input is valid and compatible. */
export type BundleMerge = {
  readonly ok: boolean;
  readonly out: string;
  readonly bundles: readonly BundleValidation[];
  readonly problems: readonly UiBundleProblem[];
  /** The merged manifest, or null when nothing was merged. */
  readonly manifest: UiBundleManifest | null;
  /** Expected participants with no attempt in any bundle (a job whose artifact never arrived). */
  readonly missing: readonly string[];
};

/**
 * Merge bundles into one at `out`, in any order with the same result: every object (copied once; layers are immutable and
 * addressed by content), every attempt, every capture with the attempt that made it (a capture two attempts made is listed
 * for each), the plans. When `out` already holds a bundle it is merged too, so merging is incremental. Refuses (writes
 * nothing, `ok: false`) when any bundle is invalid, or when they were made for different definitions, commits or refreshes.
 * `expect` lists participants (the jobs of a matrix plan) that should each have an attempt: those without are `missing`,
 * and make `ok` false while still merging what arrived.
 */
export async function mergeBundles(dirs: readonly string[], out: string, options: { readonly expect?: readonly string[] } & BundleExpectation = {}): Promise<BundleMerge> {
  const target = path.resolve(out);
  const inputs = [...new Set(dirs.map(dir => path.resolve(dir)))].filter(dir => dir !== target);
  if (await stat(path.join(target, UI_CATALOG_BUNDLE_MANIFEST)).then(() => true, () => false)) inputs.push(target);
  const bundles = await Promise.all(inputs.sort(compare).map(dir => validateBundle(dir, options)));
  const problems = bundles.flatMap(item => item.problems);
  const manifests = bundles.map(item => item.manifest).filter((item): item is UiBundleManifest => item !== null);
  const distinct = (values: readonly (string | null | undefined)[]) => [...new Set(values.filter((item): item is string => typeof item === 'string'))].sort(compare);
  for (const [label, values] of [['definitions', distinct(manifests.map(item => item.definition?.version))], ['commits', distinct(manifests.map(item => item.source.sha))], ['refreshes', distinct(manifests.map(item => item.refresh))]] as const) {
    if (values.length > 1) problems.push({ code: 'incompatible', bundle: target, message: `The bundles were made for different ${label} (${values.map(item => item.slice(0, 12)).join(', ')}); merge each into its own bundle` });
  }
  const attempts = new Map<string, UiBundleManifest['attempts'][number]>();
  for (const manifest of manifests) for (const item of manifest.attempts) {
    const key = `${item.shard}\0${item.attempt}`;
    const prior = attempts.get(key);
    if (!prior || item.startedAtMs < prior.startedAtMs) attempts.set(key, item);
  }
  const participants = new Set([...attempts.values()].map(item => item.participant));
  const missing = [...new Set(options.expect ?? [])].filter(name => !participants.has(name)).sort(compare);
  if (problems.length || !manifests.length) {
    if (!manifests.length && !problems.length) problems.push({ code: 'manifest', bundle: target, message: 'No bundle was given to merge' });
    return { ok: false, out: target, bundles, problems, manifest: null, missing };
  }
  const outStore = directoryStore(path.join(target, STORE));
  const objects = new Map<string, { sha256: string; bytes: number }>();
  for (const [index, manifest] of manifests.entries()) {
    const from = directoryStore(path.join(bundles[index]!.bundle, STORE));
    for (const item of manifest.objects) {
      const prior = objects.get(item.path);
      if (prior) { if (prior.sha256 !== item.sha256) problems.push({ code: 'digest', bundle: bundles[index]!.bundle, path: item.path, message: `${item.path} differs between bundles` }); continue; }
      objects.set(item.path, { sha256: item.sha256, bytes: item.bytes });
      if (bundles[index]!.bundle === target) continue;
      const existing = await outStore.get(item.path);
      if (existing) {
        if (sha256(await readBytes(existing.body)) !== item.sha256) problems.push({ code: 'digest', bundle: target, path: item.path, message: `${item.path} in the target differs from the bundle's` });
        continue;
      }
      const stored = await from.get(item.path);
      if (!stored) { problems.push({ code: 'missing', bundle: bundles[index]!.bundle, path: item.path, message: `${item.path} vanished during the merge` }); continue; }
      await outStore.put(item.path, await readBytes(stored.body), stored.contentType);
    }
  }
  if (problems.length) return { ok: false, out: target, bundles, problems, manifest: null, missing };
  const captures = new Map<string, UiBundleCapture>();
  for (const manifest of manifests) for (const item of manifest.captures) {
    const key = `${item.layer}\0${item.shard}\0${item.attempt}`;
    const prior = captures.get(key);
    if (!prior || RANK[item.publication] > RANK[prior.publication]) captures.set(key, item);
  }
  const plans = new Map(manifests.flatMap(manifest => manifest.plans.map(plan => [plan.layer, plan] as const)));
  const first = <T>(values: readonly T[]) => values[0] ?? null;
  const definition = manifests.map(item => item.definition).find(item => item !== null) ?? null;
  const merged: UiBundleManifest = {
    schemaVersion: UI_CATALOG_BUNDLE_VERSION, kind: 'atlas-ui-catalog-bundle', definition,
    refresh: first(distinct(manifests.map(item => item.refresh))), collection: first(distinct(manifests.map(item => item.collection))),
    source: { sha: first(distinct(manifests.map(item => item.source.sha))), branch: first(distinct(manifests.map(item => item.source.branch))) },
    attempts: [...attempts.values()].sort((a, b) => compare(a.participant, b.participant) || compare(a.attempt, b.attempt) || compare(a.shard, b.shard)),
    plans: [...plans.values()].sort((a, b) => compare(a.layer, b.layer)),
    captures: [...captures.values()].sort((a, b) => a.recordedAtMs - b.recordedAtMs || compare(a.layer, b.layer) || compare(a.shard, b.shard) || compare(a.attempt, b.attempt)),
    objects: [...objects].sort(([a], [b]) => compare(a, b)).map(([key, value]) => ({ path: key, ...value })),
    updatedAtMs: Math.max(...manifests.map(item => item.updatedAtMs))
  };
  await writeJson(path.join(target, UI_CATALOG_BUNDLE_MANIFEST), merged);
  return { ok: missing.length === 0, out: target, bundles, problems, manifest: merged, missing };
}

/** What `importBundle` did. */
export type BundleImport = {
  readonly ok: boolean;
  readonly bundle: BundleValidation;
  /** Layers now in the target (plans and captures). */
  readonly layers: number;
  readonly copied: number;
  readonly skipped: number;
  /** Captures kept in the bundle and not imported, because they never reached the server and the policy is `retain`. */
  readonly retained: readonly UiBundleCapture[];
};

/**
 * Copy a valid bundle's layers into a store (a server's `httpStore`, a directory, S3), each layer's blobs before its
 * manifest and its manifest before its catalog entry, skipping what the store has. Plans are copied unless
 * `plans: false` (a server that already holds the definition has them). A capture that was published is copied (it is
 * there already, or the copy restores it); one that never reached the server answers a claim that has since ended, so it
 * is copied only with the explicit `reconcile: 'accept'`, and otherwise retained and listed. An invalid bundle imports
 * nothing (`ok: false`). Throws when the target refuses a write.
 */
export async function importBundle(dir: string, target: ObjectStore, options: { readonly reconcile?: 'retain' | 'accept'; readonly plans?: boolean } & BundleExpectation = {}): Promise<BundleImport> {
  const bundle = await validateBundle(dir, options);
  if (!bundle.valid || !bundle.manifest) return { ok: false, bundle, layers: 0, copied: 0, skipped: 0, retained: [] };
  const manifest = bundle.manifest;
  const accept = options.reconcile === 'accept';
  const chosen = new Map<string, number>();
  if (options.plans !== false) for (const plan of manifest.plans) chosen.set(plan.layer, plan.recordedAtMs);
  const retained: UiBundleCapture[] = [];
  for (const capture of manifest.captures) {
    if (capture.publication === 'published' || capture.claimId === null || accept) chosen.set(capture.layer, capture.recordedAtMs);
    else retained.push(capture);
  }
  // A layer some attempt published is imported whatever another attempt's record of it says.
  const kept = retained.filter(capture => !chosen.has(capture.layer));
  const from = directoryStore(path.resolve(dir, STORE));
  let copied = 0, skipped = 0;
  for (const id of [...chosen.keys()].sort(compare)) {
    const layer = await readLayer(from, id);
    if (!layer) throw new Error(`Layer ${id.slice(0, 12)} vanished from ${dir} during the import`);
    for (const key of layerObjectKeys(layer)) {
      if (await target.head(key)) { skipped++; continue; }
      const stored = await from.get(key);
      if (!stored) throw new Error(`${key} vanished from ${dir} during the import`);
      await target.put(key, await readBytes(stored.body), stored.contentType);
      copied++;
    }
  }
  return { ok: true, bundle, layers: chosen.size, copied, skipped, retained: kept };
}
