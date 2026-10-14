import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { XMLParser } from 'fast-xml-parser';

import type { Credentials } from './sigv4';

type Env = Readonly<Record<string, string | undefined>>;

export type CredentialProvider = (() => Promise<Credentials>) & {
  /** Drop what is cached, so the next call asks again. Used when a store says the credentials expired. */
  invalidate(): void;
  /** Where the credentials came from, once known: "environment", "web identity (IRSA)", "profile prod", … */
  source(): string | null;
};

export type ChainOptions = {
  readonly env?: Env;
  readonly fetch?: typeof fetch;
  readonly readFile?: (file: string) => Promise<string>;
  /** Run a command and return its stdout, or null when it is not installed or fails. */
  readonly run?: (command: string, args: readonly string[]) => Promise<string | null>;
  readonly now?: () => number;
  readonly home?: string;
  /** Refresh this long before credentials expire. */
  readonly skewMs?: number;
};

let parser: XMLParser | undefined;
/** Built on first use, so importing this module does no work. */
const xml = { parse: (text: string) => (parser ??= new XMLParser({ ignoreAttributes: true, parseTagValue: false })).parse(text) };

async function runCommand(command: string, args: readonly string[]): Promise<string | null> {
  return new Promise(resolve => {
    try {
      const child = spawn(command, [...args], { stdio: ['ignore', 'pipe', 'ignore'] });
      let out = '';
      const timer = setTimeout(() => { child.kill(); resolve(null); }, 20_000);
      child.stdout.on('data', chunk => { out += String(chunk); });
      child.on('error', () => { clearTimeout(timer); resolve(null); });
      child.on('close', code => { clearTimeout(timer); resolve(code === 0 ? out : null); });
    } catch {
      resolve(null);
    }
  });
}

function parseIni(text: string): Record<string, Record<string, string>> {
  const sections: Record<string, Record<string, string>> = {};
  let current: Record<string, string> | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const header = /^\[(?:profile\s+)?([^\]]+)\]$/.exec(line);
    if (header) { current = sections[header[1]!.trim()] ??= {}; continue; }
    const at = line.indexOf('=');
    if (current && at > 0) current[line.slice(0, at).trim().toLowerCase()] = line.slice(at + 1).trim();
  }
  return sections;
}

function expiry(value: unknown): number | undefined {
  const time = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(time) ? time : undefined;
}

/**
 * The credentials an AWS SDK would find, in the same order, with no SDK: environment, web identity
 * (EKS), container (ECS), shared credentials file, the AWS CLI (which covers SSO and assumed roles),
 * and EC2 instance metadata. `ATLAS_S3_*` variables come first so one store can use keys that are
 * not the machine's AWS keys, such as Cloudflare R2 tokens.
 */
