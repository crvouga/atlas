/**
 * @module Server package entry point (`@crvouga/atlas/server`)
 *
 * Everything needed to run the Atlas server from code: `createAtlasServer` (a `fetch` handler with the live report, uploads
 * and the viewer), `listen` (serve it over HTTP on Bun or Node), `loadServerConfig` (the file, the environment and the flags
 * as one checked configuration), `serveMain` (what `atlas serve` runs), `EventHub`, `createAuth`, and the upload checks.
 * `atlas serve` keeps everything in S3: `resolveS3Config` reads the required `ATLAS_S3_*` variables, `userStateStore` the user
 * state in the bucket, and `storedSettings` serves the settings page from it.
 *
 * @see docs/server.md
 */

export { createAtlasServer, type AtlasServer, type AtlasServerOptions } from './app';
export { createAuth, type Auth, type Identity } from './auth';
export { assertSafeToListen, ConfigError, loadServerConfig, SERVER_USAGE, type ResolvedServerConfig, type ResolvedToken } from './config';
export { resolveS3Config, S3_VARIABLES, S3ConfigError, startupFailure, type S3Config } from './storage';
export { userStateStore, USER_STATE_KEY, UserStateError, type UserStateStore } from './user-state';
export { EventHub, type EventName } from './events';
export { listen, type RunningServer } from './host';
export { serveMain } from './main';
export { classify, validateUpload, validKey, Refusal } from './validate';

export { storedSettings, type GcSettings, type ServerSettings, type SettingsSnapshot } from './settings';

export { LiveRuns, LiveRunError } from './live-runs';
