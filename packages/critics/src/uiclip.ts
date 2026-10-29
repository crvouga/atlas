/**
 * @module The UIClip critic (`@crvouga/atlas/critics/uiclip`)
 *
 * A model-based critic: UIClip scores how well a screenshot looks, as one number. This module is the adapter around it, and
 * it needs nothing installed to import: the model runs in an ONNX Runtime session that is loaded only when a run starts
 * (`loadOnnxRuntime`, which needs the optional `onnxruntime-node` and `sharp` and names the one that is missing), and a test
 * or another runtime passes its own `UiclipRuntime`. The checkpoint is provisioned only by an explicit `setupUiclip`, which
 * verifies it against a pinned SHA-256 and refuses a file that does not match; inference never downloads anything and
 * refuses a checkpoint that does not match. The critic sends images nowhere: it runs on this machine.
 *
 * A single global score cannot say what to fix, and on real recordings it ranks ordinary loading overlays as poor, so
 * a UIClip score is report-only evidence read against the scores of the same state kind (see `relativeVerdict`), never an
 * absolute gate.
 *
 * @see docs/critics.md#the-built-in-uiclip-critic
 */
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';

import { defineCritic, type Critic } from './contract';

/** The version of this adapter's own logic, recorded in every critique. The checkpoint is part of the identity too (through `model.id`). */
export const UICLIP_VERSION = '1.0.0';

/** A pinned checkpoint: where it lives on disk, the SHA-256 it must have, and, optionally, where `setupUiclip` may fetch it from. */
export type UiclipCheckpoint = {
  /** The file on disk. */
  readonly path: string;
  /** Lowercase hex SHA-256 the file must have. Required: an unpinned checkpoint is refused. */
  readonly sha256: string;
  /** Where `setupUiclip` may download it from when the file is missing. Never used by inference. */
  readonly url?: string;
};

/** Something that scores one image: the model behind the critic. */
export type UiclipRuntime = {
  /** The score for the image bytes; higher is better. Must be finite and deterministic for the same bytes. */
  score(image: Uint8Array, signal: AbortSignal): Promise<number>;
  /** Frees the session. */
  close?(): Promise<void>;
};

/** Thrown when an optional dependency a runtime needs is not installed. The message names it and says how to install it. */
export class MissingDependencyError extends Error {
  /** @param dependency the package that is missing. */
  constructor(readonly dependency: string, purpose: string) {
    super(`${purpose} needs the optional dependency "${dependency}", which is not installed. Install it in this project (for example: bun add ${dependency}) and run again.`);
    this.name = 'MissingDependencyError';
  }
}

/**
 * Checks a file against a pinned SHA-256. Returns the hash it has. Throws when the file is missing or its hash differs, naming
 * both hashes, so a corrupted or swapped model is an error and never silently used.
 */
export async function verifyCheckpoint(checkpoint: Pick<UiclipCheckpoint, 'path' | 'sha256'>): Promise<string> {
  if (!/^[0-9a-f]{64}$/.test(checkpoint.sha256)) throw new Error('The checkpoint is not pinned: give its SHA-256 as 64 lowercase hex digits');
  try { await stat(checkpoint.path); } catch { throw new Error(`The UIClip checkpoint is missing: ${checkpoint.path}. Run \`atlas critic setup uiclip\`.`); }
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(checkpoint.path)) hash.update(chunk as Uint8Array);
  const actual = hash.digest('hex');
  if (actual !== checkpoint.sha256) throw new Error(`The UIClip checkpoint ${checkpoint.path} does not match its pinned checksum (expected ${checkpoint.sha256}, found ${actual}). Remove it and run \`atlas critic setup uiclip\`, or fix the pin.`);
  return actual;
}

/** What {@link setupUiclip} did. */
export type UiclipSetup = {
  /** The file that was verified. */
  readonly path: string;
  /** Its SHA-256, equal to the pin. */
  readonly sha256: string;
  /** True when it was fetched now; false when it was already there. */
  readonly downloaded: boolean;
};

