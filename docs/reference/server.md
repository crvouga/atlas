# Reference: server

The Atlas server: the API results are uploaded to, the live report, and the viewer on one host. Import path `@crvouga/atlas/server`.

> Generated from the doc comments of `packages/server/src` by `bun run docs`. Do not edit: change the comment next to the code.

### The Atlas server application

Source: `packages/server/src/app.ts`

`createAtlasServer` is the whole of a project's Atlas as one `fetch` handler: the API results are uploaded to, the live
report every viewer is shown, the gate, the server-sent event stream, the specs and runs the viewer reads, the viewer
itself, and the server's own description (`/api/openapi.json`, `/llms.txt`). What it knows lives in its backends (by
default a folder on its own disk), so replacing it loses nothing. Every error leaves as an RFC 9457 problem document; every
route is described in `openapi.ts` (a test holds the two together).

See docs/server.md

#### `AtlasServerOptions`

```ts
export type AtlasServerOptions = {
  /** Every backend, read together. */
  readonly backends: readonly BackendInput[];
  /** The id of the backend uploads go to. */
  readonly write: string;
  /** Operational lease storage. Defaults to the write backend; HTTP relays use their own local store. */
  readonly liveStore?: ObjectStore;
  readonly tokens?: readonly ResolvedToken[];
  readonly anonymousRead?: boolean;
  /** The built viewer. Without it, only the API is served. */
  readonly site?: string;
  readonly outlineBranch?: string;
  readonly include?: (layer: LayerHeader) => boolean;
  readonly refreshMs?: number;
  readonly limits?: { readonly maxObjectMiB?: number; readonly maxJsonMiB?: number; readonly maxStreams?: number };
  readonly heartbeatMs?: number;
  /** Producer lease timeout; default 30 seconds. */
  readonly runTimeoutMs?: number;
  /** Maximum time without progress; default 15 minutes, 0 disables. */
  readonly runStallMs?: number;
  readonly log?: (line: Record<string, unknown>) => void;
  readonly now?: () => number;
  readonly version?: string;
  /** Admin configuration persistence, supplied by atlas serve; kept in S3. Changes apply on restart. */
  readonly settings?: ServerSettings;
  /** The garbage collection policy, kept in S3 and read from there each time the server collects. Supplied by atlas serve. */
  readonly gc?: GcSettings;
  /** How often (ms) the server checks whether a garbage collection pass is due. Default 60 000; for tests. */
  readonly gcCheckMs?: number;
  /** Extra runtime configuration written into the page. */
  readonly page?: Record<string, unknown>;
};
```

What the server is built from: its `backends` (read together) and which one takes uploads (`write`), `tokens`, the built `site`, the report's filters (`include`, `outlineBranch`), `limits`, timings, `log`, and `now` for tests.

#### `AtlasServer`

```ts
export type AtlasServer = {
  readonly fetch: (request: Request) => Promise<Response>;
  readonly index: ReportIndex;
  readonly events: EventHub;
  /** The routes the server answers, as registered: what the OpenAPI document must describe (a test holds the two together). */
  readonly routes: readonly { readonly method: string; readonly path: string }[];
  /** Resolves when the first pass over the backends is done. */
  readonly ready: Promise<void>;
  /**
   * Apply a garbage collection policy to this project's upload backend. Deletes only layers the report has read and
   * that no longer decide any result, older than the policy allows and beyond its `keepLatest`. With `dryRun` it only
   * counts. Never throws: a failure is the `error` of the returned run.
   */
  collectGarbage(policy: GcPolicy, options: { readonly dryRun: boolean; readonly project: string }): Promise<GcRun>;
  /** Stop refreshing and end every live connection. */
  close(): void;
};
```

A running server application: `fetch` (serve requests), `index` (the live report), `events` (the viewers), `routes` (what it answers), `ready` (the first pass over the backends is done) and `close`.

#### `createAtlasServer`

```ts
export function createAtlasServer(options: AtlasServerOptions): AtlasServer
```

The whole of a project's Atlas on one process: the API that results are uploaded to, the live report every
viewer is shown, and the viewer itself. All of it is under one host, `/api` for the API and `/` for the page.
What it knows lives in its backends (by default a folder on its own disk), so replacing it loses nothing.

### Authentication and roles

Source: `packages/server/src/auth.ts`

