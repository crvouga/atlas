/**
 * @module The LLM critic (`@crvouga/atlas/critics/llm`)
 *
 * A critic that asks a vision-capable language model to review a screenshot against a rubric and answer with structured
 * findings. It is provider-agnostic: a provider is a small adapter (`LlmProvider.complete`) with declared capabilities, so
 * a developer brings their own model and account. `openAiCompatibleProvider` speaks the widely implemented chat-completions
 * protocol with plain `fetch` (hosted services and local servers alike), so there is no SDK to install; any other provider is a
 * few lines.
 *
 * The rubric is recorded only as a hash. The credential is passed in by the caller (resolved from a reference at run time),
 * sent only in the `Authorization` header, and never written to a result, a log or an error: the runner redacts what it records.
 * A provider's rate limit becomes a `RateLimitedError` carrying its `Retry-After`, an answer that is not the asked-for structure
 * becomes `invalid-output` and no score is invented, and the images' destination is declared before a run.
 *
 * @see docs/critics.md#the-llm-critic-and-bringing-your-own-ai
 */
import { createHash } from 'node:crypto';
import { z } from 'zod/v4';

import { CriticError, InvalidOutputError, RateLimitedError, defineCritic, type Critic, type CriticAnswer } from './contract';

/** What a critic asks a provider. */
export type LlmRequest = {
  readonly model: string;
  readonly system: string;
  readonly prompt: string;
  readonly image: Uint8Array;
  /** The image's media type, from its bytes (`image/png`, `image/jpeg`, `image/webp`, `image/gif`). */
  readonly imageMediaType: string;
  readonly temperature: number;
  readonly maxTokens: number;
  /** Aborted on timeout or cancellation: pass it to the network call. */
  readonly signal: AbortSignal;
};

/** What a provider answers: the model's text, and what it cost when the provider says. */
export type LlmAnswer = {
  readonly text: string;
  readonly usage?: { readonly inputTokens?: number; readonly outputTokens?: number; readonly latencyMs?: number };
};

/** A model provider. `complete` should throw `RateLimitedError` (with `Retry-After`) when rate limited and any `CriticError` otherwise. */
export type LlmProvider = {
  /** Short and stable: `openai-compatible`, `local`. Recorded as the model's provider. */
  readonly name: string;
  /** Where images are sent: a host name. A run that sends images to a third party needs explicit confirmation. */
  readonly sendsImagesTo: string;
  /** What it accepts. */
  readonly capabilities: { readonly images: true; readonly maxImageBytes?: number };
  complete(request: LlmRequest): Promise<LlmAnswer>;
};

/** The rubric used when a project gives none. */
export const DEFAULT_RUBRIC = [
  'You are a meticulous UI reviewer. Judge how polished this screenshot of a product screen is.',
  'Look for: inconsistent or cramped spacing, misalignment, text that is clipped, overlapping or hard to read, weak contrast, unclear visual hierarchy,',
  'broken or placeholder content, controls that look inactive or inconsistent, and anything a careful designer would fix before release.',
  'Judge only what is visible. Do not guess about behaviour. If the screenshot is a loading, empty or error state, judge it as that kind of state.'
].join(' ');

const FindingSchema = z.object({
  id: z.string().optional(), category: z.string().min(1).optional(), severity: z.string().min(1).optional(),
  confidence: z.number().min(0).max(1).optional(),
  region: z.object({ unit: z.string().min(1), x: z.number(), y: z.number(), w: z.number().nonnegative(), h: z.number().nonnegative() }).optional(),
  rationale: z.string().optional(), suggestion: z.string().optional()
}).passthrough();

const ModelAnswerSchema = z.object({
  score: z.number().min(0).max(1),
  label: z.string().min(1).optional(),
  confidence: z.number().min(0).max(1).optional(),
  findings: z.array(FindingSchema).max(50).optional()
}).passthrough();

