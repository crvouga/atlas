/**
 * @module Upload validation
 *
 * What the server checks before it stores an object, so one bad upload cannot corrupt the report for everyone: the key is
 * one Atlas writes (`classify`), a layer's content hashes to its id, blobs and spec files are what their names say, a
 * document's files and a catalog entry's document are already there (so nothing half-uploaded is visible), and a run
 * passed its privacy scan. Refusals are `Refusal`s carrying the HTTP status to answer. Layers are immutable: the same
 * bytes again are fine, other bytes under the same key are not.
 *
 * @see docs/server.md#what-the-server-refuses
 */

import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';

import { parseLayerDocument, SpecSetSchema } from '../../schema/src/layer';
import { readUtf8 } from '../../reports/src/object-io';
import type { ObjectStore } from '../../reports/src/object-store';
import { eachLimited } from '../../reports/src/completion-order';
import type { ReportLayer } from '../../reports/src/layer-types';
import { sha256Hex } from '../../reports/src/sigv4';

/** Why an upload was not accepted. The status is what to answer. */
export class Refusal extends Error {
  constructor(readonly status: 403 | 409 | 413 | 422, message: string) {
    super(message);
  }
}

const HEX = '[0-9a-f]{64}';
const KEY_LENGTH = 1024;

/** The kinds of object Atlas writes, by their keys. Anything else is not for a server to hold. */
const KINDS = [
  { kind: 'layer', pattern: new RegExp(`^layers/manifests/(${HEX})\\.json$`) },
  { kind: 'layer-catalog', pattern: new RegExp(`^layers/index/\\d{16}-(${HEX})\\.json$`) },
  { kind: 'blob', pattern: new RegExp(`^layers/blobs/(${HEX})\\.gz$`) },
  { kind: 'spec-body', pattern: new RegExp(`^layers/specs/blobs/(${HEX})\\.txt$`) },
  { kind: 'spec-set', pattern: new RegExp(`^layers/specs/sets/(${HEX})\\.json$`) },
  { kind: 'spec-catalog', pattern: new RegExp(`^layers/specs/index/\\d{16}-.+-[cmu]-(${HEX})\\.json$`) },
  { kind: 'run-manifest', pattern: /^layers\/runs\/([\w.-]+)\/manifest\.json$/ },
  { kind: 'run-catalog', pattern: /^layers\/runs\/index\/\d{16}-([\w.-]+)\.json$/ },
  { kind: 'run-file', pattern: /^layers\/runs\/([\w.-]+)\/.+$/ },
  { kind: 'scratch', pattern: /^layers\/doctor-[\w-]+\/.+$/ }
] as const;

/** What a key names: `layer`, `layer-catalog`, `blob`, `spec-body`, `spec-set`, `spec-catalog`, `run-manifest`, `run-catalog`, `run-file` or `scratch` (what `doctor` writes to try the store). */
export type UploadKind = (typeof KINDS)[number]['kind'];

/** Is this a key a client may name? No traversal, no odd characters, and under `layers/`. */
export function validKey(key: string): boolean {
  if (!key || key.length > KEY_LENGTH || !key.startsWith('layers/') || key.includes('\\') || /[\u0000-\u001f]/.test(key)) return false;
  return key.split('/').every(part => part !== '' && part !== '.' && part !== '..');
}

/** What kind of object a key names and the id inside it (the layer id, the digest…), or null when it is not a key Atlas writes. */
export function classify(key: string): { kind: UploadKind; id: string | null } | null {
  for (const { kind, pattern } of KINDS) {
    const match = pattern.exec(key);
    if (match) return { kind, id: match[1] ?? null };
  }
  return null;
}

/** Catalog entries are what makes something visible, so they are the last thing a client writes. */
export const isCatalog = (kind: UploadKind) => kind === 'layer-catalog' || kind === 'spec-catalog' || kind === 'run-catalog';

const gunzipAsync = promisify(gunzip);
/** The most a blob may expand to: what a layer may carry in total. A small file that expands to more is refused, not inflated. */
const MAX_BLOB_BYTES = 2 * 1024 * 1024 * 1024;

/** Parsed JSON that is not an object (a `null`, a number) names nothing: a refusal, not a crash. */
function objectOf(value: unknown): { id?: unknown } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Refusal(422, 'A catalog entry is a JSON object with the id of what it makes visible');
  return value as { id?: unknown };
}

async function exists(store: ObjectStore, key: string): Promise<boolean> {
  return store.head(key);
}

/** Which of `keys` the store does not have, asked 16 at a time (a store far away answers each in its own time). */
async function missingOf(store: ObjectStore, keys: readonly string[]): Promise<string[]> {
  const absent = new Set<string>();
  await eachLimited(keys, 16, async key => { if (!(await exists(store, key))) absent.add(key); });
  return keys.filter(key => absent.has(key));
}

/**
 * Check an object before it is stored. What is checked is what would otherwise corrupt the report for everyone:
 * a layer whose content is not its name, a catalog entry for something not there yet, a run that failed its
 * privacy scan. Everything that is checked is checked cheaply, from the bytes in hand.
 */
