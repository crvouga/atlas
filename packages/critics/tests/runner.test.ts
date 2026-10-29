import { describe, expect, test } from 'bun:test';

import { sha256Hex } from '../../reports/src/sigv4';
import {
  CriticError, defineCritic, InvalidOutputError, RateLimitedError, runCritic, identityOfCritique,
  type Critic, type CriticInput, type JudgeableEntry
} from '../src/index';

const encoder = new TextEncoder();
async function entryOf(key: string, pixels = key, state = 'screen'): Promise<{ entry: JudgeableEntry; bytes: Uint8Array }> {
  const bytes = encoder.encode(`image:${pixels}`);
  return { entry: { key, title: key, state, imageSha256: await sha256Hex(bytes) }, bytes };
}

function fake(evaluate: (input: CriticInput, call: number) => Promise<ReturnType<Critic['evaluate']> extends Promise<infer A> ? A : never>, extra: Partial<Critic> = {}) {
  let calls = 0;
  const critic = defineCritic({
    name: 'fake', version: '1.0.0', kind: 'heuristic',
    describe: () => ({ sendsImagesTo: null, needsSetup: false, model: { id: 'fake-model' }, parameters: { temperature: 0 } }),
    evaluate: input => evaluate(input, ++calls),
    ...extra
  });
  return { critic, calls: () => calls };
}

async function setup(keys: string[]) {
  const items = await Promise.all(keys.map(key => entryOf(key)));
  const images = new Map(items.map(item => [item.entry.key, item.bytes]));
  const loads: string[] = [];
  return { entries: items.map(item => item.entry), loadImage: async (entry: JudgeableEntry) => { loads.push(entry.key); return images.get(entry.key)!; }, loads };
}
const noSleep = async () => {};