Who is asking, and may they. Tokens have a role (`read` < `publish` < `admin`) and are compared in constant time. Reading
accepts a Bearer token or the browser's sign-in box (any user name, the token as the password); changing anything needs
the Bearer header, because a browser sends the sign-in box's credentials to any page that asks, which would let another
site upload with them. A server with no tokens is open, and refuses to listen beyond this machine unless told it may.

#### `Identity`

```ts
export type Identity = {
  readonly name: string;
  readonly role: ServerRole;
  /** `bearer` for a token in a header, `basic` for the browser's sign-in box, `none` for a server with no tokens. */
  readonly via: 'bearer' | 'basic' | 'none';
};
```

Who a request is: the token's `name` (never the token), its `role`, and how it was presented (`bearer`, `basic`, or `none` for an open server or an anonymous reader).

#### `Verdict`

```ts
export type Verdict =
  | { readonly ok: true; readonly identity: Identity }
  | { readonly ok: false; readonly status: 401 | 403; readonly message: string };
```

The answer to "may this request do that": allowed with the identity, or refused with the status to answer (`401` no or unknown token, `403` a known token that may not) and a message that says what to do.

#### `createAuth`

```ts
export function createAuth(tokens: readonly ResolvedToken[], anonymousRead: boolean)
```

Who is asking, and may they. A server with no tokens is open (and refuses to listen beyond this machine
unless told it may). With tokens, every request must carry one, except where `anonymousRead` lets anyone look.

Changing anything needs a token in an `Authorization: Bearer` header, never the browser's sign-in box: the
browser sends that box's credentials on its own to any page that asks, which would let another site upload
with them.

#### `Auth`

```ts
export type Auth = ReturnType<typeof createAuth>;
```

The authentication of one server: `identify` (who is this), `check` (may they, for a needed role) and `open` (the server has no tokens).

### Server configuration

Source: `packages/server/src/config.ts`

Loads how the server runs: the settings saved in S3 (the user state), then `atlas.server.json`, then environment
variables, then flags, each overriding the last, checked against `ServerConfigSchema` and resolved (storage read from
the required `ATLAS_S3_*` variables, tokens read). Storage is never optional: all reports and user state live in
S3-compatible object storage, so missing or invalid storage variables are an `S3ConfigError` naming every variable.
Every other mistake is a `ConfigError` that says what to change, and a server that would listen beyond this machine
with no tokens refuses to start. `SERVER_SETTINGS` documents every setting once; the table in docs/server.md is
generated from it and a test proves each row.

See docs/server.md#configuration

#### `ResolvedToken`

```ts
export type ResolvedToken = { readonly name: string; readonly role: ServerRole; readonly token: string };
```

A token as the server holds it: the `name` it is shown under in logs, its `role`, and the secret `token`.

#### `ResolvedServerConfig`

```ts
export type ResolvedServerConfig = Omit<ServerConfig, 'auth'> & {
  /** The S3-compatible storage that holds every report and all user state. Required; there is no other. */
  readonly s3: S3Config;
  readonly tokens: readonly ResolvedToken[];
  readonly anonymousRead: boolean;
  readonly insecure: boolean;
  /** Where the config came from, for the first line of the log. */
  readonly configFile: string | null;
};
```

The configuration the server runs with: the file, then the environment, then the flags, checked and resolved.

#### `ConfigError`

```ts
export class ConfigError extends Error {}
```

A configuration that cannot be used. The message says what to change; `atlas serve` prints it and exits 2.

#### `SERVER_FLAGS`

```ts
export const SERVER_FLAGS: readonly string[]
```

Every flag `atlas serve` accepts, with its `--`.

#### `ServerSetting`

```ts
export type ServerSetting = {
  /** What it sets, in words. */
  readonly summary: string;
  /** The key in `atlas.server.json` (dotted for nested keys). */
  readonly key: string;
  /** The command-line flag, with its value placeholder, or null when there is none. */
  readonly flag: string | null;
  /** The environment variables, the first that is set wins; empty when there are none. */
  readonly env: readonly string[];
  /** What it is when nothing sets it. */
  readonly default: string;
  /**
   * How the documentation is held to the code: giving `value` through the environment variable (or the flag) must make
   * `read` of the resolved configuration equal `expected`. A test runs every setting's example both ways.
   */
  readonly example: { readonly value: string; readonly read: (config: ResolvedServerConfig) => unknown; readonly expected: unknown };
};
```

One setting of the server as an operator meets it: the config key, the flag, the environment variables, and what it does.

