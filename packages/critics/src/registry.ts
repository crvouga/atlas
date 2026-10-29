/**
 * @module Configured critics
 *
 * Reads the critics a project configured (`atlas.critics.json`) and builds them: the built-in UIClip critic, the LLM
 * critic over a provider, or a critic of the project's own (a module whose default export is a `defineCritic` result). The
 * configuration names a credential by reference (`env:NAME`, `file:PATH`) and never contains one, so it can be committed;
 * a configuration with a literal credential is refused before anything is built. Credentials are resolved when a critic is
 * built for a run and never stored.
 *
 * Every built critic can say what is wrong with it (`inspect`) so `atlas critic doctor` reports each problem on its own
 * with how to fix it, and how to provision itself (`setup`).
 *
 * @see docs/critics.md#configuring-critics
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod/v4';

import { defineCritic, type Critic } from './contract';
import { assertNoLiteralCredentials, createRedactor, resolveCredential } from './credentials';
import { createLlmCritic, openAiCompatibleProvider } from './llm';
import { createUiclipCritic, MissingDependencyError, setupUiclip, verifyCheckpoint } from './uiclip';

const CheckpointConfig = z.object({
  path: z.string().min(1).describe('Where the checkpoint file lives, relative to the configuration file'),
  sha256: z.string().regex(/^[0-9a-f]{64}$/, 'the SHA-256 the checkpoint must have: 64 lowercase hex digits').describe('The pinned SHA-256 of the checkpoint'),
  url: z.string().url().optional().describe('Where `atlas critic setup` may download it from (https). Inference never downloads')
});

/** The configuration of one critic. `type` chooses what it is. */
export const CriticConfigSchema = z.discriminatedUnion('type', [
  z.looseObject({ type: z.literal('uiclip'), checkpoint: CheckpointConfig }),
  z.looseObject({
    type: z.literal('llm'),
    provider: z.literal('openai-compatible').default('openai-compatible'),
    baseUrl: z.string().url().describe('For example https://llm.example.com/v1. Images are sent to this host'),
    apiKey: z.string().optional().describe('A reference to the key: `env:NAME` or `file:PATH`. Never the key'),
    model: z.string().min(1),
    rubric: z.string().optional().describe('What to look for, as text; recorded as a hash'),
    rubricFile: z.string().optional().describe('Or a file holding the rubric, relative to the configuration file'),
    temperature: z.number().min(0).max(2).optional(),
    maxTokens: z.number().int().positive().optional(),
    version: z.string().min(1).optional().describe('Change it when the rubric or prompt changes meaning, so critiques are made again')
  }),
  z.looseObject({ type: z.literal('module'), module: z.string().min(1).describe('A TypeScript or JavaScript file, relative to the configuration file, whose default export is a critic (`defineCritic`)'), export: z.string().optional().describe('The export to use instead of the default') })
]);

/** The configuration file: which server, and the critics by name. */
export const CriticsConfigSchema = z.looseObject({
  server: z.looseObject({
    url: z.string().optional().describe('The Atlas server'),
    project: z.string().optional(),
    token: z.string().optional().describe('A reference to the token: `env:NAME` or `file:PATH`. Never the token')
  }).optional(),
  spool: z.string().optional().describe('Where critiques that could not be sent are kept, relative to the configuration file. Default .atlas/critic-spool'),
  critics: z.record(z.string().regex(/^[a-z0-9][a-z0-9.-]*$/, 'a critic name is lowercase letters, digits, "-" and "."'), CriticConfigSchema).default({})
});

/** The configuration file as read. */
export type CriticsConfig = z.output<typeof CriticsConfigSchema>;
/** The configuration of one critic. */
export type CriticConfig = z.output<typeof CriticConfigSchema>;

/** A configuration and where it came from; `file` is null when there is none, and every critic is then absent. */
export type LoadedConfig = { readonly config: CriticsConfig; readonly file: string | null; readonly directory: string };

/** The name of the configuration file a project commits. */
export const CONFIG_FILE = 'atlas.critics.json';

/**
 * Reads the critics configuration. With no `file`, `atlas.critics.json` in `cwd`, which may be absent (no critics are then
 * configured). A file that was named and is missing, is not JSON, contains a literal credential, or has the wrong shape is an error that
 * says where and never repeats a credential.
 */
