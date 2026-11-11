/**
 * Records where a viewer build came from in the bundle itself (`__ATLAS_VIEWER_BUILD__`), so its About dialog can say so
 * whichever server serves it: the installed `@crvouga/atlas` version (null in a source checkout, whose package.json holds the
 * release placeholder), the source revision from `ATLAS_REVISION`, and the build time from `ATLAS_BUILD_TIME` or, for a
 * production build, the moment it was built. Nothing is guessed: no git command is run, because an installed package is
 * built inside the consumer's repository, whose commit is not the viewer's. A development server records no build time.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import type { Plugin } from 'vite';

/** What the viewer bundle knows about its own build. Every field is null when unknown. */
export type ViewerBuild = { readonly version: string | null; readonly revision: string | null; readonly builtAt: string | null };

const PLACEHOLDER = '0.0.0-development';

/** The provenance of a build made now, from the environment and the package around `appRoot`. */
export function viewerBuild(appRoot: string, env: Readonly<Record<string, string | undefined>>, production: boolean, now = () => new Date()): ViewerBuild {
  let version: string | null = null;
  try {
    const manifest = JSON.parse(readFileSync(path.resolve(appRoot, '../../package.json'), 'utf8')) as { name?: unknown; version?: unknown };
    if (manifest.name === '@crvouga/atlas' && typeof manifest.version === 'string' && manifest.version !== PLACEHOLDER && /^\d+\.\d+\.\d+/.test(manifest.version)) version = manifest.version;
  } catch {
    // Unknown, not an error.
  }
  const revision = env.ATLAS_REVISION?.trim();
  const given = env.ATLAS_BUILD_TIME?.trim();
  const time = given ? (/^\d{9,11}$/.test(given) ? Number(given) * 1000 : Date.parse(given)) : production ? now().getTime() : Number.NaN;
  return {
    version,
    revision: revision && revision.toLowerCase() !== 'unknown' && /^[0-9A-Za-z][0-9A-Za-z._\/-]{0,127}$/.test(revision) ? revision : null,
    builtAt: Number.isFinite(time) ? new Date(time).toISOString() : null
  };
}

/** The Vite plugin that defines `__ATLAS_VIEWER_BUILD__` for the bundle. */
export function viewerBuildPlugin(appRoot: string): Plugin {
  return {
    name: 'atlas-viewer-build',
    config: (_config, { command }) => ({ define: { __ATLAS_VIEWER_BUILD__: JSON.stringify(viewerBuild(appRoot, process.env, command === 'build')) } })
  };
}