#### `SERVER_SETTINGS`

```ts
export const SERVER_SETTINGS: readonly ServerSetting[]
```

Every setting that can be given by flag or environment, documented once. `docs/server.md` renders its table from
this list, and a test proves each row: its example, through the flag and through the environment, changes the
configuration as the row says. A setting added to the loader without a row here is therefore not documented in the
table; one documented here that the loader ignores fails the test.

#### `SERVER_USAGE`

```ts
export const SERVER_USAGE = …
```

The text `atlas serve --help` prints. Also the source of the `atlas serve` section of `docs/reference/cli.md`.

#### `loadServerConfig`

```ts
export function loadServerConfig(argv: readonly string[], env: Env, cwd: string, read: (file: string) => string = file => readFileSync(file, 'utf8'), saved: Record<string, unknown> = {}): ResolvedServerConfig
```

Read the file named by `--config`/`ATLAS_CONFIG`, or `atlas.server.json` in the folder if there is one, lay the
environment and then the flags over it, and check the result. `saved` is the settings kept in S3 (the user state),
the lowest layer. Every problem is a {@link ConfigError} that says what to change; missing or invalid storage
variables are an `S3ConfigError` that names all of them, and are checked first.

#### `assertSafeToListen`

```ts
export function assertSafeToListen(config: Pick<ResolvedServerConfig, 'host' | 'tokens' | 'insecure'>): void
```

A server that anyone on the network can upload to must say who may.

### `atlas dev`

Source: `packages/server/src/dev.ts`

Runs the same server as `atlas serve` on a port of its own, with the client's Vite dev server in front of it. Vite proxies
`/api` (server-sent events included) to the server and writes the same address book into the page, so the browser, the
uploaders and the client all use one host, exactly as in production, and a change to the client shows at once.

#### `DEV_USAGE`

```ts
export const DEV_USAGE = …
```

The text `atlas dev --help` prints. Also the source of the `atlas dev` section of `docs/reference/cli.md`.

#### `devMain`

```ts
export async function devMain(argv: readonly string[], io: ServeIo): Promise<number>
```

`atlas dev`.

### Server-sent events

Source: `packages/server/src/events.ts`

What the server tells every connected viewer the moment it happens. A viewer that misses some (a dropped connection, a
laptop that slept) loses nothing: report events announce changes, run events carry bounded progress snapshots, and a viewer reads authoritative state again
when it reconnects. `EventHub` encodes each event once for all viewers, sends a named `ping` every heartbeat so proxies
keep the connection and a quiet server is told apart from a dead one, refuses past a maximum number of viewers (they poll
instead), and lets go of a viewer that has stopped reading rather than hold its backlog.

See docs/server.md#streaming

#### `EventName`

```ts
export type EventName = 'hello' | 'report' | 'atlas:change' | 'run' | 'projects';
```

The events the server publishes: `hello` (sent first to a new viewer), `report` (layers arrived) `atlas:change` (specs or runs changed), `run` (a bounded live lease snapshot), and `projects` (project discovery changed). `ping` is the heartbeat, sent by the hub itself.

#### `EventHub`

```ts
export class EventHub
```

The viewers connected to `/api/events` and how to reach them all. One hub per server.

- `get count(): number { return this.#subscribers.size; }` — How many viewers are connected right now.
- `publish(name: EventName, data: unknown): void` — Tell every viewer. `data` is JSON.
- `stream(request: Request, greeting: () => unknown): Response` — A stream for one viewer, starting with `hello` (what `greeting` returns). It ends when the viewer goes.
- `close(): void` — End every stream, for shutting down.

### HTTP host for a fetch handler

Source: `packages/server/src/host.ts`

`listen` serves any `(Request) => Promise<Response>` over HTTP: with `Bun.serve` when running on Bun, with a `node:http`
bridge (streaming bodies in and out, so server-sent events work) everywhere else. The server's behaviour is the same on
both; `bun run release:smoke` proves it under each. Bodies over `maxBodyBytes` are refused by the runtime before the
handler sees them.

#### `RunningServer`

```ts
export type RunningServer = {
  readonly port: number;
  readonly url: string;
  /** Stop accepting, let requests in flight finish for up to `graceMs`, then end what is left. */
  close(graceMs?: number): Promise<void>;
};
```

A server that is listening: the `port` it got (useful when asked for `0`), its `url`, and `close`.

#### `ListenOptions`

