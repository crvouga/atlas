import { PublishChecksSchema, type PublishChecksInput } from '../../schema/src/layer';
import { parseWith } from './parse-with';
import type { ObjectStore } from './object-store';
import { publishChecks } from './publish-checks';

type Check = PublishChecksInput['checks'][number];

/** What every layer of one stream shares: who is reporting, from where. Whatever `publishChecks` takes, except the checks and the time. */
export type ReporterIdentity = Pick<PublishChecksInput, 'producer' | 'kind' | 'title' | 'sha' | 'branch' | 'runUrl' | 'environment' | 'parameters' | 'freshness' | 'specs' | 'tags' | 'labels' | 'links' | 'attachments' | 'annotations' | 'extensions'>;

export type ReporterOptions = {
  /** Where layers go: a directory, S3, or `httpStore` for an Atlas server. */
  readonly store: ObjectStore;
  /** Send what has been reported this often (ms). Default 1000. `0` sends only on `flush()` and `close()`. */
  readonly flushMs?: number;
  /** Send at once when this many checks are waiting. Default 100. */
  readonly batchSize?: number;
  /** Tries for one layer, in `close()`; the timer keeps trying on its own. Default 5. */
  readonly attempts?: number;
  /** First wait between tries (ms), doubled each time to at most 30 s. Default 500. */
  readonly backoffMs?: number;
  /** Told of each failed try. A reporter never throws into the test run it reports on. */
  readonly onError?: (error: Error, willRetry: boolean) => void;
  /** Told of each layer that arrived. */
  readonly onPublished?: (layer: { id: string; checks: number }) => void;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
};

export type ReporterResult = {
  /** Layers that arrived. */
  readonly layers: number;
  /** Checks that arrived. */
  readonly checks: number;
  /** Checks that could not be sent. Zero when everything arrived. */
  readonly lost: number;
};

export type Reporter = {
  /** Report one check, finished or still running. Reporting the same `id` again replaces it, whatever its state. */
  check(check: Check): void;
  /** Send everything reported so far, now. Resolves once it has arrived or failed; never rejects. */
  flush(): Promise<void>;
  /** Send the rest and stop. Retries each layer up to `attempts` times. */
  close(): Promise<ReporterResult>;
};

type Batch = { readonly checks: Check[]; readonly recordedAtMs: number };

/**
 * A suite that reports as it goes. Each flush is one immutable layer holding the checks reported since the
 * last, so nothing is rewritten and a laptop, a CI job and a device lab can all be sending to the same
 * server at once. A check reported as `running` and then as `passed` is two layers; the later, completed one
 * wins, so the report follows the suite while it runs and agrees with it when it ends.
 *
 * A layer that cannot be sent is kept and sent again, unchanged (same time, so same content): a retry never
 * makes a second layer. Time only moves forward within a reporter, so a later result always follows an earlier one.
 */
export function createReporter(identity: ReporterIdentity, options: ReporterOptions): Reporter {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const flushMs = options.flushMs ?? 1000;
  const batchSize = Math.max(1, options.batchSize ?? 100);
  const attempts = Math.max(1, options.attempts ?? 5);
  const backoff = options.backoffMs ?? 500;

  let pending = new Map<string, Check>();
  const failed: Batch[] = [];
  let lastTime = 0;
  let layers = 0, sent = 0, lost = 0;
  let queue: Promise<void> = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  let wait = backoff;

  const nextTime = () => (lastTime = Math.max(now(), lastTime + 1));

  async function send(batch: Batch): Promise<Error | null> {
    try {
      const layer = await publishChecks(options.store, { ...identity, checks: batch.checks, recordedAtMs: batch.recordedAtMs });
      layers += 1;
      sent += batch.checks.length;
      options.onPublished?.({ id: layer.id, checks: batch.checks.length });
      return null;
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error));
    }
  }

  /** Everything waiting, oldest first. Returns once each batch has arrived, or failed `tries` times. */
  async function drain(tries: number): Promise<void> {
    if (pending.size) {
      failed.push({ checks: [...pending.values()], recordedAtMs: nextTime() });
      pending = new Map();
    }
    while (failed.length) {
      const batch = failed[0]!;
      let error: Error | null = null;
      for (let attempt = 1; attempt <= tries; attempt++) {
        error = await send(batch);
        if (!error) break;
        options.onError?.(error, attempt < tries || !closed);
        if (attempt < tries) await sleep(Math.min(wait * 2 ** (attempt - 1), 30_000));
      }
      if (error) {
        if (closed) { lost += failed.reduce((sum, item) => sum + item.checks.length, 0); failed.length = 0; }
        return;
      }
      failed.shift();
    }
  }

  const run = (tries: number) => (queue = queue.then(() => drain(tries)).catch(() => undefined));

  function schedule() {
    if (closed || timer || flushMs <= 0) return;
    timer = setTimeout(() => {
      timer = null;
      // One try per tick: a server that is down is asked again at the next one, not hammered.
      void run(1).then(() => { if (pending.size || failed.length) schedule(); });
    }, failed.length ? Math.min(flushMs * 2 ** Math.min(failed.length, 5), 30_000) : flushMs);
    (timer as { unref?: () => void }).unref?.();
  }

  return {
    check(check) {
      if (closed) throw new Error('This reporter is closed. Create another to report more.');
      // A check that cannot be a layer is a mistake of the caller, found here where it was made, and not as a layer that never arrives.
      const valid = parseWith(PublishChecksSchema.shape.checks.element, check, 'reporter.check');
      pending.set(valid.id, valid as Check);
      if (pending.size >= batchSize) void run(1);
      schedule();
    },
    flush: () => run(1),
    async close() {
      closed = true;
      if (timer) clearTimeout(timer);
      timer = null;
      await run(attempts);
      return { layers, checks: sent, lost };
    }
  };
}