/** The instructions that make the model answer in the structure {@link parseLlmAnswer} reads. */
export const ANSWER_INSTRUCTIONS = [
  'Answer with one JSON object and nothing else, in this shape:',
  '{"score": <number 0..1, higher is more polished>, "label": "ok" | "needs-polish", "confidence": <0..1>,',
  ' "findings": [{"category": "spacing|alignment|contrast|overflow|hierarchy|content|other", "severity": "info|minor|major", "confidence": <0..1>,',
  '  "region": {"unit": "normalized", "x": <0..1>, "y": <0..1>, "w": <0..1>, "h": <0..1>}, "rationale": "<why>", "suggestion": "<what to change>"}]}',
  'List findings only for real problems; an empty list is fine.'
].join('\n');

/**
 * Reads a model's text into a critic's answer. Accepts the JSON object bare or inside a code fence. Throws `InvalidOutputError`,
 * with the first problem and never the model's text, when it is not JSON or is not the asked-for structure, so no score is invented.
 */
export function parseLlmAnswer(text: string): CriticAnswer {
  const body = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1] ?? text;
  const start = body.indexOf('{'), end = body.lastIndexOf('}');
  let raw: unknown;
  try { raw = JSON.parse(start >= 0 && end > start ? body.slice(start, end + 1) : body); } catch { throw new InvalidOutputError('The model did not answer with JSON'); }
  const parsed = ModelAnswerSchema.safeParse(raw);
  if (!parsed.success) throw new InvalidOutputError(`The model's answer is not the asked-for structure: ${parsed.error.issues[0]?.path.join('.') || 'answer'}: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
  const { score, label, confidence, findings } = parsed.data;
  return {
    verdict: { score, scale: '0..1, higher is better', ...(label ? { label } : {}), ...(confidence === undefined ? {} : { confidence }) },
    ...(findings?.length ? { findings: findings.map((finding, index) => ({ id: finding.id ?? `f${index + 1}`, ...finding })) } : {})
  };
}

/** The media type of image bytes, from their first bytes. Throws for something that is not a PNG, JPEG, WebP or GIF. */
export function imageMediaType(image: Uint8Array): string {
  const starts = (...bytes: number[]) => bytes.every((byte, index) => image[index] === byte);
  if (starts(0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (starts(0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (starts(0x47, 0x49, 0x46, 0x38)) return 'image/gif';
  if (starts(0x52, 0x49, 0x46, 0x46) && image[8] === 0x57 && image[9] === 0x45 && image[10] === 0x42 && image[11] === 0x50) return 'image/webp';
  throw new CriticError('unsupported-image', 'The image is not a PNG, JPEG, WebP or GIF');
}

/** Options of {@link createLlmCritic}. */
export type LlmCriticOptions = {
  readonly provider: LlmProvider;
  /** The model id the provider knows. Part of the critique's identity. */
  readonly model: string;
  /** The critic's name and the producer suffix. Default `vision-llm`. */
  readonly name?: string;
  /** Of the critic's own logic and prompt. Change it when the rubric's meaning changes. Default `1.0.0`. */
  readonly version?: string;
  /** What to look for. Recorded as a hash, never as text. Default {@link DEFAULT_RUBRIC}. */
  readonly rubric?: string;
  /** Default 0: as deterministic as the model allows. */
  readonly temperature?: number;
  /** The most the model may answer with. Default 1024. */
  readonly maxTokens?: number;
};

/**
 * The LLM critic. It sends each image to the provider with the rubric and reads the structured answer into a verdict and findings.
 *
 * @example
 * const critic = createLlmCritic({ model: 'my-vision-model', provider: openAiCompatibleProvider({ baseUrl: 'https://llm.example.com/v1', apiKey }) });
 */
export function createLlmCritic(options: LlmCriticOptions): Critic {
  const rubric = options.rubric ?? DEFAULT_RUBRIC;
  const temperature = options.temperature ?? 0;
  const maxTokens = options.maxTokens ?? 1024;
  const rubricHash = createHash('sha256').update(rubric).digest('hex');
  return defineCritic({
    name: options.name ?? 'vision-llm', version: options.version ?? '1.0.0', kind: 'llm',
    describe: () => ({ sendsImagesTo: options.provider.sendsImagesTo, model: { id: options.model, provider: options.provider.name }, parameters: { temperature, maxTokens, rubric: rubricHash }, needsSetup: false }),
    async evaluate({ image, entry, signal }) {
      const max = options.provider.capabilities.maxImageBytes;
      if (max !== undefined && image.byteLength > max) throw new CriticError('image-too-large', `The image is ${image.byteLength} bytes; this provider accepts at most ${max}`);
      const started = Date.now();
      const answer = await options.provider.complete({
        model: options.model, system: `${rubric}\n\n${ANSWER_INSTRUCTIONS}`,
        prompt: `Review this screenshot. It is a "${entry.state}" state${entry.route ? ` of ${entry.route}` : ''}, titled "${entry.title}".`,
        image, imageMediaType: imageMediaType(image), temperature, maxTokens, signal
      });
      const parsed = parseLlmAnswer(answer.text);
      return { ...parsed, usage: { ...(answer.usage ?? {}), latencyMs: answer.usage?.latencyMs ?? Date.now() - started } };
    }
  });
}

/** Reads a `Retry-After` header (seconds or an HTTP date) as milliseconds. */
export function retryAfterMs(header: string | null, now = Date.now()): number | undefined {
  if (!header) return undefined;
  if (/^\d+(\.\d+)?$/.test(header.trim())) return Math.round(Number(header) * 1000);
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.max(0, at - now) : undefined;
}

/**
 * A provider for any server that implements the chat-completions protocol (`POST {baseUrl}/chat/completions` with image content),
 * hosted or local. The key is sent as a Bearer token and nowhere else. A 429 becomes `RateLimitedError` with its `Retry-After`; other
 * failures become `CriticError('error')` with the status and never the response body. Images go to `baseUrl`'s host, which is what
 * `sendsImagesTo` says.
 *
 * @param options.baseUrl for example `https://llm.example.com/v1`. Plain `http` is allowed only for a loopback address.
 * @param options.apiKey the credential, resolved by the caller from a reference. Optional for a local server.
 * @param options.fetch for tests.
 */
export function openAiCompatibleProvider(options: { readonly baseUrl: string; readonly apiKey?: string; readonly fetch?: typeof fetch; readonly maxImageBytes?: number }): LlmProvider {
  const url = new URL(options.baseUrl);
  const loopback = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw new Error('A provider must be reached over https (plain http only for a loopback address)');
  const doFetch = options.fetch ?? fetch;
  const endpoint = `${options.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  return {
    name: 'openai-compatible', sendsImagesTo: url.host,
    capabilities: { images: true, ...(options.maxImageBytes === undefined ? {} : { maxImageBytes: options.maxImageBytes }) },
    async complete(request) {
      let response: Response;
      try {
        response = await doFetch(endpoint, {
          method: 'POST', signal: request.signal,
          headers: { 'content-type': 'application/json', ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}) },
          body: JSON.stringify({
            model: request.model, temperature: request.temperature, max_tokens: request.maxTokens,
            messages: [
              { role: 'system', content: request.system },
              { role: 'user', content: [{ type: 'text', text: request.prompt }, { type: 'image_url', image_url: { url: `data:${request.imageMediaType};base64,${Buffer.from(request.image).toString('base64')}` } }] }
            ]
          })
        });
      } catch (error) {
        if (request.signal.aborted) throw error;
        throw new CriticError('error', `The provider at ${url.host} could not be reached (${error instanceof Error ? error.name : 'error'})`);
      }
      if (response.status === 429) { await response.body?.cancel(); throw new RateLimitedError(`The provider at ${url.host} is rate limiting`, retryAfterMs(response.headers.get('retry-after'))); }
      if (!response.ok) { await response.body?.cancel(); throw new CriticError(response.status === 401 || response.status === 403 ? 'unauthorized' : 'error', `The provider at ${url.host} answered ${response.status}`); }
      const body = await response.json().catch(() => null) as { choices?: { message?: { content?: unknown } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } } | null;
      const content = body?.choices?.[0]?.message?.content;
      if (typeof content !== 'string') throw new InvalidOutputError('The provider answered without a message');
      return { text: content, usage: { ...(body?.usage?.prompt_tokens === undefined ? {} : { inputTokens: body.usage.prompt_tokens }), ...(body?.usage?.completion_tokens === undefined ? {} : { outputTokens: body.usage.completion_tokens }) } };
    }
  };
}