```ts
export type ListenOptions = {
  readonly port: number;
  readonly host: string;
  /** The largest request body to read, in bytes. */
  readonly maxBodyBytes: number;
};
```

Where to listen (`port`, `host`) and the largest request body the runtime will accept.

#### `listen`

```ts
export async function listen(handler: Handler, options: ListenOptions): Promise<RunningServer>
```

Serve a fetch handler. On Bun, which is what Atlas is made for, that is `Bun.serve`: one native server for the
API, the live streams and the page. On Node it is the same handler behind `node:http`, so the package still runs
where Bun is not installed.

### Server package entry point (`@crvouga/atlas/server`)

Source: `packages/server/src/index.ts`. Import: `@crvouga/atlas/server`

Everything needed to run the Atlas server from code: `createAtlasServer` (a `fetch` handler with the live report, uploads
and the viewer), `listen` (serve it over HTTP on Bun or Node), `loadServerConfig` (the file, the environment and the flags
as one checked configuration), `serveMain` (what `atlas serve` runs), `EventHub`, `createAuth`, and the upload checks.
`atlas serve` keeps everything in S3: `resolveS3Config` reads the required `ATLAS_S3_*` variables, `userStateStore` the user
state in the bucket, and `storedSettings` serves the settings page from it.

See docs/server.md

### live-runs.ts

Source: `packages/server/src/live-runs.ts`

@module Live run leases
Tracks producer heartbeats independently of progress, publishes completed checks incrementally, and persists
bounded run summaries. A server restart interrupts outstanding leases rather than inventing continued progress.

#### `LiveRunError`

```ts
export class LiveRunError extends Error
```

A refused run update: 403 another publisher, 404 unknown run, 409 stale/terminal run, or 429 capacity.

#### `LiveRuns`

```ts
export class LiveRuns
```

One server's live feed. Heartbeats never create result layers. Persisted summaries contain at most 20 recent
checks and 10 active checks; completed results live in ordinary immutable layers. Leases expire by server time.

**Example**

```ts
const live = new LiveRuns({ store, timeoutMs: 30_000, stalledMs: 900_000, onChange: () => {}, onLayer: async () => {} });
```

- `readonly ready: Promise<void>;` — Resolves after restoring summaries and interrupting leases left by a previous server process.
- `async list(): Promise<LiveRun[]>` — Read the most recent 50 summaries. Progress detail and counters are already bounded and cached.
- `async start(input: Start, owner: string): Promise<LiveRun>` — Register one producer lease. Retrying an identical start is idempotent.
- `async heartbeat(id: string, owner: string): Promise<void>` — Renew liveness by server receipt time, independently of whether a test made progress.
- `async update(id: string, input: Update, owner: string): Promise<LiveRun>` — Apply one ordered progress batch and publish its completed checks before acknowledging it.
- `async sweep(): Promise<void>` — Expire silent producers and optional progress stalls. Heartbeats cannot revive an expired run.

### llms.txt of a running server

Source: `packages/server/src/llms.ts`

