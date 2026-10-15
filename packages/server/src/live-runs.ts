/** @module Live run leases
 * Tracks producer heartbeats independently of progress, publishes completed checks incrementally, and persists
 * bounded run summaries. A server restart interrupts outstanding leases rather than inventing continued progress.
 */
import { createHash } from 'node:crypto';
import type { z } from 'zod/v4';
import { LiveRunSchema, type LiveRun, type LiveRunStartSchema, type LiveRunUpdateSchema } from '../../schema/src/live-run';
import type { ObjectStore } from '../../reports/src/object-store';
import { readUtf8, writeUtf8 } from '../../reports/src/object-io';
import { publishChecks } from '../../reports/src/publish-checks';
import { layerCatalogKey } from '../../reports/src/layer-store';
import type { ReportLayer } from '../../reports/src/layer-types';

type Start = z.output<typeof LiveRunStartSchema>;
type Update = z.output<typeof LiveRunUpdateSchema>;
type Held = { run: LiveRun; owner: string; digest: string; states: Map<string, string> };
const PREFIX = 'server/live/';
const keyOf = (run: LiveRun) => `${PREFIX}${String(Number.MAX_SAFE_INTEGER - run.startedAtMs).padStart(16, '0')}-${run.id}.json`;

/** A refused run update: 403 another publisher, 404 unknown run, 409 stale/terminal run, or 429 capacity. */
export class LiveRunError extends Error {
  constructor(readonly status: 403 | 404 | 409 | 429, message: string) { super(message); }
}

/**
 * One server's live feed. Heartbeats never create result layers. Persisted summaries contain at most 20 recent
 * checks and 10 active checks; completed results live in ordinary immutable layers. Leases expire by server time.
 * @example
 * const live = new LiveRuns({ store, timeoutMs: 30_000, stalledMs: 900_000, onChange: () => {}, onLayer: async () => {} });
 */
export class LiveRuns {
  private readonly held = new Map<string, Held>();
  private readonly attempts = new Map<string, { sequence: number; digest: string; at: number }>();
  private readonly queues = new Map<string, Promise<unknown>>();
  /** Resolves after restoring summaries and interrupting leases left by a previous server process. */
  readonly ready: Promise<void>;
  private readonly now: () => number;
  constructor(private readonly options: { store: ObjectStore; timeoutMs: number; stalledMs: number; now?: () => number; onChange: (run: LiveRun) => void; onLayer: (key: string, layer: ReportLayer) => Promise<void> }) {
    this.now = options.now ?? Date.now;
    this.ready = this.restore();
    // Requests await ready and surface failures; no unhandled rejection while a backend is unavailable.
    void this.ready.catch(() => undefined);
  }
  private async restore(): Promise<void> {
    const keys = (await this.options.store.listKeys(PREFIX)).slice(0, 200);
    for (const key of keys) {
      const text = await readUtf8(this.options.store, key);
      if (text === null) continue;
      const stored = JSON.parse(text) as { run: unknown; owner: string; digest: string };
      const run = LiveRunSchema.parse(stored.run);
      const state: Held = { run, owner: stored.owner, digest: stored.digest, states: new Map() };
      this.held.set(run.id, state);
      if (run.status === 'running') await this.interrupt(state, 'The Atlas server restarted before the run completed.');
    }
  }
  private async save(state: Held): Promise<void> {
    await writeUtf8(this.options.store, keyOf(state.run), JSON.stringify({ run: state.run, owner: state.owner, digest: state.digest }), 'application/json');
  }
  private locked<T>(id: string, action: () => Promise<T>): Promise<T> {
    const next = (this.queues.get(id) ?? Promise.resolve()).catch(() => {}).then(action);
    this.queues.set(id, next);
    return next.finally(() => { if (this.queues.get(id) === next) this.queues.delete(id); });
  }
  private state(id: string, owner: string): Held {
    const held = this.held.get(id);
    if (!held) throw new LiveRunError(404, 'Unknown run.');
    if (held.owner !== owner) throw new LiveRunError(403, 'This run belongs to another publisher.');
    return held;
  }
  private async interrupt(state: Held, reason: string): Promise<void> {
    const next: Held = { ...state, states: new Map(), run: { ...state.run, status: 'interrupted', reason, finishedAtMs: this.now(), running: 0,
      current: state.run.current.map(check => ({ ...check, status: 'not-run', detail: reason })) } };
    await this.save(next);
    this.held.set(next.run.id, next);
    this.options.onChange(next.run);
  }
  private expired(run: LiveRun): string | undefined {
    if (this.now() - run.lastHeartbeatAtMs >= this.options.timeoutMs) return 'Producer heartbeat timed out. The run may have exited or lost its connection.';
    if (this.options.stalledMs > 0 && this.now() - run.lastProgressAtMs >= this.options.stalledMs) return 'No test progress arrived before the configured stall timeout.';
    return undefined;
  }
  private async requireLive(state: Held): Promise<void> {
    if (state.run.status !== 'running') throw new LiveRunError(409, 'This run has ended.');
    const reason = this.expired(state.run);
    if (reason) { await this.interrupt(state, reason); throw new LiveRunError(409, reason); }
  }

