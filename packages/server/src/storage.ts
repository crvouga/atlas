/**
 * @module Required S3 storage configuration
 *
 * The Atlas server keeps ALL reports and ALL user state (the garbage collection policy and saved settings) in
 * S3-compatible object storage, and nowhere else: no local folder, no memory, no database. So the storage settings
 * are required, come only from environment variables (they hold secrets), and have no defaults for where or as whom
 * to connect. `resolveS3Config` checks every variable in one pass and reports all the problems together;
 * `startupFailure` renders them as a banner that cannot be missed. `S3_VARIABLES` is the single description of the
 * variables: the banner, `.env.example` and the documentation table are all made from it.
 *
 * @see docs/server.md#required-s3-storage
 */

type Env = Readonly<Record<string, string | undefined>>;

/** One environment variable of the storage configuration. */
export type S3Variable = {
  readonly name: string;
  readonly required: boolean;
  /** Shown in the banner and the documentation. Never a real secret. */
  readonly meaning: string;
  readonly example: string;
  /** Secrets are never printed, not even when invalid. */
  readonly secret?: true;
  /** Returns what is wrong with a value that is set, or null when it is fine. */
  readonly check: (value: string) => string | null;
};

const hostOf = (value: string): string | null => {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return 'must start with https:// (or http:// for a local S3 server)';
    if (url.username || url.password) return 'must not contain a user name or password; credentials have their own variables';
    if (url.search || url.hash) return 'must be just the address, with no query or fragment';
    return null;
  } catch {
    return 'is not a URL; write it like https://s3.eu-west-1.amazonaws.com';
  }
};

/** Every variable that configures storage, required ones first. */
export const S3_VARIABLES: readonly S3Variable[] = [
  { name: 'ATLAS_S3_ENDPOINT', required: true, meaning: 'S3 API endpoint of the object storage service', example: 'https://s3.eu-west-1.amazonaws.com', check: hostOf },
  { name: 'ATLAS_S3_BUCKET', required: true, meaning: 'Bucket that holds reports and user state; it must already exist', example: 'my-atlas-reports',
    check: value => (/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(value) ? null : 'must be 3-63 lowercase letters, digits, dots or hyphens, starting and ending with a letter or digit') },
  { name: 'ATLAS_S3_REGION', required: true, meaning: 'Region of the bucket (`auto` for Cloudflare R2, `us-east-1` for most self-hosted servers)', example: 'eu-west-1',
    check: value => (/^[a-z0-9][a-z0-9-]*$/.test(value) ? null : 'must be lowercase letters, digits and hyphens, like eu-west-1') },
  { name: 'ATLAS_S3_ACCESS_KEY_ID', required: true, meaning: 'Access key id of an account that may list, read, write and delete in the bucket', example: 'AKIAEXAMPLE', secret: true,
    check: value => (/^\S+$/.test(value) ? null : 'must not contain spaces or line breaks') },
  { name: 'ATLAS_S3_SECRET_ACCESS_KEY', required: true, meaning: 'Secret key that goes with the access key id', example: 'change-me', secret: true,
    check: value => (/^\S+$/.test(value) ? null : 'must not contain spaces or line breaks') },
  { name: 'ATLAS_S3_PREFIX', required: false, meaning: 'Folder inside the bucket for everything Atlas writes (default: the bucket root)', example: 'atlas',
    check: value => (/^[\w./-]+$/.test(value) && !value.split('/').includes('..') ? null : 'may contain only letters, digits, `.`, `_`, `-` and `/`, and no `..`') },
  { name: 'ATLAS_S3_PATH_STYLE', required: false, meaning: 'Address the bucket as endpoint/bucket/key (default: yes; set 0 for virtual-hosted style)', example: '1',
    check: value => (['1', '0', 'true', 'false'].includes(value) ? null : 'must be 1, 0, true or false') },
  { name: 'ATLAS_S3_SESSION_TOKEN', required: false, meaning: 'Session token, only for temporary credentials', example: '', secret: true,
    check: value => (/^\S+$/.test(value) ? null : 'must not contain spaces or line breaks') }
];

/** The storage settings once checked: everything needed to open the bucket, with credentials spelled out. */
export type S3Config = {
  readonly endpoint: string;
  readonly bucket: string;
  readonly region: string;
  readonly prefix: string;
  readonly pathStyle: boolean;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly sessionToken?: string;
};

/** The state of one variable after checking, for the banner. */
export type S3Finding = { readonly variable: S3Variable; readonly status: 'ok' | 'missing' | 'invalid' | 'unset'; readonly problem?: string };