The plain-text guide ([llms.txt](https://llmstxt.org)) a server serves about itself at `GET /llms.txt`, for an AI
agent that was handed nothing but the server's address. It is written from this server's own settings (its
address, whether it needs a token), so what it says is true of the server that says it, and it points at the
machine-readable description (`/api/openapi.json`) rather than repeating it.

#### `LlmsContext`

```ts
export type LlmsContext = {
  /** The address clients use, such as `https://atlas.example.com`, no trailing slash. */
  readonly url: string;
  /** True when the server has no tokens: anyone who can reach it may upload. */
  readonly open: boolean;
  /** The id of the backend uploads go to. */
  readonly write: string;
};
```

What the guide says about the server that serves it.

#### `llmsTxt`

```ts
export function llmsTxt(context: LlmsContext): string
```

The guide for one server, Markdown. Stable in structure: an agent may read it by its headings.

### `atlas serve`

Source: `packages/server/src/main.ts`

Starts the Atlas server from its configuration. Storage comes first and is not optional: the required `ATLAS_S3_*`
variables are checked (every problem listed together), the bucket is proven reachable and writable, and the user
state (garbage collection policy and saved settings) is read from it, all before anything listens. Any failure prints
a banner naming every variable and exits 2; there is no fallback to a local folder, memory or a database. Then it
finds or builds the client, listens at once (so a liveness probe finds the process while a large bucket is still being
read), and stops cleanly on SIGTERM or SIGINT. `serverOptionsOf` is shared with `atlas dev`, so the two run the same server.

See docs/server.md#run-it

#### `ServeIo`

```ts
export type ServeIo = { readonly out: (text: string) => void; readonly env?: Env; readonly cwd?: string; readonly signal?: AbortSignal; readonly fetch?: typeof fetch };
```

What `serveMain` and `devMain` are given besides arguments: where output goes, and, for tests and embedding, the environment, working directory, the `fetch` S3 requests are sent with, and an `AbortSignal` that stops the server (otherwise SIGTERM and SIGINT do).

#### `S3_BACKEND_ID`

```ts
export const S3_BACKEND_ID = …
```

The id of the one backend: the S3 bucket.

#### `openConfiguredBackends`

```ts
export function openConfiguredBackends(config: ResolvedServerConfig, fetchImpl?: typeof fetch): (BackendInput & { readonly writable: boolean })[]
```

Open the S3 bucket named by a configuration, with exactly the credentials it gives (no ambient AWS lookup). Nothing is contacted yet.

#### `serverOptionsOf`

```ts
export function serverOptionsOf(config: ResolvedServerConfig, backends: ReturnType<typeof openConfiguredBackends>, log?: (line: Record<string, unknown>) => void): AtlasServerOptions
```

What `createAtlasServer` is given for a configuration: `atlas serve` and `atlas dev` run the same server.

#### `connectStorage`

```ts
export async function connectStorage(config: ResolvedServerConfig, env: Env, io: Pick<ServeIo, 'fetch'>): Promise<{ readonly backends: ReturnType<typeof openConfiguredBackends>; readonly stored: StoredUserState } | { readonly failure: string }>
```

Check the storage and read the user state, in that order, with the failure banner for each way it can go wrong.
Returns the opened backends and the state, or the text to print before exiting 2.

#### `serveMain`

```ts
export async function serveMain(argv: readonly string[], io: ServeIo): Promise<number>
```

`atlas serve`. Runs until it is told to stop; returns the exit code.

### OpenAPI document of the Atlas server

Source: `packages/server/src/openapi.ts`

The server's HTTP API described as an OpenAPI 3.1 document (JSON Schema 2020-12 inside), generated from the
operation table below and the Zod schemas of `packages/schema/src/api.ts`. It is served at `GET /api/openapi.json`,
shipped as `@crvouga/atlas/openapi.json`, and committed as `packages/server/openapi.json` (`bun run docs` rewrites
it; a test fails when it differs). Any OpenAPI tool can generate a client, a mock or a test suite from it.

The table is held to the code by a test: every route the server registers must have an operation here and every
operation here must be a route the server registers. Adding a route without describing it fails the build.

Stability: this API only grows within `API_VERSION`: optional parameters, optional response fields, new
operations and new events. See AGENTS.md ("The server is a living application").

#### `API_VERSION`

```ts
export const API_VERSION = …
```

The version of the API described, `major.minor.patch`: the minor grows when an operation or field is added, the major never within `/api`.

#### `Role`

```ts
export type Role = 'none' | 'read' | 'publish' | 'admin';
```

Who may call an operation: `none` (anyone), or the least role that may (`read` < `publish` < `admin`).

#### `Operation`

```ts
export type Operation = {
  /** The route as Hono registers it, `METHOD /path` (`:name` for a parameter, `*` for the rest of the path). */
  readonly route: string;
  /** The same route as OpenAPI writes it, `/path/{name}`. */
  readonly path: string;
  readonly operationId: string;
  readonly tag: string;
  readonly summary: string;
  /** What it does and how to use it, written for a client that has read nothing else (Markdown). */
  readonly description: string;
  readonly role: Role;
  readonly parameters?: readonly Param[];
  readonly body?: Body;
  readonly responses: Readonly<Record<string, Response>>;
};
```

One operation of the API, and the route the server registers for it.

#### `OPERATIONS`

```ts
export const OPERATIONS: readonly Operation[]
```

Every node operation and the same stable report protocol inside each project namespace.

#### `NOT_OPERATIONS`

```ts
export const NOT_OPERATIONS: ReadonlyMap<string, string>
```

Routes the server registers that are not operations of this API, each with the reason. The coverage test skips
these and only these.

#### `openApiDocument`

```ts
export function openApiDocument(options: { readonly serverUrl?: string } = {}): Record<string, unknown>
```

The OpenAPI 3.1 document of the API. `serverUrl` (such as `https://atlas.example.com`) is written into `servers` when given.

### Problem documents

Source: `packages/server/src/problem.ts`

Every error the server answers is an [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457) problem document
(`application/problem+json`): `type`, `title`, `status`, `detail`, and `error`, a copy of `detail` for clients
written before the standard was adopted. Handlers answer however is natural (`{ error }`); one place,
{@link asProblem}, makes every error response a problem document, so none can differ.

#### `problemResponse`

```ts
export function problemResponse(status: number, detail: string, headers: Record<string, string> = {}): Response
```

A response for a problem, built directly (used where no handler is involved, such as authentication).

#### `asProblem`

```ts
export async function asProblem(response: Response): Promise<Response>
```

The response made into a problem document when it is an error (status 400 or more) with a JSON body naming an
`error`. Headers (`WWW-Authenticate`, `Retry-After`, `Allow`) and any other body fields are kept. Anything else,
including every success, is returned as it is.

### projects.ts

Source: `packages/server/src/projects.ts`

@module Project routing
One node serves isolated project stores through the same authenticated API. Legacy unqualified requests address
the default project; named projects use scoped stores without rewriting uploaded report documents.

#### `projectServer`

```ts
export function projectServer(options: AtlasServerOptions, create: (options: AtlasServerOptions) => AtlasServer): AtlasServer
```

Wrap the single-project protocol in project selection. Auth, upload validation and composition stay identical.

### settings-page.ts

Source: `packages/server/src/settings-page.ts`

@module Settings page
The administrator's React and Mantine entry point, bundled lazily for API-only servers too.
Credentials remain in page memory; the settings API owns authorization and validation.

#### `SETTINGS_PAGE`

```ts
export const SETTINGS_PAGE = …
```

Document shell for the shared React settings UI. No configuration or credentials are embedded.

#### `renderSettingsPage`

```ts
export function renderSettingsPage(): Promise<string>
```

Render the settings UI with the same provider and theme as the viewer. Bundle once on first request,
without a prebuilt viewer, CDN, configuration data, or import-time work. A failed build can be retried.

**Example**

```ts
const html = await renderSettingsPage();
```

### settings.ts

Source: `packages/server/src/settings.ts`

@module Persisted server settings
The settings page edits two things, and both are kept in the user state document in S3 (`server/state.json`), never on
the server's disk: the report and live-run settings (applied at the next start, below the configuration file,
the environment and the flags in precedence) and the garbage collection policy (read by the server each time it
collects). Storage and authentication are deployment-owned and are not editable here.

