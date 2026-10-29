import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { AtlasHttpError } from '../../reports/src/http-store';
import { memoryStore } from '../../reports/tests/memory-store';
import { RateLimitedError, InvalidOutputError } from '../src/contract';
import { critiquesOfLayer } from '../src/critique';
import { createLlmCritic, imageMediaType, openAiCompatibleProvider, parseLlmAnswer, retryAfterMs, type LlmProvider } from '../src/llm';
import { runCritic } from '../src/runner';
import { flushSpool, pendingInSpool, spoolingStore } from '../src/spool';
import { MissingDependencyError, createUiclipCritic, loadOnnxRuntime, setupUiclip, verifyCheckpoint } from '../src/uiclip';

// Obviously fake: nothing here is, or looks like, a real credential.
const KEY = 'fake-provider-key-for-tests';
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
/** A function that stands in for `fetch`. */
const asFetch = (fake: unknown) => fake as typeof fetch;
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const entry = { key: 'home', title: 'Home', state: 'screen', imageSha256: sha(PNG) };

let dir = '';
beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), 'atlas-critic-adapters-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

describe('the UIClip critic', () => {
  test('is deterministic, reports a score and nothing else, keeps images on this machine, and has the checkpoint in its identity', async () => {
    const critic = createUiclipCritic({ checkpoint: { path: 'x.onnx', sha256: 'a'.repeat(64) }, runtime: { score: async image => image.length / 10 } });
    expect(critic.describe()).toMatchObject({ sendsImagesTo: null, needsSetup: true, model: { provider: 'local' }, parameters: { checkpoint: 'a'.repeat(64) } });
    const run = () => runCritic({ critic, entries: [entry], loadImage: async () => PNG });
    const [one, two] = [await run(), await run()];
    expect(one.outcomes[0]!.critique.verdict).toEqual(two.outcomes[0]!.critique.verdict);
    expect(one.outcomes[0]!.critique.verdict).toMatchObject({ score: 0.7 });
    expect(one.outcomes[0]!.critique.findings).toBeUndefined();
    const other = createUiclipCritic({ checkpoint: { path: 'x.onnx', sha256: 'b'.repeat(64) }, runtime: { score: async () => 1 } });
    expect(other.describe().model!.id).not.toBe(critic.describe().model!.id);
  });

  test('37. importing it needs nothing: a missing optional dependency is named only when a run needs it', async () => {
    const missing = async (name: string) => { throw new Error(`Cannot find package '${name}'`); };
    await writeFile(path.join(dir, 'm.onnx'), 'model');
    const checkpoint = { path: path.join(dir, 'm.onnx'), sha256: sha('model' as unknown as Uint8Array) };
    const error = await loadOnnxRuntime(checkpoint, { importModule: missing }).catch((caught: Error) => caught);
    expect(error).toBeInstanceOf(MissingDependencyError);
    expect((error as MissingDependencyError).dependency).toBe('onnxruntime-node');
    expect((error as Error).message).toContain('bun add onnxruntime-node');
    const sharpMissing = await loadOnnxRuntime(checkpoint, { importModule: async name => (name === 'sharp' ? missing(name) : {}) }).catch((caught: Error) => caught);
    expect((sharpMissing as MissingDependencyError).dependency).toBe('sharp');
  });

  test('scores with an ONNX session on a verified checkpoint, preprocessing the image as CLIP does', async () => {
    const model = Buffer.from('model bytes');
    await writeFile(path.join(dir, 'm.onnx'), model);
    const fed: { dims: number[]; first: number }[] = [];
    const fake = {
      InferenceSession: { create: async () => ({ inputNames: ['pixels'], outputNames: ['score'], run: async (feeds: Record<string, { dims: number[]; data: Float32Array }>) => { fed.push({ dims: feeds.pixels!.dims, first: feeds.pixels!.data[0]! }); return { score: { data: Float32Array.from([0.25]) } }; } }) },
      Tensor: class { constructor(readonly type: string, readonly data: Float32Array, readonly dims: number[]) {} }
    };
    const sharp = () => ({ resize: () => ({ removeAlpha: () => ({ raw: () => ({ toBuffer: async () => new Uint8Array(224 * 224 * 3).fill(255) }) }) }) });
    const runtime = await loadOnnxRuntime({ path: path.join(dir, 'm.onnx'), sha256: sha(model) }, { importModule: async name => (name === 'sharp' ? sharp : fake) });
    expect(await runtime.score(PNG, new AbortController().signal)).toBe(0.25);
    expect(fed[0]!.dims).toEqual([1, 3, 224, 224]);
    expect(fed[0]!.first).toBeCloseTo((1 - 0.48145466) / 0.26862954, 5);
    // A checkpoint that is not the pinned one is refused before any session is opened.
    await expect(loadOnnxRuntime({ path: path.join(dir, 'm.onnx'), sha256: 'd'.repeat(64) }, { importModule: async name => (name === 'sharp' ? sharp : fake) })).rejects.toThrow(/does not match its pinned checksum/);
  });

  test('a checkpoint must be pinned', async () => {
    await writeFile(path.join(dir, 'm.onnx'), 'x');
    await expect(verifyCheckpoint({ path: path.join(dir, 'm.onnx'), sha256: 'not-a-hash' })).rejects.toThrow(/not pinned/);
    await expect(setupUiclip({ path: path.join(dir, 'gone.onnx'), sha256: 'a'.repeat(64) })).rejects.toThrow(/no download address/);
    await expect(setupUiclip({ path: path.join(dir, 'gone.onnx'), sha256: 'a'.repeat(64), url: 'http://models.invalid/x' })).rejects.toThrow(/over https/);
  });

  test('a download that is cut off leaves no partial file behind', async () => {
    const cut = asFetch(async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1, 2])); controller.error(new Error('connection reset')); } })));
    await expect(setupUiclip({ path: path.join(dir, 'models/m.onnx'), sha256: 'a'.repeat(64), url: 'https://models.invalid/m' }, { fetch: cut })).rejects.toThrow(/connection reset/);
    expect(await readdir(path.join(dir, 'models'))).toEqual([]);
  });
});