export async function loadCriticsConfig(cwd: string, file?: string): Promise<LoadedConfig> {
  const target = path.resolve(cwd, file ?? CONFIG_FILE);
  let text: string;
  try { text = await readFile(target, 'utf8'); } catch {
    if (file) throw new Error(`The critics configuration ${file} cannot be read`);
    return { config: CriticsConfigSchema.parse({}), file: null, directory: cwd };
  }
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error(`${path.relative(cwd, target) || target} is not JSON`); }
  assertNoLiteralCredentials(raw);
  const parsed = CriticsConfigSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`${path.relative(cwd, target) || target} is not a critics configuration: ${parsed.error.issues.slice(0, 3).map(issue => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ')}`);
  return { config: parsed.data, file: target, directory: path.dirname(target) };
}

/** What a critic's `inspect` found about one aspect: fine, a warning, or a problem with how to fix it. */
export type Inspection = {
  /** For example `model-file`, `credential`, `provider`, `module`. */
  readonly aspect: string;
  readonly status: 'ok' | 'warning' | 'problem';
  readonly detail: string;
  readonly fix?: string;
};

/** What `setup` did for a critic. */
export type SetupReport = { readonly ok: true; readonly details: readonly string[] };

/** A critic built from configuration, with what a command needs around it. */
export type BuiltCritic = {
  readonly name: string;
  readonly type: CriticConfig['type'];
  readonly critic: Critic;
  /** The credentials this critic holds, for redaction. */
  readonly secrets: readonly string[];
  /** Finds what is wrong before a run, one finding per aspect. Never calls the model. */
  inspect(): Promise<Inspection[]>;
  /** Provisions what the critic needs (a verified checkpoint) or checks its credentials. */
  setup(): Promise<SetupReport>;
  /** Opens what a run needs (a model session) so a problem is found before any image is judged. */
  ready(): Promise<void>;
};

/** What building a critic may use besides the file system: the environment, `fetch` and module loading. Tests pass fakes. */
export type RegistryIo = {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly fetch?: typeof fetch;
  readonly importModule?: (name: string) => Promise<unknown>;
};

/**
 * Builds the critic `name` of a configuration. Throws, naming the problem, for a name that is not configured, a credential
 * reference that cannot be resolved, or a module that cannot be loaded.
 *
 * @param loaded the configuration and its directory.
 * @param name the critic's name in the configuration.
 */