export async function validateUpload(key: string, bytes: Uint8Array, store: ObjectStore, parsedLayer?: (layer: ReportLayer) => void): Promise<UploadKind> {
  const known = classify(key);
  if (!known) throw new Refusal(422, `"${key}" is not a key Atlas writes`);
  // Parsed once, however many of the checks below look at it.
  let parsed: { value: unknown } | undefined;
  const json = (): unknown => {
    if (!parsed) {
      try { parsed = { value: JSON.parse(new TextDecoder().decode(bytes)) }; } catch { throw new Refusal(422, `${key} is not JSON`); }
    }
    return parsed.value;
  };

  switch (known.kind) {
    case 'layer': {
      const document = parseLayerDocument(json());
      if (!document.ok) throw new Refusal(422, document.reason);
      const raw = json() as Record<string, unknown>;
      if (raw.id !== known.id) throw new Refusal(422, 'The layer\'s id is not the one in its key');
      // The id is the digest of the document without it: a layer cannot be named for something it is not.
      const { id: _id, ...rest } = raw;
      if ((await sha256Hex(JSON.stringify(rest))) !== known.id) throw new Refusal(422, 'The layer\'s content does not match its id (it was changed, or written by something that does not follow the format)');
      const blobs = [...new Set(Object.values(document.layer.bundle).flatMap(entry => entry.parts.map(part => part.blob)))];
      const missing = await missingOf(store, blobs);
      if (missing.length) throw new Refusal(409, `The layer needs files that have not been uploaded yet: ${missing.slice(0, 3).join(', ')}. Upload blobs before the manifest.`);
      // What was just read is what the report folds in: handed on so it is not read from the store again.
      const { schemaVersion: _version, ...layer } = document.layer;
      parsedLayer?.(layer as unknown as ReportLayer);
      break;
    }
    case 'layer-catalog': {
      const entry = objectOf(json());
      if (entry.id !== known.id) throw new Refusal(422, 'The catalog entry names another layer than its key does');
      if (!(await exists(store, `layers/manifests/${known.id}.json`))) throw new Refusal(409, 'That layer has not been uploaded yet. Upload its manifest before its catalog entry.');
      break;
    }
    case 'spec-body':
      if ((await sha256Hex(bytes)) !== known.id) throw new Refusal(422, 'The spec\'s text does not match the digest in its key');
      break;
    case 'spec-set': {
      const set = SpecSetSchema.safeParse(json());
      if (!set.success) throw new Refusal(422, `Not a valid spec set: ${set.error.issues[0]?.message ?? 'unknown'}`);
      if (set.data.id !== known.id) throw new Refusal(422, 'The spec set\'s id is not the one in its key');
      const lacking = new Set(await missingOf(store, [...new Set(set.data.files.map(file => `layers/specs/blobs/${file.digest}.txt`))]));
      const first = set.data.files.find(file => lacking.has(`layers/specs/blobs/${file.digest}.txt`));
      if (first) throw new Refusal(409, `The spec set needs ${first.path}, which has not been uploaded yet`);
      break;
    }
    case 'spec-catalog': {
      const entry = objectOf(json());
      if (entry.id !== known.id) throw new Refusal(422, 'The catalog entry names another spec set than its key does');
      if (!(await exists(store, `layers/specs/sets/${known.id}.json`))) throw new Refusal(409, 'That spec set has not been uploaded yet');
      break;
    }
    case 'run-manifest': {
      const manifest = json() as { privacy?: { passed?: unknown } };
      // The rule the static viewer always had: a run that did not pass its privacy scan is never shared.
      if (manifest?.privacy?.passed !== true) throw new Refusal(422, `Run ${known.id} is not shared: its privacy scan did not pass (or never ran)`);
      break;
    }
    case 'run-catalog': {
      if (!(await exists(store, `layers/runs/${known.id}/manifest.json`))) throw new Refusal(409, 'That run has not been uploaded yet. Upload its manifest before its catalog entry.');
      json();
      break;
    }
    case 'blob': {
      // The key is the digest of the uncompressed bytes. Checked the way a layer is, so a blob cannot be named for something it is not.
      let raw: Uint8Array;
      try { raw = new Uint8Array(await gunzipAsync(bytes, { maxOutputLength: MAX_BLOB_BYTES })); } catch { throw new Refusal(422, 'A blob is gzip; this one could not be read as such'); }
      if ((await sha256Hex(raw)) !== known.id) throw new Refusal(422, 'The blob\'s content does not match the digest in its key');
      break;
    }
    case 'run-file':
    case 'scratch':
      break;
  }
  return known.kind;
}

/** Is this the same object already? Layers are immutable: the same bytes again is fine, other bytes under the same key is not. */
export async function sameBytes(store: ObjectStore, key: string, bytes: Uint8Array): Promise<'absent' | 'same' | 'different'> {
  const existing = await store.get(key);
  if (!existing) return 'absent';
  const stored = new Uint8Array(await new Response(existing.body).arrayBuffer());
  if (stored.length !== bytes.length) return 'different';
  for (let i = 0; i < stored.length; i++) if (stored[i] !== bytes[i]) return 'different';
  return 'same';
}

export { readUtf8 };