describe('runCritic', () => {
  test('judges every entry once, in entry order, with a verdict anchored to the image hash', async () => {
    const { entries, loadImage } = await setup(['a', 'b', 'c']);
    const { critic } = fake(async input => ({ verdict: { score: input.entry.key === 'a' ? 0.1 : 0.9 } }));
    const result = await runCritic({ critic, entries, loadImage, concurrency: 3 });
    expect(result.outcomes.map(item => item.entry.key)).toEqual(['a', 'b', 'c']);
    expect(result).toMatchObject({ judged: 3, failed: 0, skipped: 0, waiting: 0 });
    expect(result.outcomes[0]!.critique.subject).toEqual({ entryKey: 'a', imageSha256: entries[0]!.imageSha256, state: 'screen' });
    expect(result.outcomes[0]!.critique.critic).toEqual({ name: 'fake', version: '1.0.0', kind: 'heuristic' });
  });

  test('hands the critic the exact stored bytes and the entry, and never judges an image whose bytes are not the hashed ones', async () => {
    const { entries } = await setup(['a']);
    const seen: CriticInput[] = [];
    const { critic, calls } = fake(async input => { seen.push(input); return { verdict: { score: 1 } }; });
    const good = await runCritic({ critic, entries, loadImage: async () => encoder.encode('image:a') });
    expect(good.judged).toBe(1);
    expect(new TextDecoder().decode(seen[0]!.image)).toBe('image:a');
    expect(seen[0]!.imageSha256).toBe(entries[0]!.imageSha256);
    expect(seen[0]!.entry).toEqual({ key: 'a', title: 'a', state: 'screen' });
    const bad = await runCritic({ critic, entries, loadImage: async () => encoder.encode('something else') });
    expect(bad.outcomes[0]!.critique.failure!.reason).toBe('image-mismatch');
    expect(calls()).toBe(1);
  });

  test('an image already judged by the same critic, version, model, parameters and image hash is skipped: no fetch and no call', async () => {
    const { entries, loadImage, loads } = await setup(['a', 'b']);
    const { critic, calls } = fake(async () => ({ verdict: { score: 0.5 } }));
    const first = await runCritic({ critic, entries, loadImage });
    const second = await runCritic({ critic, entries, loadImage, existing: first.outcomes.map(item => item.critique) });
    expect(second).toMatchObject({ skipped: 2, judged: 0, outcomes: [] });
    expect(calls()).toBe(2);
    expect(loads).toEqual(['a', 'b']);
  });

  test('only an image that changed is judged again', async () => {
    const { entries, loadImage } = await setup(['a', 'b']);
    const { critic, calls } = fake(async () => ({ verdict: { score: 0.5 } }));
    const first = await runCritic({ critic, entries, loadImage });
    const changed = await entryOf('b', 'b-new');
    const second = await runCritic({ critic, entries: [entries[0]!, changed.entry], loadImage: async entry => (entry.key === 'b' ? changed.bytes : encoder.encode('image:a')), existing: first.outcomes.map(item => item.critique) });
    expect(second.outcomes.map(item => item.entry.key)).toEqual(['b']);
    expect(second.skipped).toBe(1);
    expect(calls()).toBe(3);
  });

  test('a different critic version, model or parameter is a different judgement, and --force judges again', async () => {
    const { entries, loadImage } = await setup(['a']);
    const { critic } = fake(async () => ({ verdict: { score: 0.5 } }));
    const first = await runCritic({ critic, entries, loadImage });
    const existing = first.outcomes.map(item => item.critique);
    const v2 = defineCritic({ ...critic, version: '1.1.0', describe: critic.describe, evaluate: critic.evaluate });
    expect((await runCritic({ critic: v2, entries, loadImage, existing })).judged).toBe(1);
    const warmer = defineCritic({ ...critic, describe: () => ({ sendsImagesTo: null, needsSetup: false, model: { id: 'fake-model' }, parameters: { temperature: 0.7 } }), evaluate: critic.evaluate });
    expect((await runCritic({ critic: warmer, entries, loadImage, existing })).judged).toBe(1);
    expect((await runCritic({ critic, entries, loadImage, existing, force: true })).judged).toBe(1);
  });

  test('a failed critique is not a cache hit: the next run retries it', async () => {
    const { entries, loadImage } = await setup(['a']);
    let healthy = false;
    const { critic } = fake(async () => { if (!healthy) throw new Error('down'); return { verdict: { score: 0.5 } }; });
    const first = await runCritic({ critic, entries, loadImage });
    expect(first.outcomes[0]!.critique.failure!.reason).toBe('error');
    healthy = true;
    const second = await runCritic({ critic, entries, loadImage, existing: first.outcomes.map(item => item.critique) });
    expect(second).toMatchObject({ judged: 1, skipped: 0 });
  });

  test('two runs of a deterministic critic give identical critiques', async () => {
    const { entries, loadImage } = await setup(['a', 'b']);
    const score = (key: string) => (key === 'a' ? 0.25 : 0.75);
    const { critic } = fake(async input => ({ verdict: { score: score(input.entry.key) } }));
    const one = await runCritic({ critic, entries, loadImage, concurrency: 1 });
    const two = await runCritic({ critic, entries, loadImage, concurrency: 2 });
    expect(JSON.stringify(two.outcomes)).toBe(JSON.stringify(one.outcomes));
  });

  describe('rate limits', () => {
    test('waits at least Retry-After, with backoff, and then completes', async () => {
      const { entries, loadImage } = await setup(['a']);
      const { critic, calls } = fake(async (_, call) => { if (call < 3) throw new RateLimitedError('slow down', 2000); return { verdict: { score: 1 } }; });
      const waits: number[] = [];
      const result = await runCritic({ critic, entries, loadImage, sleep: async ms => { waits.push(ms); }, random: () => 0.5 });
      expect(result.judged).toBe(1);
      expect(calls()).toBe(3);
      expect(waits.length).toBe(2);
      expect(waits.every(ms => ms >= 2000)).toBe(true);
    });

    test('backs off exponentially with jitter when the provider names no delay', async () => {
      const { entries, loadImage } = await setup(['a']);
      const { critic } = fake(async (_, call) => { if (call < 4) throw new RateLimitedError('slow down'); return { verdict: { score: 1 } }; });
      const waits: number[] = [];
      await runCritic({ critic, entries, loadImage, sleep: async ms => { waits.push(ms); }, random: () => 0.999, backoff: { baseMs: 100, maxMs: 10_000 } });
      expect(waits).toEqual([99, 199, 399]);
    });

    test('a rate limit that never clears is recorded as failed (rate-limited) after a bounded number of attempts', async () => {
      const { entries, loadImage } = await setup(['a', 'b']);
      const { critic, calls } = fake(async input => { if (input.entry.key === 'a') throw new RateLimitedError('slow down', 10); return { verdict: { score: 1 } }; });
      const result = await runCritic({ critic, entries, loadImage, sleep: noSleep, maxAttempts: 3, concurrency: 1 });
      expect(result.outcomes[0]!.critique.failure!.reason).toBe('rate-limited');
      expect(result).toMatchObject({ failed: 1, judged: 1 });
      expect(calls()).toBe(4);
    });
  });

  test('a call that exceeds the timeout is recorded as failed (timeout), is aborted, and the run continues', async () => {
    const { entries, loadImage } = await setup(['slow', 'quick']);
    let aborted = false;
    const { critic } = fake(input => new Promise((resolve, reject) => {
      if (input.entry.key === 'quick') return resolve({ verdict: { score: 1 } });
      input.signal.addEventListener('abort', () => { aborted = true; reject(new Error('aborted')); });
    }));
    const result = await runCritic({ critic, entries, loadImage, timeoutMs: 20, concurrency: 1 });
    expect(result.outcomes.map(item => item.critique.failure?.reason ?? 'verdict')).toEqual(['timeout', 'verdict']);
    expect(aborted).toBe(true);
  });

  test.each([
    ['a score that is not a number', { verdict: { score: Number.NaN } }],
    ['nothing at all', {}],
    ['a confidence outside 0..1', { verdict: { score: 0.5, confidence: 7 } }]
  ])('an answer with %s is invalid-output, and no score is invented', async (_, answer) => {
    const { entries, loadImage } = await setup(['a']);
    const { critic } = fake(async () => answer as never);
    const result = await runCritic({ critic, entries, loadImage });
    expect(result.outcomes[0]!.critique.failure!.reason).toBe('invalid-output');
    expect(result.outcomes[0]!.critique.verdict).toBeUndefined();
  });

  test('a critic that says why it failed has its reason code recorded', async () => {
    const { entries, loadImage } = await setup(['a', 'b']);
    const { critic } = fake(async input => { throw input.entry.key === 'a' ? new InvalidOutputError('not JSON') : new CriticError('provider-refused', 'content policy'); });
    const result = await runCritic({ critic, entries, loadImage });
    expect(result.outcomes.map(item => item.critique.failure!.reason)).toEqual(['invalid-output', 'provider-refused']);
  });

  describe('budgets', () => {
    test('a budget of M images stops the run, which keeps what it finished and says why', async () => {
      const { entries, loadImage } = await setup(['a', 'b', 'c', 'd', 'e']);
      const { critic, calls } = fake(async () => ({ verdict: { score: 1 } }));
      const result = await runCritic({ critic, entries, loadImage, budget: { maxImages: 2 }, concurrency: 4 });
      expect(calls()).toBe(2);
      expect(result).toMatchObject({ judged: 2, waiting: 3, stoppedBy: 'budget' });
      expect(result.outcomes.map(item => item.entry.key)).toEqual(['a', 'b']);
    });

    test('a spend limit stops the run once the reported cost reaches it', async () => {
      const { entries, loadImage } = await setup(['a', 'b', 'c']);
      const { critic } = fake(async () => ({ verdict: { score: 1 }, usage: { costUsd: 0.6, inputTokens: 10, outputTokens: 5 } }));
      const result = await runCritic({ critic, entries, loadImage, budget: { maxCostUsd: 1 }, concurrency: 1 });
      expect(result).toMatchObject({ judged: 2, stoppedBy: 'budget', waiting: 1 });
      expect(result.spent.costUsd).toBeCloseTo(1.2);
      expect(result.spent.tokens).toBe(30);
    });

    test('a run that handled everything did not stop early', async () => {
      const { entries, loadImage } = await setup(['a', 'b']);
      const { critic } = fake(async () => ({ verdict: { score: 1 } }));
      const result = await runCritic({ critic, entries, loadImage, budget: { maxImages: 2 } });
      expect(result.stoppedBy).toBeUndefined();
      expect(result.waiting).toBe(0);
    });
  });

  test('--dry-run sends nothing, loads nothing, returns nothing to publish, and says what would happen and where images would go', async () => {
    const { entries, loadImage, loads } = await setup(['a', 'b', 'c']);
    const { critic, calls } = fake(async () => ({ verdict: { score: 1 } }), { describe: () => ({ sendsImagesTo: 'api.example.com', needsSetup: false }) });
    const done = await runCritic({ critic: fake(async () => ({ verdict: { score: 1 } })).critic, entries: [entries[0]!], loadImage });
    const dry = await runCritic({ critic, entries, loadImage, dryRun: true, existing: [] });
    expect(dry).toMatchObject({ dryRun: true, skipped: 0, waiting: 3, outcomes: [], sendsImagesTo: 'api.example.com' });
    expect(calls()).toBe(0);
    expect(loads).toEqual(['a']);
    expect(done.judged).toBe(1);
  });

  test('cancelling stops the run and does not record the cancelled calls as failures', async () => {
    const { entries, loadImage } = await setup(['a', 'b', 'c']);
    const controller = new AbortController();
    const { critic } = fake(async input => { if (input.entry.key === 'b') controller.abort(); return { verdict: { score: 1 } }; });
    const result = await runCritic({ critic, entries, loadImage, concurrency: 1, signal: controller.signal });
    expect(result.stoppedBy).toBe('aborted');
    expect(result.outcomes.every(item => !item.critique.failure)).toBe(true);
    expect(result.waiting).toBeGreaterThan(0);
  });

  test('reports progress for judged, skipped and failed entries without any image or credential', async () => {
    const { entries, loadImage } = await setup(['a', 'b']);
    const { critic } = fake(async input => { if (input.entry.key === 'b') throw new Error('x'); return { verdict: { score: 1 } }; });
    const first = await runCritic({ critic, entries: [entries[0]!], loadImage });
    const events: string[] = [];
    await runCritic({ critic, entries, loadImage, existing: first.outcomes.map(item => item.critique), concurrency: 1, onProgress: event => events.push(`${event.entryKey}:${event.result}`) });
    expect(events).toEqual(['a:skipped', 'b:failed']);
  });

  test.each([['concurrency', { concurrency: 0 }], ['maxAttempts', { maxAttempts: 0 }], ['timeoutMs', { timeoutMs: -1 }]])('%s must be positive', async (_, options) => {
    const { entries, loadImage } = await setup(['a']);
    const { critic } = fake(async () => ({ verdict: { score: 1 } }));
    await expect(runCritic({ critic, entries, loadImage, ...options })).rejects.toThrow('Invalid');
  });

  test('identityOfCritique matches what a run computes', async () => {
    const { entries, loadImage } = await setup(['a']);
    const { critic } = fake(async () => ({ verdict: { score: 1 } }));
    const result = await runCritic({ critic, entries, loadImage });
    expect(identityOfCritique(result.outcomes[0]!.critique)).toContain('fake-model');
  });
});

