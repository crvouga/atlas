/**
 * @module Server package entry point (`@crvouga/atlas/server`)
 *
 * Everything needed to run the Atlas server from code: `createAtlasServer` (a `fetch` handler with the live report, uploads
 * and the viewer), `listen` (serve it over HTTP on Bun or Node), `loadServerConfig` (the file, the environment and the flags
 * as one checked configuration), `serveMain` (what `atlas serve` runs), `EventHub`, `createAuth`, and the upload checks.
 *
 * @see docs/server.md
 */

export { createAtlasServer, type AtlasServer, type AtlasServerOptions } from './app';
export { createAuth, type Auth, type Identity } from './auth';
export { assertSafeToListen, ConfigError, loadServerConfig, SERVER_USAGE, type ResolvedServerConfig, type ResolvedToken } from './config';
export { EventHub, type EventName } from './events';
export { listen, type RunningServer } from './host';
export { serveMain } from './main';
export { classify, validateUpload, validKey, Refusal } from './validate';

export { fileServerSettings, type ServerSettings, type SettingsSnapshot } from './settings';

export { LiveRuns, LiveRunError } from './live-runs';
