/**
 * @module Deployment provenance
 *
 * What the viewer knows about its own build (recorded in the bundle at build time by `vite/build-info.ts`) and what a server
 * says about its build (`GET /api/server`, `build`), kept apart: a viewer and a server can be deployed independently, so
 * one version would mislead. Every value is optional; what is missing is `unknown`, never guessed. The support summary is
 * built from an allow-list of provenance fields, so it never carries credentials, storage configuration (backend labels
 * name buckets and endpoints) or anything from the project's evidence.
 */

/** Where one build came from. Every field is null when unknown. */
export type BuildFacts = { readonly version: string | null; readonly revision: string | null; readonly builtAt: string | null; readonly imageDigest?: string | null };

/** What `GET /api/server` says, as far as the About dialog reads it. Every field may be missing from an older server. */
export type ServerFacts = {
  readonly version?: string | null;
  readonly build?: Partial<BuildFacts> | null;
  readonly ready?: boolean;
  readonly role?: string;
  readonly capabilities?: Readonly<Record<string, boolean>>;
};

declare const __ATLAS_VIEWER_BUILD__: Partial<BuildFacts> | undefined;

const UNKNOWN: BuildFacts = { version: null, revision: null, builtAt: null };
const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() && value.length <= 256 ? value.trim() : null);

/** The provenance this viewer bundle was built with; all unknown in a development or test build that recorded none. */
export function viewerBuild(): BuildFacts {
  const recorded = typeof __ATLAS_VIEWER_BUILD__ === 'undefined' ? undefined : __ATLAS_VIEWER_BUILD__;
  if (!recorded || typeof recorded !== 'object') return UNKNOWN;
  return { version: text(recorded.version), revision: text(recorded.revision), builtAt: text(recorded.builtAt) };
}

/** A server's provenance from its `/api/server` answer. An older server has no `build`: then only its `version`, if any, is known. */
export function serverBuild(info: ServerFacts | null | undefined): BuildFacts {
  const build = info?.build ?? {};
  return { version: text(build.version) ?? text(info?.version), revision: text(build.revision), builtAt: text(build.builtAt), imageDigest: text(build.imageDigest) };
}

/** A value for a person: the value, or `unknown`. */
export const known = (value: string | null | undefined) => value ?? 'unknown';

/** Whether the two builds are known to come from different revisions. Unknown on either side is not a difference. */
export function differentRevisions(viewer: BuildFacts, server: BuildFacts): boolean {
  return viewer.revision !== null && server.revision !== null && viewer.revision !== server.revision;
}

/**
 * The text a person pastes into a support request: the viewer's and the server's provenance, whether the server is ready,
 * and the names of the capabilities it announces. Only these allow-listed fields are written, so nothing secret or private
 * can reach it: no token, no address of the server or its storage, no backend label, no project name, no evidence.
 *
 * @example
 * ```ts
 * supportSummary(viewerBuild(), { reachable: true, info: await (await fetch('/api/server')).json() });
 * ```
 */
export function supportSummary(viewer: BuildFacts, server: { readonly reachable: boolean; readonly info?: ServerFacts | null }, userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent): string {
  const lines = ['Atlas support summary', '', 'Viewer', `  version: ${known(viewer.version)}`, `  revision: ${known(viewer.revision)}`, `  built: ${known(viewer.builtAt)}`, '', 'Server'];
  if (!server.reachable) lines.push('  no server: this viewer reads a static export or a store directly');
  else if (!server.info) lines.push('  unknown: the server could not be asked');
  else {
    const build = serverBuild(server.info);
    const capabilities = Object.entries(server.info.capabilities ?? {}).filter(([name, on]) => on === true && /^[A-Za-z0-9_-]{1,64}$/.test(name)).map(([name]) => name).sort();
    lines.push(`  version: ${known(build.version)}`, `  revision: ${known(build.revision)}`, `  built: ${known(build.builtAt)}`, `  image digest: ${known(build.imageDigest)}`,
      `  ready: ${typeof server.info.ready === 'boolean' ? String(server.info.ready) : 'unknown'}`, `  capabilities: ${capabilities.length ? capabilities.join(', ') : 'unknown'}`);
    if (differentRevisions(viewer, build)) lines.push('', 'The viewer and the server were built from different revisions.');
  }
  const agent = text(userAgent);
  if (agent) lines.push('', `Browser: ${agent.replace(/[^\x20-\x7e]/g, '')}`);
  return `${lines.join('\n')}\n`;
}
