import { z } from 'zod/v4';

/**
 * `atlas.server.json`: how a project's Atlas server runs. Everything has a default, so an empty file (or no
 * file) is a working server that keeps its data on its own disk. Flags and environment variables override it
 * (docs/deploying.md). Unknown keys are an error here, unlike in the report format: a typo in a config should be
 * said, not ignored.
 */
export const ServerRoleSchema = z.enum(['read', 'publish', 'admin']);
export type ServerRole = z.infer<typeof ServerRoleSchema>;

export const ServerBackendSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/).describe('Lowercase letters, digits and hyphens. Names where a result came from'),
  label: z.string().optional(),
  url: z.string().min(1).describe('A folder, s3://bucket/prefix, r2://, gs://, or another Atlas server (https://…)'),
  write: z.boolean().optional().describe('Uploads go here instead of the data folder. At most one backend is the write target')
});

export const ServerTokenSchema = z
  .strictObject({
    name: z.string().min(1).describe('Shown in logs, never the token itself'),
    role: ServerRoleSchema.describe('`read` may look. `publish` may also upload. `admin` may also remove scratch objects'),
    token: z.string().min(12).optional().describe('The token. Prefer `tokenEnv`, so the file holds no secret'),
    tokenEnv: z.string().optional().describe('The name of the environment variable that holds the token')
  })
  .refine((value) => (value.token === undefined) !== (value.tokenEnv === undefined), { message: 'Give exactly one of token or tokenEnv' });

export const ServerConfigSchema = z.strictObject({
  $schema: z.string().optional(),
  host: z.string().default('127.0.0.1').describe('Where to listen. 127.0.0.1 keeps it on this machine; 0.0.0.0 is every interface and needs tokens (or `auth.insecure`)'),
  port: z.number().int().min(0).max(65535).default(8080),
  data: z.string().default('./atlas-data').describe('The folder that is the default backend and the default write target: layers, specs and runs live here'),
  backends: z.array(ServerBackendSchema).default([]).describe('Further backends, read together with the data folder: S3, another server, a device lab'),
  write: z.string().optional().describe('The id of the backend uploads go to. Default: the data folder'),
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
  refreshSeconds: z.number().min(1).default(10).describe('How often the backends are looked at for layers written by something other than this server'),
  limits: z
    .strictObject({
      maxObjectMiB: z.number().positive().default(256).describe('The largest object an upload may be'),
      maxJsonMiB: z.number().positive().default(32).describe('The largest JSON body (a manifest, a checks request)'),
      maxStreams: z.number().int().positive().default(500).describe('Viewers that may be connected for live updates at once')
    })
    .default({ maxObjectMiB: 256, maxJsonMiB: 32, maxStreams: 500 }),
  heartbeatSeconds: z.number().min(1).default(15).describe('How often a live connection is touched, so proxies keep it open'),
  log: z.boolean().default(true).describe('One JSON line per request')
});
export type ServerConfig = z.output<typeof ServerConfigSchema>;
export type ServerConfigInput = z.input<typeof ServerConfigSchema>;
