/**
 * @module Stores named on a command line
 *
 * Turns `--store`, `--backends` and `ATLAS_STORE` into opened backends for the `atlas report` commands, and reads the
 * small flag grammar those commands share (`--name value`, repeatable). A mistyped directory is an error here, never
 * an empty store: a gate that read nothing must not read as a pass.
 *
 * @see docs/deploying.md
 */

import { existsSync, mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { BackendInput } from './compose';
import { openBackends, openStore, storeSpecs, type OpenedStore } from './store-url';

type Env = Readonly<Record<string, string | undefined>>;
/** A backend of a command: what `combineBackends` reads, plus, when it came from a URL, how it was opened (`location`, `server`, `s3`). */
export type CliBackend = BackendInput & Partial<OpenedStore>;

/** Every value given for `--<name>`, in order. `--name` with nothing after it is ignored. */
export function values(argv: readonly string[], name: string): string[] {
  return argv.flatMap((token, i) => (token === `--${name}` && argv[i + 1] !== undefined ? [argv[i + 1]!] : []));
}
/** The first value given for `--<name>`, or `undefined`. */
export function value(argv: readonly string[], name: string): string | undefined {
  return values(argv, name)[0];
}

/**
 * Every store a command reads: `--store` (a directory or `s3://…`, optionally `id=url`), then
 * `--backends <module>`, or `ATLAS_STORE` when neither is given. A directory that is not there is an
 * error: a mistyped path must never read as an empty store.
 */
export async function backendsOf(argv: readonly string[], base: string, env: Env): Promise<CliBackend[]> {
  const specs = storeSpecs(values(argv, 'store'), env);
  const backends: CliBackend[] = openBackends(specs, { base, env });
  backends.forEach((backend, i) => {
    const location = backend.location;
    if (location?.kind === 'directory' && (!existsSync(location.directory) || !statSync(location.directory).isDirectory())) {
      throw new Error(`Store directory not found: ${specs[i]!.replace(/^[a-z0-9-]+=/, '')}. If a node failed to publish or upload, fix that first`);
    }
  });
  const used = new Set(backends.map(backend => backend.id));
  for (const file of values(argv, 'backends')) {
    const mod = (await import(pathToFileURL(path.resolve(base, file)).href)) as { default?: BackendInput[] | (() => BackendInput[] | Promise<BackendInput[]>) };
    if (!mod.default) throw new Error(`${file} has no default export: a list of { id, label?, store }`);
    for (const backend of typeof mod.default === 'function' ? await mod.default() : mod.default) {
      if (used.has(backend.id)) throw new Error(`Two stores are named "${backend.id}"`);
      used.add(backend.id);
      backends.push(backend);
    }
  }
  if (!backends.length) throw new Error('Give at least one --store <dir or s3://bucket/prefix> (or --backends <module>), or set ATLAS_STORE');
  return backends;
}

/** The one store a command writes to. A directory is created; a bucket must already exist. */
export function writeStoreOf(flag: string | undefined, base: string, env: Env, name = 'store'): OpenedStore {
  const specs = flag ? [flag] : storeSpecs([], env);
  if (specs.length !== 1) throw new Error(specs.length ? `Give one --${name} to write to (ATLAS_STORE names ${specs.length})` : `Give --${name} <dir or s3://bucket/prefix>, or set ATLAS_STORE`);
  const opened = openStore(/^([a-z0-9-]+)=(.+)$/.exec(specs[0]!)?.[2] ?? specs[0]!, { base, env });
  if (opened.location.kind === 'directory') mkdirSync(opened.location.directory, { recursive: true });
  return opened;
}

/**
 * Which layers take part, from `--branch <name>` (repeatable) and `--ignore-modified`. By default all do:
 * a report is whatever the newest results are, wherever they were recorded. A gate that must speak for
 * a branch narrows it; the narrowing is yours to choose, never Atlas's.
 */
export function layerFilter(argv: readonly string[], env: Env): ((layer: { readonly branch: string | null; readonly freshness?: 'unknown' | 'modified' }) => boolean) | undefined {
  const branches = [...values(argv, 'branch'), ...(env.ATLAS_ONLY_BRANCH ?? '').split(/[\s,]+/).filter(Boolean)];
  const ignoreModified = argv.includes('--ignore-modified') || env.ATLAS_IGNORE_MODIFIED === '1' || env.ATLAS_IGNORE_MODIFIED === 'true';
  if (!branches.length && !ignoreModified) return undefined;
  return layer => (!branches.length || (layer.branch !== null && branches.includes(layer.branch))) && (!ignoreModified || layer.freshness === undefined);
}
