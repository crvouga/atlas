/**
 * @module Spec inventory of a commit
 *
 * The older, commit-keyed record of which spec documents a commit has: `commits/<sha>/inventory.json` (the entries) and
 * `commits/<sha>/specs/<path>` (their bodies). Document bodies are written first, so an inventory always names readable
 * content. The newer form is the spec set (`spec-set.ts`).
 */
import { textFingerprint } from './layer-merge';
import { readUtf8, writeUtf8 } from './object-io';
import type { ObjectStore } from './object-store';
import { eachLimited } from './completion-order';
import type { SpecEntry, SpecInventory } from './explorer-types';
import { recordExplorerVersion } from './explorer-versions';
import { isCommitSha } from './keys';

/** Whether `path` is a safe spec path: starts with `specs/` and no segment is empty, `.`, `..`, or contains a backslash or control character. */
export function isSpecPath(path: string): boolean {
  return (
    path.startsWith('specs/') &&
    path
      .split('/')
      .every(
        (part) =>
          part.length > 0 &&
          part !== '.' &&
          part !== '..' &&
          !/[\\\u0000-\u001f]/.test(part)
      )
  );
}

/**
 * Describes one spec document: its `path`, a text `fingerprint`, a `kind` (the file extension, `openslo` for
 * `*.openslo.yaml`, `document` when there is none), a `title` (the first `Feature:` line, else the first `# ` heading,
 * else the file name) and a `domain` (the folder right under `specs/`, or `Overview` for a file directly in it).
 * Throws `Invalid spec path` unless `isSpecPath(path)`.
 */
export function specEntry(path: string, content: string): SpecEntry {
  if (!isSpecPath(path)) throw new Error('Invalid spec path');
  const file = path.split('/').at(-1) ?? path;
  const kind = file.endsWith('.openslo.yaml')
    ? 'openslo'
    : (file.split('.').at(-1) ?? 'document');
  const title =
    /^\s*Feature:\s*(.+)$/m.exec(content)?.[1] ??
    /^#\s+(.+)$/m.exec(content)?.[1] ??
    file;
  return {
    path,
    fingerprint: textFingerprint(content),
    domain: path.split('/').length > 2 ? path.split('/')[1]! : 'Overview',
    kind,
    title,
  };
}

function inventoryKey(sha: string): string {
  if (!isCommitSha(sha)) throw new Error('Invalid commit');
  return `commits/${sha}/inventory.json`;
}

function documentKey(sha: string, path: string): string {
  if (!isSpecPath(path)) throw new Error('Invalid spec path');
  inventoryKey(sha);
  return `commits/${sha}/specs/${encodeURIComponent(path)}`;
}

/**
 * Publishes a commit's spec documents and its inventory, and returns the inventory (entries sorted by path).
 * Publish document bodies first; an inventory always names readable content. Throws `Duplicate spec` for a repeated
 * path (before writing anything), `Invalid spec path` or `Invalid commit` for malformed input. Publishing the same
 * documents again writes the same keys.
 */
export async function publishInventory(
  store: ObjectStore,
  args: {
    readonly sha: string;
    readonly documents: readonly {
      readonly path: string;
      readonly content: string;
    }[];
  }
): Promise<SpecInventory> {
  const entries = args.documents
    .map((doc) => specEntry(doc.path, doc.content))
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  if (new Set(entries.map((entry) => entry.path)).size !== entries.length)
    throw new Error('Duplicate spec');
  await eachLimited(args.documents, 16, async (doc) => {
    await writeUtf8(
      store,
      documentKey(args.sha, doc.path),
      doc.content,
      'text/plain; charset=utf-8'
    );
  });
  const inventory = { sha: args.sha, entries };
  await writeUtf8(
    store,
    inventoryKey(args.sha),
    JSON.stringify(inventory),
    'application/json'
  );
  await recordExplorerVersion(store, args.sha);
  return inventory;
}

/** Reads a commit's inventory, or `null` when it has none. Throws `Invalid spec inventory` when the stored one is for another sha, malformed, or names an unsafe path, and `Invalid commit` for a bad sha. */
export async function readInventory(
  store: ObjectStore,
  sha: string
): Promise<SpecInventory | null> {
  const raw = await readUtf8(store, inventoryKey(sha));
  if (raw === null) return null;
  const inventory = JSON.parse(raw) as SpecInventory;
  if (
    inventory.sha !== sha ||
    !Array.isArray(inventory.entries) ||
    inventory.entries.some((entry) => !isSpecPath(entry.path))
  )
    throw new Error('Invalid spec inventory');
  return inventory;
}

/** Reads one spec document's text, or `null` when the commit has no inventory or the inventory does not list `path`. Throws `Invalid spec path` for an unsafe path. */
export async function readSpecDocument(
  store: ObjectStore,
  sha: string,
  path: string
): Promise<string | null> {
  const inventory = await readInventory(store, sha);
  if (!inventory?.entries.some((entry) => entry.path === path)) return null;
  return readUtf8(store, documentKey(sha, path));
}