describe('credentials in a run', () => {
  const key = ['sk', 'test', '0123456789abcdefghij'].join('-');

  test('a provider key never appears in the recorded failure, the progress or the outcomes', async () => {
    const { entries, loadImage } = await setup(['a', 'b']);
    const { critic } = fake(async input => {
      if (input.entry.key === 'a') throw new Error(`401 from https://api.example.com/v1?key=${key} for Bearer ${key}`);
      throw new RateLimitedError(`slow down ${encodeURIComponent(key)}`);
    });
    const events: unknown[] = [];
    const result = await runCritic({ critic, entries, loadImage, secrets: ['an-unrelated-custom-secret-value', key], sleep: noSleep, maxAttempts: 2, onProgress: event => events.push(event) });
    const everything = JSON.stringify([result, events]);
    expect(everything).not.toContain(key);
    expect(everything).not.toContain('0123456789abcdefghij');
    expect(result.outcomes[0]!.critique.failure!.message).toContain('[redacted]');
  });

  test('a custom secret that has no recognisable shape is redacted too', async () => {
    const { entries, loadImage } = await setup(['a']);
    const secret = 'hunter2-hunter2';
    const { critic } = fake(async () => { throw new Error(`bad credentials ${secret}`); });
    const result = await runCritic({ critic, entries, loadImage, secrets: [secret] });
    expect(JSON.stringify(result)).not.toContain(secret);
  });
});
