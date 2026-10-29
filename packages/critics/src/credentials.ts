/**
 * @module Credentials for bring-your-own-AI critics
 *
 * Configuration names a credential by reference (`env:OPENAI_API_KEY`, `file:~/.config/key`) and never contains one,
 * so it can be committed. A credential is read at run time and never written to a layer, a log, an error message, a
 * progress display, a cache file or JSON output: everything a run writes goes through a redactor built from the
 * credentials the run holds. A configuration that contains a literal credential is refused with a message that names
 * where it is and never repeats it.
 *
 * @see docs/critics.md#credentials
 */

/** A credential by reference: the environment variable that holds it, or the file that does. */
export type CredentialRef = { readonly scheme: 'env'; readonly name: string } | { readonly scheme: 'file'; readonly path: string };

/** The text that stands for a credential in anything written. */
export const REDACTED = '[redacted]';

/**
 * Reads a reference such as `env:OPENAI_API_KEY` or `file:/run/secrets/key`.
 *
 * Returns `null` when the text is not a reference (so it may be a literal credential, which configuration must not
 * contain).
 *
 * @example
 * parseCredentialRef('env:SOME_API_KEY'); // { scheme: 'env', name: 'SOME_API_KEY' }
 */
export function parseCredentialRef(text: string): CredentialRef | null {
  const env = /^env:([A-Za-z_][A-Za-z0-9_]*)$/.exec(text);
  if (env) return { scheme: 'env', name: env[1]! };
  const file = /^file:(.+)$/.exec(text);
  if (file) return { scheme: 'file', path: file[1]! };
  return null;
}

/**
 * Resolves a reference to the credential it names, at run time.
 *
 * Throws, naming the reference and never a value, when the text is not a reference, the variable is unset or empty, or
 * the file cannot be read or is empty. A trailing newline in a file is not part of the credential.
 *
 * @param ref the reference from configuration.
 * @param source where to read from; the defaults are the process environment and the file system. Tests pass fakes.
 */
export async function resolveCredential(ref: string, source: { readonly env?: Readonly<Record<string, string | undefined>>; readonly readFile?: (path: string) => Promise<string> } = {}): Promise<string> {
  const parsed = parseCredentialRef(ref);
  if (!parsed) throw new Error('A credential must be given as a reference such as env:NAME or file:PATH');
  if (parsed.scheme === 'env') {
    const value = (source.env ?? process.env)[parsed.name];
    if (!value) throw new Error(`The credential ${ref} is not set: export ${parsed.name}`);
    return value;
  }
  let text: string;
  try {
    text = await (source.readFile ?? (async path => (await import('node:fs/promises')).readFile(path, 'utf8')))(parsed.path);
  } catch {
    throw new Error(`The credential ${ref} could not be read`);
  }
  const value = text.replace(/\r?\n$/, '');
  if (!value) throw new Error(`The credential ${ref} is empty`);
  return value;
}

/** Shapes that are credentials whatever they are called: provider keys, access tokens, bearer tokens, JWTs. */
const LOOKS_LIKE_A_CREDENTIAL: readonly RegExp[] = [
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[abpr]-[A-Za-z0-9-]{10,}/,
  /\bAIza[0-9A-Za-z_-]{30,}/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/i
];
const CREDENTIAL_NAME = /(?:key|token|secret|password|passwd|credential|authorization|bearer)/i;

/** A place in a configuration that holds a literal credential: where, and why it was judged one. Never the value. */
export type LiteralCredential = { readonly path: string; readonly reason: string };

/**
 * Finds literal credentials in a configuration: a string under a key named like a credential (`apiKey`, `token`,
 * `secret`…) that is not a reference, and any string anywhere that has the shape of a provider key, token or JWT.
 * A key whose name ends in `Ref` or `Env`, or whose value is a reference, is fine.
 *
 * Returns the findings in document order; the value of a finding is never included.
 */
export function findLiteralCredentials(config: unknown, path = ''): LiteralCredential[] {
  const found: LiteralCredential[] = [];
  const walk = (value: unknown, where: string, key: string) => {
    if (typeof value === 'string') {
      if (parseCredentialRef(value)) return;
      if (CREDENTIAL_NAME.test(key) && !/(?:ref|env)$/i.test(key) && value !== '') found.push({ path: where, reason: `"${key}" holds a literal value: name the credential by reference instead (env:NAME or file:PATH)` });
      else if (LOOKS_LIKE_A_CREDENTIAL.some(pattern => pattern.test(value))) found.push({ path: where, reason: 'the value has the shape of a credential: name it by reference instead (env:NAME or file:PATH)' });
    } else if (Array.isArray(value)) value.forEach((item, index) => walk(item, `${where}[${index}]`, key));
    else if (value !== null && typeof value === 'object') for (const [name, item] of Object.entries(value)) walk(item, where ? `${where}.${name}` : name, name);
  };
  walk(config, path, '');
  return found;
}

/**
 * Refuses a configuration that contains a literal credential. Throws one error that lists every place, with the reason
 * and never the value.
 */
export function assertNoLiteralCredentials(config: unknown): void {
  const found = findLiteralCredentials(config);
  if (found.length) throw new Error(`The configuration contains ${found.length === 1 ? 'a literal credential' : 'literal credentials'}, which must never be committed or written:\n${found.map(item => `  ${item.path || '(root)'}: ${item.reason}`).join('\n')}`);
}

/** Replaces credentials in text with {@link REDACTED}. */
export type Redactor = (text: string) => string;

/**
 * Builds a redactor for the credentials a run holds. It removes each secret (and its URL-encoded and base64 forms) and
 * anything shaped like a provider key, token or JWT. Secrets shorter than 6 characters are ignored, because replacing
 * them would damage ordinary text and they are not credentials.
 *
 * @param secrets the resolved credentials of the run.
 */
export function createRedactor(secrets: readonly string[]): Redactor {
  const forms = new Set<string>();
  for (const secret of secrets) {
    if (secret.length < 6) continue;
    forms.add(secret);
    forms.add(encodeURIComponent(secret));
    forms.add(Buffer.from(secret).toString('base64'));
  }
  // Longest first, so a secret that contains another is removed whole.
  const ordered = [...forms].sort((a, b) => b.length - a.length);
  return text => {
    let out = text;
    for (const form of ordered) out = out.split(form).join(REDACTED);
    for (const pattern of LOOKS_LIKE_A_CREDENTIAL) out = out.replace(new RegExp(pattern.source, `${pattern.flags.replace('g', '')}g`), REDACTED);
    return out;
  };
}