/** The storage configuration could not be used. `findings` has every variable, not only the first problem. */
export class S3ConfigError extends Error {
  constructor(readonly findings: readonly S3Finding[], readonly reason: string = 'the S3 configuration is missing or invalid') {
    super(startupFailure(findings, reason));
    this.name = 'S3ConfigError';
  }
}

/** Looks at every storage variable and returns what each is. Nothing here throws. */
export function inspectS3Env(env: Env): readonly S3Finding[] {
  return S3_VARIABLES.map<S3Finding>(variable => {
    const raw = env[variable.name];
    if (raw === undefined || raw.trim() === '') return { variable, status: variable.required ? 'missing' : 'unset' };
    const problem = variable.check(raw.trim());
    return problem ? { variable, status: 'invalid', problem } : { variable, status: 'ok' };
  });
}

/**
 * The storage settings from the environment. Throws {@link S3ConfigError}, whose message lists every variable and
 * marks each missing or invalid one, when any required variable is absent or any set variable is malformed.
 *
 * @example
 * const s3 = resolveS3Config(process.env);
 */
export function resolveS3Config(env: Env): S3Config {
  const findings = inspectS3Env(env);
  if (findings.some(finding => finding.status === 'missing' || finding.status === 'invalid')) throw new S3ConfigError(findings);
  const value = (name: string) => env[name]?.trim() ?? '';
  const style = value('ATLAS_S3_PATH_STYLE');
  return {
    endpoint: value('ATLAS_S3_ENDPOINT').replace(/\/+$/, ''), bucket: value('ATLAS_S3_BUCKET'), region: value('ATLAS_S3_REGION'),
    prefix: value('ATLAS_S3_PREFIX').replace(/^\/+|\/+$/g, ''), pathStyle: style === '' ? true : style === '1' || style === 'true',
    accessKeyId: value('ATLAS_S3_ACCESS_KEY_ID'), secretAccessKey: value('ATLAS_S3_SECRET_ACCESS_KEY'),
    ...(value('ATLAS_S3_SESSION_TOKEN') ? { sessionToken: value('ATLAS_S3_SESSION_TOKEN') } : {})
  };
}

/** Where the storage is, without a secret: what the log may say. */
export const describeS3 = (config: S3Config): string => `s3://${config.bucket}/${config.prefix ? `${config.prefix}/` : ''} on ${new URL(config.endpoint).host} (${config.region})`;

const RULE = '='.repeat(78);

/**
 * The banner printed when the server cannot start because of storage: why storage is required, then EVERY variable by
 * name with what is wrong with it. Values of secrets are never printed.
 */
export function startupFailure(findings: readonly S3Finding[], reason: string, detail?: string): string {
  const width = Math.max(...findings.map(finding => finding.variable.name.length));
  const mark = (finding: S3Finding) => finding.status === 'missing' ? '[MISSING]' : finding.status === 'invalid' ? '[INVALID]' : finding.status === 'ok' ? '[ok]     ' : '[not set]';
  const line = (finding: S3Finding) => {
    const { variable } = finding;
    const note = finding.status === 'invalid' ? `${finding.problem}` : variable.meaning;
    return `  ${mark(finding)} ${variable.name.padEnd(width)}  ${note}`;
  };
  const required = findings.filter(finding => finding.variable.required);
  const optional = findings.filter(finding => !finding.variable.required);
  const bad = findings.filter(finding => finding.status === 'missing' || finding.status === 'invalid').map(finding => finding.variable.name);
  return [
    '', RULE,
    '  ATLAS CANNOT START: S3 STORAGE IS NOT USABLE',
    RULE,
    `  Why:    ${reason}.`,
    '  Reason: Atlas stores ALL reports and ALL user state (the garbage collection policy and saved',
    '          settings) in S3-compatible object storage, and nowhere else. There is no local-disk,',
    '          in-memory or database fallback, so the server refuses to start without working S3.',
    ...(detail ? ['', `  S3 said: ${detail}`] : []),
    '',
    '  Required environment variables:',
    ...required.map(line),
    '',
    '  Optional environment variables:',
    ...optional.map(line),
    '',
    bad.length ? `  Fix these ${bad.length}: ${bad.join(', ')}` : '  Every variable is well-formed, so the values themselves are wrong; check them against the storage service.',
    '  See .env.example for a complete example and docs/server.md#required-s3-storage.',
    '  Exiting with status 2.', RULE, ''
  ].join('\n');
}
