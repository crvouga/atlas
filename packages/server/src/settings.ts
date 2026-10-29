/** @module Persisted server settings
 * The settings page edits two things, and both are kept in the user state document in S3 (`server/state.json`), never on
 * the server's disk: the report and live-run settings (applied at the next start, below the configuration file,
 * the environment and the flags in precedence) and the garbage collection policy (read by the server each time it
 * collects). Storage and authentication are deployment-owned and are not editable here.
 */
import { ServerEditableSettingsSchema } from '../../schema/src/server-config';
import { GcPolicySchema, type GcPolicy, type GcRun, type GcSnapshot } from '../../schema/src/user-state';
import { ConfigError, loadServerConfig, type ResolvedServerConfig } from './config';
import { USER_STATE_KEY, UserStateError, type UserStateStore } from './user-state';

const editable = ServerEditableSettingsSchema;

/** The saved editable settings, the active settings and a revision for optimistic concurrency. Authentication token settings are excluded. */
export type SettingsSnapshot = { readonly revision: string; readonly settings: Record<string, unknown>; readonly active: Record<string, unknown>; readonly restartRequired: boolean; readonly precedence: string };
/** Storage for the admin API; saving is serialised and refuses a stale revision. */
export type ServerSettings = { read(): Promise<SettingsSnapshot>; save(settings: unknown, revision: string): Promise<SettingsSnapshot> };
/** The garbage collection policy as the admin API and the collector see it. */
export type GcSettings = {
  /** The policy in S3 with its revision and the last passes. */
  read(): Promise<GcSnapshot>;
  /** Validates and saves a policy; a stale `revision` is refused. */
  save(policy: unknown, revision: string): Promise<GcSnapshot>;
  /** The policy in S3 right now, or `null` when none has been saved. Read from S3 every time. */
  policy(): Promise<GcPolicy | null>;
  /** Remembers the result of a pass, for `read`. */
  record(runs: readonly GcRun[]): void;
};

const conflict = (error: unknown): never => {
  if (error instanceof UserStateError) throw new ConfigError(error.message);
  throw error;
};

/**
 * The settings and garbage collection policy kept in `userState` (S3). Validates a settings change against the
 * whole deployment (file, environment and flags) before saving, so what is saved can start. Never moves report data.
 *
 * @example
 * const { settings, gc } = storedSettings(config, argv, process.env, process.cwd(), userStateStore(store));
 */
export function storedSettings(config: ResolvedServerConfig, argv: readonly string[], env: Readonly<Record<string, string | undefined>>, cwd: string, userState: UserStateStore): { settings: ServerSettings; gc: GcSettings } {
  const active = { outlineBranch: config.outlineBranch, include: config.include, refreshSeconds: config.refreshSeconds, limits: config.limits, heartbeatSeconds: config.heartbeatSeconds, runTimeoutSeconds: config.runTimeoutSeconds, runStallSeconds: config.runStallSeconds, log: config.log };
  let saved = false;
  let lastRuns: GcRun[] = [];
  const snapshot = (stored: { state: { settings?: unknown }; revision: string }): SettingsSnapshot => ({
    revision: stored.revision, settings: (stored.state.settings ?? {}) as Record<string, unknown>, active, restartRequired: saved,
    precedence: `Saved in S3 (${USER_STATE_KEY}) and applied after restart. The configuration file, environment variables and command-line flags override them.`
  });
  const gcSnapshot = (stored: { state: { gc?: GcPolicy }; revision: string; exists: boolean }): GcSnapshot => ({
    revision: stored.revision, policy: stored.state.gc ? GcPolicySchema.parse(stored.state.gc) : null, saved: stored.state.gc !== undefined, lastRuns, stateKey: USER_STATE_KEY
  });
  const settings: ServerSettings = {
    read: async () => snapshot(await userState.read().catch(conflict)),
    async save(input, revision) {
      const parsed = editable.safeParse(input);
      if (!parsed.success) throw new ConfigError(parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '));
      // Prove the exact deployment (file, environment, flags and these settings) can start before keeping them.
      loadServerConfig(argv, env, cwd, undefined, parsed.data);
      // What the person chose, as sent: validated, but without the defaults filled in, so unchosen settings keep following the defaults.
      const stored = await userState.update(revision, state => ({ ...state, settings: input as Record<string, unknown> })).catch(conflict);
      saved = true;
      return snapshot(stored);
    }
  };
  const gc: GcSettings = {
    read: async () => gcSnapshot(await userState.read().catch(conflict)),
    async save(input, revision) {
      const parsed = GcPolicySchema.safeParse(input);
      if (!parsed.success) throw new ConfigError(parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '));
      return gcSnapshot(await userState.update(revision, state => ({ ...state, gc: parsed.data })).catch(conflict));
    },
    policy: async () => { const { state } = await userState.read(); return state.gc ? GcPolicySchema.parse(state.gc) : null; },
    record(runs) { lastRuns = [...runs, ...lastRuns.filter(old => !runs.some(run => run.project === old.project))].slice(0, 50); }
  };
  return { settings, gc };
}

export { SETTINGS_PAGE, renderSettingsPage } from './settings-page';