describe('the LLM critic', () => {
  const answer = { score: 0.62, label: 'needs-polish', confidence: 0.7, findings: [{ category: 'spacing', severity: 'minor', region: { unit: 'normalized', x: 0.1, y: 0.8, w: 0.5, h: 0.1 }, rationale: 'Label touches both edges.', suggestion: 'Add padding.', 'x-extra': 1 }] };
  const provider = (complete: LlmProvider['complete']): LlmProvider => ({ name: 'fake', sendsImagesTo: 'llm.example.com', capabilities: { images: true }, complete });

  test('turns the model\'s structured answer into a verdict and findings that round-trip, and records the rubric as a hash', async () => {
    const seen: string[] = [];
    const critic = createLlmCritic({ model: 'some-model', rubric: 'Look at spacing.', provider: provider(async request => { seen.push(request.imageMediaType, request.system); return { text: `Here you go:\n\`\`\`json\n${JSON.stringify(answer)}\n\`\`\``, usage: { inputTokens: 100, outputTokens: 20 } }; }) });
    expect(critic.describe()).toMatchObject({ sendsImagesTo: 'llm.example.com', model: { id: 'some-model', provider: 'fake' }, parameters: { temperature: 0, rubric: sha('Look at spacing.' as unknown as Uint8Array) } });
    const run = await runCritic({ critic, entries: [entry], loadImage: async () => PNG });
    const critique = run.outcomes[0]!.critique;
    expect(critique.verdict).toMatchObject({ score: 0.62, label: 'needs-polish' });
    expect(critique.findings![0]).toMatchObject({ id: 'f1', category: 'spacing', region: { unit: 'normalized' }, 'x-extra': 1 });
    expect(critique.usage).toMatchObject({ inputTokens: 100, outputTokens: 20 });
    expect(seen[0]).toBe('image/png');
    expect(seen[1]).toContain('Look at spacing.');
    expect(JSON.stringify(critique)).not.toContain('Look at spacing.');
  });

  test('26. an answer that is not the asked-for structure is invalid output and no score is invented', async () => {
    for (const text of ['I think it looks fine', '{"score": "high"}', '{"score": 7}', '{"findings": []}']) expect(() => parseLlmAnswer(text)).toThrow(InvalidOutputError);
    const critic = createLlmCritic({ model: 'm', provider: provider(async () => ({ text: 'it looks fine to me' })) });
    const run = await runCritic({ critic, entries: [entry], loadImage: async () => PNG });
    expect(run.outcomes[0]!.critique).toMatchObject({ failure: { reason: 'invalid-output' } });
    expect(run.outcomes[0]!.critique.verdict).toBeUndefined();
    // What the model said is not echoed into the record.
    expect(JSON.stringify(run.outcomes[0]!.critique)).not.toContain('looks fine to me');
  });

  test('a provider that is rate limited is retried after its Retry-After, and a run that never clears records rate-limited', async () => {
    let calls = 0;
    const waited: number[] = [];
    const critic = createLlmCritic({ model: 'm', provider: provider(async () => { calls += 1; if (calls < 3) throw new RateLimitedError('slow down', 7000); return { text: JSON.stringify(answer) }; }) });
    const run = await runCritic({ critic, entries: [entry], loadImage: async () => PNG, sleep: async ms => { waited.push(ms); }, random: () => 0 });
    expect(run.judged).toBe(1);
    expect(waited.every(ms => ms >= 7000)).toBe(true);
    expect(retryAfterMs('3')).toBe(3000);
    expect(retryAfterMs(new Date(10_000).toUTCString(), 4000)).toBe(6000);
    expect(retryAfterMs('nonsense')).toBeUndefined();
  });

  test('30. the key reaches the provider as a bearer token and nowhere else: not a result, not an error', async () => {
    const requests: { url: string; authorization: string | null; body: string }[] = [];
    const ok: typeof fetch = (async (url, init) => { requests.push({ url: String(url), authorization: new Headers(init?.headers).get('authorization'), body: String(init?.body) }); return Response.json({ choices: [{ message: { content: JSON.stringify(answer) } }], usage: { prompt_tokens: 5, completion_tokens: 6 } }); }) as typeof fetch;
    const critic = createLlmCritic({ model: 'm', provider: openAiCompatibleProvider({ baseUrl: 'https://llm.example.com/v1', apiKey: KEY, fetch: ok }) });
    const done = await runCritic({ critic, entries: [entry], loadImage: async () => PNG, secrets: [KEY] });
    expect(requests[0]).toMatchObject({ url: 'https://llm.example.com/v1/chat/completions', authorization: `Bearer ${KEY}` });
    expect(requests[0]!.body).not.toContain(KEY);
    expect(requests[0]!.body).toContain('data:image/png;base64,');
    expect(JSON.stringify(done)).not.toContain(KEY);
    expect(done.outcomes[0]!.critique.usage).toMatchObject({ inputTokens: 5, outputTokens: 6 });

    // A provider that echoes the key back in its failure: the record has it redacted.
    const echoing: LlmProvider = { name: 'fake', sendsImagesTo: 'llm.example.com', capabilities: { images: true }, complete: async () => { throw new Error(`401 for key ${KEY}`); } };
    const failed = await runCritic({ critic: createLlmCritic({ model: 'm', provider: echoing }), entries: [entry], loadImage: async () => PNG, secrets: [KEY] });
    expect(failed.outcomes[0]!.critique.failure!.message).not.toContain(KEY);
    expect(JSON.stringify(failed)).not.toContain(KEY);
  });

  test('the OpenAI-compatible provider maps 429, other failures and a missing message, and never shows the response body', async () => {
    const reply = (response: () => Response) => createLlmCritic({ model: 'm', provider: openAiCompatibleProvider({ baseUrl: 'https://llm.example.com/v1', apiKey: KEY, fetch: asFetch(async () => response()) }) });
    const judge = async (critic: ReturnType<typeof reply>, extra: Record<string, unknown> = {}) => (await runCritic({ critic, entries: [entry], loadImage: async () => PNG, maxAttempts: 1, ...extra })).outcomes[0]!.critique.failure;
    expect(await judge(reply(() => new Response('slow', { status: 429, headers: { 'retry-after': '1' } })))).toMatchObject({ reason: 'rate-limited' });
    expect(await judge(reply(() => new Response(`secret ${KEY}`, { status: 401 })))).toMatchObject({ reason: 'unauthorized', message: 'The provider at llm.example.com answered 401' });
    expect(await judge(reply(() => new Response('oops', { status: 500 })))).toMatchObject({ reason: 'error' });
    expect(await judge(reply(() => Response.json({ choices: [] })))).toMatchObject({ reason: 'invalid-output' });
    const unreachable = createLlmCritic({ model: 'm', provider: openAiCompatibleProvider({ baseUrl: 'https://llm.example.com/v1', fetch: asFetch(async () => { throw new TypeError('connect failed'); }) }) });
    expect(await judge(unreachable)).toMatchObject({ reason: 'error', message: expect.stringContaining('could not be reached') });
  });

  test('a provider is reached over https; plain http only for this machine', () => {
    expect(() => openAiCompatibleProvider({ baseUrl: 'http://llm.example.com/v1' })).toThrow(/https/);
    expect(openAiCompatibleProvider({ baseUrl: 'http://localhost:11434/v1' }).sendsImagesTo).toBe('localhost:11434');
  });

  test('images that are not pictures or are too large are failures of the entry, not the run', async () => {
    expect(imageMediaType(Uint8Array.from([0xff, 0xd8, 0xff, 0]))).toBe('image/jpeg');
    expect(() => imageMediaType(Uint8Array.from([1, 2, 3]))).toThrow(/not a PNG/);
    const critic = createLlmCritic({ model: 'm', provider: { ...provider(async () => ({ text: JSON.stringify(answer) })), capabilities: { images: true, maxImageBytes: 3 } } });
    const run = await runCritic({ critic, entries: [entry], loadImage: async () => PNG });
    expect(run.outcomes[0]!.critique.failure).toMatchObject({ reason: 'image-too-large' });
  });

  test('critiques it makes are layers a reader finds again', async () => {
    const critic = createLlmCritic({ model: 'm', provider: provider(async () => ({ text: JSON.stringify(answer) })) });
    const run = await runCritic({ critic, entries: [entry], loadImage: async () => PNG });
    expect(critiquesOfLayer({ id: 'x', producer: 'critic.vision-llm', parts: [{ kind: 'critique', recordedAtMs: 1, checks: [{ id: 'critique/home', status: 'passed', extensions: { 'atlas.critique': run.outcomes[0]!.critique } }] }] })).toHaveLength(1);
  });
});

