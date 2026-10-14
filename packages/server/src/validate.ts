import { parseLayerDocument, SpecSetSchema } from '../../schema/src/layer';
import { readUtf8 } from '../../reports/src/object-io';
import type { ObjectStore } from '../../reports/src/object-store';
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
  { kind: 'blob', pattern: new RegExp(`^layers/blobs/${HEX}\\.gz$`) },
  { kind: 'spec-body', pattern: new RegExp(`^layers/specs/blobs/(${HEX})\\.txt$`) },
  { kind: 'spec-set', pattern: new RegExp(`^layers/specs/sets/(${HEX})\\.json$`) },
  { kind: 'spec-catalog', pattern: new RegExp(`^layers/specs/index/\\d{16}-.+-[cmu]-(${HEX})\\.json$`) },
  { kind: 'run-manifest', pattern: /^layers\/runs\/([\w.-]+)\/manifest\.json$/ },
  { kind: 'run-catalog', pattern: /^layers\/runs\/index\/\d{16}-([\w.-]+)\.json$/ },
  { kind: 'run-file', pattern: /^layers\/runs\/([\w.-]+)\/.+$/ },
  { kind: 'scratch', pattern: /^layers\/doctor-[\w-]+\/.+$/ }
] as const;

export type UploadKind = (typeof KINDS)[number]['kind'];

/** Is this a key a client may name? No traversal, no odd characters, and under `layers/`. */
export function validKey(key: string): boolean {
  if (!key || key.length > KEY_LENGTH || !key.startsWith('layers/') || key.includes('\\') || /[\u0000-\u001f]/.test(key)) return false;
  return key.split('/').every(part => part !== '' && part !== '.' && part !== '..');
}

export function classify(key: string): { kind: UploadKind; id: string | null } | null {
  for (const { kind, pattern } of KINDS) {
    const match = pattern.exec(key);
    if (match) return { kind, id: match[1] ?? null };
  }
  return null;
}

/** Catalog entries are what makes something visible, so they are the last thing a client writes. */
export const isCatalog = (kind: UploadKind) => kind === 'layer-catalog' || kind === 'spec-catalog' || kind === 'run-catalog';

async function exists(store: ObjectStore, key: string): Promise<boolean> {
  return store.head(key);
}

/**
 * Check an object before it is stored. What is checked is what would otherwise corrupt the report for everyone:
 * a layer whose content is not its name, a catalog entry for something not there yet, a run that failed its
 * privacy scan. Everything that is checked is checked cheaply, from the bytes in hand.
 */
export async function validateUpload(key: string, bytes: Uint8Array, store: ObjectStore): Promise<UploadKind> {
  const known = classify(key);
  if (!known) throw new Refusal(422, `"${key}" is not a key Atlas writes`);
  const text = () => new TextDecoder().decode(bytes);
  const json = (): unknown => {
    try { return JSON.parse(text()); } catch { throw new Refusal(422, `${key} is not JSON`); }
  };

  switch (known.kind) {
    case 'layer': {
      const parsed = parseLayerDocument(json());
      if (!parsed.ok) throw new Refusal(422, parsed.reason);
      const raw = json() as Record<string, unknown>;
      if (raw.id !== known.id) throw new Refusal(422, 'The layer\'s id is not the one in its key');
      // The id is the digest of the document without it: a layer cannot be named for something it is not.
      const { id: _id, ...rest } = raw;
      if ((await sha256Hex(JSON.stringify(rest))) !== known.id) throw new Refusal(422, 'The layer\'s content does not match its id (it was changed, or written by something that does not follow the format)');
      const missing: string[] = [];
      for (const entry of Object.values(parsed.layer.bundle)) for (const part of entry.parts) if (!(await exists(store, part.blob))) missing.push(part.blob);
      if (missing.length) throw new Refusal(409, `The layer needs files that have not been uploaded yet: ${[...new Set(missing)].slice(0, 3).join(', ')}. Upload blobs before the manifest.`);
      break;
    }
    case 'layer-catalog': {
      const entry = json() as { id?: unknown };
      if (entry.id !== known.id) throw new Refusal(422, 'The catalog entry names another layer than its key does');
      if (!(await exists(store, `layers/manifests/${known.id}.json`))) throw new Refusal(409, 'That layer has not been uploaded yet. Upload its manifest before its catalog entry.');
      break;
    }
    case 'spec-body':
      if ((await sha256Hex(bytes)) !== known.id) throw new Refusal(422, 'The spec\'s text does not match the digest in its key');
      break;
    case 'spec-set': {
      const parsed = SpecSetSchema.safeParse(json());
      if (!parsed.success) throw new Refusal(422, `Not a valid spec set: ${parsed.error.issues[0]?.message ?? 'unknown'}`);
      if (parsed.data.id !== known.id) throw new Refusal(422, 'The spec set\'s id is not the one in its key');
      for (const file of parsed.data.files) if (!(await exists(store, `layers/specs/blobs/${file.digest}.txt`))) throw new Refusal(409, `The spec set needs ${file.path}, which has not been uploaded yet`);
      break;
    }
    case 'spec-catalog': {
      const entry = json() as { id?: unknown };
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
    case 'blob':
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
