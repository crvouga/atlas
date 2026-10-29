/**
 * @module User state in S3
 *
 * Reads and writes the user state document (`UserStateSchema`: the garbage collection policy and the saved settings) as
 * one JSON object at `server/state.json` in the object store, which in a running server is the S3 bucket. This is the
 * only place user state is kept: not a file, not a database, not the browser. A missing object is an empty state
 * ("nothing chosen yet"); an object that cannot be read or does not match the schema is an error that stops the
 * server from starting and is never overwritten, so a transient or corrupt read can never silently reset anyone's choices.
 * Saving refuses a stale revision (the SHA-256 of the stored text), serialised within this process. An object store has
 * no conditional writes, so two servers saving at the same instant could still race; run one server per bucket.
 *
 * @see docs/server.md#user-state-and-garbage-collection
 */
import { createHash } from 'node:crypto';

import { readUtf8, writeUtf8 } from '../../reports/src/object-io';
import type { ObjectStore } from '../../reports/src/object-store';
import { UserStateSchema, type UserState } from '../../schema/src/user-state';

/** Where the user state lives, relative to the store (the bucket plus `ATLAS_S3_PREFIX`). */
export const USER_STATE_KEY = 'server/state.json';

/** The user state as stored: the document, its `revision` and whether the object `exists` yet. */
export type StoredUserState = { readonly state: UserState; readonly revision: string; readonly exists: boolean };

/** Raised when the stored user state cannot be trusted. The message says where it is and what to do. */
export class UserStateError extends Error {}

/** The user state of one server: read it, or change it against the revision that was read. */
export type UserStateStore = {
  /** Reads the document. Throws {@link UserStateError} when it exists but is unreadable or invalid. */
  read(): Promise<StoredUserState>;
  /**
   * Applies `change` to the stored state and writes the result, if `revision` is still the stored one. Throws a
   * `UserStateError` starting with "Settings changed" for a stale revision.
   */
  update(revision: string, change: (state: UserState) => UserState): Promise<StoredUserState>;
};

const digest = (text: string) => createHash('sha256').update(text).digest('hex');

/**
 * The user state kept in `store` at {@link USER_STATE_KEY}.
 *
 * @example
 * const userState = userStateStore(s3Backend.store);
 * const { state } = await userState.read();
 */
export function userStateStore(store: ObjectStore): UserStateStore {
  let pending: Promise<unknown> = Promise.resolve();
  const read = async (): Promise<StoredUserState> => {
    let text: string | null;
    try { text = await readUtf8(store, USER_STATE_KEY); } catch (error) {
      throw new UserStateError(`The user state ${USER_STATE_KEY} could not be read from S3: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (text === null) return { state: { schemaVersion: 1 }, revision: digest(''), exists: false };
    let json: unknown;
    try { json = JSON.parse(text); } catch { throw new UserStateError(`The user state ${USER_STATE_KEY} in S3 is not valid JSON. Atlas will not overwrite it: fix or delete that object, then restart.`); }
    const parsed = UserStateSchema.safeParse(json);
    if (!parsed.success) throw new UserStateError(`The user state ${USER_STATE_KEY} in S3 is invalid (${parsed.error.issues.map(issue => `${issue.path.join('.') || '(document)'}: ${issue.message}`).join('; ')}). Atlas will not overwrite it: fix or delete that object, then restart.`);
    // The document as written, once it is known to be valid: defaults are not filled in, so a setting nobody chose stays unchosen.
    return { state: json as UserState, revision: digest(text), exists: true };
  };
  return {
    read,
    update(revision, change) {
      const run = pending.then(async () => {
        const held = await read();
        if (held.revision !== revision) throw new UserStateError('Settings changed. Reload them before saving.');
        const next = { ...change(held.state), schemaVersion: 1 } as UserState;
        const checked = UserStateSchema.safeParse(next);
        if (!checked.success) throw new UserStateError(checked.error.issues.map(issue => `${issue.path.join('.') || '(document)'}: ${issue.message}`).join('; '));
        const text = `${JSON.stringify(next, null, 2)}\n`;
        await writeUtf8(store, USER_STATE_KEY, text, 'application/json');
        return { state: next, revision: digest(text), exists: true };
      });
      pending = run.catch(() => undefined);
      return run;
    }
  };
}
