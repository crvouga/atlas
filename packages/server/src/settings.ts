/** @module Persisted server settings
 * The admin UI edits storage and report configuration in atlas.server.json. Changes take effect on restart;
 * environment variables and flags keep their documented precedence. Authentication is managed outside this UI.
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ServerEditableSettingsSchema } from '../../schema/src/server-config';
import { parseStoreLocation } from '../../reports/src/store-url';
import { ConfigError, loadServerConfig, type ResolvedServerConfig } from './config';

const editable = ServerEditableSettingsSchema;
const keys = new Set(Object.keys(editable.shape));
const select = (value: Record<string, unknown>) => Object.fromEntries(Object.entries(value).filter(([key]) => keys.has(key)));
const digest = (text: string) => createHash('sha256').update(text).digest('hex');

/** The persisted editable settings, active settings and a revision for optimistic concurrency. Authentication token settings are excluded. */
export type SettingsSnapshot = { readonly revision: string; readonly settings: Record<string, unknown>; readonly active: Record<string, unknown>; readonly restartRequired: boolean; readonly precedence: string };
/** Storage for the admin API; saving is serialized and refuses a stale revision. */
export type ServerSettings = { read(): Promise<SettingsSnapshot>; save(settings: unknown, revision: string): Promise<SettingsSnapshot> };

/**
 * Manage the server's configuration file with atomic replacement, preserving authentication and unrelated fields.
 * Validates both the file alone and the effective configuration before saving. Never migrates or deletes report data.
 * Changes need a server restart; deployment environment variables and flags override the file.
 * @example
 * const settings = fileServerSettings(config, argv, process.env, process.cwd());
 */
export function fileServerSettings(config: ResolvedServerConfig, argv: readonly string[], env: Readonly<Record<string, string | undefined>>, cwd: string): ServerSettings {
  const file = config.configFile ?? path.join(cwd, 'atlas.server.json');
  const active = { data: config.data, backends: config.backends.slice(1), write: config.writeId, outlineBranch: config.outlineBranch, include: config.include, refreshSeconds: config.refreshSeconds, limits: config.limits, heartbeatSeconds: config.heartbeatSeconds, runTimeoutSeconds: config.runTimeoutSeconds, runStallSeconds: config.runStallSeconds, log: config.log };
  let saved = false;
  let pending: Promise<unknown> = Promise.resolve();
  const readText = () => readFile(file, 'utf8').catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '{}'; throw error; });
  const read = async (): Promise<SettingsSnapshot> => {
    const text = await readText();
    return { revision: digest(text), settings: select(JSON.parse(text) as Record<string, unknown>), active,
      restartRequired: saved, precedence: 'File settings apply after restart. Environment variables and command-line flags override the file.' };
  };
  return { read, save(settings, revision) {
    const update = pending.then(async () => {
      const parsed = editable.safeParse(settings);
      if (!parsed.success) throw new ConfigError(parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '));
      const before = await readText();
      if (digest(before) !== revision) throw new ConfigError('Settings changed. Reload them before saving.');
      const original = JSON.parse(before) as Record<string, unknown>;
      const merged = { ...Object.fromEntries(Object.entries(original).filter(([key]) => !keys.has(key))), ...parsed.data };
      const text = `${JSON.stringify(merged, null, 2)}\n`;
      // Prove it is independently usable, then prove the exact deployment (including overrides) can start.
      const base = loadServerConfig(['--config', file], env, cwd, () => text);
      const effective = loadServerConfig([...argv, '--config', file], env, cwd, () => text);
      try {
        for (const backend of [...base.backends, ...effective.backends]) parseStoreLocation(backend.url, path.dirname(file), env);
      } catch (error) { throw new ConfigError(error instanceof Error ? error.message : String(error)); }
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, text, { mode: 0o600, flag: 'wx' });
        if (await readText() !== before) throw new ConfigError('Settings changed. Reload them before saving.');
        await rename(temporary, file);
      } finally { await rm(temporary, { force: true }); }
      saved = true;
      return read();
    });
    pending = update.catch(() => undefined);
    return update;
  } };
}

export { SETTINGS_PAGE, renderSettingsPage } from './settings-page';
