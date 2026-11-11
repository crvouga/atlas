/**
 * @module Build provenance
 *
 * Where the running server was built from, for `GET /api/server` (`build`) and the viewer's About dialog: the installed
 * `@crvouga/atlas` version when the package knows it, the source revision (`ATLAS_REVISION`), the build time
 * (`ATLAS_BUILD_TIME`) and the container image digest a deployment injects (`ATLAS_IMAGE_DIGEST`). Nothing is guessed: a
 * value that is missing, a placeholder or malformed is `null`, which a reader shows as unknown. The official image sets
 * the revision and build time from its build arguments; an image cannot know its own digest, so only the deployment can
 * supply that one. Provenance is for people diagnosing a deployment; clients decide what a server can do from
 * `capabilities`, never by comparing versions.
 *
 * @see docs/deploying.md#which-build-is-running
 */

import { readFileSync } from 'node:fs';

type Env = Readonly<Record<string, string | undefined>>;

/** Where a build came from. Every field is null when unknown. */
export type BuildInfo = {
  /** The `@crvouga/atlas` version, or null for a source build (whose package.json holds the release placeholder). */
  readonly version: string | null;
  /** The source revision it was built from, such as a git commit. */
  readonly revision: string | null;
  /** When it was built, ISO 8601. */
  readonly builtAt: string | null;
  /** The container image digest (`sha256:<64 hex>`, optionally after `<repository>@`), only when the deployment injected it. */
  readonly imageDigest: string | null;
};

/** The version package.json holds in this repository; releases set the real one. It means "unknown". */
const PLACEHOLDER = '0.0.0-development';

/** A version as npm writes it, or null. */
export function cleanVersion(value: unknown): string | null {
  return typeof value === 'string' && value !== PLACEHOLDER && /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.+-]{1,64})?$/.test(value) ? value : null;
}

/** A revision (a commit hash, a tag): up to 128 characters of letters, digits, `.`, `_`, `-` and `/`. `unknown` and empty are null. */
export function cleanRevision(value: string | undefined): string | null {
  const text = value?.trim();
  return text && text.toLowerCase() !== 'unknown' && /^[0-9A-Za-z][0-9A-Za-z._\/-]{0,127}$/.test(text) ? text : null;
}

/** A date and time, normalized to ISO 8601 UTC, or null when it cannot be read. Seconds since the epoch are accepted too (`date +%s`). */
export function cleanBuildTime(value: string | undefined): string | null {
  const text = value?.trim();
  if (!text) return null;
  const time = /^\d{9,11}$/.test(text) ? Number(text) * 1000 : Date.parse(text);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

/** An image digest (`sha256:<64 hex>`, or `<repository>@sha256:<64 hex>`), or null. */
export function cleanImageDigest(value: string | undefined): string | null {
  const text = value?.trim();
  return text && /^(?:[0-9a-z][0-9a-z._\/:-]{0,255}@)?sha256:[0-9a-f]{64}$/.test(text) ? text : null;
}

/**
 * The version of the installed `@crvouga/atlas`, read from its package.json, or null when it is a source checkout (the
 * placeholder version) or cannot be read. Reads the file each time it is called; call it once at startup.
 */
export function installedPackageVersion(read: (file: URL) => string = file => readFileSync(file, 'utf8')): string | null {
  try {
    // packages/server/src in the repository and dist/server/src in the package are both three folders below the root.
    const manifest = JSON.parse(read(new URL('../../../package.json', import.meta.url))) as { name?: unknown; version?: unknown };
    return manifest.name === '@crvouga/atlas' ? cleanVersion(manifest.version) : null;
  } catch {
    return null;
  }
}

/**
 * The provenance of this server from its environment and the installed package.
 *
 * @example
 * ```ts
 * buildInfo({ ATLAS_REVISION: 'abc1234', ATLAS_BUILD_TIME: '2026-11-10T12:00:00Z' }, null);
 * // { version: null, revision: 'abc1234', builtAt: '2026-11-10T12:00:00.000Z', imageDigest: null }
 * ```
 */
export function buildInfo(env: Env, version: string | null = installedPackageVersion()): BuildInfo {
  return { version, revision: cleanRevision(env.ATLAS_REVISION), builtAt: cleanBuildTime(env.ATLAS_BUILD_TIME), imageDigest: cleanImageDigest(env.ATLAS_IMAGE_DIGEST) };
}