#### `SettingsSnapshot`

```ts
export type SettingsSnapshot = { readonly revision: string; readonly settings: Record<string, unknown>; readonly active: Record<string, unknown>; readonly restartRequired: boolean; readonly precedence: string };
```

The saved editable settings, the active settings and a revision for optimistic concurrency. Authentication token settings are excluded.

#### `ServerSettings`

```ts
export type ServerSettings = { read(): Promise<SettingsSnapshot>; save(settings: unknown, revision: string): Promise<SettingsSnapshot> };
```

Storage for the admin API; saving is serialised and refuses a stale revision.

#### `GcSettings`

```ts
export type GcSettings = {
  /** The policy in S3 with its revision and the last passes. */
  read(): Promise<GcSnapshot>;
  /** Validates and saves a policy; a stale `revision` is refused. */
  save(policy: unknown, revision: string): Promise<GcSnapshot>;
  /** The policy in S3 right now, or `null` when none has been saved. Read from S3 every time. */
  policy(): Promise<GcPolicy | null>;
  /** Remembers the result of a pass, for `read`. */
  record(runs: readonly GcRun[]): void;
};
```

The garbage collection policy as the admin API and the collector see it.

#### `storedSettings`

```ts
export function storedSettings(config: ResolvedServerConfig, argv: readonly string[], env: Readonly<Record<string, string | undefined>>, cwd: string, userState: UserStateStore): { settings: ServerSettings; gc: GcSettings }
```

The settings and garbage collection policy kept in `userState` (S3). Validates a settings change against the
whole deployment (file, environment and flags) before saving, so what is saved can start. Never moves report data.

**Example**

```ts
const { settings, gc } = storedSettings(config, argv, process.env, process.cwd(), userStateStore(store));
```

### Finding the client

Source: `packages/server/src/site.ts`