export function credentialChain(options: ChainOptions = {}): CredentialProvider {
  const env = options.env ?? process.env;
  const doFetch = options.fetch ?? fetch;
  const read = options.readFile ?? ((file: string) => readFile(file, 'utf8'));
  const run = options.run ?? runCommand;
  const now = options.now ?? Date.now;
  const skew = options.skewMs ?? 5 * 60_000;
  const home = options.home ?? env.HOME ?? os.homedir();
  const profile = env.AWS_PROFILE || env.AWS_DEFAULT_PROFILE || 'default';
  let cached: { credentials: Credentials; source: string } | null = null;
  let pending: Promise<Credentials> | null = null;

  const sources: { name: string; load: () => Promise<Credentials | null> }[] = [
    {
      name: 'environment (ATLAS_S3_*)',
      load: async () => env.ATLAS_S3_ACCESS_KEY_ID && env.ATLAS_S3_SECRET_ACCESS_KEY
        ? { accessKeyId: env.ATLAS_S3_ACCESS_KEY_ID, secretAccessKey: env.ATLAS_S3_SECRET_ACCESS_KEY, ...(env.ATLAS_S3_SESSION_TOKEN ? { sessionToken: env.ATLAS_S3_SESSION_TOKEN } : {}) }
        : null
    },
    {
      name: 'environment (AWS_ACCESS_KEY_ID)',
      load: async () => env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY
        ? { accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY, ...(env.AWS_SESSION_TOKEN ? { sessionToken: env.AWS_SESSION_TOKEN } : {}) }
        : null
    },
    {
      name: 'web identity (IRSA)',
      load: async () => {
        if (!env.AWS_WEB_IDENTITY_TOKEN_FILE || !env.AWS_ROLE_ARN) return null;
        const region = env.AWS_REGION || env.AWS_DEFAULT_REGION || 'us-east-1';
        const token = (await read(env.AWS_WEB_IDENTITY_TOKEN_FILE)).trim();
        const url = new URL(env.AWS_STS_ENDPOINT || `https://sts.${region}.amazonaws.com/`);
        url.search = new URLSearchParams({ Action: 'AssumeRoleWithWebIdentity', Version: '2011-06-15', RoleArn: env.AWS_ROLE_ARN, RoleSessionName: env.AWS_ROLE_SESSION_NAME || 'atlas', WebIdentityToken: token }).toString();
        const response = await doFetch(url, { method: 'GET', headers: { accept: 'application/xml' } });
        const body = await response.text();
        if (!response.ok) throw new Error(`STS AssumeRoleWithWebIdentity failed (${response.status}): ${body.slice(0, 300)}`);
        const found = xml.parse(body)?.AssumeRoleWithWebIdentityResponse?.AssumeRoleWithWebIdentityResult?.Credentials;
        if (!found?.AccessKeyId) throw new Error('STS returned no credentials');
        return { accessKeyId: found.AccessKeyId, secretAccessKey: found.SecretAccessKey, sessionToken: found.SessionToken, ...(expiry(found.Expiration) ? { expiresAtMs: expiry(found.Expiration)! } : {}) };
      }
    },
    {
      name: 'container credentials (ECS)',
      load: async () => {
        const url = env.AWS_CONTAINER_CREDENTIALS_FULL_URI || (env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI ? `http://169.254.170.2${env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI}` : null);
        if (!url) return null;
        const token = env.AWS_CONTAINER_AUTHORIZATION_TOKEN || (env.AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE ? (await read(env.AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE)).trim() : null);
        const response = await doFetch(url, { headers: token ? { authorization: token } : {} });
        if (!response.ok) throw new Error(`The container credentials endpoint answered ${response.status}`);
        const found = await response.json() as Record<string, string>;
        return { accessKeyId: found.AccessKeyId!, secretAccessKey: found.SecretAccessKey!, sessionToken: found.Token!, ...(expiry(found.Expiration) ? { expiresAtMs: expiry(found.Expiration)! } : {}) };
      }
    },
    {
      name: `shared credentials file (profile ${profile})`,
      load: async () => {
        const file = env.AWS_SHARED_CREDENTIALS_FILE || path.join(home, '.aws', 'credentials');
        const text = await read(file).catch(() => null);
        const section = text ? parseIni(text)[profile] : undefined;
        return section?.aws_access_key_id && section.aws_secret_access_key
          ? { accessKeyId: section.aws_access_key_id, secretAccessKey: section.aws_secret_access_key, ...(section.aws_session_token ? { sessionToken: section.aws_session_token } : {}) }
          : null;
      }
    },
    {
      name: `AWS CLI (profile ${profile})`,
      load: async () => {
        // Covers SSO, assumed roles and credential_process: whatever `aws` itself can sign in with.
        if (env.ATLAS_NO_AWS_CLI) return null;
        const out = await run('aws', ['configure', 'export-credentials', '--format', 'process', ...(env.AWS_PROFILE ? ['--profile', env.AWS_PROFILE] : [])]);
        if (!out) return null;
        try {
          const found = JSON.parse(out) as Record<string, string>;
          return found.AccessKeyId && found.SecretAccessKey ? { accessKeyId: found.AccessKeyId, secretAccessKey: found.SecretAccessKey, ...(found.SessionToken ? { sessionToken: found.SessionToken } : {}), ...(expiry(found.Expiration) ? { expiresAtMs: expiry(found.Expiration)! } : {}) } : null;
        } catch {
          return null;
        }
      }
    },
    {
      name: 'EC2 instance metadata',
      load: async () => {
        if (env.AWS_EC2_METADATA_DISABLED === 'true') return null;
        const base = env.AWS_EC2_METADATA_SERVICE_ENDPOINT || 'http://169.254.169.254';
        const signal = () => AbortSignal.timeout(1_000);
        try {
          const token = await doFetch(`${base}/latest/api/token`, { method: 'PUT', headers: { 'x-aws-ec2-metadata-token-ttl-seconds': '21600' }, signal: signal() });
          if (!token.ok) return null;
          const headers = { 'x-aws-ec2-metadata-token': await token.text() };
          const roles = await doFetch(`${base}/latest/meta-data/iam/security-credentials/`, { headers, signal: signal() });
          const role = (await roles.text()).split('\n')[0]?.trim();
          if (!roles.ok || !role) return null;
          const found = await (await doFetch(`${base}/latest/meta-data/iam/security-credentials/${role}`, { headers, signal: signal() })).json() as Record<string, string>;
          return { accessKeyId: found.AccessKeyId!, secretAccessKey: found.SecretAccessKey!, sessionToken: found.Token!, ...(expiry(found.Expiration) ? { expiresAtMs: expiry(found.Expiration)! } : {}) };
        } catch {
          return null;
        }
      }
    }
  ];

  async function resolve(): Promise<Credentials> {
    const failures: string[] = [];
    for (const source of sources) {
      try {
        const credentials = await source.load();
        if (credentials) {
          cached = { credentials, source: source.name };
          return credentials;
        }
      } catch (error) {
        failures.push(`${source.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    throw new Error([
      'No AWS credentials found for the object store.',
      'Atlas looked, in order, at: ATLAS_S3_ACCESS_KEY_ID / ATLAS_S3_SECRET_ACCESS_KEY, AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY, EKS web identity, ECS container credentials, ~/.aws/credentials, the AWS CLI (aws sso login), and EC2 instance metadata.',
      ...failures.map(failure => `  - ${failure}`),
      'Fix: export AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY, or run `aws sso login` / `aws configure`, or attach a role to the machine.'
    ].join('\n'));
  }

  const provider = (async () => {
    if (cached && (cached.credentials.expiresAtMs === undefined || cached.credentials.expiresAtMs - skew > now())) return cached.credentials;
    // One lookup at a time, however many requests are waiting for credentials.
    pending ??= resolve().finally(() => { pending = null; });
    return pending;
  }) as CredentialProvider;
  provider.invalidate = () => { cached = null; };
  provider.source = () => cached?.source ?? null;
  return provider;
}

/** A provider for keys that are already known. */
export function staticCredentials(credentials: Credentials): CredentialProvider {
  const provider = (async () => credentials) as CredentialProvider;
  provider.invalidate = () => {};
  provider.source = () => 'given to the store';
  return provider;
}