describe('spooling', () => {
  const object = (n: number) => ({ key: `layers/blobs/${n}`, bytes: Uint8Array.from([n, n, n]), type: 'application/octet-stream' });

  test('what cannot be sent is kept and sent later in order, byte for byte, once', async () => {
    const down = memoryStore();
    const failing = { ...down, put: async () => { throw new AtlasHttpError('cannot reach server', null, true); }, head: async () => { throw new AtlasHttpError('cannot reach server', null, true); } } as typeof down;
    const spool = path.join(dir, 'spool');
    const spooling = spoolingStore(failing, spool);
    expect(await spooling.head('x')).toBe(false);
    for (const n of [1, 2, 3]) await spooling.put(object(n).key, object(n).bytes, object(n).type);
    await spooling.put(object(2).key, object(2).bytes, object(2).type);
    expect(spooling.spooled()).toBe(3);
    expect(await pendingInSpool(spool)).toBe(3);
    const target = memoryStore();
    const order: string[] = [];
    const recording = { ...target, put: async (key: string, bytes: Uint8Array, type: string) => { order.push(key); await target.put(key, bytes, type); } } as typeof target;
    expect(await flushSpool(recording, spool)).toEqual({ sent: 3, remaining: 0 });
    expect(order).toEqual([1, 2, 3].map(n => object(n).key));
    for (const n of [1, 2, 3]) expect(new Uint8Array(await new Response((await target.get(object(n).key))!.body).arrayBuffer())).toEqual(object(n).bytes);
    expect(await pendingInSpool(spool)).toBe(0);
    expect(await flushSpool(recording, spool)).toEqual({ sent: 0, remaining: 0 });
  });

  test('a refusal is not spooled: it will not pass by waiting', async () => {
    const refusing = { ...memoryStore(), put: async () => { throw new AtlasHttpError('knows this token but it may not do that', 403, false); } } as ReturnType<typeof memoryStore>;
    const spooling = spoolingStore(refusing, path.join(dir, 'spool'));
    await expect(spooling.put('k', new Uint8Array(1), 'x')).rejects.toThrow(/may not do that/);
    expect(await pendingInSpool(path.join(dir, 'spool'))).toBe(0);
  });

  test('a flush that meets a server still away stops and keeps the rest', async () => {
    const away = { ...memoryStore(), put: async () => { throw new AtlasHttpError('cannot reach server', null, true); } } as ReturnType<typeof memoryStore>;
    const spool = path.join(dir, 'spool');
    const spooling = spoolingStore(away, spool);
    await spooling.put('a', new Uint8Array([1]), 'x');
    await spooling.put('b', new Uint8Array([2]), 'x');
    expect(await flushSpool(away, spool)).toMatchObject({ sent: 0, remaining: 2, error: expect.stringContaining('cannot reach') });
    expect(await pendingInSpool(spool)).toBe(2);
  });
});