Locates the built client a server serves: the folder named by `--site`, `./atlas-site`, or one built once into the user's
cache from the client source shipped in the package (`atlas client build --no-data`). The build is the same for every
project because the server writes its own address book into the page, so it is built at most once per installed version.

#### `clientMain`

```ts
export async function clientMain(argv: readonly string[]): Promise<number>
```

Run the Atlas client build tools. Returns the child's exit code; throws when the client is missing.

#### `visualizerRoot`

```ts
export function visualizerRoot(): string | null
```

Where the client's source is, in this repository and in an installed package.

#### `buildSite`

```ts
export async function buildSite(out: string, log: (text: string) => void): Promise<boolean>
```

Build the client once into a folder, for a server that was not given a prebuilt one.

#### `findSite`

```ts
export async function findSite(named: string | undefined, cwd: string, log: (text: string) => void): Promise<string | null>
```

The client to serve: the one named, a build beside the project, or one built into the user's cache.

### Required S3 storage configuration

Source: `packages/server/src/storage.ts`

The Atlas server keeps ALL reports and ALL user state (the garbage collection policy and saved settings) in
S3-compatible object storage, and nowhere else: no local folder, no memory, no database. So the storage settings
are required, come only from environment variables (they hold secrets), and have no defaults for where or as whom
to connect. `resolveS3Config` checks every variable in one pass and reports all the problems together;
`startupFailure` renders them as a banner that cannot be missed. `S3_VARIABLES` is the single description of the
variables: the banner, `.env.example` and the documentation table are all made from it.

See docs/server.md#required-s3-storage

#### `S3Variable`

```ts
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
```

One environment variable of the storage configuration.

#### `S3_VARIABLES`

```ts
export const S3_VARIABLES: readonly S3Variable[]
```

Every variable that configures storage, required ones first.

#### `S3Config`

```ts
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
```

The storage settings once checked: everything needed to open the bucket, with credentials spelled out.

#### `S3Finding`

```ts
export type S3Finding = { readonly variable: S3Variable; readonly status: 'ok' | 'missing' | 'invalid' | 'unset'; readonly problem?: string };
```

The state of one variable after checking, for the banner.

#### `S3ConfigError`

```ts
export class S3ConfigError extends Error
```

The storage configuration could not be used. `findings` has every variable, not only the first problem.

#### `inspectS3Env`

```ts
export function inspectS3Env(env: Env): readonly S3Finding[]
```

Looks at every storage variable and returns what each is. Nothing here throws.

#### `resolveS3Config`

```ts
export function resolveS3Config(env: Env): S3Config
```

The storage settings from the environment. Throws {@link S3ConfigError}, whose message lists every variable and
marks each missing or invalid one, when any required variable is absent or any set variable is malformed.

**Example**

```ts
const s3 = resolveS3Config(process.env);
```

#### `describeS3`

```ts
export const describeS3 = …
```

Where the storage is, without a secret: what the log may say.

#### `startupFailure`

```ts
export function startupFailure(findings: readonly S3Finding[], reason: string, detail?: string): string
```

The banner printed when the server cannot start because of storage: why storage is required, then EVERY variable by
name with what is wrong with it. Values of secrets are never printed.

### Store protocol routes

Source: `packages/server/src/store-api.ts`

The `ObjectStore` interface over HTTP at `/api/store`: list keys under `layers/`, read and probe an object, upload one
(checked by `validateUpload`, immutable once stored) and remove a scratch object. This is what `httpStore` talks to. An
upload is told to the report only after it is stored, and a layer's manifest, parsed while it was checked, is handed on so
it is not read again. Everything read is served as untrusted bytes (never sniffed, never run).

See docs/server.md#the-store-protocol

#### `StoreApiOptions`

```ts
export type StoreApiOptions = {
  readonly store: ObjectStore;
  readonly auth: Auth;
  readonly maxObjectBytes: number;
  /** Told after something was uploaded: its key, and what kind of thing it is. */
  readonly onStored: (key: string, kind: string, layer?: ReportLayer) => void | Promise<void>;
};
```

What the store routes need: the `store` they read and write, the `auth` that decides who may, the largest object accepted, and `onStored`, told after each upload with its key, its kind and (for a layer catalog entry) the layer already parsed.

#### `readLimited`

```ts
export async function readLimited(request: Request, limit: number): Promise<Uint8Array>
```

Read a request body, refusing as soon as it is over the limit rather than after holding it all.

#### `storeApi`

```ts
export function storeApi(options: StoreApiOptions)
```