export async function buildCritic(loaded: LoadedConfig, name: string, io: RegistryIo = {}): Promise<BuiltCritic> {
  const entry = loaded.config.critics[name];
  if (!entry) throw new Error(`No critic named "${name}" is configured${loaded.file ? ` in ${path.basename(loaded.file)}` : ` (there is no ${CONFIG_FILE})`}. Configured: ${Object.keys(loaded.config.critics).join(', ') || 'none'}`);
  const resolve = (relative: string) => path.resolve(loaded.directory, relative);
  const env = io.env ?? process.env;

  if (entry.type === 'uiclip') {
    const checkpoint = { path: resolve(entry.checkpoint.path), sha256: entry.checkpoint.sha256, ...(entry.checkpoint.url ? { url: entry.checkpoint.url } : {}) };
    const critic = createUiclipCritic({ checkpoint, name, ...(io.importModule ? { modules: { importModule: io.importModule } } : {}) });
    const load = io.importModule ?? ((module: string) => import(module));
    return {
      name, type: 'uiclip', critic, secrets: [],
      async inspect() {
        const found: Inspection[] = [];
        try { await verifyCheckpoint(checkpoint); found.push({ aspect: 'model-file', status: 'ok', detail: `The checkpoint ${entry.checkpoint.path} matches its pinned checksum` }); } catch (error) {
          found.push({ aspect: 'model-file', status: 'problem', detail: error instanceof Error ? error.message : String(error), fix: `Run \`atlas critic setup ${name}\`, or put the checkpoint at ${entry.checkpoint.path}` });
        }
        for (const dependency of ['onnxruntime-node', 'sharp']) {
          try { await load(dependency); found.push({ aspect: dependency, status: 'ok', detail: `${dependency} is installed` }); } catch {
            found.push({ aspect: dependency, status: 'problem', detail: new MissingDependencyError(dependency, 'The UIClip critic').message, fix: `bun add ${dependency}` });
          }
        }
        return found;
      },
      async setup() {
        const result = await setupUiclip(checkpoint, io.fetch ? { fetch: io.fetch } : {});
        return { ok: true, details: [`${result.downloaded ? 'Downloaded' : 'Found'} the checkpoint at ${entry.checkpoint.path}`, `Verified its SHA-256 ${result.sha256}`, 'Inference never downloads anything'] };
      },
      ready: () => critic.ready()
    };
  }

  if (entry.type === 'llm') {
    const key = entry.apiKey ? await resolveCredential(entry.apiKey, { env }) : undefined;
    const secrets = key ? [key] : [];
    const redact = createRedactor(secrets);
    const rubric = entry.rubricFile ? await readFile(resolve(entry.rubricFile), 'utf8').catch(() => { throw new Error(`The rubric file ${entry.rubricFile} cannot be read`); }) : entry.rubric;
    const provider = openAiCompatibleProvider({ baseUrl: entry.baseUrl, ...(key ? { apiKey: key } : {}), ...(io.fetch ? { fetch: io.fetch } : {}) });
    const critic = createLlmCritic({ provider, model: entry.model, name, ...(rubric ? { rubric } : {}), ...(entry.temperature === undefined ? {} : { temperature: entry.temperature }), ...(entry.maxTokens === undefined ? {} : { maxTokens: entry.maxTokens }), ...(entry.version ? { version: entry.version } : {}) });
    const doFetch = io.fetch ?? fetch;
    return {
      name, type: 'llm', critic, secrets,
      async inspect() {
        const found: Inspection[] = [];
        found.push(entry.apiKey ? { aspect: 'credential', status: 'ok', detail: `${entry.apiKey} is set` } : { aspect: 'credential', status: 'warning', detail: 'No apiKey is configured: only a server that needs none will answer', fix: 'Set apiKey to a reference such as env:SOME_API_KEY' });
        try {
          const response = await doFetch(`${entry.baseUrl.replace(/\/+$/, '')}/models`, { headers: key ? { authorization: `Bearer ${key}` } : {}, signal: AbortSignal.timeout(5_000) });
          await response.body?.cancel();
          if (response.status === 401 || response.status === 403) found.push({ aspect: 'provider', status: 'problem', detail: `${provider.sendsImagesTo} rejected the credential (${response.status})`, fix: `Check the key that ${entry.apiKey ?? 'apiKey'} names` });
          else if (response.status >= 500) found.push({ aspect: 'provider', status: 'problem', detail: `${provider.sendsImagesTo} answered ${response.status}`, fix: 'Try again later, or check the provider status' });
          else found.push({ aspect: 'provider', status: 'ok', detail: `${provider.sendsImagesTo} is reachable` });
        } catch (error) {
          found.push({ aspect: 'provider', status: 'problem', detail: redact(`${provider.sendsImagesTo} is not reachable (${error instanceof Error ? error.name : 'error'})`), fix: `Check baseUrl (${entry.baseUrl}) and the network` });
        }
        return found;
      },
      async setup() {
        return { ok: true, details: [entry.apiKey ? `The credential ${entry.apiKey} is set` : 'No credential is configured', `Images would be sent to ${provider.sendsImagesTo}`] };
      },
      async ready() { /* nothing to open */ }
    };
  }

  const file = resolve(entry.module);
  const load = io.importModule ? () => io.importModule!(pathToFileURL(file).href) : () => import(pathToFileURL(file).href);
  let module: Record<string, unknown>;
  try { module = await load() as Record<string, unknown>; } catch (error) {
    throw new Error(`The module ${entry.module} of critic "${name}" cannot be loaded: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
  }
  const exported = module[entry.export ?? 'default'] as Critic | undefined;
  if (!exported || typeof exported.evaluate !== 'function' || typeof exported.describe !== 'function') throw new Error(`The module ${entry.module} has no critic as its ${entry.export ?? 'default'} export: use defineCritic`);
  if (exported.name !== name) throw new Error(`The module ${entry.module} exports a critic named "${exported.name}" but it is configured as "${name}": the names must agree, because the name is the producer of its layers`);
  const critic = defineCritic(exported);
  return {
    name, type: 'module', critic, secrets: [],
    async inspect() { return [{ aspect: 'module', status: 'ok', detail: `${entry.module} exports the critic "${critic.name}"` }]; },
    async setup() { await critic.setup?.(); return { ok: true, details: [critic.setup ? `Ran the setup of ${critic.name}` : `${critic.name} needs no setup`] }; },
    async ready() { /* nothing to open */ }
  };
}
