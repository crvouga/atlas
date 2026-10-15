/** @module Reporting a live run to Atlas
 * Streams bounded check deltas while tests execute. Heartbeats are independent of progress; finished results are
 * published by the server as ordinary immutable layers. A final flush is awaited before a runner exits.
 */
import { randomUUID } from 'node:crypto';
import type { z } from 'zod/v4';
import type { LiveCheck, LiveRunStartSchema } from '../../schema/src/live-run';

/** Fixed identity of a live invocation; a UUID is generated when omitted. */
export type LiveIdentity = Omit<z.input<typeof LiveRunStartSchema>, 'id'> & { id?: string };
/** Transport and batching configuration. Defaults: 250 ms batches, 5 s heartbeats and 10 s request timeouts. */
export type LiveReporterOptions = { url: string; project?: string; token?: string; flushMs?: number; heartbeatMs?: number; timeoutMs?: number; onError?: (error: Error) => void };
/** Producer handle. check never throws transport errors into a test; finish flushes and rejects if publication failed. */
export type LiveReporter = { readonly id: string; readonly finishedAtMs?: number; check(check: LiveCheck): void; flush(): Promise<void>; finish(status?: 'completed' | 'interrupted', reason?: string): Promise<void> };

/**
 * Start publishing immediately, batch changing checks, and send independent heartbeats while the producer is alive.
 * The same failed batch is retried with the same sequence and content; never silently replace a lost update.
 * @example
 * const run = createLiveReporter({ producer: 'unit', plannedChecks: 10 }, { url: 'http://localhost:5180' });
 * run.check({ id: 'a', title: 'Adds a todo', status: 'running' });
 * run.check({ id: 'a', title: 'Adds a todo', status: 'passed' });
 * await run.finish();
 */
export function createLiveReporter(identity: LiveIdentity, options: LiveReporterOptions): LiveReporter {
  const base = new URL(options.url);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) throw new Error('Atlas live reporter needs an HTTP(S) server URL without credentials, query or fragment.');
  const id = identity.id ?? randomUUID();
  const endpoint = `${base.href.replace(/\/$/, '')}/api/live/${id}`;
  let sequence = 0;
  let finishedAtMs: number | undefined;
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let error: Error | undefined;
  const pending = new Map<string, LiveCheck>();
  const known = new Map<string, LiveCheck>();
  let failed: { sequence: number; checks: LiveCheck[] } | undefined;
  const reportError = (caught: unknown) => { error = caught instanceof Error ? caught : new Error(String(caught)); options.onError?.(error); };
  async function request(method: string, payload?: unknown, suffix = ''): Promise<{ finishedAtMs?: number }> {
    const text = payload === undefined ? undefined : JSON.stringify(payload);
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await fetch(endpoint + suffix, { method, redirect: 'error', signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
          headers: { 'content-type': 'application/json', ...(options.project ? { 'x-atlas-project': options.project } : {}), ...(options.token ? { authorization: `Bearer ${options.token}` } : {}) }, body: text });
        const status = response.status;
        const json = response.headers.get('content-type')?.includes('application/json');
        if (response.ok && !json) { await response.body?.cancel(); throw Object.assign(new Error('Atlas live reporter: the endpoint is not an Atlas server. Start or restart `bun atlas`.'), { permanent: true }); }
        if (!response.ok) { await response.body?.cancel(); throw Object.assign(new Error(`Atlas live reporter: HTTP ${status}`), { permanent: status < 500 && status !== 429 }); }
        return await response.json() as { finishedAtMs?: number };
      } catch (caught) {
        if (attempt >= 2 || (caught as { permanent?: boolean }).permanent) throw caught;
        await new Promise(resolve => setTimeout(resolve, 250 * 2 ** attempt));
      }
    }
  }
  const ready = request('POST', { ...identity, id });
  void ready.catch(reportError);
  let queue: Promise<void> = Promise.resolve();
  let draining: Promise<void> | undefined;
  const flush = () => {
    if (draining) return draining;
    queue = queue.then(async () => {
      await ready;
      while (failed || pending.size) {
        if (!failed) {
          const checks = [...pending.values()].slice(0, 1000);
          checks.forEach(check => pending.delete(check.id));
          failed = { sequence: sequence + 1, checks };
        }
        await request('PATCH', failed);
        sequence = failed.sequence;
        failed = undefined;
      }
      error = undefined;
    }).catch(reportError);
    draining = queue.finally(() => { draining = undefined; });
    return draining;
  };
  const heartbeat = setInterval(() => { if (!closed) void ready.then(async () => { await request('POST', undefined, '/heartbeat'); if (!closed && (failed || pending.size)) void flush(); }).catch(caught => { if (!closed) reportError(caught); }); }, options.heartbeatMs ?? 5000);
  heartbeat.unref?.();
  const check = (given: LiveCheck) => {
    if (closed) throw new Error('This live reporter is closed.');
    const check: LiveCheck = { id: given.id, title: given.title.slice(0, 2048), status: given.status, detail: (given.detail ?? '').slice(0, 8000),
      ...(given.specPath ? { specPath: given.specPath } : {}), ...(given.durationMs === undefined ? {} : { durationMs: given.durationMs }),
      ...(given.steps?.length ? { steps: given.steps.slice(-20).map(step => ({ name: step.name.slice(0, 2048), ...(step.status ? { status: step.status.slice(0, 100) } : {}) })) } : {}) };
    if (JSON.stringify(known.get(check.id)) === JSON.stringify(check)) return;
    known.set(check.id, check);
    pending.set(check.id, check);
    if (!timer) {
      timer = setTimeout(() => { timer = undefined; void flush(); }, options.flushMs ?? 250);
      timer.unref?.();
    }
  };
  return { id, get finishedAtMs() { return finishedAtMs; }, check, flush, async finish(status = 'completed', reason) {
    if (closed) { await queue; if (error) throw error; return; }
    const unfinished = [...known.values()].filter(check => check.status === 'running');
    if (unfinished.length) {
      status = 'interrupted';
      reason ??= 'The producer ended without a final outcome for running checks.';
      unfinished.forEach(value => check({ ...value, status: 'not-run', detail: reason }));
    }
    closed = true;
    clearInterval(heartbeat);
    clearTimeout(timer);
    await flush();
    if (error) throw error;
    const result = await request('PATCH', { sequence: sequence + 1, checks: [], finish: status, ...(reason ? { reason } : {}) });
    finishedAtMs = result.finishedAtMs;
    sequence++;
  } };
}