The Hono app of the store protocol, to be mounted at `/api/store`. Reads need role `read`; writes need `publish` through a Bearer token.

### User state in S3

Source: `packages/server/src/user-state.ts`

Reads and writes the user state document (`UserStateSchema`: the garbage collection policy and the saved settings) as
one JSON object at `server/state.json` in the object store, which in a running server is the S3 bucket. This is the
only place user state is kept: not a file, not a database, not the browser. A missing object is an empty state
("nothing chosen yet"); an object that cannot be read or does not match the schema is an error that stops the
server from starting and is never overwritten, so a transient or corrupt read can never silently reset anyone's choices.
Saving refuses a stale revision (the SHA-256 of the stored text), serialised within this process. An object store has
no conditional writes, so two servers saving at the same instant could still race; run one server per bucket.

See docs/server.md#user-state-and-garbage-collection

#### `USER_STATE_KEY`

```ts
export const USER_STATE_KEY = …
```

Where the user state lives, relative to the store (the bucket plus `ATLAS_S3_PREFIX`).

#### `StoredUserState`

```ts
export type StoredUserState = { readonly state: UserState; readonly revision: string; readonly exists: boolean };
```

The user state as stored: the document, its `revision` and whether the object `exists` yet.

#### `UserStateError`

```ts
export class UserStateError extends Error {}
```

Raised when the stored user state cannot be trusted. The message says where it is and what to do.

#### `UserStateStore`

```ts
export type UserStateStore = {
  /** Reads the document. Throws {@link UserStateError} when it exists but is unreadable or invalid. */
  read(): Promise<StoredUserState>;
  /**
   * Applies `change` to the stored state and writes the result, if `revision` is still the stored one. Throws a
   * `UserStateError` starting with "Settings changed" for a stale revision.
   */
  update(revision: string, change: (state: UserState) => UserState): Promise<StoredUserState>;
};
```

The user state of one server: read it, or change it against the revision that was read.

#### `userStateStore`

```ts
export function userStateStore(store: ObjectStore): UserStateStore
```

The user state kept in `store` at {@link USER_STATE_KEY}.

**Example**

```ts
const userState = userStateStore(s3Backend.store);
const { state } = await userState.read();
```

### Upload validation

Source: `packages/server/src/validate.ts`

What the server checks before it stores an object, so one bad upload cannot corrupt the report for everyone: the key is
one Atlas writes (`classify`), a layer's content hashes to its id, blobs and spec files are what their names say, a
document's files and a catalog entry's document are already there (so nothing half-uploaded is visible), and a run
passed its privacy scan. Refusals are `Refusal`s carrying the HTTP status to answer. Layers are immutable: the same
bytes again are fine, other bytes under the same key are not.

See docs/server.md#what-the-server-refuses

#### `Refusal`

```ts
export class Refusal extends Error
```

Why an upload was not accepted. The status is what to answer.

#### `UploadKind`

```ts
export type UploadKind = (typeof KINDS)[number]['kind'];
```

What a key names: `layer`, `layer-catalog`, `blob`, `spec-body`, `spec-set`, `spec-catalog`, `run-manifest`, `run-catalog`, `run-file` or `scratch` (what `doctor` writes to try the store).

#### `validKey`

```ts
export function validKey(key: string): boolean
```

Is this a key a client may name? No traversal, no odd characters, and under `layers/`.

#### `classify`

```ts
export function classify(key: string): { kind: UploadKind; id: string | null } | null
```

What kind of object a key names and the id inside it (the layer id, the digest…), or null when it is not a key Atlas writes.

#### `isCatalog`

```ts
export const isCatalog = …
```

Catalog entries are what makes something visible, so they are the last thing a client writes.

#### `validateUpload`

```ts
export async function validateUpload(key: string, bytes: Uint8Array, store: ObjectStore, parsedLayer?: (layer: ReportLayer) => void): Promise<UploadKind>
```

Check an object before it is stored. What is checked is what would otherwise corrupt the report for everyone:
a layer whose content is not its name, a catalog entry for something not there yet, a run that failed its
privacy scan. Everything that is checked is checked cheaply, from the bytes in hand.

#### `sameBytes`

```ts
export async function sameBytes(store: ObjectStore, key: string, bytes: Uint8Array): Promise<'absent' | 'same' | 'different'>
```

Is this the same object already? Layers are immutable: the same bytes again is fine, other bytes under the same key is not.