/**
 * Provisions the checkpoint: uses the file when it is there, else downloads it from `checkpoint.url` (to a temporary file, hashing as
 * it arrives), and in both cases verifies the pinned SHA-256. A download whose hash differs is deleted and is an error; an
 * existing file whose hash differs is an error and is left alone. This is the only place anything is downloaded.
 *
 * @param checkpoint the pinned checkpoint.
 * @param options.fetch for tests; default `fetch`.
 * @param options.signal cancels the download.
 */
export async function setupUiclip(checkpoint: UiclipCheckpoint, options: { readonly fetch?: typeof fetch; readonly signal?: AbortSignal } = {}): Promise<UiclipSetup> {
  const exists = await stat(checkpoint.path).then(() => true, () => false);
  if (exists) return { path: checkpoint.path, sha256: await verifyCheckpoint(checkpoint), downloaded: false };
  if (!checkpoint.url) throw new Error(`The UIClip checkpoint is not at ${checkpoint.path} and no download address is configured: put the file there, or set checkpoint.url.`);
  if (!/^https:\/\//.test(checkpoint.url)) throw new Error('The checkpoint must be downloaded over https');
  const response = await (options.fetch ?? fetch)(checkpoint.url, options.signal ? { signal: options.signal } : {});
  if (!response.ok || !response.body) throw new Error(`The checkpoint download answered ${response.status}`);
  await mkdir(path.dirname(checkpoint.path), { recursive: true });
  const partial = `${checkpoint.path}.part`;
  const hash = createHash('sha256');
  const out = createWriteStream(partial);
  try {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      hash.update(value);
      if (!out.write(value)) await new Promise<void>(resolve => out.once('drain', () => resolve()));
    }
    await new Promise<void>((resolve, reject) => { out.once('error', reject); out.end(() => resolve()); });
  } catch (error) {
    // The file is opened asynchronously: close it before removing it, or it can reappear.
    if (!out.closed) await new Promise<void>(resolve => { out.once('close', () => resolve()); out.destroy(); });
    await rm(partial, { force: true });
    throw error;
  }
  const actual = hash.digest('hex');
  if (actual !== checkpoint.sha256) {
    await rm(partial, { force: true });
    throw new Error(`The downloaded checkpoint does not match its pinned checksum (expected ${checkpoint.sha256}, received ${actual}); it was discarded.`);
  }
  await rename(partial, checkpoint.path);
  return { path: checkpoint.path, sha256: actual, downloaded: true };
}

/** The modules a runtime imports, so a test can replace them. */
export type UiclipModules = { readonly importModule?: (name: string) => Promise<unknown> };

type OnnxTensor = { readonly data: Float32Array | Float64Array };
type OnnxModule = {
  InferenceSession: { create(path: string): Promise<{ inputNames: string[]; outputNames: string[]; run(feeds: Record<string, unknown>): Promise<Record<string, OnnxTensor>>; release?(): Promise<void> }> };
  Tensor: new (type: 'float32', data: Float32Array, dims: number[]) => unknown;
};
type SharpModule = (input: Uint8Array) => { resize(width: number, height: number, options: { fit: 'cover' }): { removeAlpha(): { raw(): { toBuffer(): Promise<Uint8Array> } } } };

/** CLIP's published normalisation of RGB channels. */
const MEAN = [0.48145466, 0.4578275, 0.40821073] as const;
const STD = [0.26862954, 0.26130258, 0.27577711] as const;
const SIZE = 224;

/**
 * Opens an ONNX Runtime session on a verified checkpoint and scores images with it: the image is resized to 224 by 224 and
 * normalised as CLIP does, and the first output's first value is the score. The checkpoint's hash is verified first and a
 * mismatch is an error. Needs the optional `onnxruntime-node` and `sharp`; the error names the missing one. Nothing is
 * downloaded. The graph and score head are those of the checkpoint you pinned; this has not been validated against any particular
 * checkpoint, so measure it on your own examples (`calibrate`) before reading its scores.
 */
