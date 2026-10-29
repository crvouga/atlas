/**
 * @module Server configuration schema
 *
 * The schema of `atlas.server.json`, the file that configures `atlas serve` and `atlas dev`: where to listen, which
 * bearer tokens may read, publish or administer, and limits. Where reports are kept is not here: the server stores
 * everything in S3-compatible storage named by required `ATLAS_S3_*` environment variables, never in this file.
 * Every field has a default. Unlike the report format, unknown keys are an error, so a typo (or a removed `data`,
 * `backends` or `write` key) is reported instead of ignored. Flags and environment variables override the file.
 *
 * @see docs/deploying.md
 * @see docs/server.md
 */
import { z } from 'zod/v4';

/**
 * What a bearer token may do: `read` (look), `critic` (also publish critiques, and nothing else), `publish` (also upload
 * anything) or `admin` (also remove scratch objects).
 */
export const ServerRoleSchema = z.enum(['read', 'critic', 'publish', 'admin']);
/** One of the roles of `ServerRoleSchema`. */
export type ServerRole = z.infer<typeof ServerRoleSchema>;

/**
 * A bearer token: a name for logs, a role, and the token itself or the name of the environment variable that holds it
 * (exactly one of the two).
 */
export const ServerTokenSchema = z
  .strictObject({
    name: z.string().min(1).describe('Shown in logs, never the token itself'),
    role: ServerRoleSchema.describe('`read` may look. `critic` may also publish critiques (layers of producer `critic.*` whose parts are all of kind `critique`). `publish` may also upload. `admin` may also remove scratch objects'),
    token: z.string().min(12).optional().describe('The token. Prefer `tokenEnv`, so the file holds no secret'),
    tokenEnv: z.string().optional().describe('The name of the environment variable that holds the token')
  })
  .refine((value) => (value.token === undefined) !== (value.tokenEnv === undefined), { message: 'Give exactly one of token or tokenEnv' });

/**
 * The whole `atlas.server.json`: listening address, authentication, the viewer to serve, which layers take part in the report, refresh and heartbeat intervals, request limits and logging.
 */
export const ServerConfigSchema = z.strictObject({
  $schema: z.string().optional(),
  host: z.string().default('127.0.0.1').describe('Where to listen. 127.0.0.1 keeps it on this machine; 0.0.0.0 is every interface and needs tokens (or `auth.insecure`)'),
  port: z.number().int().min(0).max(65535).default(8080),
  auth: z
    .strictObject({
      tokens: z.array(ServerTokenSchema).default([]),
      anonymousRead: z.boolean().default(false).describe('Let anyone look without a token. Uploading still needs one'),
      insecure: z.boolean().default(false).describe('Allow listening on every interface with no tokens at all')
    })
    .default({ tokens: [], anonymousRead: false, insecure: false }),
  site: z.string().optional().describe('The built viewer. Default: the one shipped with Atlas, built on first start'),
  outlineBranch: z.string().optional().describe('Which branch\'s specs the report is laid over. Default main, then master, then the newest'),
  include: z
    .strictObject({
      branches: z.array(z.string()).optional().describe('Only layers recorded on these branches take part'),
      ignoreModified: z.boolean().optional().describe('Leave out layers from modified checkouts and unknown origins')
    })
    .default({}),
  catalog: z
    .strictObject({
      roots: z.array(z.string().refine((value) => value.includes('>'), { message: 'Write a root mapping as from>to, e.g. ">specs/" (paths under `from` are the same specs as paths under `to`)' })).default([]).describe('Root mappings `from>to` that relate spec paths a producer publishes to the paths the specs are recorded under (an empty `from` matches every path). The catalog health report applies them to every request, beside any `root` the request adds')
    })
    .default({ roots: [] }),
  refreshSeconds: z.number().min(1).default(10).describe('How often the backends are looked at for layers written by something other than this server'),
  limits: z
    .strictObject({
      maxObjectMiB: z.number().positive().default(256).describe('The largest object an upload may be'),
      maxJsonMiB: z.number().positive().default(32).describe('The largest JSON body (a manifest, a checks request)'),
      maxStreams: z.number().int().positive().default(500).describe('Viewers that may be connected for live updates at once')
    })
    .default({ maxObjectMiB: 256, maxJsonMiB: 32, maxStreams: 500 }),
  runTimeoutSeconds: z.number().min(10).max(3600).default(30).describe('Interrupt a live run after this many seconds without a producer heartbeat'),
  runStallSeconds: z.number().min(0).max(86400).default(900).describe('Interrupt after this many seconds without test progress; 0 disables progress expiry'),
  heartbeatSeconds: z.number().min(1).default(15).describe('How often a live connection is touched, so proxies keep it open'),
  log: z.boolean().default(true).describe('One JSON line per request')
});
/** A server configuration after parsing, with every default applied. */
export type ServerConfig = z.output<typeof ServerConfigSchema>;
/** A server configuration as written, before defaults are applied. */
export type ServerConfigInput = z.input<typeof ServerConfigSchema>;

/** Report and live-run settings editable by an admin. Storage, authentication, listeners and the served site stay deployment-owned. Replaces the saved portion of the user state; omitted fields use defaults after restart. */
export const ServerEditableSettingsSchema = ServerConfigSchema.pick({ outlineBranch: true, include: true, refreshSeconds: true, limits: true, heartbeatSeconds: true, runTimeoutSeconds: true, runStallSeconds: true, log: true }).partial();

/** The settings API response: editable configuration saved in the user state in S3, active values, concurrency revision and restart/precedence guidance. Authentication token settings are excluded. */
export const ServerSettingsSnapshotSchema = z.looseObject({
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  settings: ServerEditableSettingsSchema,
  active: ServerEditableSettingsSchema,
  restartRequired: z.boolean(),
  precedence: z.string()
});