  /** Read the most recent 50 summaries. Progress detail and counters are already bounded and cached. */
  async list(): Promise<LiveRun[]> {
    await this.ready;
    return [...this.held.values()].map(state => state.run).sort((a, b) => b.startedAtMs - a.startedAtMs || a.id.localeCompare(b.id)).slice(0, 50);
  }
  /** Register one producer lease. Retrying an identical start is idempotent. */
  async start(input: Start, owner: string): Promise<LiveRun> {
    await this.ready;
    return this.locked(input.id, async () => {
      const prior = this.held.get(input.id);
      if (prior) {
        const found = this.state(input.id, owner);
        if (Object.entries(input).some(([key, value]) => found.run[key as keyof LiveRun] !== value)) throw new LiveRunError(409, 'A run id cannot be reused with another identity.');
        return found.run;
      }
      if ([...this.held.values()].filter(state => state.run.status === 'running').length >= 100) throw new LiveRunError(429, 'Too many live runs.');
      const now = this.now();
      const state: Held = { owner, digest: '', states: new Map(), run: { ...input, status: 'running', sequence: 0, startedAtMs: now, lastHeartbeatAtMs: now, lastProgressAtMs: now, completed: 0, passed: 0, failed: 0, notRun: 0, running: 0, current: [], recent: [] } };
      await this.save(state);
      this.held.set(input.id, state);
      // Retain bounded terminal history in memory; durable summaries remain in the configured backend.
      if (this.held.size > 200) {
        const old = [...this.held.values()].filter(value => value.run.status !== 'running').sort((a, b) => a.run.startedAtMs - b.run.startedAtMs)[0];
        if (old) this.held.delete(old.run.id);
      }
      this.options.onChange(state.run);
      return state.run;
    });
  }
  /** Renew liveness by server receipt time, independently of whether a test made progress. */
  async heartbeat(id: string, owner: string): Promise<void> {
    await this.ready;
    await this.locked(id, async () => {
      const state = this.state(id, owner);
      await this.requireLive(state);
      const next = { ...state, run: { ...state.run, lastHeartbeatAtMs: this.now() } };
      await this.save(next);
      this.held.set(id, next);
      this.options.onChange(next.run);
    });
  }
  /** Apply one ordered progress batch and publish its completed checks before acknowledging it. */
  async update(id: string, input: Update, owner: string): Promise<LiveRun> {
    await this.ready;
    return this.locked(id, async () => {
      const state = this.state(id, owner);
      const digest = createHash('sha256').update(JSON.stringify(input)).digest('hex');
      if (input.sequence === state.run.sequence && digest === state.digest) return state.run;
      await this.requireLive(state);
      if (input.sequence !== state.run.sequence + 1) throw new LiveRunError(409, 'This run ended or its progress sequence is stale.');
      if (state.states.size + input.checks.filter(check => !state.states.has(check.id)).length > 100_000) throw new LiveRunError(429, 'A live run may track at most 100000 check identities.');
      const priorAttempt = this.attempts.get(id);
      if (priorAttempt && (priorAttempt.sequence !== input.sequence || priorAttempt.digest !== digest)) throw new LiveRunError(409, 'Retry the pending sequence with identical content.');
      const now = priorAttempt?.at ?? Math.max(this.now(), state.run.lastProgressAtMs + 1);
      const states = new Map(state.states);
      const run = { ...state.run, sequence: input.sequence, lastHeartbeatAtMs: now, ...(input.checks.length ? { lastProgressAtMs: now } : {}) };
      const current = new Map(run.current.map(check => [check.id, check]));
      for (const check of input.checks) {
        const prior = states.get(check.id);
        if (prior === 'running') run.running--;
        else if (prior) { run.completed--; if (prior === 'passed') run.passed--; else if (prior === 'failed') run.failed--; else run.notRun--; }
        states.set(check.id, check.status);
        if (check.status === 'running') { run.running++; current.set(check.id, check); }
        else { run.completed++; if (check.status === 'passed') run.passed++; else if (check.status === 'failed') run.failed++; else run.notRun++; current.delete(check.id); }
      }
      run.current = [...current.values()].slice(-10);
      run.recent = [...input.checks].reverse().concat(run.recent.filter(check => !input.checks.some(next => next.id === check.id))).slice(0, 20);
      if (input.finish) {
        if (input.finish === 'completed' && run.running) throw new LiveRunError(409, 'Finish running checks before completing the run.');
        run.status = input.finish;
        run.finishedAtMs = now;
        run.reason = input.reason;
        if (input.finish === 'interrupted') { run.running = 0; run.current = run.current.map(check => ({ ...check, status: 'not-run', detail: input.reason ?? 'Run interrupted.' })); }
        states.clear();
      }
      const finished = input.checks.filter(check => check.status !== 'running');
      this.attempts.set(id, { sequence: input.sequence, digest, at: now });
      if (finished.length) {
        const layer = await publishChecks(this.options.store, { producer: state.run.producer, environment: state.run.environment, branch: state.run.branch, sha: state.run.sha, recordedAtMs: now,
          labels: { 'atlas.run': id }, checks: finished });
        await this.options.onLayer(layerCatalogKey(layer.recordedAtMs, layer.id), layer);
      }
      const next = { ...state, states, run, digest };
      await this.save(next);
      this.held.set(id, next);
      this.attempts.delete(id);
      this.options.onChange(run);
      return run;
    });
  }
  /** Expire silent producers and optional progress stalls. Heartbeats cannot revive an expired run. */
  async sweep(): Promise<void> {
    await this.ready;
    await Promise.all([...this.held.keys()].map(id => this.locked(id, async () => {
      const state = this.held.get(id)!;
      if (state.run.status !== 'running') return;
      const reason = this.expired(state.run);
      if (reason) await this.interrupt(state, reason);
    })));
  }
}
