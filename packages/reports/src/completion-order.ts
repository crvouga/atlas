/**
 * @module Bounded concurrency
 *
 * Small helpers that run async work with a cap on how many tasks are in flight, used for reading and writing many
 * store objects without flooding the backend. They differ from `Promise.all` in three ways: the cap, results in
 * completion order (not input order), and failure handling: once one task rejects, no new task is started,
 * those already started are allowed to finish, and then the first error is rethrown.
 */

/**
 * Runs `tasks` at most `limit` at a time (at least 1) and yields each result the moment it
 * settles, so one slow read never holds back faster siblings. Results come in completion order, not input
 * order. A rejection is rethrown to the consumer once every started task has settled; no results are yielded
 * after the first failure.
 */
export async function* inCompletionOrder<T>(
  tasks: readonly (() => Promise<T>)[],
  limit: number
): AsyncGenerator<T> {
  const width = Math.max(1, Math.floor(limit));
  const running = new Map<number, Promise<{ id: number; value: T }>>();
  let next = 0;
  const outcome: { failure: { error: unknown } | null } = { failure: null };

  const start = (): void => {
    while (
      running.size < width &&
      next < tasks.length &&
      outcome.failure === null
    ) {
      const id = next;
      const task = tasks[id];
      next += 1;
      if (task === undefined) continue;
      running.set(
        id,
        task().then(
          (value) => ({ id, value }),
          (error: unknown) => {
            running.delete(id);
            outcome.failure ??= { error };
            throw error;
          }
        )
      );
    }
  };

  start();
  while (running.size > 0) {
    let settled: { id: number; value: T } | null = null;
    try {
      settled = await Promise.race(running.values());
    } catch {
      // Recorded in `failure`; drain the rest, then rethrow.
      continue;
    }
    running.delete(settled.id);
    if (outcome.failure === null) yield settled.value;
    start();
  }
  if (outcome.failure !== null) throw outcome.failure.error;
}

/** Applies `work` to every item, at most `limit` at a time, and resolves when all are done; rejects with the first error as {@link inCompletionOrder} does. */
export async function eachLimited<T>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<void>
): Promise<void> {
  const tasks = items.map((item) => () => work(item));
  for await (const _ of inCompletionOrder(tasks, limit)) {
    // Results are void; draining is the point.
  }
}

/**
 * Consumes a lazy (async) input with backpressure: it pulls the next item only while fewer than `limit` works are
 * running, so a huge or generated input is never held in memory at once. After a failure it stops pulling,
 * waits for the started work to settle, then rethrows the first error.
 */
export async function eachLimitedStream<T>(
  items: AsyncIterable<T>,
  limit: number,
  work: (item: T) => Promise<void>
): Promise<void> {
  const width = Math.max(1, Math.floor(limit));
  const running = new Set<Promise<void>>();
  const outcome: { failure: { error: unknown } | null } = { failure: null };
  try {
    for await (const item of items) {
      if (outcome.failure !== null) break;
      const task: Promise<void> = work(item)
        .catch((error: unknown) => {
          outcome.failure ??= { error };
        })
        .finally(() => running.delete(task));
      running.add(task);
      if (running.size >= width) await Promise.race(running);
    }
  } finally {
    await Promise.all(running);
  }
  if (outcome.failure !== null) throw outcome.failure.error;
}