export async function loadOnnxRuntime(checkpoint: Pick<UiclipCheckpoint, 'path' | 'sha256'>, modules: UiclipModules = {}): Promise<UiclipRuntime> {
  const load = modules.importModule ?? ((name: string) => import(name));
  const onnx = await load('onnxruntime-node').catch(() => { throw new MissingDependencyError('onnxruntime-node', 'The UIClip critic'); }) as OnnxModule;
  const sharpModule = await load('sharp').catch(() => { throw new MissingDependencyError('sharp', 'The UIClip critic (to decode images)'); }) as { default?: SharpModule } & SharpModule;
  const sharp = (sharpModule.default ?? sharpModule) as SharpModule;
  await verifyCheckpoint(checkpoint);
  const session = await onnx.InferenceSession.create(checkpoint.path);
  return {
    async score(image) {
      const rgb = await sharp(image).resize(SIZE, SIZE, { fit: 'cover' }).removeAlpha().raw().toBuffer();
      const planes = new Float32Array(3 * SIZE * SIZE);
      for (let pixel = 0; pixel < SIZE * SIZE; pixel++) for (let channel = 0; channel < 3; channel++) planes[channel * SIZE * SIZE + pixel] = ((rgb[pixel * 3 + channel]! / 255) - MEAN[channel]!) / STD[channel]!;
      const outputs = await session.run({ [session.inputNames[0]!]: new onnx.Tensor('float32', planes, [1, 3, SIZE, SIZE]) });
      const value = outputs[session.outputNames[0]!]?.data[0];
      if (value === undefined || !Number.isFinite(value)) throw new Error('The UIClip model gave no finite score');
      return value;
    },
    async close() { await session.release?.(); }
  };
}

/**
 * The UIClip critic: judges each image with a runtime and reports the score and nothing else (a score is a valid critique; it
 * has no findings). Deterministic for a deterministic runtime. Its identity includes the checkpoint hash, so a different
 * checkpoint is judged again. The runtime is created once, on the first image.
 *
 * @param options.checkpoint the pinned checkpoint. Its hash is the model id.
 * @param options.runtime a runtime, or a function that makes one. Default: {@link loadOnnxRuntime} on the checkpoint.
 * @example
 * const critic = createUiclipCritic({ checkpoint: { path: '.atlas/uiclip.onnx', sha256 }, runtime: { score: async () => 0.5 } });
 */
export function createUiclipCritic(options: { readonly checkpoint: Pick<UiclipCheckpoint, 'path' | 'sha256'>; readonly runtime?: UiclipRuntime | (() => Promise<UiclipRuntime>); readonly name?: string; readonly modules?: UiclipModules }): Critic & { ready(): Promise<void> } {
  let runtime: Promise<UiclipRuntime> | undefined;
  const open = () => {
    runtime ??= Promise.resolve(typeof options.runtime === 'function' ? options.runtime() : options.runtime ?? loadOnnxRuntime(options.checkpoint, options.modules));
    return runtime;
  };
  const critic: Critic = defineCritic({
    name: options.name ?? 'uiclip', version: UICLIP_VERSION, kind: 'model',
    describe: () => ({ sendsImagesTo: null, model: { id: `uiclip@${options.checkpoint.sha256.slice(0, 16)}`, provider: 'local' }, parameters: { checkpoint: options.checkpoint.sha256 }, needsSetup: true }),
    setup: async () => { await verifyCheckpoint(options.checkpoint); },
    async evaluate({ image, signal }) {
      const score = await (await open()).score(image, signal);
      return { verdict: { score, scale: 'UIClip similarity, higher is better; read it against the same state kind' } };
    }
  });
  /** Opens the runtime now, so a missing dependency or a bad checkpoint is found before any image is judged. */
  return { ...critic, async ready() { await open(); } };
}
