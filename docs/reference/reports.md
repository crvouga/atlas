# Reference: reports

Layered evidence for any kind of spec: publishing layers, stores (folder, S3, an Atlas server), combining and gating, the incremental report, init. Import paths `@crvouga/atlas/reports/<module>`.

> Generated from the doc comments of `packages/reports/src` by `bun run docs`. Do not edit: change the comment next to the code.

### Reading the files attachments name

Source: `packages/reports/src/attachment-files.ts`. Import: `@crvouga/atlas/reports/attachment-files`

Turns an attachment that names a file on disk (`path`) into one that carries its bytes (`data`), just before a
layer is published. It owns the safety rules for doing so: a path that came from a test report may only name
files inside the allowed roots, never a hidden file, and never a link that leads out; a path the person running
the command typed is trusted. It does not upload anything. Node-only (reads the file system).

See docs/report-contract.md (evidence rule 7: paths inside a report are data from a test run)

#### `AttachmentFileResult`

```ts
export type AttachmentFileResult = {
  /** A copy of the holder in which every readable `path` attachment became a `data` attachment (and `path` is gone). The input is not mutated. */
  readonly value: Loose;
  /** How many files were read. */
  readonly attached: number;
  /** The total size of those files, in bytes. */
  readonly bytes: number;
  /** One line per attachment that was left out (missing, not allowed, too large, over budget), prefixed with its name. */
  readonly warnings: readonly string[];
};
```

What {@link readAttachmentFiles} found.

#### `AttachmentBudget`

```ts
export type AttachmentBudget = {
  /** Bytes still available; each file read subtracts its size. A file larger than this is left out, not truncated. */
  remaining: number;
};
```

A budget shared by every call of one publish, so many files cannot add up to more than can be held.

#### `ReadOptions`

```ts
export type ReadOptions = {
  /** Largest single file, in bytes. Default 512 MiB. */
  readonly maxBytes?: number;
  /** Shared total-size budget; mutated as files are read. Omit for no total limit. */
  readonly budget?: AttachmentBudget;
  /**
   * A path the person running the command typed (`--attach`) is theirs to choose. A path inside a *report* is
   * data from a test run, which is not: it may name only files inside `roots`, never a hidden file, and never a
   * link that leads out.
   */
  readonly trusted?: boolean;
};
```

Options of {@link readAttachmentFiles}.

#### `readAttachmentFiles`

```ts
export async function readAttachmentFiles(holder: Loose, roots: readonly string[], options: ReadOptions = {}): Promise<AttachmentFileResult>
```

Reads the files that attachments name (`path`), at every level (the holder, its `steps` and its `attempts`,
recursively), and hands their bytes over as `data` with a `contentType` guessed from the file name when the
attachment gave none.

A file that is missing, not allowed or too large is left out with a warning: evidence that could not be
found never stops the results from being published. Attachments without a `path` are kept untouched.

- `holder`: A check, step, attempt or any object that may have `attachments`, `steps` and `attempts`.

- `roots`: Folders a relative path is resolved against (in order), and the only folders an untrusted path may name.

**Returns** The rewritten copy, counts and warnings; never throws for a bad file.

### Serving attachment bytes safely

Source: `packages/reports/src/attachment-response.ts`. Import: `@crvouga/atlas/reports/attachment-response`

Builds the HTTP response for an attachment's bytes. A producer chose the media type, and the bytes come from a
test run, so they are treated as untrusted: never sniffed, never allowed to run scripts, never embedded by
another site. Videos can be sought (HTTP range requests). Every route that serves attachment bytes must go
through here (or add {@link UNTRUSTED_HEADERS}); it never reads from a store itself.

See docs/report-contract.md (evidence rule 8)

#### `UNTRUSTED_HEADERS`

```ts
export const UNTRUSTED_HEADERS: Readonly<Record<string, string>>
```

Headers for bytes that came from a test run: never sniffed (`nosniff`), a sandboxing content-security policy so a
page navigated to at this address runs locked down, and `cross-origin-resource-policy: same-origin` so
another site cannot embed it. Spread these into every response that serves attachment or recorded bytes.

#### `attachmentResponse`

```ts
export function attachmentResponse(request: Request, entry: { readonly bytes: Uint8Array; readonly contentType: string }, etag: string): Response
```

Answers a request for one attachment's bytes with the untrusted-bytes headers, long-lived immutable caching
and range support.

The producer's `contentType` is used only when it is a well-formed media type (`type/subtype` with simple
parameters); anything else is served as `application/octet-stream`. A matching `if-none-match` answers 304.
A single `bytes=a-b`, `bytes=a-` or `bytes=-n` range answers 206, an unsatisfiable one 416; multiple ranges are
not understood and get the whole body (200).

- `etag`: A strong validator the caller derives from content identity (it is sent as given, so include the quotes).

### AWS credential lookup

Source: `packages/reports/src/aws-credentials.ts`. Import: `@crvouga/atlas/reports/aws-credentials`

Finds S3 credentials the way an AWS SDK does, without depending on one: environment variables, web identity
(EKS), ECS container credentials, the shared credentials file, the AWS CLI (SSO, assumed roles) and EC2 instance
metadata. It owns the lookup order, the caching and the early refresh before expiry; it does not sign requests
(that is `sigv4.ts`) or know about buckets (`s3-store.ts`). Credentials are never put in a store URL: they
come from here. Node-only (reads files, spawns `aws`). Nothing runs at import time.

See docs/report-contract.md (backends)

#### `CredentialProvider`

```ts
export type CredentialProvider = (() => Promise<Credentials>) & {
  /** Drop what is cached, so the next call asks again. Used when a store says the credentials expired. */
  invalidate(): void;
  /** Where the credentials came from, once known: "environment", "web identity (IRSA)", "profile prod", … */
  source(): string | null;
};
```

An async function returning currently valid credentials, with cache control. Concurrent calls share one lookup;
cached credentials are reused until shortly before they expire (never, when they carry no expiry).

#### `ChainOptions`

```ts
export type ChainOptions = {
  /** The environment variables to read. Default `process.env`. */
  readonly env?: Env;
  /** The HTTP client for STS, container and instance-metadata calls. Default global `fetch`. */
  readonly fetch?: typeof fetch;
  /** Reads a UTF-8 file. Default `fs.readFile`. */
  readonly readFile?: (file: string) => Promise<string>;
  /** Run a command and return its stdout, or null when it is not installed or fails. Default spawns it with a 20 s timeout. */
  readonly run?: (command: string, args: readonly string[]) => Promise<string | null>;
  /** The clock, epoch milliseconds. Default `Date.now`. */
  readonly now?: () => number;
  /** The home directory that holds `.aws/credentials`. Default `$HOME`, then the OS home. */
  readonly home?: string;
  /** Refresh this long before credentials expire, in milliseconds. Default 5 minutes. */
  readonly skewMs?: number;
};
```

Options of {@link credentialChain}; every one exists so a test can replace a piece of the machine.

#### `credentialChain`

```ts
export function credentialChain(options: ChainOptions = {}): CredentialProvider
```

Creates a provider for the credentials an AWS SDK would find, in the same order, with no SDK: environment, web
identity (EKS), container (ECS), shared credentials file, the AWS CLI (which covers SSO and assumed roles),
and EC2 instance metadata. `ATLAS_S3_ACCESS_KEY_ID` / `ATLAS_S3_SECRET_ACCESS_KEY` (and `ATLAS_S3_SESSION_TOKEN`)
come first so one store can use keys that are not the machine's AWS keys, such as Cloudflare R2 tokens.

Nothing is looked up until the provider is first called. The first source that yields credentials wins and
is cached; a source that throws (for example an STS error) is skipped and reported if no later source works.
When none works the provider rejects with an error that lists every source tried and how to fix it. Set
`ATLAS_NO_AWS_CLI` to skip the `aws` CLI step and `AWS_EC2_METADATA_DISABLED=true` to skip instance metadata.

**Example**

```ts
const credentials = await credentialChain()();
credentials.accessKeyId;
```

#### `staticCredentials`

```ts
export function staticCredentials(credentials: Credentials): CredentialProvider
```

Wraps keys that are already known in a {@link CredentialProvider} that never refreshes (its `invalidate` does nothing).

### Browser navigation for the reports viewer

Source: `packages/reports/src/browser-navigation.ts`. Import: `@crvouga/atlas/reports/browser-navigation`

The one implementation of {@link ReportNavigation} that touches `window` and `document`: the explorer's selection
lives in the URL hash, keys come from `keydown`, and the tab title is `document.title`. Browser-only; nothing
here runs until {@link browserReportNavigation} is called, so importing it is safe in Node.

#### `browserReportNavigation`

```ts
export function browserReportNavigation(): ReportNavigation
```

Creates a {@link ReportNavigation} backed by `window.location.hash`, `history`, `keydown` and `document.title`.

`writeHash` does nothing when the hash is already the given one; otherwise it replaces or pushes a history entry
(no `hashchange` is fired by `replaceState`/`pushState`, so the caller owns re-reading). `subscribeHash` listens to both
`hashchange` and `popstate`. Every `subscribe*` returns its unsubscribe function. Must be called in a browser.

### Bundles of captured files

Source: `packages/reports/src/bundle.ts`. Import: `@crvouga/atlas/reports/bundle`

Packs many small captured files (screenshots, frames, attachments) into a few gzip-compressed, content-addressed
blobs in an {@link ObjectStore}, and reads single files back out. The bytes of every entry are concatenated into
chunks of at most {@link BUNDLE_BYTES} uncompressed bytes; each chunk is gzipped and stored once at
`<prefix><sha256 of the uncompressed chunk>.gz`, so identical chunks and re-publishes write nothing new. A
{@link BundleIndex} says, per file key, which byte ranges of which blobs hold it. A layer document keeps that
index in its `bundle` field. Blobs are immutable; the index is the only mutable-looking part and is written last.

See docs/report-contract.md (where bytes go)

#### `BUNDLE_BYTES`

```ts
export const BUNDLE_BYTES = …
```

Uncompressed size of one chunk, in bytes (4 MiB). A file larger than this is split across several chunks.

#### `BundleIndex`

```ts
export type BundleIndex = Record<
  string,
  { contentType: string; parts: Location[] }
>;
```

Where each file of a bundle is, keyed by the file's key (for a layer, `attachments/<sha256>` and the like).
`parts` lists, in order, the byte ranges (`offset`, `size` within the decompressed blob `blob`, a store key) whose
concatenation is the file.

#### `BundleEntry`

```ts
export type BundleEntry = {
  /** The file's name inside the bundle; the key in the {@link BundleIndex}. A repeated key appends more parts to the same file. */
  key: string;
  bytes: Uint8Array;
  /** The media type to serve the bytes with. The first entry with a key decides it. */
  contentType: string;
};
```

One file to bundle, or one file read back.

#### `bundleIndexKey`

```ts
export function bundleIndexKey(sha: string, source: string): string
```

The store key of a commit's bundle index for one source: `commits/<sha>/bundles/<source>.json`. This is the older, per-commit layout; layers hold their index in the layer document instead.

#### `publishBundle`

```ts
export async function publishBundle(
  store: ObjectStore,
  key: string,
  entries: AsyncIterable<BundleEntry>
): Promise<void>
```

Writes `entries` as blobs next to `key` and then the index at `key`: up to four compressed chunks in flight,
with the one small index published last, so a reader never finds an index whose blobs have not arrived.

Trap: blobs go to `<key up to "/bundles/">/blobs/`, so `key` must contain `/bundles/` (as {@link bundleIndexKey}
gives); otherwise the prefix is computed from a wrong slice.

#### `writeBundle`

```ts
export async function writeBundle(store: ObjectStore, entries: AsyncIterable<BundleEntry>, prefix: string): Promise<BundleIndex>
```

Packs `entries` into gzip blobs under `prefix` (for layers, `layers/blobs/`) and returns the index that locates
every file; the caller stores the index (a layer keeps it as its `bundle`).

The entries are consumed lazily with up to four chunks in flight. A blob that already exists in the store is not
written again (one `head` per distinct blob). The gzip header's timestamp is zeroed, and the blob name is the
SHA-256 of the uncompressed chunk, so the same files in the same order always produce the same blobs. Order of
entries matters for that: chunking follows input order. A store error rejects after started writes settle.

#### `createBundleReader`

```ts
export function createBundleReader(
  store: ObjectStore,
  index: BundleIndex
): (key: string) => Promise<BundleEntry | null>
```

Creates a reader that returns one file of a bundle by key, or `null` when the key is not in `index` or one of
its blobs is missing from the store.

Only immutable blobs are cached (the last four decompressed blobs, oldest evicted first, including a cached
"missing" answer); mutable indexes are read for each request. Transport errors from the store reject.

#### `readBundleIndex`

```ts
export async function readBundleIndex(
  store: ObjectStore,
  key: string
): Promise<BundleIndex>
```

Reads and parses the bundle index at `key`; an index that is not there is an empty bundle (`{}`). Invalid JSON throws.

### Catalog search, filter, group and sort

Source: `packages/reports/src/catalog.ts`. Import: `@crvouga/atlas/reports/catalog`

The pure view logic behind the viewer's list of reports (and of the tests inside one): given entities and a
query (text, status, grouping, sort), it returns the groups to draw. It owns no data and does no I/O; the
caller maps its own records to {@link CatalogEntity}. Input is never mutated.

#### `CatalogStatus`

```ts
export type CatalogStatus = 'all' | 'passed' | 'failed' | 'skipped' | 'running';
```

A status filter: one of the four result statuses as the list names them (`skipped` is a check that was `not-run`), or `all`.

#### `CatalogGroup`

```ts
export type CatalogGroup = 'none' | 'file' | 'status' | 'package' | 'runtime';
```

What the list is grouped by; `none` gives one group named `All`.

#### `CatalogSort`

```ts
export type CatalogSort = 'recent' | 'name' | 'duration' | 'status';
```

How entities are ordered inside a group: `recent` keeps the input order, `name` is by title, `duration` is longest first, `status` is failed first then by title.

#### `CatalogLayout`

```ts
export type CatalogLayout = 'list' | 'grid';
```

How the list is drawn.

#### `CatalogQuery`

```ts
export type CatalogQuery = {
  /** Free text; matched case-insensitively as a substring of each entity's `search` text. Blank matches everything. */
  readonly q: string;
  readonly status: CatalogStatus;
  readonly group: CatalogGroup;
  readonly sort: CatalogSort;
  readonly layout: CatalogLayout;
};
```

The user's current choices, mirrored in the URL (see {@link catalogParams}).

#### `CatalogEntity`

```ts
export type CatalogEntity = {
  /** Stable identifier of the row. */
  readonly id: string;
  readonly title: string;
  /** A status string; only `passed`, `failed`, `skipped` and `running` are counted and ranked, any other sorts after them. */
  readonly status: string;
  /** Duration in milliseconds, or null when unknown (sorted last by `duration`, counted as 0 in a group's total). */
  readonly durationMs: number | null;
  /** Group label for `file` (a source file, or a branch). */
  readonly file: string;
  /** Group label for `package`; empty groups under `Other`. */
  readonly packageName: string;
  /** Group label for `runtime`; empty groups under `Other`. */
  readonly runtime: string;
  /** One muted line under the title: a failure, or a date. */
  readonly detail: string;
  /** Everything the text query may match (title, ids, paths, ...), built by the caller. */
  readonly search: string;
  /** Where selecting the row navigates, or null when it is not a link. */
  readonly href: string | null;
};
```

One row of the list: a report or a test, flattened to what the list needs.

#### `CatalogGroupView`

```ts
export type CatalogGroupView = {
  readonly name: string;
  /** Sum of the members' durations in milliseconds; unknown durations count as 0. */
  readonly durationMs: number;
  /** How many members have status `failed`. */
  readonly failed: number;
  readonly entities: readonly CatalogEntity[];
};
```

One drawn group of the list.

#### `catalogCounts`

```ts
export function catalogCounts(
  entities: readonly CatalogEntity[]
): Record<CatalogStatus, number>
```

Counts entities per status filter (`all` is the total); a status the list does not know is counted only in `all`.

#### `catalogParams`

```ts
export function catalogParams(
  params: Readonly<Record<string, string>>
): Record<string, string>
```

Keeps only the list's own URL search params (`q`, `status`, `group`, `sort`, `layout`, `spec`, `tab`, `partq`) and drops empty ones, so a test route's frame and zoom params do not leak into a link back to the list.

#### `arrangeCatalog`

```ts
export function arrangeCatalog(
  entities: readonly CatalogEntity[],
  query: CatalogQuery
): readonly CatalogGroupView[]
```

Filters entities by the query's status and text, sorts them, then splits them into one group per value of the
chosen key. `recent` keeps input order.

Group order: for `status`, failed, running, skipped, passed; otherwise alphabetical by name with `Other` (the
label for an empty file, package or runtime) last. With `none` there is a single group named `All`. When
nothing matches, no group is returned.

### Stores named on a command line

Source: `packages/reports/src/cli-stores.ts`. Import: `@crvouga/atlas/reports/cli-stores`

Turns `--store`, `--backends` and `ATLAS_STORE` into opened backends for the `atlas report` commands, and reads the
small flag grammar those commands share (`--name value`, repeatable). A mistyped directory is an error here, never
an empty store: a gate that read nothing must not read as a pass.

See docs/deploying.md

#### `CliBackend`

```ts
export type CliBackend = BackendInput & Partial<OpenedStore>;
```

A backend of a command: what `combineBackends` reads, plus, when it came from a URL, how it was opened (`location`, `server`, `s3`).

#### `values`

```ts
export function values(argv: readonly string[], name: string): string[]
```

Every value given for `--<name>`, in order. `--name` with nothing after it is ignored.

#### `value`

```ts
export function value(argv: readonly string[], name: string): string | undefined
```

The first value given for `--<name>`, or `undefined`.

#### `backendsOf`

```ts
export async function backendsOf(argv: readonly string[], base: string, env: Env): Promise<CliBackend[]>
```

Every store a command reads: `--store` (a directory or `s3://…`, optionally `id=url`), then
`--backends <module>`, or `ATLAS_STORE` when neither is given. A directory that is not there is an
error: a mistyped path must never read as an empty store.

#### `writeStoreOf`

```ts
export function writeStoreOf(flag: string | undefined, base: string, env: Env, name = 'store'): OpenedStore
```

The one store a command writes to. A directory is created; a bucket must already exist.

#### `layerFilter`

```ts
export function layerFilter(argv: readonly string[], env: Env): ((layer: { readonly branch: string | null; readonly freshness?: 'unknown' | 'modified' }) => boolean) | undefined
```

Which layers take part, from `--branch <name>` (repeatable) and `--ignore-modified`. By default all do:
a report is whatever the newest results are, wherever they were recorded. A gate that must speak for
a branch narrows it; the narrowing is yours to choose, never Atlas's.

### Injectable time

Source: `packages/reports/src/clock.ts`. Import: `@crvouga/atlas/reports/clock`

The two time dependencies of the reports code, as types, so tests and simulations can supply virtual time.
Production hosts pass `{ now: Date.now }` and wrappers over the global timers (see `host.ts`). There is no
default implementation in this module.

#### `Clock`

```ts
export type Clock = {
  /** Epoch milliseconds (virtual or wall). */
  readonly now: () => number;
};
```

The clock a reader or route uses to decide when polling or tailing has run long enough.

#### `Timers`

```ts
export type Timers = {
  readonly setTimeout: (fn: () => void, ms: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
  readonly setInterval: (fn: () => void, ms: number) => unknown;
  readonly clearInterval: (handle: unknown) => void;
};
```

The timer functions the reports code schedules work with; each handle is opaque and only passed back to the matching `clear*`.

### Bounded concurrency

Source: `packages/reports/src/completion-order.ts`. Import: `@crvouga/atlas/reports/completion-order`

Small helpers that run async work with a cap on how many tasks are in flight, used for reading and writing many
store objects without flooding the backend. They differ from `Promise.all` in three ways: the cap, results in
completion order (not input order), and failure handling: once one task rejects, no new task is started,
those already started are allowed to finish, and then the first error is rethrown.

#### `inCompletionOrder`

```ts
export async function* inCompletionOrder<T>(
  tasks: readonly (() => Promise<T>)[],
  limit: number
): AsyncGenerator<T>
```

Runs `tasks` at most `limit` at a time (at least 1) and yields each result the moment it
settles, so one slow read never holds back faster siblings. Results come in completion order, not input
order. A rejection is rethrown to the consumer once every started task has settled; no results are yielded
after the first failure.

#### `eachLimited`

```ts
export async function eachLimited<T>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<void>
): Promise<void>
```

Applies `work` to every item, at most `limit` at a time, and resolves when all are done; rejects with the first error as {@link inCompletionOrder} does.

#### `eachLimitedStream`

```ts
export async function eachLimitedStream<T>(
  items: AsyncIterable<T>,
  limit: number,
  work: (item: T) => Promise<void>
): Promise<void>
```

Consumes a lazy (async) input with backpressure: it pulls the next item only while fewer than `limit` works are
running, so a huge or generated input is never held in memory at once. After a failure it stops pulling,
waits for the started work to settle, then rethrows the first error.

### Combining backends into one report

Source: `packages/reports/src/compose.ts`. Import: `@crvouga/atlas/reports/compose`

The entry point that turns stores of layers into a report: it reads every layer from every {@link BackendInput},
lays them over the specs, and counts the outcome. It owns reading and failure reporting (an unreadable backend or
layer becomes a notice, never a pass); the rule for which result wins a slot lives in `layer-merge.ts`. A report
is computed, never stored, and is a function of the set of layers: the order and split of backends does not
change it.

See docs/report-contract.md (how layers compose, guarantees)

#### `BackendInput`

```ts
export type BackendInput = {
  /** Stable and unique: lowercase letters, digits and hyphens. It names where a result came from. */
  readonly id: string;
  /** What a person sees in notices and in the viewer. Defaults to `id`. */
  readonly label?: string;
  /** Where the layers are. Only read from. */
  readonly store: ObjectStore;
};
```

A store that contributes layers. Any {@link ObjectStore} is one: a directory, a bucket, a device lab.

#### `CombineOptions`

```ts
export type CombineOptions = {
  /** The specs the report is laid out against. When omitted, the specs the layers recorded. */
  readonly outline?: ReportOutline;
  /** Layers read at once, across all backends. Default 16. */
  readonly concurrency?: number;
  /**
   * Leave layers out, to see what earlier ones said (a layer for which this returns false takes no part: not in the
   * results, the layer list, the counts, or the recorded specs). Layers are still read; this filters after reading.
   */
  readonly include?: (layer: LayerHeader) => boolean;
};
```

Options of {@link combineBackends}.

#### `ReportSummary`

```ts
export type ReportSummary = {
  /** Counts of the winning results by status, and their total. */
  readonly checks: StatusCounts & { readonly total: number };
  /** The same counts per environment slug, keys sorted; results with no environment are under `unspecified`. */
  readonly byEnvironment: Readonly<Record<string, StatusCounts & { readonly total: number }>>;
  /** Specs in the outline with no result at all. */
  readonly specsWithoutEvidence: readonly string[];
};
```

What a report says in numbers. Timings that only qualify a check are not counted as checks.

#### `CombinedReport`

```ts
export type CombinedReport = {
  /** Every spec in the outline with the winning result of each of its slots, plus results that belong to no spec in the outline. */
  readonly combined: CombinedEvidence;
  /** Every distinct layer that was read, newest first. A layer several backends hold is one layer. */
  readonly layers: readonly LayerHeader[];
  /** Every backend given, sorted by id, with whether it could be read. */
  readonly backends: readonly BackendInfo[];
  /** What could not be read. A gate treats any of these as unknown, never as a pass. */
  readonly notices: readonly string[];
  /** The numbers of `combined`, computed once for the gate and the viewer. */
  readonly summary: ReportSummary;
};
```

A report: the results laid over the specs, with what was read and what could not be.

#### `countResults`

```ts
export function countResults(results: readonly EvidenceResult[]): StatusCounts & { total: number }
```

Counts results by status. Diagnostic results (parts of kind `performance`, which only qualify a check) are left out
whenever any other result is present; if only diagnostics exist, they are counted so the report is not empty.

#### `summarize`

```ts
export function summarize(combined: CombinedEvidence): ReportSummary
```

Counts a combined report's winning results in total and per environment, and lists the specs that have no result at all.

#### `combineBackends`

```ts
export async function combineBackends(backends: readonly BackendInput[], options: CombineOptions = {}): Promise<CombinedReport>
```

Reads every layer of every backend and lays them over the specs. Layers are the only input:
a report is a function of the set of layers, so the order of backends and layers, and how they
were split across machines, branches and runs, does not change it.

A backend that cannot be read, or a layer that cannot be understood, is named in `notices` and
leaves everything else usable; a gate must treat any notice as unknown, never as a pass. A layer held by
several backends is one layer. Only an invalid backend `id` (not lowercase letters, digits and hyphens, or
repeated) throws, before anything is read. Backends are only read from.

When `options.outline` is omitted, the specs are the ones the included layers recorded (the newest
recording of each spec path wins), with no commit sha.

**Example**

```ts
const outline = await loadDirectoryOutline('./specs'); // optional: without it the layers' own specs are used
const report = await combineBackends([{ id: 'ci', store: directoryStore('./atlas-reports') }], { outline });
report.summary.checks.failed; // number of slots whose winner failed
report.notices; // non-empty means something could not be read
```

### Copying layers between stores

Source: `packages/reports/src/copy-store.ts`. Import: `@crvouga/atlas/reports/copy-store`

`copyStore` copies the layers one store has and another lacks: how partial reports meet (each CI node publishes to its own
store; copying them together is the aggregate). It is idempotent, commutative and safe to repeat, because layers are
immutable and named by their content, and it writes in dependency order (files, then documents, then catalog entries) so a
reader of the destination, or a server that checks, never sees something before what it names.

See docs/report-contract.md

#### `copyStore`

```ts
export async function copyStore(from: ObjectStore, to: ObjectStore, options: { readonly concurrency?: number } = {}): Promise<{ readonly copied: number; readonly skipped: number; readonly ignored: number }>
```

Copy every layer object (`layers/…`) of `from` that `to` does not have. Only layers: they are
immutable, so an object that exists is already right. Commit-keyed legacy objects are mutable and
are left where they are. This is how partial reports meet: each CI
node publishes into its own store, and copying them together is the aggregate, because layers are
immutable, addressed by content, and never share a key with different bytes. It is idempotent,
commutative and safe to repeat after a failure.

A layer's catalog entry is copied last, and its manifest after its files, so a reader of `to` never sees an
entry for a layer whose content has not arrived.

### Spec outline from a directory

Source: `packages/reports/src/directory-outline.ts`. Import: `@crvouga/atlas/reports/directory-outline`

Defines what a spec file is and reads a specs directory into the outline a report is laid over: one entry per
spec, named `specs/<path inside the directory>`, with its notation, title and a fingerprint of its text. The same
definition feeds the specs that are published, so the outline and the published spec set agree. Node-only
(reads the file system and asks `git` for the commit); nothing is written.

See docs/report-contract.md (the layer document's `specs`, and `specPath`)

#### `isSpecFile`

```ts
export function isSpecFile(file: string): boolean
```

Every file the viewer reads from a specs directory: charts, journeys, notations and notes.

#### `specKindOf`

```ts
export function specKindOf(file: string): string
```

The notation of a spec file. Anything else is named by its extension.

#### `specTitleOf`

```ts
export function specTitleOf(file: string, text: string): string
```

The title of a spec: the `Feature:` line of a `.feature`, the `module` name of a `.qnt`, otherwise the file's base name.

#### `SpecFileText`

```ts
export type SpecFileText = { readonly path: string; readonly text: string };
```

One spec file: its `specs/<relative path>` name and its UTF-8 text.

#### `collectSpecFiles`

```ts
export async function collectSpecFiles(directory: string): Promise<SpecFileText[]>
```

The spec files of a directory, named `specs/<path inside it>`: the one definition of what a spec is,
shared by the outline a report is laid over and by the specs that are published. Hidden files and
folders, `node_modules`, `dist`, files over 2 MiB and files of other types (pictures, build output) are
left out. Sorted by path. Rejects if `directory` does not exist.

#### `loadDirectoryOutline`

```ts
export async function loadDirectoryOutline(directory: string, options: { readonly domain?: string; readonly repoRoot?: string } = {}): Promise<ReportOutline & { readSpec: (specPath: string) => Promise<string | null> }>
```

The specs of a directory as the outline a report is laid over. Each spec is named
`specs/<its path inside the directory>`: that is the `specPath` a check uses to say which spec it
belongs to. `domain` groups specs in the viewer; it defaults to the project's folder name.

`repoRoot` is where `git rev-parse HEAD` is asked for the outline's `sha` (default: `directory`); the `sha` is
null outside git. `changedFiles` is always empty. The returned `readSpec(specPath)` answers the text read here,
or null for a path that is not in the outline.

**Example**

```ts
const outline = await loadDirectoryOutline('./specs', { repoRoot: process.cwd() });
outline.specs.map(spec => spec.path); // ['specs/join.feature', ...]
```

### Directory-backed object store

Source: `packages/reports/src/directory-store.ts`. Import: `@crvouga/atlas/reports/directory-store`

The {@link ObjectStore} implementation for a local folder: a CI workspace, a downloaded artifact, a mount or a
laptop. Each key is a file under the root; its content type is kept in a sidecar `<key>.content-type`. Writes go
to a temporary `.tmp-*` file and are renamed into place so a reader sees all of an object or none of it. Keys
that could escape the root (`..`, absolute, backslash, empty segments) or collide with the sidecar or temporary
names are rejected with an error. Node/Bun only.

See docs/report-contract.md (backends)

#### `directoryStore`

```ts
export function directoryStore(root: string): ObjectStore & PagedListing
```

Creates an {@link ObjectStore} on a directory: one file per key, its content type in a sidecar file. The
backend for a CI workspace, a downloaded artifact or a laptop. Writes are atomic, listing reads
only the directories a prefix can reach, and two stores over copies of the same layers can be
merged with `cp -R` because layers are immutable and addressed by content.

The directory need not exist yet: `put` creates it, and `get`/`head`/`listKeys` on a missing one answer
null/false/`[]`. A missing sidecar reads as `application/octet-stream`. `put` writes the content type before
the bytes, so an object is never visible without its type. `listKeys` returns keys in code-unit order, skips
temporary and sidecar files, and throws on a prefix that is absolute, contains a backslash or `..`. `getUri`
is a `file://` URL. Also implements `listPage` (`after` is exclusive, `limit` defaults to 1000, `next` is the
last returned key while more remain).

**Example**

```ts
const store = directoryStore('./atlas-reports');
await store.put('layers/blobs/x', new TextEncoder().encode('hi'), 'text/plain');
await store.listKeys('layers/'); // ['layers/blobs/x']
```

### Store doctor and IAM policy

Source: `packages/reports/src/doctor.ts`. Import: `@crvouga/atlas/reports/doctor`

`inspectStore` checks that a store works end to end (credentials, listing, what it holds, writing and reading back a
scratch object) and says what to fix when it does not; `iamPolicy` prints the least-privilege AWS policy for publishers
and readers. Used by `atlas report doctor` and `atlas report policy`, for folders, S3-compatible buckets and Atlas
servers alike.

See docs/deploying.md

#### `Check`

```ts
export type Check = { readonly ok: boolean; readonly name: string; readonly detail: string; readonly fix?: string };
```

One thing `inspectStore` checked: its `name` (`store`, `list`, `contents`, `write`, …), whether it is `ok`, what was seen, and, when it is not, what to `fix`.

#### `iamPolicy`

```ts
export function iamPolicy(location: { bucket: string; prefix: string }, role: 'publisher' | 'reader' | 'both'): object
```

The least an account needs, as an AWS IAM policy. The combined server role also stores operational leases under server/live/. R2, MinIO and the rest have their own policy languages: grant the same actions.

#### `Role`

```ts
export type Role = 'publisher' | 'reader' | 'both';
```

What the account being checked is for: `publisher` (writes layers), `reader` (reads them) or `both`. It decides which checks run.

#### `inspectStore`

```ts
export async function inspectStore(backend: CliBackend, options: { readonly role?: Role } = {}): Promise<Check[]>
```

Is this store usable for Atlas, and if not, what exactly is wrong? Each step says what to do.

### Report deltas

Source: `packages/reports/src/effective-delta.ts`. Import: `@crvouga/atlas/reports/effective-delta`

The client half of "send only what changed": `applyEffectiveDelta` turns the report a viewer holds and a delta from the
server (`GET /api/reports/evidence/effective?since=<version>`) into the current report. Pure and free of Node APIs, so a
browser bundle uses it. The server half is `ReportIndex.delta`; a test holds the two together over random runs.

See docs/server.md#reading-only-what-changed

#### `EffectiveDelta`

```ts
export type EffectiveDelta = Omit<EffectiveEvidence, 'layers'> & {
  readonly delta: true;
  /** The version this applies to. */
  readonly base: string;
  readonly layers: readonly LayerEvidence[];
  readonly removed: readonly string[];
};
```

What a server answers when a viewer asks for the report `since` a version it holds and the server still
remembers that version: only what changed. `layers` are whole layers (with the rows that win), replacing those
of the same id; `removed` are layers that no longer win anything. Everything else, `backends` and `notices`
and the count, is sent whole because it is small.

It is an optimisation and nothing else: applying it gives exactly the report the server would have sent in
full, and a server that does not know it sends the full report, which a viewer takes as it always did.

#### `isEffectiveDelta`

```ts
export const isEffectiveDelta = …
```

Is `value` a delta (`delta: true`, a `base` version, `layers` and `removed`) and not a whole report? Decides which of the two a server answered.

#### `applyEffectiveDelta`

```ts
export function applyEffectiveDelta(held: EffectiveEvidence, delta: EffectiveDelta): EffectiveEvidence | null
```

The report a delta leads to, or null when it does not apply to `held` (a different version): ask for the
whole report then.

### Evidence of one result

Source: `packages/reports/src/evidence-detail.ts`. Import: `@crvouga/atlas/reports/evidence-detail`

Reads the evidence (attachments, steps, annotations, attempts, tags, labels, links, extensions) that a layer, a
part or a check carries beyond its outcome: the short summary that rides in every report row, one result's full
detail, and the bundle keys its files live under. It only reads; evidence never decides a status, a slot or a
winner, so nothing here affects who wins.

See docs/extending.md
See docs/report-contract.md (evidence)

#### `EvidenceHolder`

```ts
export type EvidenceHolder = {
  readonly tags?: readonly string[];
  readonly labels?: Readonly<Record<string, string>>;
  readonly links?: readonly { readonly url: string; readonly name?: string | undefined; readonly rel?: string | undefined }[];
  readonly attachments?: readonly Attachment[];
  readonly annotations?: readonly Annotation[];
  readonly steps?: readonly Step[];
  readonly attempts?: readonly Attempt[];
  readonly extensions?: Readonly<Record<string, unknown>>;
};
```

Anything that may carry evidence: a layer, a part or a check.

#### `summarizeEvidence`

```ts
export function summarizeEvidence(...holders: readonly EvidenceHolder[]): EvidenceSummary | undefined
```

What a result carries beyond its outcome, as counts and short facts. It rides in every row of the
report so a list can show "3 attachments, 12 steps" without opening anything; the evidence itself is
read when someone asks for it. Undefined when there is none.

Several holders (for example a check and its layer) are summed: `attachments` also counts those on steps and
attempts, `steps` counts only each holder's own top-level steps, tags are de-duplicated, and for a repeated
label the later holder wins. `roles` are the attachments' roles (or, without one, what their media type or file
name implies), sorted and distinct.

#### `roleOfType`

```ts
export function roleOfType(contentType: string | undefined): string
```

A role to show when a producer gave none, from the media type: `image`, `video`, `audio`, `snapshot` (text/html), `text` (text, JSON, XML) or `file`. Roles are an open vocabulary; a producer's own role always wins.

#### `CheckDetail`

```ts
export type CheckDetail = {
  /** The id of the layer the check was read from. */
  readonly layer: string;
  /** The kind of the part that holds the check. */
  readonly kind: string;
  /** The check as recorded, with all of its evidence. */
  readonly check: Check;
  /** What the run as a whole carries: its logs, its links, its labels. */
  readonly run: EvidenceHolder;
};
```

All of one result's evidence, read when someone opens it.

#### `checkDetailOf`

```ts
export function checkDetailOf(layer: { readonly id: string; readonly parts: readonly { readonly kind: string; readonly checks: readonly Check[] }[] } & EvidenceHolder, checkId: string, kind?: string): CheckDetail | null
```

One result's evidence, from a layer: the first check with id `checkId` (in a part of kind `kind`, when given) plus the layer's own evidence. Null when the layer holds no such check.

#### `runEvidence`

```ts
export function runEvidence(layer: EvidenceHolder): EvidenceHolder
```

What a layer carries as a whole (its tags, labels, links, attachments, annotations and extensions; not its parts' checks). Absent fields stay absent.

#### `bundleKeysOf`

```ts
export function bundleKeysOf(holder: EvidenceHolder): string[]
```

Every distinct bundle key (`bundleKey`) that the attachments of a holder, its steps and its attempts point to, so a layer's files can be copied. Attachments held by `uri` or inline `text` have none.

### Live evidence from running suites

Source: `packages/reports/src/evidence-live.ts`. Import: `@crvouga/atlas/reports/evidence-live`

Shows results the moment each test finishes, before its package has been collected into an archived layer. A
running suite announces itself with a record under `active/` in the local store (see {@link LiveRunRecord});
this module reads the test reports that suite has written so far into a temporary layer (id `live-<source>`,
`live: true`) and drops it once the archived layer arrives or after a short linger. Live layers are a viewing
aid only (this module writes nothing), and an unreadable or half-written report is skipped, not guessed at.

#### `LiveRunRecord`

```ts
export type LiveRunRecord = {
  /** The package directory the suite runs in, relative to the repository (`libs/chess`); with `bucket`, it names the source. */
  readonly packageDir: string;
  /** The suite's bucket within the package (`part-2`); where the run writes each finished test. */
  readonly bucket: string;
  /** When the run started, epoch milliseconds. A new value for the same source means a new run: tracking restarts. */
  readonly startedAtMs: number;
  /** How many checks the run expects to execute, when known. */
  readonly plannedChecks?: number;
  /** The client this suite is checking. A different client does not replace it. */
  readonly environment?: string;
  /** Other string choices that make the results their own slot; non-string or empty values are dropped on reading. */
  readonly parameters?: LayerParameters;
};
```

What a running spec suite announces under `active/` in the local store.

#### `liveRunRecord`

```ts
export function liveRunRecord(value: unknown): LiveRunRecord | null
```

Validates a parsed `active/` announcement and keeps only the fields the live layer can trust (the environment is
normalised to its slug, parameters are string-to-string). Null when `packageDir`, `bucket` or a numeric
`startedAtMs` is missing, so garbage in `active/` is ignored rather than shown.

#### `LiveSource`

```ts
export type LiveSource = {
  /** The bucket the run writes each finished test into, or null when it cannot be read (the run is then not tracked). */
  readonly bucket: (run: LiveRunRecord) => ObjectStore | null;
  /** The checkout the runs execute: its commit and branch, stamped on every live layer. Asked once per refresh pass. */
  readonly origin?: () => Promise<{ readonly sha: string | null; readonly branch: string | null }>;
  /** The stylesheet the runs' snapshots render with (served as `frame.css`). */
  readonly frameCss?: () => Promise<string | null>;
};
```

How the host reaches the results a spec run has written so far.

#### `liveLayerId`

```ts
export function liveLayerId(source: string): string
```

The id of the temporary layer for a source: `live-<source>`. Not a content hash, unlike an archived layer's id.

#### `createLiveEvidence`

```ts
export function createLiveEvidence(args: { readonly live: LiveSource | undefined; readonly clock: Clock; readonly backend: string })
```

Creates the tracker of finished tests of runs that have not been collected into a layer yet, so a
result appears the moment its test ends instead of when its package does.

The tracker is stateful and meant to live as long as the server: call `refresh` on each poll with the current
`active/` records and the newest archived layers. It returns the live layers (only those with at least one result)
and the runs still in progress with their completed and failed counts. A run that disappears is read one last
time and kept for 30 seconds, or until an archived (non-live) layer of the same producer and environment recorded
at or after its start appears. `find(id)` returns a live layer by `live-<source>` id, and `store(source)` the
bucket its files are read from. A bucket that is being replaced or a report still being written is skipped until
the next pass; `refresh` does not throw for those.

- `args.live`: How the host reaches the buckets; without it nothing is tracked.

- `args.backend`: The backend id stamped on live layers.

### Report evidence types

Source: `packages/reports/src/evidence-types.ts`. Import: `@crvouga/atlas/reports/evidence-types`

The shapes the report API and the viewer exchange about layers: a layer's header (origin and totals), its rows
(one per check), the backends that contributed, runs in progress, and the address of a recorded test's
timeline. These are the wire shapes of `/api/reports/*`, so within a version they only gain optional fields.
Also holds {@link recordingPaths}, the one place the URL layout of a recording is defined.

See docs/report-contract.md

#### `RecordingAddress`

```ts
export type RecordingAddress =
  | { readonly type: 'layer'; readonly layer: string }
  | { readonly type: 'commit'; readonly sha: string; readonly source: string }
  | { readonly type: 'live'; readonly source: string };
```

Where a recorded test's timeline and captured files are read from.

#### `BackendInfo`

```ts
export type BackendInfo = {
  /** Stable backend id (lowercase letters, digits, hyphens); names where a result came from. */
  readonly id: string;
  /** What a person sees for the backend. */
  readonly label: string;
  /** Spec runs on this machine write here while they are still running. */
  readonly live: boolean;
  /** False when the backend could not be read; a notice says why, and its results are unknown, not passed. */
  readonly available: boolean;
};
```

One store that contributes report layers.

#### `StatusCounts`

```ts
export type StatusCounts = Readonly<Record<EvidenceStatus, number>>;
```

How many results have each status (`passed`, `failed`, `running`, `not-run`).

#### `EvidenceSummary`

```ts
export type EvidenceSummary = {
  /** Attachments on the result, including those on its steps and attempts. */
  readonly attachments: number;
  readonly steps: number;
  readonly annotations: number;
  /** How many tries were recorded when the check was retried. */
  readonly attempts: number;
  readonly links: number;
  readonly tags: readonly string[];
  readonly labels: Readonly<Record<string, string>>;
  /** The distinct roles of its attachments (or what their media types say), to show what kind of evidence there is. */
  readonly roles: readonly string[];
};
```

What a result (or a run) carries beyond its outcome, as counts and short facts: attachments, steps,
annotations, retries, tags, labels, links. It is only there when there is something. The evidence itself
is read when someone opens the result.

#### `LayerHeader`

```ts
export type LayerHeader = {
  /** The layer's id: 64 hex digits for an archived layer, `live-<source>` for a live one. */
  readonly id: string;
  /** The id of the backend it was read from (the one whose id sorts first when several hold it). */
  readonly backend: string;
  /** The suite or tool that made it. Part of the slot. */
  readonly producer: string;
  /** The package directory of a spec run, when the layer came from one. */
  readonly packageDir: string | null;
  /** When the checks ran, epoch milliseconds; the newest completed result wins its slot. */
  readonly recordedAtMs: number;
  /** Provenance: the commit it was recorded at. Never part of the slot. */
  readonly sha: string | null;
  /** Provenance: the branch it was recorded on. Never part of the slot. */
  readonly branch: string | null;
  /** The client this layer checked. Null when the layer did not say. */
  readonly environment: string | null;
  /** Provenance: the CI run that made it. */
  readonly runUrl: string | null;
  /** Other string choices that make a result its own slot. */
  readonly parameters: LayerParameters;
  /** `modified`: recorded from a checkout with uncommitted changes; `unknown`: origin not captured; absent: clean. Advisory; never changes a status. */
  readonly freshness?: 'unknown' | 'modified';
  /** The execution the producer named for it (one local or manual invocation), or absent. Grouping and display only; never part of the slot. */
  readonly run?: LayerRun;
  /** Where this layer's recorded timelines and captured files are read from, or null when it has none. */
  readonly recording: RecordingAddress | null;
  /** From a spec run that has not been collected into a layer yet. */
  readonly live: boolean;
  /** Its checks by status. Parts of kind `performance` are not counted when anything else was recorded. */
  readonly counts: StatusCounts;
  /** Equal for the mutable and the archived address of one execution. */
  readonly execution: string;
  /** What the run as a whole carries: its logs, links and labels. */
  readonly evidence?: EvidenceSummary;
};
```

A report layer's origin and totals. Its checks are read separately, once.

#### `LayerRow`

```ts
export type LayerRow = {
  /** The kind of the part holding the check (`behavior`, `performance`, ...). Part of the slot. */
  readonly kind: string;
  /** The check's stable id. Part of the slot. */
  readonly id: string;
  readonly title: string;
  readonly status: EvidenceStatus;
  /** The spec the check belongs to (`specs/<path>`), or null. */
  readonly specPath: string | null;
  /** Why it has this status, for a person; empty when there is nothing to add. */
  readonly detail: string;
  readonly measurements: readonly EvidenceMeasurement[];
  /** The recorded test behind this check, when it has a timeline to open. */
  readonly testId: string | null;
  /** What distinguishes this recorded test from another run of the same check. */
  readonly variant: LayerParameters;
  /** How long the check took, milliseconds, or null when unknown. */
  readonly durationMs: number | null;
  /** What this result carries beyond its outcome. Absent when nothing. */
  readonly evidence?: EvidenceSummary;
};
```

One check of one report part.

#### `LayerRows`

```ts
export type LayerRows = {
  /** The layer's id. */
  readonly id: string;
  readonly rows: readonly LayerRow[];
  /** Spec path to the fingerprint the layer recorded for it. */
  readonly fingerprints: Readonly<Record<string, string>>;
};
```

The checks of one layer, read separately from its header.

#### `LayerEvidence`

```ts
export type LayerEvidence = LayerRows & { readonly layer: LayerHeader };
```

A layer's rows together with its header: everything composition needs to lay the layer over the specs.

#### `ActiveRun`

```ts
export type ActiveRun = {
  readonly source: string;
  readonly packageDir: string;
  readonly bucket: string;
  readonly startedAtMs: number;
  /** Spec files the run planned, when the producer recorded it. */
  readonly plannedChecks?: number;
  /** Checks finished so far: passed, failed or not-run. */
  readonly completed: number;
  /** Of those, how many failed. */
  readonly failed: number;
};
```

A spec run that is writing results right now.

#### `EvidencePage`

```ts
export type EvidencePage = {
  /** The layers on this page, newest first. */
  readonly layers: readonly LayerHeader[];
  /** Opaque token for the next page, or null at the end. */
  readonly cursor: string | null;
  /** What could not be read; a gate treats any as unknown, never as a pass. */
  readonly notices: readonly string[];
  readonly backends: readonly BackendInfo[];
  /** Runs writing results right now. */
  readonly active: readonly ActiveRun[];
};
```

One page of the layer listing the viewer reads.

#### `recordingPaths`

```ts
export function recordingPaths(address: RecordingAddress, testId: string)
```

The report API paths (relative to the reports API root) of one recorded test: its `report` JSON, a `file(path)`
builder for its captured files (each path segment is URL-encoded), and the `css` its snapshots render with.
The layout depends on where the recording lives: an archived layer, a commit (the older layout) or a live run.

### The viewer's model of a combined report

Source: `packages/reports/src/evidence-view.ts`. Import: `@crvouga/atlas/reports/evidence-view`

Pure functions that reshape a combined report for display: results grouped per check (a {@link CheckSlot}), rolled
up per spec and overall, the facets by which layers are included or left out, and the history of one check across
layers. They never change a result: statuses come from the composition (`layer-merge.ts`), and a spec with no
recorded check is `none`, never a pass.

See docs/report-contract.md

#### `CheckSlot`

```ts
export type CheckSlot = {
  /** The check's key (its spec path and id), shared by all of its results. */
  readonly key: string;
  readonly id: string;
  readonly title: string;
  readonly specPath: string | null;
  /** The worst outcome across the check's parameter sets (failed, then running, then not-run, then passed). */
  readonly status: EvidenceStatus;
  /** What happened, newest first. One entry per producer, environment and parameter set. */
  readonly outcomes: readonly EvidenceResult[];
  /** Recorded timings of the same check. They never change its outcome. */
  readonly diagnostics: readonly EvidenceResult[];
  /** The newest `recordedAtMs` among all of its results, diagnostics included. */
  readonly latestAtMs: number;
  /** True when any result comes from a run that is still in progress. */
  readonly live: boolean;
};
```

Everything the combined report holds for one check.

#### `checkSlots`

```ts
export function checkSlots(results: readonly EvidenceResult[]): CheckSlot[]
```

Groups the combined results (the winners of the slots) by check, in the order the checks were first seen.
A check's status is the worst of its non-diagnostic results; if it has only diagnostics (timings), those are its
outcomes. The title and id shown are the newest result's.

#### `SpecStatus`

```ts
export type SpecStatus = EvidenceStatus | 'none';
```

A spec's rolled-up status: the worst of its checks, or `none` when nothing was recorded for it.

#### `SpecSummary`

```ts
export type SpecSummary = {
  /** `failed` if any check failed, else `running`, else `passed` if any passed, else `not-run`; `none` with no checks. */
  readonly status: SpecStatus;
  /** Checks by their own status. */
  readonly counts: StatusCounts;
  readonly total: number;
  /** The newest `recordedAtMs` among them, or null with no checks. */
  readonly latestAtMs: number | null;
  readonly live: boolean;
};
```

The rollup of a set of checks (one spec, or the whole report).

#### `NO_EVIDENCE`

```ts
export const NO_EVIDENCE: SpecSummary
```

The summary of a spec with no recorded check: status `none`, which is not a pass.

#### `summarizeSlots`

```ts
export function summarizeSlots(slots: readonly CheckSlot[]): SpecSummary
```

Rolls the checks of one spec up into a {@link SpecSummary}. No recorded check is `none`, never a pass.

#### `addSummaries`

```ts
export function addSummaries(summaries: readonly SpecSummary[]): SpecSummary
```

Adds several summaries (for example every spec's) into one, with the same status rule; `none` when they hold no checks at all.

#### `SpecEvidence`

```ts
export type SpecEvidence = { readonly slots: readonly CheckSlot[]; readonly summary: SpecSummary };
```

One spec's checks and their rollup.

#### `EvidenceView`

```ts
export type EvidenceView = {
  /** Keyed by the spec path the outline uses (`specs/...`). */
  readonly specs: ReadonlyMap<string, SpecEvidence>;
  /** Results whose spec is no longer in the outline, or that name no spec. */
  readonly unassigned: readonly CheckSlot[];
  /** The rollup of the specs in the outline only; `unassigned` results are not counted in it. */
  readonly total: SpecSummary;
};
```

The combined report as the viewer draws it.

#### `evidenceView`

```ts
export function evidenceView(combined: CombinedEvidence): EvidenceView
```

Builds the {@link EvidenceView} of a combined report: every spec of the outline gets an entry, with an empty one when it has no results.

#### `SourceSelection`

```ts
export type SourceSelection = {
  /** Backend ids to leave out. */
  readonly backends: readonly string[];
  /** Branch names to leave out; `Unknown branch` stands for layers with no branch. */
  readonly branches: readonly string[];
  /** Commit shas to leave out; `unknown` stands for layers with no sha. */
  readonly versions: readonly string[];
  /** Environment slugs to leave out; `unspecified` stands for layers with none. */
  readonly environments: readonly string[];
  /** Layer ids to leave out. */
  readonly layers: readonly string[];
};
```

Sources left out of the combined report. An empty list means every layer
on that axis contributes, including layers that arrive later.

#### `ALL_SOURCES`

```ts
export const ALL_SOURCES: SourceSelection
```

The selection that leaves nothing out: every layer contributes.

#### `sourceSelection`

```ts
export function sourceSelection(excluded: Partial<SourceSelection> | null | undefined): SourceSelection
```

A saved selection from before versions and environments were axes still means "exclude nothing new".

#### `branchOf`

```ts
export function branchOf(layer: LayerHeader): string
```

The branch a layer was recorded on, or `Unknown branch` when it did not say.

#### `versionOf`

```ts
export function versionOf(layer: Pick<LayerHeader, 'sha'>): string
```

The commit a layer checked, or `unknown` when the layer did not record one.

#### `environmentOf`

```ts
export function environmentOf(layer: Pick<LayerHeader, 'environment'>): string
```

The client a layer checked, or `unspecified` when it did not say.

#### `contributes`

```ts
export function contributes(layer: LayerHeader, excluded: Partial<SourceSelection>): boolean
```

Whether a layer takes part given what is left out: false when its backend, branch, commit, environment or id is excluded. Missing axes in `excluded` exclude nothing.

#### `SourceFacet`

```ts
export type SourceFacet = { readonly id: string; readonly layers: number; readonly latestAtMs: number };
```

One choice on an axis of the sources panel: its value, how many layers have it, and the newest `recordedAtMs` among them.

#### `sourceFacets`

```ts
export function sourceFacets(layers: readonly LayerHeader[])
```

Counts the layers per backend, branch, commit and environment, each list newest first (ties by name).

#### `HistoryEntry`

```ts
export type HistoryEntry = { readonly layer: LayerHeader; readonly row: LayerRow };
```

One layer's record of a check.

#### `checkHistory`

```ts
export function checkHistory(layers: readonly LayerEvidence[], path: string | null, id: string): HistoryEntry[]
```

Every layer's own record of one check, newest first. A superseded result stays readable here.

### Explorer data types

Source: `packages/reports/src/explorer-types.ts`. Import: `@crvouga/atlas/reports/explorer-types`

The plain shapes the reports explorer shares between the store readers, the API routes and the viewer: a spec
entry, a commit's spec inventory, the four result statuses, measurements, checks and parts. They are types only
and carry no behaviour. The vocabulary matches the layer document (`docs/report-contract.md`): `status` is the
closed set of four, everything else about a check is open.

#### `SpecEntry`

```ts
export type SpecEntry = {
  /** `specs/<path inside the specs directory>`. The `specPath` a check uses to say which spec it belongs to. */
  readonly path: string;
  /** Groups specs in the viewer (by default the project's folder name). */
  readonly domain: string;
  /** The notation: `gherkin`, `quint`, `dmn`, `alloy`, `openslo`, a file extension, or `document`. An open vocabulary. */
  readonly kind: string;
  readonly title: string;
  /** A fingerprint of the spec's text, so a reader can warn when a spec changed since a layer recorded it. Opaque. */
  readonly fingerprint?: string;
};
```

Commit-scoped definitions and independently produced evidence. One spec of the outline a report is laid over.

#### `SpecInventory`

```ts
export type SpecInventory = {
  /** The 40-hex-digit commit. */
  readonly sha: string;
  readonly entries: readonly SpecEntry[];
};
```

The specs of one commit.

#### `EvidenceStatus`

```ts
export type EvidenceStatus = 'passed' | 'failed' | 'running' | 'not-run';
```

The four result statuses. The only closed vocabulary in the format: `not-run` is never a pass and `running` is not done.

#### `EvidenceMeasurement`

```ts
export type EvidenceMeasurement = {
  readonly name: string;
  readonly value: number;
  /** The unit of `value` and `limit`, such as `ms`. */
  readonly unit: string;
  /** The allowance for `value`, in the same unit, when there is one. */
  readonly limit?: number;
};
```

A number a check recorded. Exceeding `limit` is shown and never fails the check by itself.

#### `EvidenceExtras`

```ts
export type EvidenceExtras = Partial<Pick<import('../../schema/src/layer').Check, 'tags' | 'labels' | 'links' | 'steps' | 'attachments' | 'annotations' | 'attempts' | 'extensions'>>;
```

What a check may carry beyond its outcome. All optional and open: see docs/extending.md.

#### `EvidenceCheck`

```ts
export type EvidenceCheck = EvidenceExtras & {
  /** Stable across runs; the newer result replaces the older one only if both used the same id. */
  readonly id: string;
  readonly title: string;
  readonly status: EvidenceStatus;
  /** Why the check has this status, for a person. */
  readonly detail: string;
  /** The spec the check belongs to, as `specs/<path>`. */
  readonly specPath?: string;
  readonly measurements: readonly EvidenceMeasurement[];
  /** How long the check took, when the producer measured it. */
  readonly durationMs?: number;
};
```

One check of a part, as recorded.

#### `ReportPart`

```ts
export type ReportPart = EvidenceExtras & {
  /** `modified`: recorded from a checkout with uncommitted changes; `unknown`: origin not captured. Advisory; never changes a status. */
  readonly freshness?: 'unknown' | 'modified';
  /** String choices that make a result its own slot (a device, a seed). */
  readonly parameters?: Readonly<Record<string, string>>;
  /** The commit the part was recorded at. */
  readonly sha: string;
  /** The part's id; when the part is published it is the `producer` of the layer made from it. */
  readonly id: string;
  /** Open category (`behavior`, `performance`, ...); part of the slot. */
  readonly kind: string;
  readonly title: string;
  /** When the checks ran, epoch milliseconds. */
  readonly recordedAtMs: number;
  readonly checks: readonly EvidenceCheck[];
};
```

`kind` is an open producer key; new parts need no protocol change.

#### `ReportPartOutput`

```ts
export type ReportPartOutput = Pick<ReportPart, 'kind' | 'title' | 'checks'>;
```

The part of a {@link ReportPart} that a spec run's evidence file carries: its `kind`, `title` and `checks`.

#### `ExplorerData`

```ts
export type ExplorerData = {
  readonly inventory: SpecInventory | null;
  readonly parts: readonly ReportPart[];
  /** A message to show instead of data, when something could not be read. */
  readonly notice?: string;
};
```

What the explorer shows for one commit: its specs (or null when none were recorded) and the parts recorded against it.

#### `WorkspaceVersion`

```ts
export type WorkspaceVersion = {
  readonly sha: string;
  readonly branch: string;
  /** True when the checkout has uncommitted changes. */
  readonly dirty: boolean;
};
```

The checkout a workspace reads from.

#### `WorkspaceReports`

```ts
export type WorkspaceReports = {
  readonly version: WorkspaceVersion;
  readonly inventory: SpecInventory;
  readonly parts: readonly ReportPart[];
  readonly readSpec: (path: string) => Promise<string | null>;
};
```

Only composition roots provide checkout content; it is never CI evidence.

### Explorer version markers

Source: `packages/reports/src/explorer-versions.ts`. Import: `@crvouga/atlas/reports/explorer-versions`

Marker files `versions/<sha>.json` that list which commits a store has anything recorded for, so the explorer can
show a commit that has parts or specs but no spec run. A store layout older than layers; the markers are small,
immutable and idempotent to write, and are read in place by newer readers.

See docs/report-contract.md (stores written before layers existed)

#### `recordExplorerVersion`

```ts
export async function recordExplorerVersion(
  store: ObjectStore,
  sha: string
): Promise<void>
```

Writes the marker `versions/<sha>.json` (`{"sha": "<sha>"}`) so an independent producer's commit appears without
a spec run. Writing it again is harmless. Throws `Invalid commit` when `sha` is not a 40-hex-digit commit.

#### `listExplorerVersions`

```ts
export async function listExplorerVersions(
  store: ObjectStore
): Promise<readonly string[]>
```

Lists the commits that have a marker, in key order. Keys under `versions/` that are not `<40 hex>.json` are
ignored. A marker that is missing at read time or whose content does not name its own sha is not skipped:
it throws `Invalid explorer version`, so corrupt data fails visibly.

### Static export of a report

Source: `packages/reports/src/export-evidence.ts`. Import: `@crvouga/atlas/reports/export-evidence`

Copies what a running reports API serves (outline, spec texts, layer pages, rows, per-result evidence, recorded
files) into an {@link ObjectStore}, one file per URL, so the viewer can be hosted statically. {@link evidenceFile}
is the single mapping from an API path to the exported file name; the exporter writes with it and a static host
must read with it. Only collected layers are exported (a static site has no running suite).

#### `evidenceFile`

```ts
export function evidenceFile(path: string): string
```

Maps a report API path (with its query) to the file an export stores it under, for example `/evidence?cursor=x`
to `evidence/pages/x.json` and `/` to `index.json`. Files a layer carries (`/blobs/`, `/files/`, `frame.css`,
`report.json`) keep their path so their type stays known by name; everything else gets `.json` appended. Pure.

#### `exportEvidence`

```ts
export async function exportEvidence(args: { fetch: (path: string) => Promise<Response>; target: ObjectStore })
```

Exports the combined report, preserving layer provenance and lazy recording addresses.

`args.fetch` answers report API paths (`/outline`, `/evidence?cursor=`, ...), for example the reports app's own
`request`. Every response is stored in `args.target` under {@link evidenceFile}, each path once. A 404 or 503 for
a path is recorded in `missing` and skipped; any other failure throws, as does a layer catalog that repeats a
page. Live runs are left out and each execution is exported once. Nothing in `target` is deleted.

**Returns** `revisions` (distinct commits among the exported layers), `layers` (layers exported) and `missing`
(paths that were not there).

### Cacheable reads of a commit-keyed reports API

Source: `packages/reports/src/fetcher.ts`. Import: `@crvouga/atlas/reports/fetcher`

The client side of the older, commit-addressed reports API (`/<sha>/explorer`, `/<sha>/spec`,
`/<sha>/sources`, `/<sha>/tests/<source>/<testId>`, ...). Commit pages, sources, stylesheets and
test timelines go through TanStack Query. Frame files also land in
`ReportCache` (IndexedDB on the wall, a map in tests) so a scrub reads
bytes the browser already kept, without putting multi-megabyte HTML into
the query document. A 503 from the API means reports are not available and throws {@link ReportsUnavailable};
a 404 for a spec, test or frame is answered as `null` (or an empty stylesheet), not an error.

#### `ReportsUnavailable`

```ts
export class ReportsUnavailable extends Error
```

Thrown when the reports API answers 503: no reports store is configured or reachable. Its message is `reports_unavailable`.

#### `ReportCache`

```ts
export type ReportCache = {
  /** The saved value, or null when there is none. */
  get(key: string): Promise<string | null>;
  /** Saves a value, replacing any under the key. */
  set(key: string, value: string): Promise<void>;
  /** Forgets a key; a missing key is not an error. */
  remove(key: string): Promise<void>;
};
```

String store the query persister and frame files share.

#### `memoryReportCache`

```ts
export function memoryReportCache(): ReportCache
```

A {@link ReportCache} held in a `Map`, lost on reload. For tests and hosts without persistent storage.

#### `reportQueryClient`

```ts
export function reportQueryClient(): QueryClient
```

Creates the TanStack `QueryClient` the fetcher expects: results stay fresh 5 minutes, are kept 1 day, and are neither retried nor refetched on window focus.

#### `reportQueryKey`

```ts
export const reportQueryKey = …
```

The TanStack query keys of each read, so a host can invalidate or persist them. Every key starts with `reports`.

#### `ReportFetcher`

```ts
export type ReportFetcher = {
  /** The specs and parts recorded for a commit. Never served from a stale query (always refetched). */
  explorer(sha: string): Promise<ExplorerData>;
  /** The text of one spec of a commit, or null when it is not there. */
  spec(sha: string, path: string): Promise<string | null>;
  /** One page of commits; pass the previous page's `cursor`, or null for the first page. */
  commits(cursor: string | null): Promise<CommitPage>;
  /** The spec-run sources of a commit. */
  sources(sha: string): Promise<readonly SourceRecord[]>;
  /** The stylesheet snapshots of a commit render with; empty when there is none. */
  frameCss(sha: string): Promise<string>;
  /** One recorded test's report, or null when it is not there. */
  test(sha: string, source: string, testId: string): Promise<RunReport | null>;
  /** One captured file of a test, or null when it is missing (a missing file is retried on the next call). Resolved from the `ReportCache` before the network. */
  blob(
    sha: string,
    source: string,
    testId: string,
    file: string
  ): Promise<HtmlReportBlob | null>;
};
```

The reads the explorer makes. Rejections are `ReportsUnavailable` (503) or an `Error` naming the HTTP status.

#### `ReportFetcherArgs`

```ts
export type ReportFetcherArgs = {
  /** The HTTP client used for every request. */
  readonly http: HttpClient;
  /** The URL prefix of the reports API, prepended to each path with no added slash (for example `/api/reports`). */
  readonly apiBase: string;
  /** The query cache; see {@link reportQueryClient}. */
  readonly client: QueryClient;
  /** Where captured frame files are kept between visits. */
  readonly cache: ReportCache;
};
```

What {@link createHttpReportFetcher} needs.

#### `createHttpReportFetcher`

```ts
export function createHttpReportFetcher(
  args: ReportFetcherArgs
): ReportFetcher
```

Creates a {@link ReportFetcher} over HTTP with query-cached reads. Frame files resolve from `cache` before the network.

### Date formatting

Source: `packages/reports/src/format-date.ts`. Import: `@crvouga/atlas/reports/format-date`

Formats epoch-millisecond timestamps for display in the viewer's locale.

#### `fmtDate`

```ts
export function fmtDate(ms: number): string
```

Formats epoch milliseconds as a local date and time (`toLocaleString`); an empty string for 0 or missing, and the number as text if it cannot be formatted.

### Display formatting for recorded tests

Source: `packages/reports/src/format.ts`. Import: `@crvouga/atlas/reports/format`

Small pure formatters the viewer uses to show durations, file names, action lines and captured blobs. Nothing
here reads a store or the network; missing or unreadable input becomes a placeholder, never an exception.

#### `fmtMs`

```ts
export function fmtMs(ms: number | null | undefined): string
```

Formats milliseconds compactly (`850ms`, `1.5s`, `2m 5s`); `—` for null, undefined or a non-finite number.

#### `fileName`

```ts
export function fileName(path: string | undefined): string
```

The last `/`-separated segment of a path; empty for no path.

#### `fileLabel`

```ts
export function fileLabel(sourceFile: string | undefined): string
```

The group label for a test's source file: its base name, or `Other` when it has none.

#### `formatArgs`

```ts
export function formatArgs(args: readonly unknown[] | undefined): string
```

Compact `arg, arg` for an action line. Empty when the step recorded none.

#### `actionLabel`

```ts
export function actionLabel(step: {
  readonly action?: string | undefined;
  readonly args?: readonly unknown[] | undefined;
  readonly title: string;
}): string
```

`action(args)`, or the step title when the step is not an action.

#### `formatBlobBody`

```ts
export function formatBlobBody(
  test: HtmlReportTest,
  blob: ReportSnapshotBlob
): string
```

The text to show for a captured blob: binary blobs become a `(binary name, ~N bytes)` placeholder, JSON is
pretty-printed (left as is if it does not parse), anything else is shown as stored, and `(missing)` when the
test does not hold the blob's file.

#### `blobHeading`

```ts
export function blobHeading(blob: ReportSnapshotBlob): string
```

The heading line of a blob: `name · nodeId · media`, without the node when it has none.

#### `downloadUrl`

```ts
export function downloadUrl(
  test: HtmlReportTest,
  blob: ReportSnapshotBlob
): string | null
```

A `data:` URL for a blob stored as base64 bytes, or null when the test holds no such bytes (text blobs have none).

### Frames of a recorded test

Source: `packages/reports/src/frames.ts`. Import: `@crvouga/atlas/reports/frames`

Pure helpers over a recorded test's step tree: flattening it into time-ordered frames (captured snapshots),
choosing the frame and actor a route selects, stepping to neighbouring frames or failures, and listing the files
a report names. Results of `testFrames` and the per-actor orderings are cached per test, keyed by the identity of
`test.report.steps`, so treat a loaded report as immutable. Nothing here reads a store.

#### `FlatFrame`

```ts
export type FlatFrame = {
  step: ReportStep;
  frame: ReportFrame;
  /** How deeply the step is nested (0 for a top-level step). */
  depth: number;
  /** Position in the flattened list this frame came from; `testFrames` renumbers it by capture time. Route `frame=N` is `index + 1`. */
  index: number;
};
```

A frame placed in its step, in the flattened timeline.

#### `OrderedUiBlob`

```ts
export type OrderedUiBlob = {
  readonly nodeId: string;
  /** This frame's snapshot, or the client's latest earlier one when stale. */
  readonly blob: ReportSnapshotBlob | null;
  /** True when `blob` is carried forward from an earlier frame. */
  readonly stale: boolean;
};
```

A UI snapshot slot for one client (actor) of a frame.

#### `FlatStep`

```ts
export type FlatStep = {
  step: ReportStep;
  depth: number;
  /** The enclosing step, or null for a top-level step. */
  parent: FlatStep | null;
  index: number;
};
```

A step placed in the flattened (depth-first) step list.

#### `flattenFrames`

```ts
export function flattenFrames(
  steps: readonly ReportStep[],
  out: FlatFrame[] = [],
  depth = 0
): FlatFrame[]
```

Flattens the frames of a step tree depth first (a step's own frames, then its children's), in step order, not capture-time order. Appends to `out`.

#### `flattenSteps`

```ts
export function flattenSteps(
  steps: readonly ReportStep[],
  out: FlatStep[] = [],
  depth = 0,
  parent: FlatStep | null = null
): FlatStep[]
```

Flattens a step tree depth first into rows that know their depth and parent. Appends to `out`.

#### `firstFrameFor`

```ts
export function firstFrameFor(
  step: ReportStep,
  frames: readonly FlatFrame[]
): FlatFrame | null
```

The first frame of `step`, or failing that of its first descendant that has one; null when none of them has a frame.

#### `lastFrameBefore`

```ts
export function lastFrameBefore(
  step: ReportStep,
  frames: readonly FlatFrame[]
): FlatFrame | null
```

The last frame (in list order, which should be capture-time order) captured at or before the step ended; null when none was.

#### `testFrames`

```ts
export function testFrames(test: HtmlReportTest): FlatFrame[]
```

All frames of a test in capture-time order (ties keep step order), each numbered by its position. Cached per report.

#### `orderedUiBlobs`

```ts
export function orderedUiBlobs(
  frame: FlatFrame | null,
  test: HtmlReportTest
): OrderedUiBlob[]
```

Returns a frame's UI snapshots (html or png) in one stable actor order, including empty slots, so each client
stays in the same column from frame to frame. The order is the report's `meta.actorIds`, then any other client in
the order first seen. A client with no snapshot at this frame carries its latest earlier one (`stale: true`), or
`null` blob if it has none yet. Snapshots with no `nodeId` follow, named `snapshot-N`.

#### `selectedFrame`

```ts
export function selectedFrame(
  frames: readonly FlatFrame[],
  route: Route
): FlatFrame | null
```

The frame a route selects: the 1-based `frame` param when in range, otherwise the first frame of a failed step, otherwise the last frame; null with no frames.

#### `capturedFiles`

```ts
export function capturedFiles(report: Pick<RunReport, 'steps' | 'artifacts'>): string[]
```

Every distinct file a report names, relative to the test's folder: step snapshots, and files attached to the test as a whole (artifacts with their poster and captions). Used to know what to copy or prefetch.

#### `isUi`

```ts
export function isUi(b: ReportSnapshotBlob): boolean
```

Whether a snapshot is a rendered user interface (`html` or `png`), as opposed to data such as JSON or text.

#### `uiBlobs`

```ts
export function uiBlobs(frame: FlatFrame | null): ReportSnapshotBlob[]
```

The UI snapshots (html or png) of a frame; empty for no frame.

#### `stageBlobs`

```ts
export function stageBlobs(frame: FlatFrame | null): ReportSnapshotBlob[]
```

All snapshots of a frame of any media; empty for no frame.

#### `frameHasUi`

```ts
export function frameHasUi(frame: FlatFrame | null): boolean
```

Whether a frame has at least one UI snapshot.

#### `frameFilesNear`

```ts
export function frameFilesNear(
  frames: readonly FlatFrame[],
  index: number,
  radius: number
): readonly string[]
```

The distinct html, png, json and text files of the frames within `radius` of `index` (the visible one plus neighbors, clamped to the list), to fetch ahead.

#### `actorIds`

```ts
export function actorIds(
  frame: FlatFrame | null,
  test: HtmlReportTest
): string[]
```

The clients (actors) to show for a frame: those with a UI snapshot, else those with any snapshot, else the report's declared `meta.actorIds`.

#### `selectedNode`

```ts
export function selectedNode(
  frame: FlatFrame | null,
  route: Route,
  test: HtmlReportTest
): string | null
```

The client a route selects: the `node` param when it is one of the frame's actors, else the frame's step actor, else the first actor; null with none.

#### `blobText`

```ts
export function blobText(
  test: HtmlReportTest,
  blob: ReportSnapshotBlob
): string | null
```

The text of a blob the test holds as text, or null when it is missing or held as bytes.

#### `blobDataUrl`

```ts
export function blobDataUrl(
  test: HtmlReportTest,
  blob: ReportSnapshotBlob
): string | null
```

A `data:` URL for a blob the test holds as base64 bytes, or null when it is missing or held as text.

#### `stepHasPress`

```ts
export function stepHasPress(step: ReportStep): boolean
```

Whether any frame of `step` (not its children) shows a press target.

#### `neighborFailure`

```ts
export function neighborFailure(
  frames: readonly FlatFrame[],
  from: number,
  delta: 1 | -1
): FlatFrame | null
```

Next (`delta` 1) / previous (-1) frame of a failed step, wrapping.

#### `neighborStepFrame`

```ts
export function neighborStepFrame(
  frames: readonly FlatFrame[],
  from: number,
  delta: 1 | -1
): FlatFrame | null
```

First frame of the next / previous step (skipping same-step frames).

### URL hash routes of the reports viewer

Source: `packages/reports/src/hash.ts`. Import: `@crvouga/atlas/reports/hash`

The explorer keeps its state in the URL hash (`#/test/<id>?view=single&zoom=fit`) so a link reproduces a view.
This module parses a hash into a {@link Route} and builds it back; it is pure and never throws on a missing
value, but `parseHash` throws `URIError` on a malformed percent-escape. Unknown params are carried untouched.

#### `RouteParams`

```ts
export type RouteParams = Readonly<Record<string, string>>;
```

The query part of a hash: decoded keys and values. Empty values are dropped when a hash is built.

#### `ListRoute`

```ts
export type ListRoute = {
  readonly view: 'list';
  readonly params: RouteParams;
};
```

The list of reports or tests (`#/`).

#### `TestRoute`

```ts
export type TestRoute = {
  readonly view: 'test';
  /** The test's id, decoded; it may contain slashes (`libs/chess/monkey`). */
  readonly testId: string;
  readonly params: RouteParams;
};
```

One recorded test (`#/test/<id>`).

#### `Route`

```ts
export type Route = ListRoute | TestRoute;
```

Where the viewer is: the list, or one test. Anything that is not `#/test/<id>` is the list.

#### `parseHash`

```ts
export function parseHash(hash: string): Route
```

Parses a `location.hash` (with or without the leading `#` and `/`) into a {@link Route}; an unrecognized path is the list.

#### `buildHash`

```ts
export function buildHash(route: Route): string
```

Builds the hash for a route (`#/` or `#/test/<encoded id>`) with its non-empty params encoded; the inverse of {@link parseHash}.

#### `viewMode`

```ts
export function viewMode(route: Route): 'single' | 'multi'
```

`single` when the `view` param says so, otherwise `multi`.

#### `zoomMode`

```ts
export function zoomMode(route: Route): string
```

The `zoom` param, or `fit` when it is absent.

#### `showAside`

```ts
export function showAside(route: Route): boolean
```

Whether the side panel is shown: true unless `aside=0`.

#### `showPress`

```ts
export function showPress(route: Route): boolean
```

Whether press targets are drawn on frames: true unless `press=0`.

### Reports host for a project's own stores

Source: `packages/reports/src/host.ts`. Import: `@crvouga/atlas/reports/host`

Mounts the reports API (outline of a specs directory, layers from one or more stores) as a plain
`(request, repoRoot) => Response` function, for a dev server or a project's own server to call at
`/api/reports`. It owns opening the stores and lazily building the app once per repository root; the report
logic itself is in `reports-route.ts` and `compose.ts`. Node/Bun only. It forwards only the method, URL and
headers of a request (not the body), so it serves reads.

See docs/dogfooding.md

#### `ReportsHostOptions`

```ts
export type ReportsHostOptions = {
  /** The specs directory, relative to the project. Its files are the outline every layer fills. */
  readonly specs: string;
  /**
   * Where layers are: a directory, an `s3://` URL, or any backend. Several stores are one report: layers
   * from all of them are laid over the same specs. Default: `ATLAS_STORE`.
   */
  readonly stores?: readonly (string | BackendInput)[];
  /** Groups the specs in the viewer. Default: the repository folder's name, or `product`. */
  readonly domain?: string;
};
```

Options of {@link reportsHost}.

#### `reportsHost`

```ts
export function reportsHost(options: ReportsHostOptions): (request: Request, repoRoot: string) => Promise<Response>
```

The reports half of the viewer, for a project's own stores. Export it from the module that
`ATLAS_REPORTS_MODULE` names:

```ts
import { reportsHost } from '@crvouga/atlas/reports/host';
export const reportsDevFetch = reportsHost({ specs: './specs', stores: ['./atlas-reports'] });
```

The returned function takes the incoming `Request` and the repository root (relative store paths and `specs`
resolve against it); a path starting `/api/reports` has that prefix removed before routing. The app is built
on first use and rebuilt if the root changes. A store given as a string is opened with `openStore` and gets an
id derived from its location; a failure while answering (for example a wrong `specs` path) is a 500 whose JSON
body names the `specs` directory and the store ids.

### HTML cards for frames without a UI snapshot

Source: `packages/reports/src/html-frame.ts`. Import: `@crvouga/atlas/reports/html-frame`

Builds a self-contained HTML document for a frame that has no UI snapshot: a Quint step's model state, or any
spec step that only recorded text. It is painted in the same phone surface as a real snapshot. All text taken
from the recording is HTML-escaped and the document carries only its own inline style, no script.

#### `stateFrameHtml`

```ts
export function stateFrameHtml(
  frame: FlatFrame,
  sections: readonly Section[]
): string
```

The HTML document of one frame's model or recorded state: the step's kind and timings, its title, its error,
its `detail` (shown as a name/value table when every line reads `name = value`, otherwise as preformatted text)
and then one block per extra `sections` entry. Everything from the recording is escaped.

### Atlas server as an ObjectStore

Source: `packages/reports/src/http-store.ts`. Import: `@crvouga/atlas/reports/http-store`

`httpStore` speaks the server's store protocol (`/api/store`) as an `ObjectStore`, so everything that publishes to a store
(`publishChecks`, spec sets, run uploads, `copyStore`, `createReporter`) publishes to a server unchanged. It retries what a
retry can fix (network errors, 5xx, 429, 408) with jittered backoff, never what it cannot (401, 403, 409, 413, 422), and
every refusal says what to do about it.

See docs/server.md#the-store-protocol

#### `HttpStoreOptions`

```ts
export type HttpStoreOptions = {
  /** Project namespace on a shared Atlas node. Omit for the legacy default project. */
  readonly project?: string;
  /** The Atlas server, such as `https://atlas.example.com`. A path on it (`/atlas`) is kept. */
  readonly url: string;
  /** A publish or admin token to write with, a read token to read with. Never put it in the URL. */
  readonly token?: string;
  readonly fetch?: typeof fetch;
  /** Retries after the first attempt, for network errors and server errors. Default 4. */
  readonly retries?: number;
  /** Per attempt, to start answering, in milliseconds. Default 30 000. */
  readonly timeoutMs?: number;
  readonly sleep?: (ms: number) => Promise<void>;
};
```

How to reach a server: its `url`, the `token` to send (never in the URL), and, for tests and special runtimes, `fetch`, the retry count, the per-attempt timeout and `sleep`.

#### `AtlasHttpError`

```ts
export class AtlasHttpError extends Error
```

What an Atlas server said no to, with what to do about it.

#### `HttpStore`

```ts
export type HttpStore = ObjectStore & PagedListing & {
  /** The same authenticated node connection, scoped to another project. */
  forProject(project: string): HttpStore;
  /** `https://atlas.example.com`, with no secrets. */
  readonly label: string;
  readonly url: string;
  /** Is the server there, and does it know this token? */
  ping(): Promise<{ readonly ok: boolean; readonly ms: number; readonly role?: string; readonly error?: string }>;
  /** The gate, worked out by the server from the layers it holds: the `atlas report status --format json` document. Needs a token that may read. */
  status(query?: URLSearchParams): Promise<unknown>;
};
```

An `ObjectStore` (with paged listing) over an Atlas server, plus what only a server can answer: `ping` (is it there, and what may this token do) and `status` (the gate, worked out by the server).

#### `httpStore`

```ts
export function httpStore(options: HttpStoreOptions): HttpStore
```

An {@link ObjectStore} on an Atlas server, over its store protocol (`/api/store`). The server holds the
layers (on its own disk, or in whatever backends it was given), checks what is uploaded, and shows
everyone the combined report at once. Anything that publishes to a store, `publishChecks`, spec sets,
run uploads, `copyStore`, works against it unchanged.

### HTTP client port

Source: `packages/reports/src/http.ts`. Import: `@crvouga/atlas/reports/http`

The one thing the reports readers need from the network, as a type, so a host can supply `fetch`, an
authenticating wrapper or a test double.

#### `HttpClient`

```ts
export type HttpClient = { fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> };
```

Anything with a `fetch` of the standard signature. The readers only call it; they do not retry or add credentials.

### Importing checks from existing test reports

Source: `packages/reports/src/ingest.ts`. Import: `@crvouga/atlas/reports/ingest`

Turns the output of tools that already exist (CTRF JSON, JUnit XML, an Atlas run `manifest.json`) into checks a
layer can hold, so any test suite can publish without a custom producer. It owns the mapping of foreign
statuses onto the four Atlas statuses (anything not clearly passed or failed is `not-run`, never a pass) and the
rule for check ids: stable across runs, built from the file, suite and name, with a repeated id numbered
(`#2`, `#3`) so no check is silently counted as another. It reads text it is given and touches no files.

See docs/report-contract.md (choosing a check id)

#### `IngestedChecks`

```ts
export type IngestedChecks = {
  /** One per test, with ids made unique. Attachments that name a file carry a `path` for the publisher to read; see `attachment-files.ts`. */
  readonly checks: readonly EvidenceCheck[];
  /**
   * For each check, in order, the names the report gave its container (suite, class, file), which
   * can name the spec it checks when the report has no path for it.
   */
  readonly hints?: readonly (readonly string[])[];
  /** When the report says the run ended (or started), epoch milliseconds; null when it does not say. */
  readonly recordedAtMs: number | null;
  /** The tool that wrote the report, when it says. */
  readonly tool: string | null;
  /** What the report says about the run as a whole: the tool, the build, the platform. */
  readonly labels?: Readonly<Record<string, string>>;
};
```

The checks an existing test report holds, and when it was recorded when the report says.

#### `uniqueChecks`

```ts
export function uniqueChecks(checks: readonly EvidenceCheck[]): EvidenceCheck[]
```

Never silently count two checks as one: the first check with an id keeps it and a repeat becomes `<id> #2`, `<id> #3`, ... in input order.

#### `checksFromCtrf`

```ts
export function checksFromCtrf(report: unknown): IngestedChecks
```

A [CTRF](https://ctrf.io) report (`results.tests`). A check's id is its file, its suites and its
name, so the same test keeps the same id in every run. Skipped, pending and other results are
`not-run`: never a pass; a status this function does not know is also `not-run`.

Also carries what CTRF has beyond the outcome as evidence: tags, labels (browser, device, flaky, run environment
and tool), steps, attachments (files by `path`, `url` as `uri`, inline screenshot, stdout/stderr, trace), retry
attempts, a snippet annotation and `extra` under the `ctrf.extra` extension. `recordedAtMs` is `summary.stop`,
else `summary.start`. Throws `Not a CTRF report: results.tests is missing` when there is no `results.tests` array.

- `report`: The parsed CTRF JSON.

#### `checksFromJunit`

```ts
export function checksFromJunit(xml: string): IngestedChecks
```

A JUnit XML report: one check per `<testcase>`, identified by its file or class and its name (`file or classname > name`).

A case with a `<failure>` (an assertion that did not hold) or an `<error>` (an exception) is `failed`, one with
`<skipped>` is `not-run`, any other is `passed`. Durations are seconds converted to milliseconds. Properties become labels, `<system-out>`/`<system-err>` become log
attachments, and a Jenkins `[[ATTACHMENT|path]]` line in the output attaches that file by `path`. `recordedAtMs`
is the newest `<testsuite timestamp>` (a timestamp with no offset is read as UTC). Throws
`Not a JUnit report: no <testsuite> found` when the text has no test cases and no `<testsuite`.

#### `checksFromManifest`

```ts
export function checksFromManifest(manifest: unknown): IngestedChecks
```

An Atlas run (`manifest.json`): one check per path. A path's key, which the same start and
events give in every run, is its id. A flaky path passed. While the run is still going, a
running path is `running` and a queued one `not-run`, so a snapshot never reads as finished.

Every check's `specPath` is the run's root chart file under its spec directory. A run is still going when
`run.finishedAt` is `null`. `recordedAtMs` is `run.finishedAt`, else `run.startedAt` plus `run.durationMs`.
Throws `Not an Atlas manifest: run and paths are required` when `paths` or `run.id` is missing.

- `manifest`: The parsed `manifest.json` of an Atlas run.

### Project detection and `atlas init`

Source: `packages/reports/src/init.ts`. Import: `@crvouga/atlas/reports/init`

Looks at a project (its package manager, test runners, spec files, CI and git state) and produces a plan to send its
test results to an Atlas server: for each suite the command that runs it and the command that publishes (or streams)
its results, a CI workflow, and a section of `AGENTS.md` that tells the next agent how to use Atlas in this project.
It changes nothing unless asked (`--write`), and applying it twice changes nothing the second time: files are
rewritten only between their `atlas:begin` / `atlas:end` markers (or created whole), never merged by guesswork.

The plan is one JSON document (`InitPlanSchema`) so an agent can run `atlas init --format json`, read it, and act. See
docs/agents.md for the whole flow. Detection is deliberately conservative: it names what it found and why
(`evidence`), says what it could not tell, and never invents a suite.

#### `InitPlan`

```ts
export type InitPlan = z.infer<typeof InitPlanSchema>;
```

The document `atlas init` prints, and what {@link planInit} returns.

#### `InitOptions`

```ts
export type InitOptions = {
  /** The project directory. Default: the current directory. */
  readonly directory: string;
  /** The Atlas server clients will send results to (`https://atlas.example.com`). Falls back to `ATLAS_STORE` when that is a server. */
  readonly server?: string;
  /** Write the files of the plan. Without it nothing is changed. */
  readonly write?: boolean;
  /** Ask the server who we are and whether this token may upload. */
  readonly verify?: boolean;
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** For tests: git as a function from arguments to output (or null). Default: the `git` command. */
  readonly git?: (args: readonly string[], cwd: string) => string | null;
  readonly fetch?: typeof fetch;
};
```

What `planInit` is told: where the project is, which server, and what to do with the plan.

#### `planInit`

```ts
export async function planInit(options: InitOptions): Promise<InitPlan>
```

Detects the project in `options.directory` and returns the plan, writing its files when `options.write` is set.
Never throws for a project it cannot understand: it says so in `warnings` and plans what it can (the `AGENTS.md`
section with no suites, so the next agent knows to add them). Throws only for a directory that does not exist.

**Example**

```ts
const plan = await planInit({ directory: process.cwd(), server: 'https://atlas.example.com' });
for (const suite of plan.suites) console.log(suite.run, '→', suite.publish);
```

#### `formatPlan`

```ts
export function formatPlan(plan: InitPlan): string
```

The plan as the text a person reads: what was found, what is planned, and what to do next.

#### `INIT_USAGE`

```ts
export const INIT_USAGE = …
```

The usage of `atlas init`, printed by `atlas init --help`.

#### `initMain`

```ts
export async function initMain(argv: readonly string[], io: { readonly out: (text: string) => void; readonly env?: Readonly<Record<string, string | undefined>>; readonly cwd?: string; readonly fetch?: typeof fetch }): Promise<number>
```

`atlas init`: parses the arguments, plans, prints the plan as text or JSON, and returns the exit code.

### JUnit XML parsing

Source: `packages/reports/src/junit.ts`. Import: `@crvouga/atlas/reports/junit`

Reads the `<testcase>` elements of a JUnit XML document without an XML library, and overlays test-runner
outcomes (JUnit XML) onto a report bundle. A harness run only sees failures raised inside its own steps;
assertions in the test body surface through the runner's report instead. Parsing is tolerant by design
(nested suites, self-closing elements, CDATA) and never drops a case silently, because a result that goes
missing reads as a pass. `ingest.ts` turns the cases into checks.

#### `JunitCase`

```ts
export type JunitCase = {
  /** The case's `file` attribute, else its suite's, else empty. */
  readonly file: string;
  /** The `classname` attribute, which many runners use for the suite or the file. */
  readonly classname: string;
  /** The `name` of the `<testsuite>` the case is in. */
  readonly suite: string;
  /** Seconds, when the runner emits it. */
  readonly time: number | null;
  readonly name: string;
  /** 1-based line of the test declaration, when the runner emits it. */
  readonly line: number | null;
  /** `failed` when the case has a `<failure>` or an `<error>`, `skipped` when it has `<skipped>`, otherwise `passed`. */
  readonly status: 'passed' | 'failed' | 'skipped';
  /** The failure's text (else its `message`, else `failed`), or null when the case did not fail. */
  readonly failure: string | null;
  /** The case's `<system-out>`, when it has one. */
  readonly stdout?: string;
  /** The case's `<system-err>`, when it has one. */
  readonly stderr?: string;
  /** The case's `<properties>`, then its suite's: names a runner chose to record. */
  readonly properties?: Readonly<Record<string, string>>;
};
```

One `<testcase>` as read, with the suite it is in.

#### `parseJunit`

```ts
export function parseJunit(xml: string): JunitCase[]
```

Parses every `<testcase>` of a JUnit XML document, in document order, whatever the nesting of its suites. Returns `[]` for text with none; never throws.

#### `matchJunitCase`

```ts
export function matchJunitCase(
  cases: readonly JunitCase[],
  sourceFile: string,
  sourceLine: number | undefined
): JunitCase | null
```

The test case whose declaration precedes `sourceLine` in the same file and
is the nearest one (bodies follow declarations). Files match when equal or when one path ends with the other
(after normalising backslashes). With one case in the file, or no line, the first case in the file is used.
Null when no case is in the file, or none declared at or before the line.

#### `applyJunitOutcomes`

```ts
export function applyJunitOutcomes(
  bundle: HtmlReportBundle,
  cases: readonly JunitCase[]
): HtmlReportBundle
```

Applies runner outcomes and titles to every test of a bundle that has a known source file and a matching case:
the test takes the case's name as title, its failure as error (a harness error is kept), and fails if either the
runner or the harness failed. The bundle fails if any test does. Tests without a match are returned unchanged;
the input is not mutated.

### Keyboard shortcuts of the reports viewer

Source: `packages/reports/src/keyboard.ts`. Import: `@crvouga/atlas/reports/keyboard`

One `keydown` handler for the viewer: the command palette (Cmd/Ctrl+K), help (`?`), Escape, and, on a test page,
scrubbing frames, jumping between steps and failures, moving to the neighbouring test and toggling the view. It is
framework-free: everything it changes goes through the {@link KeyNavHandlers} the host supplies, and it ignores
keys typed into inputs, buttons and links.

#### `KeyNavHandlers`

```ts
export type KeyNavHandlers = {
  /** Opens or closes the shortcut help. */
  toggleHelp: () => void;
  /** Whether the help is open. */
  showHelp: () => boolean;
  /** Whether the command palette is open; while it is, no other shortcut acts. */
  showPalette: () => boolean;
  togglePalette: () => void;
  /** Stops frame playback. */
  stopPlay: () => void;
  /** Goes to a route (writes the URL hash). */
  navigate: (route: Route) => void;
  /** Selects a frame, optionally of a given client (`node`). */
  goFrame: (frame: FlatFrame | null, node?: string) => void;
  togglePlay: () => void;
  /** Sets a URL param on the current route; the empty string removes it. */
  setParam: (key: string, value: string) => void;
  /** The current route. */
  route: () => Route;
};
```

What {@link onReportKeyDown} may ask the host to do, and what it reads from it.

#### `onReportKeyDown`

```ts
export function onReportKeyDown(
  e: KeyboardEvent,
  data: ReportData,
  h: KeyNavHandlers
): void
```

Handles one `keydown` for the viewer. Keys: Cmd/Ctrl+K palette; `?` help; Escape closes help or the palette,
else stops playback and returns to the list. On a test page: Left/Right/Home/End scrub frames, Space plays,
Up/Down jump between steps, `n`/`N` between failures, `[`/`]` to the previous/next test (keeping the list's
params), `1`-`9` pick a client, and, when the frame has a UI snapshot, `m` single/multi view, `a` aside, `p`
press targets, `f` cycles zoom (fit, 50, 75, 100).

Cmd/Ctrl+K and Escape-closing-the-palette work anywhere. Every other key is ignored while the palette is open and
while focus is in an input, textarea, select, button, link or editable element; the test-page keys also need the
route to be a test that is in `data`.

### Commit-keyed object-store key layout

Source: `packages/reports/src/keys.ts`. Import: `@crvouga/atlas/reports/keys`

Builds and validates the keys of the commit-addressed layout of the shared reports store. Historical recording
addresses use the full commit sha. Immutable report layers (`layers/…`, see `docs/report-contract.md`) combine
across those addresses:

  index/<13-digit inverted start ms>-<sha>.json   one per published commit;
                                                  sorted keys = newest first
  commits/<sha>/commit.json                       the commit's run record
  commits/<sha>/frame.css                         stylesheet for its snapshots
  commits/<sha>/sources/<source>.json             one source's test metas
  commits/<sha>/bundles/<source>.json              logical file locations
  commits/<sha>/blobs/<content hash>.gz            compressed chunks

Logical test and frame keys below are entries in the bundle indexes.

A source is one report bucket of one package (`libs-chess--part-2`).
Writers put a source's tests first and its `sources/` record last, so a
reader that sees the record can read every test it names.

Every builder validates its inputs (a full 40-hex sha, path-safe segments) and throws on a bad one, so a key
made here can never climb out of its prefix.

#### `REPORTS_ROOT_PREFIX`

```ts
export const REPORTS_ROOT_PREFIX = …
```

Where the reports live in their bucket. Every reader and writer scopes its
store to it, so the keys below are relative to it.

#### `COMMITS_INDEX_PREFIX`

```ts
export const COMMITS_INDEX_PREFIX = …
```

The prefix of the per-commit catalog entries, `index/`.

#### `isCommitSha`

```ts
export function isCommitSha(value: string): boolean
```

Whether the value is a full 40-digit lowercase hex commit sha (an abbreviated sha is not).

#### `isKeySegment`

```ts
export function isKeySegment(value: string): boolean
```

One path segment the harness could have written (never `.` or `..`).

#### `isFramePath`

```ts
export function isFramePath(value: string): boolean
```

A frame file relative to its test (`frames/f-0001.state.json`).

#### `sourceId`

```ts
export function sourceId(packageDir: string, bucket: string): string
```

The id of a source (one report bucket of one package): `libs/chess` + `part-2` → `libs-chess--part-2`. Throws `not a report source` when the result is not a safe key segment.

#### `commitIndexKey`

```ts
export function commitIndexKey(sha: string, startedAtMs: number): string
```

The catalog key of a commit, `index/<13-digit inverted start ms>-<sha>.json`: the time is inverted so a listing is newest first. Negative times count as 0. Throws for a sha that is not 40 hex digits.

#### `shaOfIndexKey`

```ts
export function shaOfIndexKey(key: string): string | null
```

The sha an index key names, or null for anything else.

#### `commitPrefix`

```ts
export function commitPrefix(sha: string): string
```

The folder of everything recorded for a commit, `commits/<sha>/`. Throws for a sha that is not 40 hex digits.

#### `commitKey`

```ts
export function commitKey(sha: string): string
```

The key of the commit's run record, `commits/<sha>/commit.json`.

#### `frameCssKey`

```ts
export function frameCssKey(sha: string): string
```

The key of the stylesheet the commit's snapshots render with, `commits/<sha>/frame.css`.

#### `sourcesPrefix`

```ts
export function sourcesPrefix(sha: string): string
```

The folder of a commit's source records, `commits/<sha>/sources/`.

#### `sourceKey`

```ts
export function sourceKey(sha: string, source: string): string
```

The key of one source's record, `commits/<sha>/sources/<source>.json`; written last, after the source's tests. Throws `not a source` for an unsafe name.

#### `sourceOfKey`

```ts
export function sourceOfKey(sha: string, key: string): string | null
```

The source a `sources/` key names, or null for anything else.

#### `remoteTestPrefix`

```ts
export function remoteTestPrefix(
  sha: string,
  source: string,
  testId: string
): string
```

The folder of one recorded test, `commits/<sha>/tests/<source>/<testId>/`. Throws for an unsafe source or test id.

#### `remoteTestReportKey`

```ts
export function remoteTestReportKey(
  sha: string,
  source: string,
  testId: string
): string
```

The key of a recorded test's report, `<test folder>/report.json`.

#### `remoteTestFileKey`

```ts
export function remoteTestFileKey(
  sha: string,
  source: string,
  testId: string,
  file: string
): string
```

The key of a file a recorded test captured (a frame, a snapshot), inside its folder. A leading `/` is dropped; throws `not a frame file` for a path with an unsafe segment (`..`, empty or odd characters).

#### `viewerTestId`

```ts
export function viewerTestId(source: string, testId: string): string
```

The id a viewer shows for a test of a source (`libs-chess--part-2/monkey`):
unique across the commit, since two packages may both name a test `monkey`.

#### `splitViewerTestId`

```ts
export function splitViewerTestId(
  id: string
): { readonly source: string; readonly testId: string } | null
```

The inverse of {@link viewerTestId}: splits at the first `/`; null when either side is not a safe key segment.

### Environment axis of a layer

Source: `packages/reports/src/layer-axes.ts`. Import: `@crvouga/atlas/reports/layer-axes`

Owns how a layer's `environment` (the client that was checked: `ios`, `desktop-web`, ...) is normalised to a stable
slug, read from either the `environment` field or an `environment` parameter, and shown to people. The environment
is part of the slot a check fills, so two spellings of one client must normalise to one id or their results would
never replace each other; an unrecognised name is kept as its own slug rather than rejected.

See docs/report-contract.md

#### `REPORT_ENVIRONMENTS`

```ts
export const REPORT_ENVIRONMENTS = …
```

The environments Atlas names and labels out of the box. Any other recorded name is kept, so a new
client layers beside these instead of being dropped or renamed away.

#### `normalizeEnvironment`

```ts
export function normalizeEnvironment(value: string | null | undefined): string | null
```

Turns any spelling of a client name into a stable lowercase slug, or `null` when none was given.

Trims, lowercases, turns whitespace and underscores into `-`, drops every other character outside `a-z0-9-`,
collapses repeated `-`, then maps known aliases (`iPhone` and `iPad` to `ios`, `mobile browser` to `mobile-web`,
`desktop` to `desktop-web`). A name with no alias is returned as its slug. `null`, `undefined` and a value that
slugs to nothing return `null`, which means "the layer did not say", so older layers still compose.

**Example**

```ts
normalizeEnvironment('Desktop Web'); // 'desktop-web'
normalizeEnvironment('iPhone'); // 'ios'
normalizeEnvironment('Smart TV'); // 'smart-tv'
normalizeEnvironment('  '); // null
```

#### `layerPlace`

```ts
export function layerPlace(summary: Pick<LayerSummary, 'environment' | 'parameters'>): { environment: string | null; parameters: LayerParameters }
```

Splits a layer into the two slot axes it fills: its normalised environment and its remaining parameters.

The environment is the layer's `environment` field, or when that is `null` or absent the `environment` parameter
(an empty-string field does not fall back to the parameter). The `environment` parameter is always removed from
the returned `parameters`, so it is never both an environment and a free choice that splits the slot twice.

#### `environmentLabel`

```ts
export function environmentLabel(id: string | null | undefined): string
```

The human label of an environment id: `Desktop web`, `Mobile web`, `iOS`, `Android` for the known ids,
`Unspecified` for a missing one, and otherwise the id with its first word capitalised and `-` shown as a space
(`smart-tv` reads `Smart tv`).

### Layer catalog of one backend

Source: `packages/reports/src/layer-catalog.ts`. Import: `@crvouga/atlas/reports/layer-catalog`

Lists what one backend holds as catalog entries (immutable layers under `layers/index/`, and commit-keyed
recordings written before layers existed) and turns one entry into the layer summaries it stands for. It only
reads: opening Atlas never rewrites a store. Whether a backend can be read at all, and how entries from several
backends combine, is decided by the callers (`compose.ts`, `layers-route.ts`).

See docs/report-contract.md

#### `catalogEntries`

```ts
export async function catalogEntries(store: ObjectStore): Promise<readonly string[]>
```

Lists one backend's catalog entries as opaque strings to pass to `catalogLayers`.

An entry is `layer:<key>` for each key under `layers/index/` (listed newest first, in the store's own key order),
followed by `commit:<sha>` for every 40-hex commit named by a key under `versions/` or `index/` (a store written
before layers existed, sorted by sha). Only lists keys; reads no layer. A store that cannot be listed throws.
Existing recordings are read in place and never rewritten.

#### `catalogLayers`

```ts
export async function catalogLayers(store: ObjectStore, entry: string): Promise<readonly LayerSummary[]>
```

Reads the layer summaries one catalog entry from `catalogEntries` stands for.

A `layer:` entry yields exactly one summary (the layer the catalog entry names, without its bundle) and throws
when the entry is not JSON, names no layer, the layer is missing, or the layer cannot be parsed, so the caller can
report it as a notice instead of counting it as a pass. A `commit:` entry yields the older commit-keyed
recordings of that sha: one summary per stored part (`part-<sha>-<id>`) and one per stored source
(`source-<sha>-<id>`); a part whose checks a source already carries, and that has no parameters, is dropped so the
same evidence is not counted twice. Those ids are mutable addresses, not content digests.

### Layer composition: slots, winners and de-duplication

Source: `packages/reports/src/layer-merge.ts`. Import: `@crvouga/atlas/reports/layer-merge`

The pure core of the composition rule: it flattens layers into rows, computes the slot key each row fills, decides
which result wins a slot, and removes the duplicate copies of one immutable layer held by several backends. It does
no I/O. The winner order (a completed result beats an unfinished one, then the newer `recordedAtMs`, then
`failed` over `passed` and `running` over `not-run`, then the greater `layerId|backendId`) is a total order and is
part of the stable report contract: changing it changes every report. `report-index.ts` folds layers into the same
winners incrementally and must always equal `combineEvidence`.

See docs/report-contract.md#how-layers-compose

#### `textFingerprint`

```ts
export function textFingerprint(text: string): string
```

A short, deterministic fingerprint of a spec's text, shaped `<length>:<hash>:<hash>` (the length in UTF-16 code
units and two 32-bit hashes in hex). A layer records it per spec so a reader can warn when the spec changed
since ("Potentially outdated: spec changed"). Advisory identity only: it is not collision resistant and never an
integrity check.

#### `specPath`

```ts
export function specPath(path: string): string
```

Normalises a check's or spec's path to its `specs/<path inside the specs directory>` form, so the same spec
recorded from different checkouts is one spec.

Converts `\` to `/`, drops a leading `./`, and drops everything before the first path segment named exactly
`specs`. A path with no such segment is returned unchanged (apart from the first two steps).

**Example**

```ts
specPath('packages/app/specs/join.feature'); // 'specs/join.feature'
specPath('myspecs/x.feature'); // 'myspecs/x.feature'
```

#### `parameterKey`

```ts
export function parameterKey(parameters: LayerParameters): string
```

Serialises parameters as JSON key/value pairs sorted by key, so equal parameter sets compare equal as strings.

#### `isDiagnosticKind`

```ts
export function isDiagnosticKind(kind: string): boolean
```

Whether a part `kind` only qualifies an outcome (today only `performance`) and so is not counted as a check when anything else is recorded.

#### `emptyCounts`

```ts
export function emptyCounts(): Record<EvidenceStatus, number>
```

A fresh status tally with every status at zero.

#### `outcomeCounts`

```ts
export function outcomeCounts(rows: readonly LayerRow[]): StatusCounts
```

Counts rows by status, leaving out the diagnostic rows (see `isDiagnosticKind`) that only qualify an outcome.
When every row is diagnostic they are counted, so a layer of timings alone is not empty.

#### `layerEvidence`

```ts
export function layerEvidence(summary: LayerSummary, backend: string): LayerEvidence
```

Flattens a layer into what composition reads: a header (origin, normalised environment and parameters, counts,
evidence summary), one row per check of every part, and the spec fingerprints it recorded.

`backend` is the id of the backend the layer was read from; it only breaks ties between copies. Paths in rows and
fingerprints go through `specPath`. When the layer has a recorded `source`, a row whose check id matches one of its
tests also gets that test's `testId`, `variant` and duration. The result is `live: false`: a layer read from a
store is never a run still in progress.

#### `EvidenceResult`

```ts
export type EvidenceResult = {
  /** One producer's check of one kind under one parameter set. See `resultKey`. */
  readonly key: string;
  /** The check itself, whatever kind of evidence and parameters describe it. See `slotKey`. */
  readonly slot: string;
  /** The layer that recorded this result. */
  readonly layer: LayerHeader;
  /** The check as recorded. */
  readonly row: LayerRow;
  /** The layer's parameters other than the environment. */
  readonly parameters: LayerParameters;
  /** Why the result may be out of date, or `null` when nothing suggests it. Advisory: never changes the status. */
  readonly warning: string | null;
};
```

The winning result of one slot: which layer and row it came from, and whether it may be stale.

#### `replaces`

```ts
export function replaces(next: EvidenceResult, prior: EvidenceResult): boolean
```

Whether `next` should take the slot currently held by `prior`: the winner rule of the report contract.

In order: a completed result (`passed`, `failed`) beats an unfinished one (`running`, `not-run`) whatever their
times; otherwise the greater `recordedAtMs` wins; at the same time `failed` beats `passed` and `running` beats
`not-run`; at the same status the greater `layerId|backendId` wins. The last step makes the order total, so the
answer never depends on the order results are offered in. Returns `false` for two identical results.

#### `CombinedEvidence`

```ts
export type CombinedEvidence = {
  /** One entry per spec of the outline, in outline order (a spec with no results has an empty list). */
  readonly specs: readonly { readonly spec: SpecEntry; readonly results: EvidenceResult[] }[];
  /** Winners whose spec path is absent or not in the outline (a removed spec keeps its evidence here). */
  readonly unassigned: EvidenceResult[];
};
```

The winners of every slot, grouped under the spec of the current outline they belong to.

#### `combineEvidence`

```ts
export function combineEvidence(outline: ReportOutline, layers: readonly LayerEvidence[]): CombinedEvidence
```

Lays layers over the outline of current specs and returns the winner of every slot.

One linear pass over the rows of the layers (after `distinctEvidence`). The slot is producer, kind, spec path,
check id, environment and parameters; `replaces` picks the winner, so the result does not depend on the order of
`layers`. Branch, sha, backend and run never split a slot. Each result carries a freshness `warning`, computed
against `outline`, that does not affect which result wins.

See /report-contract.md#how-layers-compose

#### `resultKey`

```ts
export function resultKey(layer: Pick<LayerHeader, 'producer' | 'environment' | 'parameters'>, row: Pick<LayerRow, 'kind' | 'specPath' | 'id'>): string
```

The key of the slot a row fills: a JSON array of producer, kind, spec path (`''` when none), check id, environment
(`''` when none) and the sorted parameters. Two results with the same key compete; the winner is `replaces`.

#### `layerResultKeys`

```ts
export function layerResultKeys(layer: Pick<LayerHeader, 'producer' | 'environment' | 'parameters'>): (row: Pick<LayerRow, 'kind' | 'specPath' | 'id'>) => string
```

`resultKey` for every row of one layer, which share all but three parts of it. The strings are exactly
those `resultKey` makes (they are keys that persist in no store, but two ways of making one must agree),
without sorting and writing the layer's parameters once per check.

#### `slotKey`

```ts
export function slotKey(path: string, id: string): string
```

The key of a check regardless of producer, environment and parameters: a JSON array of its spec path and check id.

#### `distinctHeaders`

```ts
export function distinctHeaders<T extends { readonly id: string; readonly execution: string; readonly backend?: string }>(layers: readonly T[]): T[]
```

De-duplicates layer headers: the same layer held by several backends is one layer.

Suppresses the mutable address of an execution already archived as an immutable layer. An
immutable layer (64-hex id) held by several backends is one layer, reported by the backend whose id sorts
first, whatever order they were read in. A mutable one is its backend's own and is kept once per backend.
Returns the survivors, not necessarily in input order.

#### `distinctEvidence`

```ts
export function distinctEvidence(layers: readonly LayerEvidence[]): LayerEvidence[]
```

Keeps, in input order, only the layers `distinctHeaders` keeps, and each `backend|id` once.

#### `distinctLayers`

```ts
export function distinctLayers(layers: readonly LayerSummary[]): LayerSummary[]
```

Drops each mutable layer whose execution is already archived as an immutable one, and keeps one summary per id.

#### `layerExecutionKey`

```ts
export function layerExecutionKey(layer: LayerSummary): string
```

A string equal for the mutable and the archived address of one execution: its producer, sha, time, parts and, when the producer named one, its execution id.
Object key order is ignored at every depth, including check evidence and extensions; array order is preserved.
This is an advisory execution identity, not the content digest that addresses an immutable layer in storage.

### Archiving a recorded run as a layer

Source: `packages/reports/src/layer-source.ts`. Import: `@crvouga/atlas/reports/layer-source`

Turns one published source (a package bucket of recorded statechart or test runs with timelines and screenshots)
into an immutable layer, so it composes with every other layer. It is the bridge from the commit-keyed recordings
to the layer store and is called only by `publishSource`.

#### `archiveSourceLayer`

```ts
export async function archiveSourceLayer(store: ObjectStore, args: PublishSourceArgs, source: SourceRecord, tests: readonly HtmlReportTest[], bundle?: BundleIndex)
```

Writes `source` and its recorded files as an immutable layer and returns it (see `publishLayerBundle`).

The layer is recorded at the later of the commit's start and the source's `updatedAtMs`, with the commit's branch and
run URL, the commit's spec inventory (empty when none), the source's parts, `parameters` from `args`, the environment
normalised from `args.environment` or the `environment` parameter, and `recording: { type: 'layer' }`. Its bundle
holds the commit's `frame.css` and each test's `tests/<testId>/report.json` and `tests/<testId>/files/<file>`.
`bundle`, when given, is an index of those files already written for this source (keys under
`commits/<sha>/tests/<source>/`); then only `frame.css` is written here and the index is re-keyed to the layer's
layout. The same inputs give the same layer, so publishing twice is harmless. Store errors reject.

### Layer storage

Source: `packages/reports/src/layer-store.ts`. Import: `@crvouga/atlas/reports/layer-store`

Reads and writes layers in an `ObjectStore`: the immutable manifest at `layers/manifests/<id>.json`, the catalog
entry at `layers/index/<inverted-time>-<id>.json`, and the captured files under `layers/blobs/`. A layer is written
bottom up (files, then manifest, then catalog entry) so a reader never meets an entry whose content has not arrived,
and every key is derived from content so two producers never write different bytes to one key.

See docs/report-contract.md#where-bytes-go

#### `LAYER_INDEX`

```ts
export const LAYER_INDEX = …
```

The key prefix under which every layer's catalog entry is written.

#### `layerKey`

```ts
export function layerKey(id: string): string
```

The store key of a layer's manifest. Throws `Invalid layer id` unless `id` is 64 lowercase hex digits, so an id can never address another key.

#### `publishLayer`

```ts
export async function publishLayer(store: ObjectStore, summary: Omit<LayerSummary, 'id'>, entries: AsyncIterable<BundleEntry>): Promise<ReportLayer>
```

Writes a layer whose captured files arrive as a stream, then its manifest and catalog entry, and returns it.

The files are packed into content-addressed blobs under `layers/blobs/` first (`writeBundle`), then
`publishLayerBundle` does the rest. The id is computed from the content, so publishing the same layer again
writes the same keys.

#### `layerCatalogKey`

```ts
export function layerCatalogKey(recordedAtMs: number, id: string): string
```

The key of a layer's catalog entry: `layers/index/<16 digits>-<id>.json`, where the digits are
`Number.MAX_SAFE_INTEGER - floor(max(0, recordedAtMs))` zero-padded. The time is inverted so a listing in key order
is newest first. The entry makes a layer visible, so it is written last, after the layer and its files.

#### `publishLayerBundle`

```ts
export async function publishLayerBundle(store: ObjectStore, summary: Omit<LayerSummary, 'id'>, bundle: BundleIndex): Promise<ReportLayer>
```

Writes a layer whose captured files are already stored (`bundle` locates them) and returns it with its id.

The id is the SHA-256 of the JSON of `{ schemaVersion, ...summary, bundle }`, so recording the same thing the same
way gives the same id. Writes the manifest only if `head` says it is absent, then always writes the catalog entry
(same key, same bytes on a repeat), so a retry is harmless and a crash between the two leaves a manifest no catalog
entry names, never the reverse. Store errors reject; nothing is validated here (the publishers do that).

#### `readLayer`

```ts
export async function readLayer(store: ObjectStore, id: string): Promise<ReportLayer | null>
```

Reads and validates a layer manifest, returning it without `schemaVersion`, or `null` when no manifest exists.

A manifest that is present but cannot be read is an error naming why, never a half-read layer: it throws when the
bytes are not JSON, fail the layer schema, or are a newer major schema version. Callers turn that into a notice,
which fails the gate. Throws `Invalid layer id` for a malformed `id`. The id is not recomputed from the content.

#### `readLayerFile`

```ts
export async function readLayerFile(store: ObjectStore, id: string, file: string)
```

Reads one captured file (a screenshot, a frame, a recorded report) of a layer, or `null` when the layer or the file is missing. Throws like `readLayer`.

#### `layerSummary`

```ts
export function layerSummary(layer: ReportLayer): LayerSummary
```

Drops a layer's bundle index, leaving the summary composition reads.

### Layer types

Source: `packages/reports/src/layer-types.ts`. Import: `@crvouga/atlas/reports/layer-types`

The in-memory shapes of a layer: `LayerSummary` (everything but its captured files), `ReportLayer` (the summary plus
the index of those files) and `ReportOutline` (the specs a report is laid over). The stored form is the layer
document of `packages/schema/src/layer.ts`; these types are what the reader and publisher code hands around after
parsing it. Fields follow the layer document, so adding a field here means adding an optional field there.

See docs/report-contract.md#the-layer-document

#### `LayerParameters`

```ts
export type LayerParameters = Readonly<Record<string, string>>;
```

String choices (such as `{ device: 'iphone-15' }`) that make a result its own slot. Compared as sorted key/value pairs.

#### `LayerExtras`

```ts
export type LayerExtras = Partial<Pick<import('../../schema/src/layer').LayerDocument, 'tags' | 'labels' | 'links' | 'attachments' | 'annotations' | 'extensions'>>;
```

What a layer may carry as a whole. All optional and open: see docs/extending.md.

#### `LayerSummary`

```ts
export type LayerSummary = LayerExtras & {
  /** `modified`: recorded from a checkout with uncommitted changes. `unknown`: origin not captured. Absent for a clean checkout. Advisory; never changes a status. */
  readonly freshness?: 'unknown' | 'modified';
  /** The layer's content digest: 64 lowercase hex digits. Opaque to readers. Legacy commit-keyed recordings use `part-<sha>-<id>` or `source-<sha>-<id>` instead. */
  readonly id: string;
  /** When the checks ran, epoch milliseconds. The newest completed result wins its slot. */
  readonly recordedAtMs: number;
  /** The stable name of the suite or tool that made the layer. Part of the slot. */
  readonly producer: string;
  /** Provenance: the commit recorded, or `null`. Never part of the slot. */
  readonly sha: string | null;
  /** Provenance: the branch recorded, or `null`. Never part of the slot. */
  readonly branch: string | null;
  /** The client this layer checked, when it said. Normalized when the layer is read. */
  readonly environment?: string | null;
  /** Provenance: the CI run that produced the layer, or `null`. Never part of the slot. */
  readonly runUrl: string | null;
  /** The execution (one invocation of a local or manual run) the layer belongs to, when the producer named one. Grouping and display only; never part of the slot. Absent: the run is told by `runUrl`, else `branch@sha`. */
  readonly run?: LayerRun;
  /** Free choices that make a result its own slot. The `environment` parameter is read as the environment (see `layerPlace`). */
  readonly parameters: LayerParameters;
  /** The specs the layer was recorded against, with fingerprints of their text. */
  readonly specs: readonly SpecEntry[];
  /** The checks, grouped by producer-defined kind. */
  readonly parts: readonly ReportPart[];
  /** The recorded statechart run behind the layer (timelines and tests), or `null` for a layer of plain checks. */
  readonly source: SourceRecord | null;
  /** Where the layer's timelines and captured files are read from: its own bundle (`layer`), an older commit-keyed recording (`commit`), or nowhere (`null`). */
  readonly recording: { readonly type: 'layer' } | { readonly type: 'commit'; readonly sha: string; readonly source: string } | null;
};
```

A layer without its captured files: what composition and the viewer's lists read.

#### `ReportLayer`

```ts
export type ReportLayer = LayerSummary & { readonly bundle: BundleIndex };
```

A layer with the index that locates its captured files (screenshots, frames) in the store.

#### `ReportOutline`

```ts
export type ReportOutline = {
  /** The specs that make the outline of the report. A spec here with no layer shows as having no results. */
  readonly specs: readonly SpecEntry[];
  /** The commit the specs are from, or `null` when unknown. */
  readonly sha: string | null;
  /** Paths changed since the layers were recorded; a result touching one is warned as potentially outdated. */
  readonly changedFiles: readonly string[];
};
```

The current specs a report is laid over, and the commit and changes freshness warnings are judged against.

### Layers HTTP routes

Source: `packages/reports/src/layers-route.ts`. Import: `@crvouga/atlas/reports/layers-route`

The read-only HTTP API the viewer uses to see layers: a paged list of layer headers merged from every backend, the
rows of one layer, its attachments and recorded timelines, the live runs still writing on this machine, and the
spec outline. It is mounted under `/api/reports` by `reportsHost` and by the Atlas server. Immutable layers (64-hex
ids) are read once and cached for good and answered with long-lived `immutable` cache headers; mutable commit-keyed
recordings are re-read after a short wait. A backend that cannot be listed or a layer that cannot be read becomes a
notice in the page, never a silent omission and never a pass. Layers the host's `include` filter rejects are absent
from every route here, so a filter cannot be undone by asking for history.

See docs/server.md
See docs/report-contract.md#failure-behaviour

#### `ReportBackend`

```ts
export type ReportBackend = {
  /** Stable and unique: lowercase letters, digits and hyphens. `local` and `shared` are taken. Appears in cursors and URLs. */
  readonly id: string;
  /** Human name shown for the backend in the viewer. */
  readonly label: string;
  /** Where the backend's layers are read from. */
  readonly store: ObjectStore;
};
```

A further store whose layers join the combined report, beside the local and the shared one. Passed as `backends` in `ReportsAppDeps`.

#### `LOCAL_BACKEND`

```ts
export const LOCAL_BACKEND = …
```

The id of the backend for this machine's own store (`localStore`), where runs may still be writing.

#### `SHARED_BACKEND`

```ts
export const SHARED_BACKEND = …
```

The id of the backend for the shared reports store (`store`).

#### `reportBackends`

```ts
export function reportBackends(deps: ReportsAppDeps): Backend[]
```

The stores that contribute layers, in the order they answer for a recording: `localStore` (id `local`, live), then
`store` (id `shared`) when it is a different store, then each of `backends`.

Throws `Invalid report backend id: "<id>"` when an extra backend's id is not lowercase letters, digits and hyphens
or repeats an earlier id (including `local` and `shared`).

#### `createLayersApp`

```ts
export function createLayersApp(deps: ReportsAppDeps)
```

Builds the Hono app that serves layers: bounded pages of layer origins, each layer's checks read once, and the
runs still writing. Throws (as `reportBackends`) when a backend id is invalid.

Routes, relative to where it is mounted:
- `GET /outline` the current specs as `{ specs, sha, changedFiles }` (503 when the host has no outline), cached 30 s.
- `GET /outline/spec?path=` one outline spec's text; 404 for a path not in the outline.
- `GET /evidence?cursor=&retry=` one page of layer headers (`EvidencePage`) from 40 catalog entries across all
  backends: immutable layers newest first, then commit-keyed recordings. Without a cursor it also carries the live
  runs of this machine. `cursor` is the previous page's; 409 when it no longer matches the listing (refresh).
  Any `retry` value re-lists backends that were unavailable now instead of after the wait.
- `GET /evidence/rows/:backend/:id` the checks and spec fingerprints of one layer (`LayerRows`).
- `GET /evidence/detail/:backend/:id?check=&kind=` the run-level evidence of an immutable layer, or one check's detail.
- `GET /layers/:id/blobs/*` an attachment of an immutable layer by its bundle key, served by `attachmentResponse`.
- `GET /layers/:id/*` the recorded `frame.css`, `tests/<test>/report.json` and `tests/<test>/files/<frame>` of a layer.
- `GET /live/:source/frame.css` and `GET /live/:source/tests/:testId/*` the same for a run still writing (uncached).

Directory listings are cached for 30 s (1.5 s for the local store). A listing that fails keeps the previous keys and
marks the backend unavailable; the page then carries a notice.

### live-reporter.ts

Source: `packages/reports/src/live-reporter.ts`. Import: `@crvouga/atlas/reports/live-reporter`

@module Reporting a live run to Atlas
Streams bounded check deltas while tests execute. Heartbeats are independent of progress; finished results are
published by the server as ordinary immutable layers. A final flush is awaited before a runner exits.

#### `LiveIdentity`

```ts
export type LiveIdentity = Omit<z.input<typeof LiveRunStartSchema>, 'id'> & { id?: string };
```

Fixed identity of a live invocation; a UUID is generated when omitted.

#### `LiveReporterOptions`

```ts
export type LiveReporterOptions = { url: string; project?: string; token?: string; flushMs?: number; heartbeatMs?: number; timeoutMs?: number; onError?: (error: Error) => void };
```

Transport and batching configuration. Defaults: 250 ms batches, 5 s heartbeats and 10 s request timeouts.

#### `LiveReporter`

```ts
export type LiveReporter = { readonly id: string; readonly finishedAtMs?: number; check(check: LiveCheck): void; flush(): Promise<void>; finish(status?: 'completed' | 'interrupted', reason?: string): Promise<void> };
```

Producer handle. check never throws transport errors into a test; finish flushes and rejects if publication failed.

#### `createLiveReporter`

```ts
export function createLiveReporter(identity: LiveIdentity, options: LiveReporterOptions): LiveReporter
```

Start publishing immediately, batch changing checks, and send independent heartbeats while the producer is alive.
The same failed batch is retried with the same sequence and content; never silently replace a lost update.

**Example**

```ts
const run = createLiveReporter({ producer: 'unit', plannedChecks: 10 }, { url: 'http://localhost:5180' });
run.check({ id: 'a', title: 'Adds a todo', status: 'running' });
run.check({ id: 'a', title: 'Adds a todo', status: 'passed' });
await run.finish();
```

### Media types by file extension

Source: `packages/reports/src/media-types.ts`. Import: `@crvouga/atlas/reports/media-types`

A small fixed table from file extension to media type, used when a captured file arrives without a type. It is a
fallback guess from the name only: the bytes are never sniffed, and a type the producer gave always wins.

#### `contentTypeOf`

```ts
export function contentTypeOf(file: string): string
```

The media type for a file name, from its last extension, case-insensitively. Anything not in the table, and a name
with no extension, is `application/octet-stream`. Never reads the content.

### Object key guards

Source: `packages/reports/src/namespace-guard.ts`. Import: `@crvouga/atlas/reports/namespace-guard`

Throws on object-store keys that could escape their prefix. The checks are lexical only (empty, leading `/`, `..`,
missing namespace); they do not normalise a key or decide whether an object exists.

#### `assertRemoteObjectKey`

```ts
export function assertRemoteObjectKey(key: string, namespace: string): void
```

Validates a wire key before any remote object-store I/O. Every S3 command
for the shared bucket must pass this gate so projects cannot clobber
each other's prefixes.

Throws `Error` when `key` is empty, starts with `/`, contains `..` anywhere, is exactly `namespace` (with or without
a trailing `/`), or does not start with `namespace`. Returns nothing when the key is acceptable.

#### `assertLogicalObjectKey`

```ts
export function assertLogicalObjectKey(key: string): void
```

Validates a logical key before {@link ObjectStoreWithPrefix} scopes it under
a namespace or feature prefix. Throws `Error` when `key` is empty, starts with `/`, or contains `..` anywhere.

### Explorer navigation host

Source: `packages/reports/src/navigation.ts`. Import: `@crvouga/atlas/reports/navigation`

The seam between a reports explorer and the page it is embedded in: where the address (hash), keyboard and title
live. It is a type only; a host (usually the browser) supplies the implementation, which keeps the explorer free of
`window` and testable.

#### `ReportNavigation`

```ts
export type ReportNavigation = {
  /** The current location hash, as the host holds it, with or without the leading `#` (the route parser accepts both). */
  readonly readHash: () => string;
  /** Sets the hash (given with its leading `#`, like `#/test/<id>`); `replace` true replaces the current history entry instead of adding one. */
  readonly writeHash: (hash: string, replace: boolean) => void;
  /** Calls `listener` whenever the hash changes; returns the function that stops listening. */
  readonly subscribeHash: (listener: () => void) => () => void;
  /** Calls `listener` for keyboard events scoped to this explorer; returns the function that stops listening. */
  readonly subscribeKeys: (
    listener: (event: KeyboardEvent) => void
  ) => () => void;
  /** Sets the page title. */
  readonly setTitle: (title: string) => void;
};
```

Host navigation and keyboard events, scoped to one reports explorer.

### Reading and writing whole objects

Source: `packages/reports/src/object-io.ts`. Import: `@crvouga/atlas/reports/object-io`

Small helpers over `ObjectStore` for the common case of an object read or written whole: draining a stream,
decoding UTF-8, and encoding text for `put`. They hold the object in memory, so they are for manifests, catalog
entries and bounded blobs, not for large files. Errors from the store are not caught.

#### `readBytes`

```ts
export async function readBytes(
  stream: ReadableStream<Uint8Array>
): Promise<Uint8Array>
```

Drains a stream into one byte array (it reads the stream to its end; it holds every chunk in memory).

#### `readUtf8`

```ts
export async function readUtf8(
  store: ObjectStore,
  key: string
): Promise<string | null>
```

Reads an object as UTF-8 text, or `null` when the key is missing. Invalid UTF-8 is decoded leniently (replacement characters), not rejected. Transport errors throw.

#### `writeUtf8`

```ts
export async function writeUtf8(
  store: ObjectStore,
  key: string,
  text: string,
  contentType = 'text/plain; charset=utf-8'
): Promise<void>
```

Writes UTF-8 text under `key` with the given content type (default `text/plain; charset=utf-8`). Overwrites; transport errors throw.

#### `readObjectBytes`

```ts
export async function readObjectBytes(
  store: ObjectStore,
  key: string
): Promise<Uint8Array | null>
```

Reads an object's bytes whole, or `null` when the key is missing. Transport errors throw.

### ObjectStore conformance check

Source: `packages/reports/src/object-store-conformance.ts`. Import: `@crvouga/atlas/reports/object-store-conformance`

Runs the `ObjectStore` contract against any implementation, so a new backend (GCS, an HTTP service, a device lab) can
prove it composes with the others before it holds evidence. It is a plain async function with no test-runner
dependency. It writes only under a scratch prefix and removes what it wrote.

See docs/report-contract.md#backends

#### `StoreVerification`

```ts
export type StoreVerification = { readonly ok: boolean; readonly failures: readonly string[] };
```

The outcome of `verifyObjectStore`: `ok` is true exactly when `failures` is empty.

#### `verifyObjectStore`

```ts
export async function verifyObjectStore(store: ObjectStore, scratch = `atlas-conformance-${Math.random().toString(36).slice(2, 10)}/`): Promise<StoreVerification>
```

Checks a backend against the {@link ObjectStore} contract before trusting it with evidence. It
writes a few objects under a scratch prefix and removes them. Use it in the test suite of an S3,
GCS, R2 or HTTP adapter; an adapter that passes composes with every other backend.

It is a plain async function, so it runs under any test runner and from a script. It checks: a missing key reads
`null` (`get`, `getUri`) and `false` (`head`); `put` overwrites and round-trips bytes, size and content type;
`listKeys` is in code-unit order, filters by any string prefix and is empty for an unused one; `withPrefix` scopes
reads and writes; `delete` and `deleteMany` accept missing keys. A failed expectation is reported in `failures`;
an exception from the store is reported as one `threw: ...` failure rather than thrown. It does not check
`listPage`.

- `store`: the backend to verify.

- `scratch`: the key prefix to write under; defaults to a random `atlas-conformance-<id>/`. If you pass one,
nothing else may live under it: the check asserts that `listKeys(scratch)` returns exactly the four objects it wrote.

**Example**

```ts
const { ok, failures } = await verifyObjectStore(myStore);
if (!ok) throw new Error(failures.join('\n'));
```

### ObjectStore interface

Source: `packages/reports/src/object-store.ts`. Import: `@crvouga/atlas/reports/object-store`

The one interface a backend implements: seven async methods over keys and bytes, with no transactions, renames,
locks or conditional writes. That is what lets a directory, an S3-compatible bucket, an HTTP server and a device
lab hold the same report. Implementations here are `directoryStore`, `s3Store` and `httpStore`; `verifyObjectStore`
proves a new one. This interface is part of the stable report contract.

Read semantics: `get` returns `null` when the key is missing; transport and parse errors throw. `head` returns
`false` for a missing key and never throws on "not found".

Write semantics: `put` is idempotent (writing a key twice overwrites without error) and the stored `contentType`
round-trips through `get`. `delete` and `deleteMany` on a missing key are no-ops.

URI semantics: `getUri` returns a URL the host can load directly (a `file://` URL for a directory, a presigned URL
for S3), or `null` for a missing key or a store with no addressable URL.

Listing: `listKeys` returns keys in sorted code-unit order, optionally only those starting with `prefix`.

See docs/report-contract.md#backends

#### `StoredObject`

```ts
export interface StoredObject {
  /** Stream of stored bytes. Single-use; consume or discard before issuing more I/O on the same store. */
  readonly body: ReadableStream<Uint8Array>;
  /** The media type the object was written with. */
  readonly contentType: string;
  /** The length of the object in bytes. */
  readonly size: number;
}
```

An object read from a store: a one-shot byte stream with its media type and length.

#### `ObjectStore`

```ts
export interface ObjectStore {
  /** Returns the stored object, or `null` if no value exists for `key`. */
  get(key: string): Promise<StoredObject | null>;

  /** Idempotently writes `bytes` under `key` with the given `contentType`. */
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;

  /** `true` iff a value exists for `key`. Never throws on "not found". */
  head(key: string): Promise<boolean>;

  /** Removes the value at `key` if present. No-op when missing. */
  delete(key: string): Promise<void>;

  /** Remove every key, idempotently. Errors (including partial failure) throw. */
  deleteMany(keys: readonly string[]): Promise<void>;

  /**
   * Returns a URL that the host runtime can load directly without reading bytes
   * through {@link ObjectStore.get} again. Returns `null` for missing keys, and
   * `null` for stores whose backend has no addressable URL (e.g. R2).
   */
  getUri(key: string): Promise<string | null>;

  /**
   * Returns keys present in the store, sorted by code-unit order.
   * When `prefix` is set, only keys that start with it are returned.
   */
  listKeys(prefix?: string): Promise<readonly string[]>;

  /**
   * Returns a new store scoped to `prefix`. Caller keys are relative (must not
   * include the prefix). All I/O operates on `prefix + key`. Nested calls compose
   * prefixes (`a/` + `b/` → `a/b/`).
   */
  withPrefix(prefix: string): ObjectStore;
}
```

A place that holds objects by key: the backend interface of the report contract. Keys are `/`-separated strings; see each method for its rules.

#### `PagedListing`

```ts
export interface PagedListing {
  listPage(prefix: string, options?: { readonly after?: string; readonly limit?: number }): Promise<{ readonly keys: readonly string[]; /** The `after` for the next page, or null on the last. */ readonly next: string | null }>;
}
```

Optional, beyond the seven methods: list one page of keys, starting after a key. A reader that has
already seen most of a catalog uses it to find what is new without listing all of it. A store without
it works the same, a little slower. Pages are in the same code-unit order as {@link ObjectStore.listKeys}.

#### `isPaged`

```ts
export function isPaged(store: ObjectStore): store is ObjectStore & PagedListing
```

Whether a store also implements `PagedListing`.

### Consumer package-manager commands

Source: `packages/reports/src/package-managers.ts`. Import: `@crvouga/atlas/reports/package-managers`

One source for commands emitted by init, the running server's agent guide, and generated documentation.
Execute the installed CLI so a consumer keeps the versions selected by its own manifest and lockfile.

#### `PACKAGE_MANAGERS`

```ts
export const PACKAGE_MANAGERS = …
```

Supported consumer package managers, their development install command and installed-binary executor.

#### `packageManagerTable`

```ts
export function packageManagerTable(): string
```

Markdown installation table for consumer and server agent documentation.

**Example**

```ts
const markdown = packageManagerTable(); // the same commands `atlas init` emits
```

### Schema parsing with readable errors

Source: `packages/reports/src/parse-with.ts`. Import: `@crvouga/atlas/reports/parse-with`

One helper that parses untrusted input with a Zod schema and turns every problem into a single error message that
names each failing path, so a publisher can tell a person exactly which field to fix.

#### `parseWith`

```ts
export function parseWith<S extends z.ZodType>(schema: S, input: unknown, subject: string): z.output<S>
```

Parses `input` with `schema` and returns the parsed value, or throws one `Error` naming every problem by its path.

The message is `<subject>: <path>: <message>; <path>: <message>`, with `(input)` as the path of a problem at the
root. Nothing is returned partially: on any problem it throws.

- `subject`: what is being parsed, as the person would call it (for example `checks file`); prefixes the message.

### Performance part of a report

Source: `packages/reports/src/performance-part.ts`. Import: `@crvouga/atlas/reports/performance-part`

Turns the measured step timings of recorded test runs into a `performance`-kind report part, one check per run,
so slow actions show beside the behaviour checks. The part is diagnostic: `performance` is the kind that composition
leaves out of counts when anything else was recorded, and a measurement over its limit never fails a check on its
own (here only a step over the allowance marks the diagnostic check `failed`).

See docs/report-contract.md#statuses-and-the-gate

#### `performancePart`

```ts
export function performancePart(args: {
  readonly sha: string;
  readonly recordedAtMs: number;
  readonly allowanceMs: number;
  readonly reports: readonly RunReport[];
}): ReportPart
```

Builds a `performance` part with one check per run report, judging each step's own recorded time against
`allowanceMs`. No missing measurement becomes a pass.

A check is `failed` when any step's self time is over `allowanceMs`; `not-run` when the run has no steps or any step
has no measurement; otherwise `passed`. Its `id` and `title` are the run's `testId` and `title`, its `specPath` the
run's `sourceFile` when known, and it carries one measurement, `Longest own action` in ms with the allowance as its
`limit`, when anything was measured. The part's id is `recorded-performance`. Throws `Invalid performance allowance`
when `allowanceMs` is not a positive finite number.

- `args.sha`: the commit the runs were recorded at.

- `args.recordedAtMs`: when the runs were recorded, epoch milliseconds.

- `args.allowanceMs`: the diagnostic allowance for one step's own time, in milliseconds.

- `args.reports`: the recorded runs.

### Performance heat of recorded steps

Source: `packages/reports/src/performance.ts`. Import: `@crvouga/atlas/reports/performance`

Classifies each step of a recorded run by how long its own work took against an allowance, ranks hotspots, and
indexes steps to a frame for a heatmap. Pure functions over `ReportStep` trees. The allowance is a diagnostic
threshold, not a portable CPU or paint-time assertion.

#### `HeatBand`

```ts
export type HeatBand = 'unmeasured' | 'cool' | 'warm' | 'slow';
```

How a step's own time compares with the allowance: `unmeasured` (no valid time), `cool`, `warm` (over a quarter of it) or `slow` (over it).

#### `PerformanceRow`

```ts
export type PerformanceRow = FlatStep & {
  /** The step's `performance.selfMs` classified by `heatBand`. */
  readonly band: HeatBand;
};
```

A flattened step with its heat band.

#### `heatBand`

```ts
export function heatBand(
  ms: number | undefined,
  allowanceMs: number
): HeatBand
```

Classifies a duration in milliseconds against `allowanceMs`: `unmeasured` when it is missing, not finite or
negative; `slow` when over the allowance; `warm` when over a quarter of it; otherwise `cool`.

#### `performanceRows`

```ts
export function performanceRows(
  steps: readonly ReportStep[],
  allowanceMs: number
): PerformanceRow[]
```

Flattens a step tree depth-first (parents before children) into rows, each banded by its own recorded time (`performance.selfMs`) against `allowanceMs`.

#### `performanceHotspots`

```ts
export function performanceHotspots(
  rows: readonly PerformanceRow[]
): PerformanceRow[]
```

The measured rows, longest own time first and earlier rows first on a tie. Self time attributes nested work once, instead of ranking every ancestor as slow. Sorts in place the array it builds, not `rows`.

#### `measuredMs`

```ts
export function measuredMs(ms: number): string
```

Formats a millisecond duration for display with two decimals, like `12.34 ms`.

#### `performanceFrameIndex`

```ts
export function performanceFrameIndex(
  rows: readonly PerformanceRow[],
  frames: readonly FlatFrame[]
): ReadonlyMap<ReportStep, FlatFrame>
```

Maps each step to a frame in one linear pass: its own first frame, or failing that the first frame of its first
child that has one (found walking `rows` from the end, so deeper steps resolve first). Steps with no frame in their
subtree are absent. Meant for a large heatmap where a per-step search would be quadratic.

### Query cache persistence

Source: `packages/reports/src/persist.ts`. Import: `@crvouga/atlas/reports/persist`

Persists the viewer's TanStack query cache into a `ReportCache` (IndexedDB in the browser) so a reload starts from
what was already fetched. Frame-file queries stay out of this document: those bytes live in `ReportCache` on their
own keys.

#### `reportPersister`

```ts
export function reportPersister(cache: ReportCache): Persister
```

A TanStack `Persister` that keeps the whole query client as one JSON string under one key in `cache`. A stored value that is not valid JSON is removed and treated as no cache.

#### `attachReportCache`

```ts
export function attachReportCache(
  client: QueryClient,
  cache: ReportCache
): [() => void, Promise<void>]
```

Restores the query client from `cache`, then keeps writing it back as queries change. Returns
`[unsubscribe, restored]`: the function that stops writing, and a promise that settles when the restore is done.
Only successful queries are stored, never `blob` queries (those are the frame files); a stored cache older than a
week, or from a different cache version, is discarded.

### Phone frame geometry

Source: `packages/reports/src/phone.ts`. Import: `@crvouga/atlas/reports/phone`

The fixed size of the phone-shaped frame snapshots are shown in, how to scale it to a box, and cleaning of
recorded page HTML before it is shown.

#### `PHONE_W`

```ts
export const PHONE_W = …
```

Width of the phone frame snapshots render in, in CSS pixels.

#### `PHONE_H`

```ts
export const PHONE_H = …
```

Height of the phone frame snapshots render in, in CSS pixels.

#### `zoomScale`

```ts
export function zoomScale(mode: string, wrapW: number, wrapH: number): number
```

The scale to draw the phone frame at: a fixed `0.5`, `0.75` or `1` for modes `'50'`, `'75'`, `'100'`; for any other
mode, the largest scale up to 1 that fits a wrapper of `wrapW` by `wrapH` pixels (leaving 8 px), or `0.4` when
that is not a positive finite number.

#### `cleanSnapshotHtml`

```ts
export function cleanSnapshotHtml(html: string): string
```

Removes every `<script>` element and the `<link>` to `snapshot-shell.css` from recorded page HTML. The stylesheet is
replaced by the layer's `frame.css`. This is a regex rewrite, not a sanitiser: inline event handlers and everything
else stay, so it is not a security boundary (render snapshots in a sandbox).

### Commit-keyed recording protocol

Source: `packages/reports/src/protocol.ts`. Import: `@crvouga/atlas/reports/protocol`

The shapes of what the reports store holds for a commit (`commits/<sha>/commit.json`, `sources/<source>.json`) and of
the Server-Sent Events a reports API streams about them, plus the codec for those events. These are the older,
commit-keyed recordings that layers are composed beside; layers themselves are described by the layer document.
Types and a small codec only, so it is safe in a Worker, a CLI and a browser alike.

See docs/report-backends.md

#### `CommitState`

```ts
export type CommitState = 'running' | 'complete';
```

`running` until the run that publishes the commit closes it.

#### `CommitRecord`

```ts
export type CommitRecord = {
  /** The full 40-hex commit sha. */
  readonly sha: string;
  readonly branch: string;
  /** The CI run that published it, or `null`. */
  readonly runUrl: string | null;
  readonly state: CommitState;
  /** When the run started, epoch milliseconds. */
  readonly startedAtMs: number;
  /** When the run closed, epoch milliseconds; `null` while running. */
  readonly endedAtMs: number | null;
  /** Worst status over every source; null while running. */
  readonly status: ReportTestStatus | null;
};
```

`commits/<sha>/commit.json`: one published run of every spec of a commit.

#### `SourceRecord`

```ts
export type SourceRecord = {
  /** Producer measurements travel with reusable source content. */
  readonly evidence?: readonly ReportPartOutput[];
  /** The source id: the package dir with `/` as `-`, `--`, and the bucket (`libs-chess--part-2`). */
  readonly source: string;
  /** Repo-relative package dir (`libs/chess`). */
  readonly packageDir: string;
  /** The bucket under the package's report dir (`part-2`, `all`). */
  readonly bucket: string;
  /** `failed` if any test failed, `skipped` if all were skipped, else `passed`. */
  readonly status: ReportTestStatus;
  /** When the source was last updated, epoch milliseconds; the layer made from it is recorded at this time (or the commit's start if later). */
  readonly updatedAtMs: number;
  /** The client this source checked, when the run said. */
  readonly environment?: string;
  /** Recorded choices other than the client, such as an example or a device size. */
  readonly parameters?: Readonly<Record<string, string>>;
  /** Each test's meta, test-runner outcomes already applied. */
  readonly tests: readonly RunReportMeta[];
};
```

`commits/<sha>/sources/<source>.json`: one package bucket's tests.

#### `CommitPage`

```ts
export type CommitPage = {
  readonly commits: readonly CommitRecord[];
  /** Pass back as `?cursor=` for the next, older page; null on the last. */
  readonly cursor: string | null;
  /** The checkout the host serves, when it serves one. */
  readonly workspace?: WorkspaceVersion;
  /** Why the list is partial or empty, for a person to read. */
  readonly notice?: string;
  /** Versions that have evidence in the stores, on the first page only. */
  readonly evidenceVersions?: readonly string[];
};
```

One page of the commit list (`GET /` of the reports API), newest commit first.

#### `CommitEvent`

```ts
export type CommitEvent =
  | { readonly type: 'commit'; readonly commit: CommitRecord | null }
  | { readonly type: 'source'; readonly source: SourceRecord }
  | { readonly type: 'end'; readonly state: CommitState | 'missing' };
```

`GET …/:sha/events`: the commit, then each source as it is read.

#### `TestEvent`

```ts
export type TestEvent =
  | { readonly type: 'report'; readonly report: RunReport }
  | {
      readonly type: 'blob';
      readonly file: string;
      readonly blob: HtmlReportBlob;
    }
  | { readonly type: 'end'; readonly found: boolean };
```

`GET …/:sha/tests/:source/:testId/events`: a test, then its frame files.

#### `EVENT_STREAM_CONTENT_TYPE`

```ts
export const EVENT_STREAM_CONTENT_TYPE = …
```

The `content-type` of an event stream response.

#### `encodeSseEvent`

```ts
export function encodeSseEvent(event: CommitEvent | TestEvent): string
```

Encodes one event as one SSE message: `event:` is the event's `type`, `data:` its JSON, ended by a blank line.

#### `SseDecoder`

```ts
export class SseDecoder<T>
```

Incremental SSE decoder: feed it text as it arrives, get back each
complete message's parsed `data`. Only `data:` lines matter here (every
event repeats its type in its JSON); comments and other fields are skipped.

- `push(chunk: string): T[]` — Adds `chunk` (any split of the stream, `\r\n` and `\r` read as `\n`) and returns the parsed `data` of every message it completes, in order. An unfinished message is kept for the next call. A message with no `data:` line is skipped. Throws a `SyntaxError` when a message's data is not JSON; that message is already consumed.

### Per-attempt publication scope

Source: `packages/reports/src/publication.ts`. Import: `@crvouga/atlas/reports/publication`

Lets concurrent CI attempts for one commit publish without overwriting each other: a store view that redirects the
commit-local keys (`commits/<sha>/...`) into `attempts/<publicationId>/`, while immutable shared content
(the spec inventory and spec bodies, blobs, layers) stays where it is. `reportStore` finds the right view for a
commit from the pointer `openCommit` leaves.

#### `publicationStore`

```ts
export function publicationStore(
  store: ObjectStore,
  publicationId: string
): ObjectStore
```

A view of `store` for one CI attempt: keys under `commits/` go to `attempts/<publicationId>/commits/...`, except
`commits/<sha>/inventory.json` and `commits/<sha>/specs/...`, which stay shared; all other keys are unchanged.
Listing a `commits/` prefix lists only the attempt's own copies, with the `attempts/<id>/` part removed.

Throws `Invalid report publication id` unless `publicationId` is letters, digits, `.`, `_`, `:` or `-` and is not
`.` or `..`, so an id can never address another key.

#### `reportStore`

```ts
export async function reportStore(
  store: ObjectStore,
  sha: string
): Promise<ObjectStore>
```

The store view to read a commit's records from: the attempt-scoped view when the commit's `commit.json` is a
pointer `{ "publicationId": ... }` (written by `openCommit` when given a `publicationId`), otherwise `store`
itself, also when the commit has no record. Throws if `commit.json` is not JSON.

### Publishing checks as a layer

Source: `packages/reports/src/publish-checks.ts`. Import: `@crvouga/atlas/reports/publish-checks`

`publishChecks` turns the checks of one producer into one immutable layer in any store: the whole integration for a suite
that has no timeline to record. Attachments of any kind are stored by content (the same screenshot attached ten times is
stored once). Nothing here reads a clock or the environment, so the same input is always the same layer and a retried CI
step changes nothing.

See docs/integrating.md
See docs/extending.md

#### `PublishChecksOptions`

```ts
export type PublishChecksOptions = {
  /** Refuse a single attachment larger than this many bytes. Default 512 MiB. */
  readonly maxAttachmentBytes?: number;
  /** Refuse a layer whose attachments together are larger than this, because they are held in memory while stored. Default 2 GiB. */
  readonly maxTotalAttachmentBytes?: number;
};
```

Limits that protect the machine publishing: the largest single attachment, and the most attachment bytes in one layer (they are held in memory while stored).

#### `publishChecks`

```ts
export async function publishChecks(store: ObjectStore, input: PublishChecksInput, options: PublishChecksOptions = {}): Promise<ReportLayer>
```

Publish the checks of one producer as one immutable layer. This is the whole integration for a
suite that has no timelines to record: Gherkin scenarios, a Quint run, a DMN table test, an SLO
evaluation, a linter, anything that ends in "this check passed or failed".

A check may carry whatever evidence its framework has: attachments of any media type (screenshots,
videos, traces, logs, DOM snapshots…), timeline steps, annotations, retries, tags, labels, links and
namespaced `extensions`. All of it is optional (docs/extending.md).

Nothing here reads a clock: `recordedAtMs` is when the checks ran, given by the caller. Publishing
the same input twice therefore writes the same layer, and a retried CI step changes nothing.
Each check's `id` is its identity across runs. It must be stable and unique within the layer.

### Publishing commit-keyed recordings

Source: `packages/reports/src/publish.ts`. Import: `@crvouga/atlas/reports/publish`

The write side of the older, commit-keyed shared store: what CI runs after a spec suite recorded timelines with
screenshots. `openCommit` starts a commit, `publishSource` copies one package bucket's recorded tests into the store
(and also archives it as an immutable layer, so it composes with every other layer), and `closeCommit` finishes the
commit. Pure over two injected `ObjectStore`s, the local report bucket a test run wrote and the shared store, so it
runs the same against a directory, S3 or memory. Writes go content first, then the record that names it, so a
reader that sees a record can read everything it names. Plain checks from JUnit, CTRF or a checks file do not go
through here: they use `publishChecks`.

See docs/report-backends.md

#### `SPEC_RUN_ID`

```ts
export const SPEC_RUN_ID = …
```

The run id every spec suite writes its bucket under.

#### `OpenCommitArgs`

```ts
export type OpenCommitArgs = {
  /** The full 40-hex commit sha. */
  readonly sha: string;
  readonly branch: string;
  /** The CI run publishing this commit, or `null`. */
  readonly runUrl: string | null;
  /** When the run started, epoch milliseconds; it also orders the commit list (newest first). */
  readonly startedAtMs: number;
  /** Stylesheet the commit's HTML snapshots render with. */
  readonly frameCss: string;
  /** Concurrent CI attempts own independent commit-local files. Letters, digits, `.`, `_`, `:` and `-`; see `publicationStore`. */
  readonly publicationId?: string;
};
```

What `openCommit` needs to start a commit's run.

#### `openCommit`

```ts
export async function openCommit(
  store: ObjectStore,
  args: OpenCommitArgs
): Promise<CommitRecord>
```

Marks a commit's run as started and lists it (newest first), returning the `running` record.

Writes the snapshot stylesheet first, so a test is viewable the moment it lands, then `commit.json`, then the
`index/` entry that lists the commit, and, only when `publicationId` is given, last the pointer that tells readers
to look under that attempt. With a `publicationId` the stylesheet and record are written in the attempt's scope, not
the shared one. Calling it again for the same sha and attempt rewrites the same keys. Store errors reject.

#### `PublishSourceArgs`

```ts
export type PublishSourceArgs = {
  /** Execution completion time, separate from a virtual timeline clock. Epoch milliseconds. Default: the latest test's `endedAtMs`. */
  readonly recordedAtMs?: number;
  /** Recorded on the layer: `modified` when the run was from a checkout with uncommitted changes, `unknown` when its origin is unknown. */
  readonly freshness?: 'unknown' | 'modified';
  /** The client this run checked: desktop web, mobile web, iOS, Android, or another recorded name. */
  readonly environment?: string;
  /** Choices other than the client that make this its own slot (see `LayerParameters`). */
  readonly parameters?: LayerParameters;
  /** The full 40-hex commit sha the run is for. */
  readonly sha: string;
  /** Repo-relative package dir; with `bucket` it forms the source id (`libs-chess--part-2`). */
  readonly packageDir: string;
  /** The bucket under the package's report dir (`part-2`, `all`). */
  readonly bucket: string;
  /** The package's local report bucket (`.cache/harness-report/<bucket>`). */
  readonly local: ObjectStore;
  /** The run id the tests were written under in `local`. Default: `latest` (`SPEC_RUN_ID`). */
  readonly runId?: string;
  /** Only a passing execution is reusable under its exact task hash. */
  readonly identity?: SourceIdentity;
  /** Forces the source's status to `failed`; any other value is ignored and the status is computed from the tests. */
  readonly status?: ReportTestStatus;
};
```

What `publishSource` needs to publish one package bucket of recorded tests.

#### `publishSource`

```ts
export async function publishSource(
  store: ObjectStore,
  args: PublishSourceArgs
): Promise<SourceRecord | null>
```

Copies one package bucket into the store: every test (runner outcomes from the bucket's `junit.xml` applied) and its
frame files, then the source record last, so a reader that sees the record can read every test it names; finally it
archives the source as an immutable layer. Returns the record, or `null` when the bucket recorded no test and
neither `identity` nor `status` was given.

The source's status is `failed` when `args.status` is `failed`, else `failed` if any test failed, `skipped` if all
were skipped, else `passed`. A passing source with an `identity` is stored once, content-addressed by its task
hash, and referenced from the commit; any other source gets its files in the commit's bundle. When the bucket has no
`ui-quality` or `performance` part of its own, a `performance` part with a 50 ms allowance is derived from the
tests. Throws on a source id that is not a valid key segment, a part that fails `validatePart`, or a store error;
a failure part-way leaves unreferenced content, never a record that names missing content.

#### `CloseCommitArgs`

```ts
export type CloseCommitArgs = {
  /** The full 40-hex commit sha. */
  readonly sha: string;
  /** When the run ended, epoch milliseconds. */
  readonly endedAtMs: number;
  /** The attempt given to `openCommit`, when it was given one. */
  readonly publicationId?: string;
  /** `failed` forces the commit's status to `failed`; any other value is ignored. */
  readonly status?: ReportTestStatus;
};
```

What `closeCommit` needs to finish a commit's run.

#### `closeCommit`

```ts
export async function closeCommit(
  store: ObjectStore,
  args: CloseCommitArgs
): Promise<CommitRecord>
```

Marks a commit's run `complete` and returns the record, with the worst status of its sources: `failed` if
`args.status` is `failed` or any source failed, `skipped` when there are no sources or all were skipped, else
`passed`. Throws `no open report for <sha>; openCommit runs first` when the commit was never opened. Calling it
again rewrites the record with the sources present at that time.

### Reading commit-keyed recordings

Source: `packages/reports/src/read.ts`. Import: `@crvouga/atlas/reports/read`

The read side of the older, commit-keyed shared store: what the reports API serves for a commit (its record, its
sources, each test's timeline and frame files) and the event streams that deliver them. Pure over an injected
`ObjectStore`, `Clock` and `Timers`; nothing here imports a runtime or an HTTP framework. Every read goes through
`reportStore`, so a commit published by an attempt (`publicationId`) is read from that attempt's records.

See docs/report-backends.md

#### `readCommit`

```ts
export async function readCommit(
  store: ObjectStore,
  sha: string
): Promise<CommitRecord | null>
```

Reads a commit's record, or `null` when it is missing or not valid JSON.

#### `readFrameCss`

```ts
export async function readFrameCss(
  store: ObjectStore,
  sha: string
): Promise<StoredObject | null>
```

Reads the stylesheet a commit's snapshots render with, or `null` when the commit has none.

#### `listCommits`

```ts
export async function listCommits(
  store: ObjectStore,
  options: { readonly limit: number; readonly cursor: string | null }
): Promise<CommitPage>
```

Lists commits newest first, `limit` per page (at least 1).

A commit published twice (a rerun) has two index entries; only the newer one is ever listed, on any page.
`cursor` is the previous page's `cursor`; `null` starts at the newest. The returned `cursor` is `null` on the last
page. An index entry whose commit record is missing or unreadable is left out, so a page may hold fewer than
`limit` commits. Store errors reject.

#### `CommitEventsOptions`

```ts
export type CommitEventsOptions = {
  /** Time source for `tailMs`. */
  readonly clock: Clock;
  /** Timer functions used to wait `pollMs` between listings. */
  readonly timers: Timers;
  /** Sources the client already holds (a reconnect): never sent again. */
  readonly have?: ReadonlySet<string>;
  /** How often, in milliseconds, a running commit is re-listed for new sources. */
  readonly pollMs: number;
  /** A running commit's stream ends after this many milliseconds; the client reconnects. */
  readonly tailMs: number;
};
```

How `commitEvents` tails a running commit.

#### `commitEvents`

```ts
export async function* commitEvents(
  store: ObjectStore,
  sha: string,
  options: CommitEventsOptions
): AsyncGenerator<CommitEvent>
```

Streams a commit as events: the commit record, then every source in the order its read finishes. While the
commit is running, its sources are re-listed every `pollMs` and each new one is sent as it lands, until the commit
completes or `tailMs` passes. The state is read before each listing, so a listing after `complete` is the final
one. A `commit` event is sent again when the commit's state changes.

Ends with `{ type: 'end', state }`: `missing` when there is no commit record and no source, `complete` when the
commit closed, `running` when `tailMs` passed first (reconnect with `have` to continue). A source is never sent
twice in one stream, nor one listed in `options.have`. Trap: a source is counted as sent as soon as it is listed,
so one whose record cannot be read at that moment is not retried in the same stream.

#### `readTestReport`

```ts
export async function readTestReport(
  store: ObjectStore,
  args: {
    readonly sha: string;
    readonly source: string;
    readonly testId: string;
  }
): Promise<RunReport | null>
```

Reads one test's timeline (`RunReport`) without its frame files, or `null` when the source or test is not in the
commit. A timeline stored as a reusable source is parsed leniently (`null` if not JSON); one in the commit's bundle
throws if its bytes are not JSON.

#### `FrameBody`

```ts
export type FrameBody = {
  /** The file's bytes. */
  readonly bytes: Uint8Array;
  /** The media type the file was stored with. */
  readonly contentType: string;
};
```

One frame file's content.

#### `readFrameBody`

```ts
export async function readFrameBody(
  store: ObjectStore,
  args: {
    readonly sha: string;
    readonly source: string;
    readonly testId: string;
    readonly file: string;
  }
): Promise<FrameBody | null>
```

Reads one frame file of a test, or `null` when the test never wrote it. Throws `Invalid report frame` when `file` is not a safe relative frame path.

#### `listSourceRecords`

```ts
export async function listSourceRecords(
  store: ObjectStore,
  sha: string
): Promise<SourceRecord[]>
```

Lists every source record of a commit, in the order each read finishes. A source whose record cannot be read is left out.

#### `testEvents`

```ts
export async function* testEvents(
  store: ObjectStore,
  args: {
    readonly sha: string;
    readonly source: string;
    readonly testId: string;
  }
): AsyncGenerator<TestEvent>
```

Streams a test as events: its report, then each frame file the report names as its read finishes, then
`{ type: 'end', found: true }`. A test that is not in the commit yields only `{ type: 'end', found: false }`. A frame
the report names but the store lacks is skipped. Text media (`html`, `json`, `text`) arrive as inline text, the rest
as base64.

### Specs the layers recorded

Source: `packages/reports/src/recorded-specs.ts`. Import: `@crvouga/atlas/reports/recorded-specs`

When no spec set was published, a report is laid over the specs its layers say they ran against (each layer's
`specs[]`). `RecordedSpecs` keeps one entry per spec path: the one from the newest layer, and at the same time the
one with the larger fingerprint, so the outline it gives does not depend on the order layers are read in. The CLI's
composition and the server's live report use it alike, so the two cannot disagree about which specs a report has.

See docs/report-contract.md#how-layers-compose

#### `RecordedSpecs`

```ts
export class RecordedSpecs
```

The specs layers recorded, newest first per path. Add every included layer's `specs[]` with its `recordedAtMs`;
`entries()` is the outline, sorted by path.

**Example**

```ts
const recorded = new RecordedSpecs();
for (const layer of layers) recorded.add(layer.specs, layer.recordedAtMs);
const outline = { specs: recorded.entries(), sha: null, changedFiles: [] };
```

- `add(specs: readonly SpecEntry[], at: number): void` — Takes in the specs one layer recorded at `at` (epoch ms). A spec whose path is empty is ignored.
- `get(path: string): SpecEntry | undefined` — The recorded spec at a path (as `specPath` normalises it), or undefined.
- `get size(): number { return this.#byPath.size; }` — How many distinct specs were recorded.
- `entries(): readonly SpecEntry[]` — Every recorded spec, sorted by path.

### In-memory recorded test

Source: `packages/reports/src/recording-bundle.ts`. Import: `@crvouga/atlas/reports/recording-bundle`

Types for a recorded test with its frame files held in memory, which is what a viewer renders and what a publisher
copies: text media inline, binary media as base64.

#### `HtmlReportBlob`

```ts
export type HtmlReportBlob = {
  /** The media type of the file. */
  readonly contentType: string;
  /** The file's content for text media. */
  readonly text?: string;
  /** The file's content for binary media, base64-encoded. */
  readonly base64?: string;
};
```

One embedded frame file: text media inline, binary media as base64.

#### `HtmlReportTest`

```ts
export type HtmlReportTest = {
  /** The test's timeline. */
  readonly report: RunReport;
  /** Keyed by the blob's `file` (relative to the test dir). */
  readonly blobs: Readonly<Record<string, HtmlReportBlob>>;
};
```

One recorded test: its timeline and its frame files.

#### `HtmlReportBundle`

```ts
export type HtmlReportBundle = {
  readonly runId: string;
  /** The run's overall outcome. */
  readonly status: ReportTestStatus;
  /** When the run was last updated, epoch milliseconds. */
  readonly updatedAtMs: number;
  /** The run's tests. */
  readonly tests: readonly HtmlReportTest[];
};
```

The tests of one run held in memory.

### Key layout of one report bucket

Source: `packages/reports/src/recording-keys.ts`. Import: `@crvouga/atlas/reports/recording-keys`

Where a test run writes its recordings inside one local report bucket (an `ObjectStore`): `runs/index.json`,
`runs/<runId>/manifest.json` and `runs/<runId>/tests/<testId>/report.json` plus the test's frame files beside it.
Pure string functions. Neither id is validated here; callers sanitise them (`sanitizeRunId`, `sanitizeTestId`).

#### `RUNS_INDEX_KEY`

```ts
export const RUNS_INDEX_KEY = …
```

The key of the index of the runs in a bucket.

#### `runPrefix`

```ts
export function runPrefix(runId: string): string
```

The key prefix of one run, without a trailing slash: `runs/<runId>`.

#### `runManifestKey`

```ts
export function runManifestKey(runId: string): string
```

The key of a run's manifest: `runs/<runId>/manifest.json`.

#### `testPrefix`

```ts
export function testPrefix(runId: string, testId: string): string
```

The key prefix of one test, without a trailing slash: `runs/<runId>/tests/<testId>`. With an empty `testId` it ends in `/tests/`, which lists all tests of the run.

#### `testReportKey`

```ts
export function testReportKey(runId: string, testId: string): string
```

The key of a test's timeline: `runs/<runId>/tests/<testId>/report.json`.

#### `testFrameKey`

```ts
export function testFrameKey(
  runId: string,
  testId: string,
  frameFile: string
): string
```

The key of one frame file of a test: the test prefix and `frameFile` with any leading `/` removed. With an empty `frameFile` it is the test's prefix with a trailing slash.

#### `mediaExtension`

```ts
export function mediaExtension(media: string): string
```

The file extension for a snapshot media kind (`html`, `png`, `json`, `txt`, `bin`, `mp4`); an unknown kind is `bin`.

#### `contentTypeForMedia`

```ts
export function contentTypeForMedia(media: string): string
```

The media type for a snapshot media kind (`html`, `png`, `json`, `text`, `bytes`, `video`); an unknown kind is `application/octet-stream`.

### Remote commit report

Source: `packages/reports/src/remote-report.ts`. Import: `@crvouga/atlas/reports/remote-report`

A commit's report, streamed from a reports API into a Solid store the viewer renders as it grows: the test list
fills in source by source, and a test's steps and frame files stream in the first time it is opened. Transport and
time are injected (`http`, `timers`, `fetcher`); nothing here touches a global. It reads only: it never writes to
the API. It serves the older commit-keyed recordings (see `protocol.ts`), not layers.

#### `RemoteReportArgs`

```ts
export type RemoteReportArgs = {
  /** The HTTP client used for the event stream. */
  readonly http: HttpClient;
  /** Timer functions for the reconnect wait. */
  readonly timers: Timers;
  /** The reports API root (`https://api.example.com/api/reports`). */
  readonly apiBase: string;
  /** The full 40-hex commit sha to open. */
  readonly sha: string;
  /** Cached reads (sources, stylesheet, one test, one frame file). */
  readonly fetcher: ReportFetcher;
};
```

What `createRemoteReport` needs: transport, timers, and which commit to open.

#### `RemoteReportPhase`

```ts
export type RemoteReportPhase =
  | 'connecting'
  | 'live'
  | 'complete'
  | 'missing'
  | 'error';
```

Where the commit stream is: `connecting` before the first event, `live` while tailing a running commit, `complete` or `missing` once it ended for good, `error` after a stream failed (it retries).

#### `RemoteReport`

```ts
export type RemoteReport = {
  /** The tests of the commit as a Solid store; steps and frame files fill in when a test is loaded. */
  readonly data: ReportData;
  /** The commit record, `null` until the stream sends it (or when none exists). */
  readonly commit: Accessor<CommitRecord | null>;
  /** The stream's phase. */
  readonly phase: Accessor<RemoteReportPhase>;
  /** The source records received so far. */
  readonly sources: Accessor<readonly SourceRecord[]>;
  /** The stylesheet snapshots render with: `undefined` until read, `''` when there is none. */
  readonly frameCss: Accessor<string | undefined>;
  /** Loads one test's timeline and frame files on demand. */
  readonly loader: ReportTestLoader;
  /** Stops the stream and any pending reconnect. Safe to call more than once. */
  readonly dispose: () => void;
};
```

An open report: reactive data that grows as the stream delivers, and the handles to load more or stop.

#### `readEventStream`

```ts
export async function readEventStream<T>(
  response: Response,
  onEvent: (event: T) => void
): Promise<void>
```

Reads a Server-Sent Events response body to its end, handing each message's parsed `data` to `onEvent` in order.
Throws `reports API answered <status>` when the response is not ok or has no body; rejects when the stream breaks
or a message is not JSON.

#### `createRemoteReport`

```ts
export function createRemoteReport(args: RemoteReportArgs): RemoteReport
```

Opens a commit's report and starts streaming it. The commit stream reconnects on its own (sending the sources it
already holds as `?have=`; after a failure it waits 3 seconds first) until the commit is complete or missing, or
`dispose` is called. Sources and the stylesheet are also read from the query cache so a revisit paints at once.
Call this inside a Solid root: it creates signals and a store.

### The `atlas report` command

Source: `packages/reports/src/report-cli.ts`. Import: `@crvouga/atlas/reports/report-cli`

`reportMain` is `atlas report publish | stream | status | merge | doctor | policy`, written so it can be called from code and
tests as well as a terminal: it takes its arguments, environment, working directory, clock, git and standard input as
parameters and returns the exit code. Every command can print a JSON document (`--format json`) instead of prose, and a
command that is wrong throws, which `runReportCommand` turns into a message (or a JSON error) and exit code 2.

Exit codes: 0 it worked, 1 it ran and the answer is no (a report that does not pass, a store that needs attention, checks
that could not be sent), 2 the command itself was wrong.

See docs/integrating.md
See docs/agents.md

#### `REPORT_USAGE`

```ts
export const REPORT_USAGE = …
```

The text `atlas report --help` prints: every subcommand, its flags, what each does and the exit codes. Also the source of the command reference in `docs/reference/cli.md`.

#### `ReportIo`

```ts
export type ReportIo = { readonly out: (text: string) => void; /** Where `stream` reads checks from. Default: standard input. */ readonly stdin?: AsyncIterable<string | Uint8Array>; readonly env?: Env; readonly cwd?: string; readonly git?: Git; readonly clock?: () => number };
```

What `reportMain` is given besides arguments: where output goes (`out`), and, for tests and embedding, the environment, working directory, git, clock and standard input (`stdin`, where `stream` reads checks from). Defaults are the real ones.

#### `detectOrigin`

```ts
export function detectOrigin(env: Env, git: Git = gitOutput): { sha: string | null; branch: string | null; runUrl: string | null; ci: boolean }
```

Where the checks ran, from the CI's own variables and then git. Explicit flags win over both.

#### `detectFreshness`

```ts
export function detectFreshness(origin: { sha: string | null; ci: boolean }, git: Git = gitOutput): 'modified' | 'unknown' | undefined
```

Whether the checks ran on exactly the commit they name. A CI checkout does. A developer's worktree
with edits to tracked files does not: its layer is `modified`, shown with a warning and never mistaken
for the commit's own result. Outside git the origin is `unknown`.

#### `runReportCommand`

```ts
export async function runReportCommand(argv: readonly string[]): Promise<number>
```

`atlas report …` for a terminal: a mistake in the command or a path is a message on stderr and exit
code 2, so a CI job can tell a broken invocation (2) from a report that does not pass (1).

#### `reportMain`

```ts
export async function reportMain(argv: readonly string[], io: ReportIo = { out: text => process.stdout.write(text) }): Promise<number>
```

`atlas report …`. Returns the exit code: 0 passes, 1 does not. Throws on a mistake in the command (see {@link runReportCommand}).

### Incremental report index

Source: `packages/reports/src/report-index.ts`. Import: `@crvouga/atlas/reports/report-index`

`ReportIndex` is the report, maintained as layers arrive. Each immutable layer is read once and folded into the winning
result of every slot it fills, then dropped unless it still holds a winner, so memory follows the number of checks and not
the age of the project. The winner rule is a total order, so folding is exact in any order and equals combining every layer
from scratch (a test proves it over random partial runs). It also keeps what each layer sends (rows, JSON, a digest) until
that layer changes, so taking in a result costs one layer, answers viewers a version hash, a cached JSON text and a delta,
and tells listeners what arrived.

See docs/report-contract.md
See docs/server.md#performance

#### `EffectiveEvidence`

```ts
export type EffectiveEvidence = {
  /** A hash of the report itself: the same on every replica, and different exactly when the report is. Use it as an ETag. */
  readonly version: string;
  /** Only layers that fill at least one slot, each with only the rows that win. */
  readonly layers: readonly LayerEvidence[];
  readonly backends: readonly BackendInfo[];
  readonly notices: readonly string[];
  /** Every layer read, superseded or not. */
  readonly totalLayers: number;
};
```

What a viewer needs to show the report, and nothing that is only history.

#### `IndexChange`

```ts
export type IndexChange = {
  readonly version: string;
  /** Layers read since the last change, newest first, whether or not they won anything. */
  readonly added: readonly LayerHeader[];
  readonly totalLayers: number;
};
```

What changed, told to those who asked to know: the report's new version, and the layers that arrived.

#### `ReportIndex`

```ts
export class ReportIndex
```

The report, maintained as layers arrive. Each layer is read once and folded into the winning result
of every slot it fills, then dropped unless it still holds a winner. Because the winner rule is a
total order, folding is exact in any order, so this equals combining every layer from scratch, with
memory proportional to the number of checks and not to how long the project has existed.

It reads only immutable layers (`layers/index/…`), which is what makes "read once" correct.

- `refresh(): Promise<boolean>` — Read what is new in every backend and fold it in. Resolves true when the report changed. Calls overlap safely.
- `async refreshNow(): Promise<boolean>` — A refresh that surely starts after this call: one already under way may have looked before whatever made the caller ask. Used when something was just written.
- `accept(backendId: string, indexKey: string, known?: ReportLayer): Promise<void>` — Take in a layer an uploader has just written, from its catalog entry, without listing anything. Entries are read one after another; one already known is ignored. The regular refresh still reconciles the rest.
- `onChange(listener: (change: IndexChange) => void): () => void` — Be told when the report changes. Returns how to stop.
- `async start(intervalMs: number): Promise<void>` — Keep refreshing in the background. The first call returns once the first pass has finished.
- `stop(): void` — Stops the background refresh started by `start`. Safe to call twice.
- `get ready(): boolean { return this.#refreshedAt > 0; }` — True once a first pass over the backends has finished, so `snapshot` is a report and not an empty guess.
- `snapshot(): EffectiveEvidence` — The current report, ready to send. Built once per change, and only the layers that changed are rebuilt.
- `json(): { readonly version: string; readonly text: string }` — The report as JSON text: exactly what `JSON.stringify({ ...snapshot(), active: [] })` writes, put together from the text of each layer, which is written once. `active` is what a store without live runs always sends: none.
- `delta(since: string): { readonly text: string; readonly version: string } | null` — What differs between the report a viewer holds (named by its version) and the current one: the layers that changed in full, and the ids of those that no longer hold a winner. Null when that version is not remembered, and the viewer should ask for the whole report. See `applyEffectiveDelta`.
- `get history(): TestHistory { return this.#history; }` — Every recorded result of every test and every run, as layers were folded in: what the test catalog, a test's history and the run list are built from. Read-only for callers; `history.rev` changes whenever a layer is taken in.
- `stats()` — For `/readyz` and logs.

### Test loading state

Source: `packages/reports/src/report-loader.ts`. Import: `@crvouga/atlas/reports/report-loader`

The state of loading one recorded test into the viewer, and the interface a report gives the viewer to load tests on
demand. Types only.

#### `TestLoad`

```ts
export type TestLoad =
  | { readonly kind: 'ready' }
  | {
      readonly kind: 'loading';
      readonly frames: number;
      readonly framesTotal: number | null;
    }
  | { readonly kind: 'missing' }
  | { readonly kind: 'error'; readonly message: string };
```

Where loading a test is: `ready`, `loading` (with how many frame files have arrived and how many there are, when known), `missing`, or `error` with a message to show.

#### `ReportTestLoader`

```ts
export type ReportTestLoader = {
  /** Starts loading a test's timeline if it has not started (or failed before). Returns at once. */
  readonly load: (testId: string) => void;
  /** Starts fetching one frame file of a test if it is not held or already being fetched. */
  readonly ensureBlob?: (testId: string, file: string) => void;
  /** The current load state of a test; reactive where the host is. */
  readonly state: (testId: string) => TestLoad;
};
```

Loads a test's steps on first view, then individual frame files as the
scrubber reaches them. Absent when every test arrives with its frames
(a standalone HTML file).

### Report parts of a commit

Source: `packages/reports/src/report-parts.ts`. Import: `@crvouga/atlas/reports/report-parts`

Reads, writes and validates "parts": one producer's checks for one commit, stored under
`commits/<sha>/parts/<producer>/` in the older commit-keyed layout. Publishing a part also publishes it as an
immutable layer, so it composes with everything else; reading parts picks the latest per producer for the explorer.
A part that is corrupt or belongs to another commit fails visibly instead of being skipped.

#### `partStatus`

```ts
export function partStatus(part: ReportPart): EvidenceStatus
```

The status of a whole part: `failed` if any check failed, else `running` if any is running, else `not-run` if it has no checks or any is `not-run`, else `passed`.

#### `validatePart`

```ts
export function validatePart(part: ReportPart): void
```

Throws unless `part` is well formed: a 40-hex `sha`, an `id` usable as a key segment, a non-empty `kind` and
`title`, a non-negative safe-integer `recordedAtMs`, string `parameters` values, and checks with a unique non-empty
`id`, non-empty `title`, a string `detail`, one of the four statuses and finite-number measurements with a name and
unit. The error is `Invalid report part`, `Invalid report parameters`, `Invalid evidence check` or `Invalid evidence
measurement`; it does not say which field.

#### `publishPart`

```ts
export async function publishPart(
  store: ObjectStore,
  part: ReportPart
): Promise<void>
```

Stores a part and publishes it as a layer. Validates first (`validatePart`, which throws and writes nothing).

Each producer owns a separate key, `commits/<sha>/parts/<id>/<recordedAtMs>-<sha256 of the JSON>.json`, independent
of the spec-run attempt, so republishing identical content rewrites the same key. It then records the commit as an
explorer version and publishes a layer (producer `part.id`, environment from the `environment` parameter, the
commit's branch and run URL when a commit record exists, the commit's spec inventory) with no captured files.

#### `readParts`

```ts
export async function readParts(
  store: ObjectStore,
  sha: string
): Promise<readonly ReportPart[]>
```

Reads the latest part of every producer for a commit (see `latestParts`), sorted by kind then id.

Throws `Invalid commit` for a sha that is not 40 hex, a validation error (see `validatePart`) or a `SyntaxError` for
a part that is corrupt, `Report part disappeared` when a listed part vanishes, and `Report part belongs to another
commit` when a part's `sha` or `id` does not match its key. Corrupt evidence fails visibly; it is never skipped.

#### `latestParts`

```ts
export function latestParts(
  parts: readonly ReportPart[]
): readonly ReportPart[]
```

Keeps one part per producer id and sorts by kind then id. The newer `recordedAtMs` wins; at the same time the more
severe status wins (`failed`, then `running`, then `not-run`, then `passed`); at the same status the greater JSON
text wins, so the answer is independent of write and list order. This is not the layer winner rule: here a newer
unfinished part replaces an older completed one.

### The report gate

Source: `packages/reports/src/report-status.ts`. Import: `@crvouga/atlas/reports/report-status`

Reduces a combined report to a pass or fail with reasons (`reportStatus`) and renders that result as text or
markdown. The JSON of `ReportStatus` is a stable contract (`schemaVersion` 1); the text and markdown are for people
and are not. The gate fails closed: no checks, a failed or still-running check, an unreadable layer or backend
(a notice), a missing required environment, or (when asked) a spec with no result each make it fail.

See docs/report-contract.md#statuses-and-the-gate

#### `StatusOptions`

```ts
export type StatusOptions = {
  /** Environments that must have at least one check, such as `ios,android`. A missing one fails the gate. */
  readonly requireEnvironments?: readonly string[];
  /** Fail when any spec of the outline has no result at all. */
  readonly requireAllSpecs?: boolean;
};
```

Extra conditions for the gate beyond "all checks pass".

#### `reportStatus`

```ts
export function reportStatus(report: CombinedReport, options: StatusOptions = {}): ReportStatus
```

The gate. A report passes only when it has checks, none failed, none is still running, every
layer and backend could be read, and every required environment is present. Unknown never passes.

Returns a `ReportStatus` (schemaVersion 1): `ok` is true exactly when `reasons` is empty. Reasons name, in order: no
checks (or none completed), failed checks, running checks, specs without results (only with `requireAllSpecs`),
each required environment with no checks (the name is normalised, so `iOS` means `ios`), then every notice of the
report (an unreadable layer or backend). `failing` lists each failed or running winner, in a fixed order that does
not depend on read order; diagnostic `performance` checks are left out unless nothing else was recorded.

**Example**

```ts
const status = reportStatus(await combineBackends(backends), { requireEnvironments: ['ios'] });
if (!status.ok) throw new Error(status.reasons.join('\n'));
```

See /report-contract.md#atlas-report-status

#### `formatStatusText`

```ts
export function formatStatusText(status: ReportStatus): string
```

Renders a status as plain text for a terminal: a `PASS`/`FAIL` line with totals, one line per environment, each
failing or running check with where it ran and the first line of its detail, notices, reasons and specs with no
results. Ends with a newline. For people: the layout is not a contract; parse `--format json` instead.

#### `formatStatusMarkdown`

```ts
export function formatStatusMarkdown(status: ReportStatus): string
```

Renders a status as GitHub-flavoured markdown for a pull request comment or `$GITHUB_STEP_SUMMARY`: a heading with
totals, a table per environment, a table of failing checks (`|` and newlines in cells are escaped) and the reasons.
Ends with a newline. For people: the layout is not a contract.

### Recorded test timeline types

Source: `packages/reports/src/report-types.ts`. Import: `@crvouga/atlas/reports/report-types`

The shapes of a recorded test run as the harness persists it and the viewer renders it: a timeline of steps, each
with frames (captured snapshots), plus per-run metadata, the suite and run indexes, and the options of a recording.
All times are epoch milliseconds unless a name says otherwise. Mostly types; the few functions are small id helpers
that keep ids safe to use as key segments.

#### `ReportStepPerformance`

```ts
export type ReportStepPerformance = {
  /** Observed elapsed time of the step, in milliseconds. */
  readonly executionMs: number;
  /** Time attributed to the step's own work, nested steps counted once (see `performanceHotspots`), in milliseconds. */
  readonly selfMs: number;
  /** Time spent capturing snapshots for the step, in milliseconds. */
  readonly snapshotMs: number;
};
```

Observed elapsed work, independent of the simulation clock.

#### `ReportPerformanceSummary`

```ts
export type ReportPerformanceSummary = {
  /** Total observed elapsed work of the run, in milliseconds. */
  readonly executionMs: number;
  /** Part of that spent capturing snapshots, in milliseconds. */
  readonly snapshotMs: number;
  /** How many steps had a measurement. */
  readonly measuredSteps: number;
  /** How many measured steps were over `slowStepMs`. */
  readonly slowSteps: number;
  /** The allowance, in milliseconds, a step's own time is judged against. */
  readonly slowStepMs: number;
};
```

Timing totals of a whole run.

#### `ReportPerformanceOptions`

```ts
export type ReportPerformanceOptions = {
  /** The monotonic clock to measure with; separate from the simulation clock. */
  readonly clock: Clock;
  /** Diagnostic threshold, not a portable CPU or paint-time assertion. */
  readonly slowStepMs: number;
};
```

How to measure elapsed work while recording.

#### `SnapshotMedia`

```ts
export type SnapshotMedia = 'json' | 'html' | 'png' | 'text' | 'bytes' | 'video';
```

How a captured value is encoded on disk and rendered in the report.
`png` is a still, `html` is a page snapshot, and `video` is an mp4 of the moment or the whole test.
A runner may record any mix. The viewer treats a still, a video, and a timeline of frames as the same kind of evidence.

#### `ReportStepStatus`

```ts
export type ReportStepStatus = 'passed' | 'failed';
```

The outcome of one step.

#### `ReportTestStatus`

```ts
export type ReportTestStatus = 'passed' | 'failed' | 'skipped';
```

Test outcome after the harness (e.g. the test runner) has weighed in.

#### `ReportSnapshotBlob`

```ts
export type ReportSnapshotBlob = {
  /** The blob's name as its snapshotter gave it. */
  readonly name: string;
  /** How `file` is encoded. */
  readonly media: SnapshotMedia;
  /** Relative path under the test dir, e.g. `frames/f-00001.html.alice.html`. */
  readonly file: string;
  /** Which client (actor) the blob is of, when the snapshot has one per client. */
  readonly nodeId?: string;
};
```

One blob produced by a snapshotter at a point in time.
Multi-actor UI maps become one entry per nodeId.

#### `ReportFrame`

```ts
export type ReportFrame = {
  /** The frame's ordinal as the recorder assigned it. */
  readonly index: number;
  /** When it was captured, epoch milliseconds. */
  readonly capturedAtMs: number;
  /** How long the capture took, in milliseconds. */
  readonly durationMs?: number;
  /** The captured blobs, one per snapshotter (and per client). */
  readonly snapshots: readonly ReportSnapshotBlob[];
  /**
   * Gesture target, set only on the frame captured right before a UI step
   * acts (the target is still mounted). Viewers highlight it on this frame.
   */
  readonly hit?: ReportStepHit;
};
```

Discrete visual/state capture within a report step.

#### `ReportStepHit`

```ts
export type ReportStepHit = {
  /** Chain of `data-testid` values, each looked up inside the previous match. */
  readonly path: readonly string[];
  /** Where in the target box the gesture landed, as fractions from 0 to 1 of its width and height. */
  readonly point?: {
    readonly xRatio: number;
    readonly yRatio: number;
  };
};
```

Where a UI gesture landed — test-id path (chained first-match, as the
driver resolves it) + optional tap point relative to the target box.
Viewers resolve the path against the snapshot DOM for real geometry.

#### `ReportStep`

```ts
export type ReportStep = {
  /** The step's ordinal as the recorder assigned it. */
  readonly index: number;
  /** An open category of step. Gherkin keywords (`given`, `when`, `then`, `and`, `but`) mark scenario lines. */
  readonly kind: string;
  /** Human title. */
  readonly title: string;
  readonly status: ReportStepStatus;
  readonly startedAtMs: number;
  readonly endedAtMs: number;
  /** `endedAtMs - startedAtMs`, in milliseconds. */
  readonly durationMs: number;
  /** Observed elapsed work, when measurement was on. */
  readonly performance?: ReportStepPerformance;
  /** Which client (actor) took the step, in a multi-client run. */
  readonly actorId?: string;
  /** The UI selector the step acted on. */
  readonly selector?: string;
  readonly detail?: string;
  /** The action performed, when the step is an applied action. */
  readonly action?: string;
  readonly args?: readonly unknown[];
  /** The failure message when `status` is `failed`. */
  readonly error?: string;
  readonly errorStack?: string;
  /** Captures taken during the step. */
  readonly frames: readonly ReportFrame[];
  /** Steps nested in this one. */
  readonly steps: readonly ReportStep[];
};
```

One labeled entry on the report timeline. Steps nest: an `apply` step
holds the UI ops recorded while its action ran.

#### `RunReportMeta`

```ts
export type RunReportMeta = {
  /** The system under test the run exercised. */
  readonly system: string;
  /** The runtime it ran in. */
  readonly runtime: string;
  /** The seed of a randomised run. */
  readonly seed: string;
  readonly startedAtMs: number;
  readonly endedAtMs: number;
  /** `endedAtMs - startedAtMs`, in milliseconds. */
  readonly durationMs: number;
  /** Timing totals, when measurement was on. */
  readonly performance?: ReportPerformanceSummary;
  readonly status: ReportTestStatus;
  /** The run the test belongs to; see `sanitizeRunId`. */
  readonly runId: string;
  /** The test's id within the run; see `sanitizeTestId`. */
  readonly testId: string;
  /** Human title (defaults to `testId`). */
  readonly title: string;
  /** The clients (actors) that took part. */
  readonly actorIds: readonly string[];
  /** Repo-relative path of the test's source file (a spec), when known. */
  readonly sourceFile?: string;
  /** 1-based line of the call that opened this run, when known. */
  readonly sourceLine?: number;
  /** First failure message (step, property, or harness). */
  readonly error?: string;
  /** The stack of that failure. */
  readonly errorStack?: string;
};
```

Metadata of one recorded test run.

#### `ReportArtifact`

```ts
export type ReportArtifact = {
  /** Display name. */
  readonly name: string;
  /** How `file` is encoded. */
  readonly media: SnapshotMedia;
  /** Path of the file relative to the test's directory. */
  readonly file: string;
  /** For a video: path of a still to show before playing. */
  readonly poster?: string;
  /** For a video: path of its captions (WebVTT). */
  readonly captions?: string;
};
```

A file attached to the whole test. A runner that can capture each step puts stills and page
snapshots on `steps[].frames` instead, and the viewer builds a timeline from those. This list
is for what the runner can attach when it cannot: a video of the test, a few screenshots, a log.

#### `RunReport`

```ts
export type RunReport = {
  readonly meta: RunReportMeta;
  /** The top-level steps, in order; nested steps hang off each. */
  readonly steps: readonly ReportStep[];
  /** Whole-test files, for runners that cannot capture per step. */
  readonly artifacts?: readonly ReportArtifact[];
};
```

In-memory / persisted timeline for one test run.

#### `SuiteTestSummary`

```ts
export type SuiteTestSummary = {
  readonly testId: string;
  readonly title: string;
  readonly seed: string;
  readonly status: ReportTestStatus;
  readonly durationMs: number;
  /** How many steps the test recorded. */
  readonly stepCount: number;
  /** How many frames the test captured. */
  readonly frameCount: number;
  readonly system: string;
  readonly runtime: string;
  readonly sourceFile?: string;
  readonly error?: string;
};
```

One test as a suite manifest lists it: the metadata without the timeline.

#### `SuiteManifest`

```ts
export type SuiteManifest = {
  readonly tests: readonly SuiteTestSummary[];
  /** When the listing was last written, epoch milliseconds. */
  readonly updatedAtMs: number;
};
```

A listing of a suite's tests, with the time it was last written.

#### `RunSummary`

```ts
export type RunSummary = {
  /** The run id; see `sanitizeRunId`. */
  readonly id: string;
  /** When the run was last updated, epoch milliseconds. */
  readonly updatedAtMs: number;
  /** The run's overall outcome. */
  readonly status: ReportTestStatus;
  readonly testCount: number;
  readonly frameCount: number;
};
```

One run as `runs/index.json` lists it.

#### `RunsIndex`

```ts
export type RunsIndex = {
  readonly runs: readonly RunSummary[];
};
```

The index of the runs in a report bucket (stored at `runs/index.json`).

#### `RecordStepMeta`

```ts
export type RecordStepMeta = {
  readonly kind: string;
  readonly title: string;
  readonly actorId?: string;
  readonly selector?: string;
  readonly detail?: string;
  /** Press / gesture target; persisted onto the step's pre-action frame. */
  readonly hit?: ReportStepHit;
  /** Capture snapshots before `fn` (e.g. before close unmounts). */
  readonly snapshotBefore?: boolean;
  /** Skip registered snapshotters for this step. */
  readonly skipSnapshot?: boolean;
};
```

Metadata for an open `run.record(...)` call.

#### `ReportCaptureMode`

```ts
export type ReportCaptureMode = 'apply' | 'none';
```

When a recording auto-opens a report step: on each applied action (`apply`) or never (`none`).

#### `RunReportOptions`

```ts
export type RunReportOptions = {
  /** Enable elapsed work measurement with a separate monotonic clock. */
  readonly performance?: ReportPerformanceOptions;
  /** When false, reporting is disabled even if options object is passed. */
  readonly enabled?: boolean;
  /** Object store for this report bucket (required for persistence). */
  readonly store?: ObjectStore;
  /**
   * Run id under `runs/<runId>/`. Default: `YYYYMMDDTHHmmss` UTC from `now`.
   */
  readonly runId?: string;
  /**
   * Stable id for this test under the run (`tests/<testId>/`).
   * Default: sanitized system name.
   */
  readonly testId?: string;
  /** Human title shown in reports. Default: `testId`. */
  readonly title?: string;
  /**
   * Epoch-ms clock for step timestamps. Default: session clock.
   */
  readonly now?: () => number;
  /**
   * When to auto-open a report step. Default `apply` (each `s.apply`).
   * `advanceTime` never opens a step (avoids poll spam).
   */
  readonly capture?: ReportCaptureMode;
  /**
   * Capture the registered snapshotters (UI frames, state) onto each step.
   * Default true. False keeps the timeline — every step, its outcome and
   * error — without the frames, which are what make a report expensive.
   */
  readonly frames?: boolean;
  /** Repo-relative path to the test source file when known. */
  readonly sourceFile?: string;
  /** 1-based source line of the call that opened the run, when known. */
  readonly sourceLine?: number;
};
```

Options that turn on and shape the recording of a test run.

#### `sanitizeTestId`

```ts
export function sanitizeTestId(raw: string): string
```

Makes a test id safe as a key segment: runs of characters outside `A-Za-z0-9._-` become one `_`, leading and trailing `_` are trimmed, and an empty result is `test`.

#### `sanitizeRunId`

```ts
export function sanitizeRunId(raw: string): string
```

Makes a run id safe as a key segment: runs of characters outside `A-Za-z0-9._-` become one `_`, leading and trailing `_` are trimmed, and an empty result is `run`.

#### `mintRunId`

```ts
export function mintRunId(nowMs: number): string
```

Mint `YYYYMMDDTHHmmss` UTC from epoch ms.

#### `resolveReportOptions`

```ts
export function resolveReportOptions(
  report: boolean | RunReportOptions | undefined
): RunReportOptions | null
```

Normalises the `report` option of a test: `undefined` or `false` is `null` (reporting off), `true` is `{ enabled: true }`, an options object with `enabled: false` is `null`, and any other object is returned with `enabled: true`.

### Streaming reporter

Source: `packages/reports/src/reporter.ts`. Import: `@crvouga/atlas/reports/reporter`

`createReporter` lets a suite report checks as they finish: each flush is one immutable layer of the checks since the last,
so a run is visible while it is still going, and a check reported `running` then `passed` is two layers whose newer,
completed one wins. A layer that cannot be sent is kept and sent again byte for byte the same (never a second layer), a
layer the server permanently refuses is counted as lost without blocking the ones behind it, and nothing is ever thrown
into the suite being reported on.

See docs/server.md#streaming-a-run-as-it-happens

#### `ReporterIdentity`

```ts
export type ReporterIdentity = Pick<PublishChecksInput, 'producer' | 'kind' | 'title' | 'sha' | 'branch' | 'runUrl' | 'run' | 'environment' | 'parameters' | 'freshness' | 'specs' | 'tags' | 'labels' | 'links' | 'attachments' | 'annotations' | 'extensions'>;
```

What every layer of one stream shares: who is reporting, from where. Whatever `publishChecks` takes, except the checks and the time.

#### `ReporterOptions`

```ts
export type ReporterOptions = {
  /** Where layers go: a directory, S3, or `httpStore` for an Atlas server. */
  readonly store: ObjectStore;
  /** Send what has been reported this often (ms). Default 1000. `0` sends only on `flush()` and `close()`. */
  readonly flushMs?: number;
  /** Send at once when this many checks are waiting. Default 100. */
  readonly batchSize?: number;
  /** Tries for one layer, in `close()`; the timer keeps trying on its own. Default 5. */
  readonly attempts?: number;
  /** First wait between tries (ms), doubled each time to at most 30 s. Default 500. */
  readonly backoffMs?: number;
  /** Told of each failed try. A reporter never throws into the test run it reports on. */
  readonly onError?: (error: Error, willRetry: boolean) => void;
  /** Told of each layer that arrived. */
  readonly onPublished?: (layer: { id: string; checks: number }) => void;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
};
```

How a reporter sends: the `store` (a folder, S3, or `httpStore` for a server), how often (`flushMs`, `batchSize`), how hard it tries (`attempts`, `backoffMs`), what it tells (`onError`, `onPublished`), and the clock and sleep for tests.

#### `ReporterResult`

```ts
export type ReporterResult = {
  /** Layers that arrived. */
  readonly layers: number;
  /** Checks that arrived. */
  readonly checks: number;
  /** Checks that could not be sent. Zero when everything arrived. */
  readonly lost: number;
};
```

What `close()` says happened: layers and checks that arrived, and checks `lost` (never arrived). `lost` is zero when everything did.

#### `Reporter`

```ts
export type Reporter = {
  /** Report one check, finished or still running. Reporting the same `id` again replaces it, whatever its state. */
  check(check: Check): void;
  /** Send everything reported so far, now. Resolves once it has arrived or failed; never rejects. */
  flush(): Promise<void>;
  /** Send the rest and stop. Retries each layer up to `attempts` times. */
  close(): Promise<ReporterResult>;
};
```

A running reporter. `check` adds a result, `flush` sends what is waiting, `close` sends the rest and stops.

#### `createReporter`

```ts
export function createReporter(identity: ReporterIdentity, options: ReporterOptions): Reporter
```

A suite that reports as it goes. Each flush is one immutable layer holding the checks reported since the
last, so nothing is rewritten and a laptop, a CI job and a device lab can all be sending to the same
server at once. A check reported as `running` and then as `passed` is two layers; the later, completed one
wins, so the report follows the suite while it runs and agrees with it when it ends.

A layer that cannot be sent is kept and sent again, unchanged (same time, so same content): a retry never
makes a second layer. Time only moves forward within a reporter, so a later result always follows an earlier one.

### Explorer routes

Source: `packages/reports/src/reports-explorer-route.ts`. Import: `@crvouga/atlas/reports/reports-explorer-route`

Two read-only routes that give the explorer one commit's spec inventory, latest evidence parts and spec text, drawn
from the checkout (when the commit is the one checked out), this machine's store and the shared store. A shared store
that cannot be read degrades to a notice when anything local is available.

#### `ReportsExplorerDeps`

```ts
export type ReportsExplorerDeps = ReportsStores & {
  /** The checkout the host is serving. Only composition roots provide it; its content is never CI evidence. */
  readonly workspace?: () => Promise<WorkspaceReports>;
};
```

The stores plus an optional provider of the current checkout.

#### `createReportsExplorerApp`

```ts
export function createReportsExplorerApp(deps: ReportsExplorerDeps)
```

Builds the Hono app for `GET /:sha/explorer` and `GET /:sha/spec`.

`/:sha/explorer` answers `{ inventory, parts, notice? }` for a 40-hex sha. The inventory is the checkout's when `sha`
is the workspace's, else the local store's, else the shared store's. The parts are the shared store's followed by the
checkout's (or the local store's), reduced to the latest part per producer. If the shared store fails but something
local exists, it answers with a `notice`; with nothing local it throws. 404 for a
bad sha, 503 `reports_unavailable` when there is no shared store and nothing local. `/:sha/spec?path=` answers a
spec's text (`text/plain`) from the workspace, else the local store, else the shared store, or 404 for a bad sha,
a path that is not a spec path, or a missing file. Both are `no-store`.

### Commit list route

Source: `packages/reports/src/reports-list-route.ts`. Import: `@crvouga/atlas/reports/reports-list-route`

The handler for the reports list: commits of the shared store newest first, the evidence versions found in the
stores, and the checkout when there is one. It degrades to the local view instead of failing when the shared store
is down.

#### `reportsListRoute`

```ts
export function reportsListRoute(deps: ReportsExplorerDeps)
```

Returns the handler for `GET /`: `{ commits, cursor, evidenceVersions?, workspace?, notice? }`.

`commits` are the shared store's, 30 per page, continued with `?cursor=`. `evidenceVersions` (first page only) are
the distinct versions found in the shared and local stores. 503 `reports_unavailable` when there is no shared
store, no workspace and no local store. With no shared store it answers no commits and a notice; when listing the
shared store throws and there is a workspace, it answers from the local store with a notice, otherwise the error
propagates. Always `no-store`.

### Reports HTTP API

Source: `packages/reports/src/reports-route.ts`. Import: `@crvouga/atlas/reports/reports-route`

The HTTP API behind the viewer, as one Hono app: the layer routes of `layers-route.ts`, the explorer routes, and the
read-only commit-keyed routes for recordings written before layers existed. Every route is a GET (or HEAD) with
`cache-control: no-store` unless a layer route says otherwise, and CORS reflects the caller's origin. Nothing here
writes. Mounted at `/api/reports` by `reportsHost` and by the Atlas server.

Commit-keyed routes (`:sha` is a 40-hex commit; anything else is 404 `not_found`, no store configured is 503
`reports_unavailable`):
- `GET /` commits with a report, newest first (`?cursor=`), see `reportsListRoute`.
- `GET /:sha` one commit's run record.
- `GET /:sha/events` Server-Sent Events: the commit, then each source as it is read. A running commit stays open and
  sends new sources as they are published, for at most `REPORTS_TAIL_MS`; `?have=a,b` skips sources a reconnecting
  client already holds.
- `GET /:sha/sources` every source record of the commit, merged from the shared and the local store.
- `GET /:sha/frame.css` the stylesheet its snapshots render with.
- `GET /:sha/tests/:source/:testId` one test's timeline without frames.
- `GET /:sha/tests/:source/:testId/files/*` one frame file.
- `GET /:sha/tests/:source/:testId/events` a test, then its frames, as Server-Sent Events.
- `GET /:sha/explorer` and `GET /:sha/spec?path=` see `createReportsExplorerApp`.

See docs/server.md

#### `REPORTS_PAGE_SIZE`

```ts
export const REPORTS_PAGE_SIZE = …
```

Intended commits per page of the commit list. The list route currently pages by its own constant of the same value (30) and does not read this one.

#### `REPORTS_POLL_MS`

```ts
export const REPORTS_POLL_MS = …
```

How often, in milliseconds, a running commit's event stream re-lists the store for new sources.

#### `REPORTS_TAIL_MS`

```ts
export const REPORTS_TAIL_MS = …
```

How long, in milliseconds, a running commit's event stream stays open before it ends; the client reconnects.

#### `ReportsAppDeps`

```ts
export type ReportsAppDeps = ReportsExplorerDeps & {
  /** Loads the current specs (and the text of each) every report is laid over. Without it `GET /outline` answers 503. */
  readonly outline?: () => Promise<ReportOutline & { readSpec: (path: string) => Promise<string | null> }>;
  /** Leave layers out of the report, in every route. */
  readonly include?: (layer: import('./evidence-types').LayerHeader) => boolean;
  /** Further stores whose layers join the combined report beside `localStore` and `store`. */
  readonly backends?: readonly ReportBackend[];
  /** Results of spec runs that are still running on this machine. */
  readonly live?: LiveSource;
  /** The shared reports store; null when this deployment has no credential. */
  readonly store: ObjectStore | null;
  /** Time source; injected so caches and polling are testable. */
  readonly clock: Clock;
  /** Timer functions for the event streams; injected so tests need no real time. */
  readonly timers: Timers;
};
```

What `createReportsApp` and `createLayersApp` need from their host: stores, an outline of current specs, and time.

#### `createReportsApp`

```ts
export function createReportsApp(deps: ReportsAppDeps)
```

Builds the complete reports app (layer routes, explorer routes and the commit-keyed routes). Read-only: nothing it
serves can change a store. CORS reflects any caller's origin for GET, HEAD and OPTIONS.

**Example**

```ts
const app = createReportsApp({ store: null, backends: [{ id: 'ci', label: 'CI', store }], clock: { now: Date.now }, timers });
const response = await app.request('/evidence');
```

### Choosing between the shared and the local reports store

Source: `packages/reports/src/reports-store.ts`. Import: `@crvouga/atlas/reports/reports-store`

Decides which store answers for a commit or a source when a project has both a shared store and this machine's own,
and merges their source records. The local store wins for what it holds, so a remote outage cannot hide a local run.

#### `ReportsStores`

```ts
export type ReportsStores = {
  /** The shared reports store, or `null` when this deployment has no credential for one. */
  readonly store: ObjectStore | null;
  /** This machine's own store, where collected local runs are written. */
  readonly localStore?: ObjectStore;
};
```

The stores a reports host reads.

#### `reportsStoreForCommit`

```ts
export async function reportsStoreForCommit(
  deps: ReportsStores,
  sha: string
): Promise<ObjectStore | null>
```

The store to read a commit from: the local store when it has that commit's record, else the shared store (`null`
when there is none). Collected local runs own their timelines; a remote outage cannot hide them.

#### `reportsStoreForSource`

```ts
export async function reportsStoreForSource(
  deps: ReportsStores,
  sha: string,
  source: string
): Promise<ObjectStore | null>
```

The store to read one source of a commit from: the local store when it holds that source, else the shared store (`null` when there is none).

#### `reportsSources`

```ts
export async function reportsSources(
  deps: ReportsStores,
  sha: string
): Promise<readonly SourceRecord[]>
```

Lists the source records of a commit from the shared and the local store, one per source name. A local source
replaces the shared one of the same name only; others from both are kept. A store that fails is skipped, and the
error is thrown only when no source was found at all and a store failed.

### Resilient report cache

Source: `packages/reports/src/resilient-cache.ts`. Import: `@crvouga/atlas/reports/resilient-cache`

Wraps a persistent `ReportCache` (IndexedDB, which a browser may deny or corrupt) so a failure of the cache never
blocks reports: everything is also kept in memory and every storage error is swallowed.

#### `resilientReportCache`

```ts
export function resilientReportCache(cache: ReportCache): ReportCache
```

Returns a cache that reads and writes `cache` and also keeps every value in memory. Storage is an optimization. A
denied or corrupt persistent cache cannot block reports.

`get` answers from `cache`, falling back to memory when it has no value or throws. `set` and `remove` always apply
to memory first, then try `cache` and ignore its errors, so a value written while storage is failing is still
readable for the life of this wrapper (but not after a reload).

### Report retention

Source: `packages/reports/src/retention.ts`. Import: `@crvouga/atlas/reports/retention`

The plan for what cleanup may remove from a store. There is none: Atlas never deletes a layer or a commit's evidence
by itself (the contract is deletion-free), so the plan always retains everything and lists no key to delete.
Retention is the operator's choice, made outside Atlas.

See docs/report-contract.md#guarantees

#### `ReportRetentionPlan`

```ts
export type ReportRetentionPlan = {
  /** The commit records found, all of them. */
  readonly retained: readonly CommitRecord[];
  /** Keys to delete. Always empty: automatic cleanup never discards evidence. */
  readonly deleteKeys: readonly string[];
};
```

What a retention pass would keep and delete.

#### `planReportRetention`

```ts
export async function planReportRetention(store: ObjectStore): Promise<ReportRetentionPlan>
```

Lists the commits recorded in `index/` with their records, and no key to delete. Report evidence outlives branch
heads: automatic cleanup never discards a layer. A listed commit with no readable record is left out of `retained`.

#### `pruneReports`

```ts
export async function pruneReports(store: ObjectStore): Promise<ReportRetentionPlan>
```

Same as `planReportRetention`. Despite the name it deletes nothing, and `deleteKeys` is always empty.

### Run bundles

Source: `packages/reports/src/run-bundle.ts`. Import: `@crvouga/atlas/reports/run-bundle`

Uploads a finished statechart run directory (manifest, screenshots, clips) to a store under `layers/runs/<run>/` and
lists and reads them back for the viewer. A run is shared only once its privacy scan passed. The manifest is written
after its files and the catalog entry (`layers/runs/index/<inverted-time>-<run>.json`) after the manifest, so a
half-uploaded run is never listed, and uploading again finishes the job. Uses Node's `fs`, so it is not for
browsers.

See docs/report-contract.md#where-bytes-go

#### `summarizeManifest`

```ts
export function summarizeManifest(id: string, manifest: unknown)
```

Builds the row the viewer lists for a finished run (a `RunSummary`) from its `manifest.json`, which may be any JSON:
every field is read defensively and a missing one takes a default.

`startedAt` is `run.startedAt`, else the time in the run id (`2026-10-09T12-00-00-000Z-...`), else the epoch;
`mode` is `run.mode`, else `showcase` for an id ending in `showcase`, else `fast`. `journeys` counts the manifest's
`journeys` (or the `paths` of kind `journey`) by status `passed`, `failed`, `flaky`, with any other status counted
as `notReached`. `progress` is always `complete`.

#### `RunNotShareableError`

```ts
export class RunNotShareableError extends Error {}
```

Thrown by `publishRunBundle` when a run's privacy scan did not pass (or never ran), so the run is not uploaded. The same rule the static viewer applies.

#### `publishRunBundle`

```ts
export async function publishRunBundle(store: ObjectStore, directory: string): Promise<{ readonly id: string; readonly files: number; readonly bytes: number; readonly alreadyPublished: boolean }>
```

Uploads a finished run directory so the viewer can browse it from the store. Files go first and
`manifest.json` after them, then the catalog entry, so a half-uploaded run is never listed. Running it
again after a failure finishes the job; a run that is already complete is left alone.

The run id is the directory's name (letters, digits, `_`, `.`, `-`; not starting with a dot). Files are written to
`layers/runs/<id>/<relative path>` with a media type from their extension; dot-files, dot-folders and symbolic links
are skipped. Resolves to the file and byte counts uploaded (both 0 with `alreadyPublished: true` when the manifest
was already in the store; a missing catalog entry is then written). Throws `RunNotShareableError` when
`manifest.privacy.passed` is not `true`, and an `Error` for a badly named directory or a missing or unreadable
`manifest.json`.

#### `listRunSummaries`

```ts
export async function listRunSummaries(store: ObjectStore, limit = 100, cache: Map<string, ReturnType<typeof summarizeManifest>> = new Map()): Promise<ReturnType<typeof summarizeManifest>[]>
```

Lists the newest `limit` (default 100) runs in the store, newest first by `startedAt` (ties by id). The catalog is
newest first, so one page of it is enough; entries never change, so `cache` (catalog key to summary) lets a
long-lived reader open each only once. A catalog entry that is empty or not JSON is skipped.

#### `readRunFile`

```ts
export async function readRunFile(store: ObjectStore, id: string, relative: string): Promise<StoredObject | null>
```

Reads one file of a run, or `null` when it is missing. Also `null`, without reading, for an `id` that is not a plain run name or a `relative` path with an empty, `.`, `..` or backslash segment, so a path can never leave the run.

### S3 object store

Source: `packages/reports/src/s3-store.ts`. Import: `@crvouga/atlas/reports/s3-store`

An `ObjectStore` on AWS S3 or anything that speaks its protocol (Cloudflare R2, MinIO, SeaweedFS, GCS interoperability,
Backblaze B2, Wasabi), written without an SDK: requests are signed with Signature Version 4 and sent with `fetch`, so
it runs on Bun and Node. Built for many writers and a long-lived reader: connections are reused, requests in flight
are capped, throttling and server errors are retried with jittered backoff, a bucket in another region is followed,
and expired credentials are refreshed once. Credentials never come from a URL; they come from options or the
environment the way an AWS SDK finds them. Importing the module does no work. Change it only with the S3 integration
tests passing against a real server: a fake `fetch` cannot tell you S3 accepts your signature.

See docs/report-contract.md#backends
See docs/deploying.md

#### `S3StoreOptions`

```ts
export type S3StoreOptions = {
  /** The bucket name. A name containing `.` is addressed path-style. */
  readonly bucket: string;
  /** A folder inside the bucket that holds everything: `atlas/my-project`. */
  readonly prefix?: string;
  /** Default `AWS_REGION`, then `us-east-1`. Cloudflare R2 uses `auto`. */
  readonly region?: string;
  /** For anything that is not AWS: `https://<account>.r2.cloudflarestorage.com`, `http://localhost:9000`. */
  readonly endpoint?: string;
  /** `endpoint/bucket/key` instead of `bucket.endpoint/key`. Default: yes for a custom endpoint, no for AWS. */
  readonly forcePathStyle?: boolean;
  /** Keys, or a provider. Default: the same lookup an AWS SDK does ({@link credentialChain}). */
  readonly credentials?: Credentials | CredentialProvider;
  /** The environment variables to read (`AWS_REGION`, `AWS_ENDPOINT_URL_S3`, credentials, ...). Default: `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** The `fetch` to send requests with. Default: the global one; inject a fake in tests. */
  readonly fetch?: typeof fetch;
  /** Attempts after the first for a request that failed in a way worth retrying. Default 4. */
  readonly retries?: number;
  /** For the service to start answering, per attempt, in milliseconds. A large body may take longer. Default 30 000. */
  readonly timeoutMs?: number;
  /** Requests in flight at once. Default 64: S3 answers in tens of milliseconds, so parallelism is what makes a cold start fast. */
  readonly concurrency?: number;
  /** The clock used to sign requests. Default: the system clock; inject in tests. */
  readonly now?: () => Date;
  /** The wait between retries, in milliseconds. Default: a real timer; inject in tests. */
  readonly sleep?: (ms: number) => Promise<void>;
};
```

How to reach a bucket. Only `bucket` is required.

#### `S3Error`

```ts
export class S3Error extends Error
```

An error from the store. The message names the bucket and what to do about it (for example the missing IAM
permission); `status` and `code` are what the service answered, `null` when it was never reached.
`retryable` says whether trying again can help; the store already retried before throwing.

#### `S3Store`

```ts
export type S3Store = ObjectStore & PagedListing & {
  /** A description with no secrets: `s3://bucket/prefix (us-east-1)`. */
  readonly label: string;
  /** Where the credentials came from, once a request has been made. */
  credentialSource(): string | null;
  /** One cheap round trip: can this store be listed? Used by readiness checks and `atlas report doctor`. */
  ping(): Promise<{ readonly ok: boolean; readonly ms: number; readonly error?: string }>;
};
```

An `ObjectStore` on S3 with paged listing, a secret-free label, and diagnostics.

#### `s3Store`

```ts
export function s3Store(options: S3StoreOptions): S3Store
```

An {@link ObjectStore} on S3, or anything that speaks its protocol: Cloudflare R2, MinIO, Google
Cloud Storage (interoperability), Backblaze B2, Wasabi, SeaweedFS. No SDK: requests are signed with
Signature Version 4 and sent with `fetch`, so it runs on Bun and Node and adds nothing
to the install.

Made for many writers and a long-lived reader: connections are reused, requests in flight are
capped, throttling and server errors are retried with jittered backoff, a bucket in another region
is followed, and expired credentials are refreshed once.

Behaviour to know: a missing key reads as `null`/`false` only when S3 answers 404. For an account without
`s3:ListBucket`, S3 answers 403 for a missing key, which throws `S3Error` with a hint: the publishing credentials
need `s3:GetObject`, `s3:PutObject` and `s3:ListBucket` (`atlas report policy` prints a least-privilege policy).
`getUri` returns a presigned URL valid for one hour. `deleteMany` sends one request per key, 16 at a time.
`listKeys` pages through the whole listing and sorts it; use `listPage` to read part of a large catalog. Nothing is
checked or created at construction: the first request is the first contact.

**Example**

```ts
const store = s3Store({ bucket: 'my-evidence', prefix: 'atlas/my-project', region: 'eu-west-1' });
await store.put('layers/manifests/x.json', bytes, 'application/json');
const { ok, error } = await store.ping();
```

### Gherkin scenario view of a recorded run

Source: `packages/reports/src/scenario.ts`. Import: `@crvouga/atlas/reports/scenario`

Recognises the Gherkin-keyword steps (`Given`, `When`, `Then`, `And`, `But`, `*`) at the top of a recorded step tree
and groups the harness actions nested under each, so the viewer can show a run as a readable script. Pure functions
over `ReportStep`.

#### `ScenarioLine`

```ts
export type ScenarioLine = {
  /** The Gherkin step itself. */
  readonly step: ReportStep;
  /** Nested harness steps: the actions taken while this line ran. */
  readonly actions: readonly ReportStep[];
};
```

One Gherkin line of a scenario and what the harness did while it ran.

#### `isGherkinStep`

```ts
export function isGherkinStep(step: ReportStep): boolean
```

Whether a step's `kind` (trimmed, any case) is a Gherkin keyword: `given`, `when`, `then`, `and`, `but` or `*`.

#### `gherkinText`

```ts
export function gherkinText(step: ReportStep): string
```

The step's title with a leading copy of its `kind` removed (case-insensitively, not word-aware), so the script can show the keyword once. Returns the trimmed title unchanged when it does not start with the kind.

#### `scenarioScript`

```ts
export function scenarioScript(
  steps: readonly ReportStep[]
): readonly ScenarioLine[] | null
```

Groups a run's top-level Gherkin steps with the actions nested under each, every descendant step flattened in
depth-first order. Returns `null` when no top-level step is a Gherkin step (a model check, a property), so the step
tree is the action log instead. Gherkin steps nested deeper than the top level are only listed as actions.

### AWS Signature Version 4

Source: `packages/reports/src/sigv4.ts`. Import: `@crvouga/atlas/reports/sigv4`

AWS Signature Version 4 request signing and URL presigning, with Web Crypto only, so it runs unchanged on Bun, Node
and in a Worker. S3 and every store that speaks its protocol (R2, MinIO, GCS interoperability, B2, Wasabi) sign this
way. Pure apart from Web Crypto: the time is passed in, nothing is sent. It is tested against AWS's published signing
vectors; change it only with the S3 integration tests passing against a real server.

See docs/report-contract.md#backends

#### `Credentials`

```ts
export type Credentials = {
  /** The public key id; sent in the `Authorization` header. */
  readonly accessKeyId: string;
  /** The secret used to derive the signing key. Never sent. */
  readonly secretAccessKey: string;
  /** Temporary-credential token, sent as `x-amz-security-token` by the caller; absent for long-lived keys. */
  readonly sessionToken?: string;
  /** Epoch milliseconds after which these stop working. Absent for long-lived keys. */
  readonly expiresAtMs?: number;
};
```

An AWS-style credential.

#### `sha256Hex`

```ts
export async function sha256Hex(data: Uint8Array | string): Promise<string>
```

The SHA-256 digest of a string (UTF-8) or bytes, as 64 lowercase hex digits.

#### `uriEncode`

```ts
export function uriEncode(value: string, keepSlash = false): string
```

RFC 3986 percent-encoding of the UTF-8 bytes of `value`, which is what SigV4 asks for: letters, digits and `-_.~`
stay, everything else (including `/`, unless `keepSlash`) becomes uppercase `%XX`.

#### `amzDate`

```ts
export function amzDate(at: Date): { readonly date: string; readonly datetime: string }
```

Formats a time for signing: `date` is `YYYYMMDD` and `datetime` is `YYYYMMDDTHHMMSSZ`, both UTC.

#### `SignInput`

```ts
export type SignInput = {
  /** The HTTP method, uppercase (`GET`, `PUT`). */
  readonly method: string;
  /** The full request URL; its path and query are signed. */
  readonly url: URL;
  /** Every header to sign, lowercase names. `host` is added when missing. */
  readonly headers: Readonly<Record<string, string>>;
  /** SHA-256 hex of the body, or `UNSIGNED-PAYLOAD`. */
  readonly payloadHash: string;
  /** The key to sign with. */
  readonly credentials: Credentials;
  /** The region in the credential scope, such as `us-east-1`. */
  readonly region: string;
  /** The service in the credential scope, `s3` for S3. */
  readonly service: string;
  /** The signing instant. Use the same instant for the `x-amz-date` header, or a request that straddles a second is rejected. */
  readonly at: Date;
  /** S3 keeps the path exactly as given; other services encode it twice. */
  readonly doubleEncodePath?: boolean;
};
```

What `signRequest` signs.

#### `signRequest`

```ts
export async function signRequest(input: SignInput): Promise<Record<string, string>>
```

Signs a request and returns the headers to send: those given, plus `host` (when missing) and `authorization`. The
caller must send exactly these headers (and any it did not sign must not matter to the service). Does not send
anything and does not read the body; `payloadHash` is trusted.

#### `presignUrl`

```ts
export async function presignUrl(input: { readonly url: URL; readonly credentials: Credentials; readonly region: string; readonly service: string; readonly at: Date; readonly expiresSeconds: number }): Promise<string>
```

A query-signed URL anyone can GET until it expires, without credentials: for handing a file to a browser. Valid for
`expiresSeconds` from `at`; signs only the `host` header and an unsigned payload, so it works for `GET` only.

### Snapshot bundles

Source: `packages/reports/src/snapshot-bundle.ts`. Import: `@crvouga/atlas/reports/snapshot-bundle`

Packs the frame files of one recorded test into a few gzip chunks of roughly 1 MiB (JSON of base64 snapshots), with a
small index from file to chunk, so a test with hundreds of frames uploads as a handful of objects and a reader
fetches only the chunks it needs. Keys are `<prefix>snapshots.json` (the index, written last) and
`<prefix>snapshots-<n>.json.gz`. Reads reject a chunk name that does not look like `snapshots-<n>.json.gz`.

#### `publishSnapshotBundle`

```ts
export async function publishSnapshotBundle(args: {
  /** Where the recorded files are now. */
  readonly local: ObjectStore;
  /** Where the bundle is written. */
  readonly remote: ObjectStore;
  /** The key prefix of the files in `local`. */
  readonly localPrefix: string;
  /** The key prefix to write the bundle under; end it with `/`. */
  readonly remotePrefix: string;
  /** The file names, relative to `localPrefix`. */
  readonly files: readonly string[];
}): Promise<void>
```

Copies `files` from `local` into gzip chunks on `remote`, then writes the index last, so a reader that finds the
index can read every chunk it names.

Each file is read from `local` at `localPrefix + file` and stored under the name `file` in the index. Chunks are
packed up to about 1 MiB of encoded text (a larger single file gets a chunk of its own) and uploaded four at a time
to `remotePrefix`. Throws `Missing report snapshot: <key>` when a listed file is absent in `local`, before anything
is written to `remote`.

#### `readBundledSnapshot`

```ts
export async function readBundledSnapshot(
  store: ObjectStore,
  prefix: string,
  file: string
): Promise<{
  readonly bytes: Uint8Array;
  readonly contentType: string;
} | null>
```

Reads one file from a bundle written by `publishSnapshotBundle`, decompressing the chunk that holds it. Returns `null`
when the bundle has no index, the file is not in the index, or its chunk is missing. Throws `Invalid snapshot chunk`
for a chunk name that is not `snapshots-<n>.json.gz`, and a `SyntaxError` for a corrupt index or chunk.

#### `readBundledSnapshots`

```ts
export async function* readBundledSnapshots(
  store: ObjectStore,
  prefix: string,
  files: ReadonlySet<string>
)
```

Streams the requested `files` of a bundle as `{ file, bytes, contentType }`, in the order chunks finish reading (not
the order of `files`). A streamed test reads each compressed chunk once even when it contains many frames. Files not
in the index and chunks that are missing are skipped silently; a bundle with no index yields nothing.

### Snapshot surface

Source: `packages/reports/src/snapshot-surface.ts`. Import: `@crvouga/atlas/reports/snapshot-surface`

Paints recorded page snapshots (HTML captured at each step of a test) into a phone-sized surface in the viewer and
draws the press target of a gesture on top. One long-lived surface per client panel: frames are painted by swapping
the parsed snapshot DOM into that surface synchronously, so scrubbing never re-parses `frameCss` or refetches fonts.
The press target is resolved against the painted DOM with the driver's chained first-match semantics and drawn as a
single overlay from real layout.

The phone paints into an open shadow tree, not an iframe: embedded browsers drop iframe documents, and a shadow tree
stays in the page. Snapshot styles sit on the shadow root, and the host is the 390x844 viewport the app shell fills.
Browser-only: needs `document`, `DOMParser` and shadow DOM. Snapshot HTML comes from a test run and is untrusted;
`<script>` elements are removed (`cleanSnapshotHtml`) but nothing else is sanitised, so show it only in a context you
would show that run's pages in.

#### `HitResult`

```ts
export type HitResult = 'none' | 'found' | 'missing';
```

What drawing a press target found: `none` (no target to draw), `found` (target located, overlay drawn) or `missing` (the path does not resolve in the painted snapshot, overlay hidden).

#### `scopeSnapshotCss`

```ts
export function scopeSnapshotCss(css: string): string
```

Rewrites snapshot CSS so it applies inside the phone surface: the selectors `html` and `:root` become `.sr-snap-doc`,
`body` becomes `.sr-snap-body`, and the viewport units `100vh`, `100vw` (and their `d`, `s`, `l` variants) become
`100%` of that box. A regex rewrite, so it is approximate for unusual selectors.

#### `ensureShell`

```ts
export function ensureShell(doc: Document, frameCss: string): void
```

Makes `doc` the standards-mode shell with `frameCss` installed, replacing its content, unless it already is one. Does nothing when the shell's stylesheet is present, so a later different `frameCss` is not applied.

#### `resolveHitTarget`

```ts
export function resolveHitTarget(
  scope: ParentNode,
  path: readonly string[]
): Element | null
```

Finds the element a gesture targeted: the first `[data-testid]` match of `path[0]` inside `scope`, then the first
match of `path[1]` inside that, and so on. Returns `null` as soon as a step has no match, and for an empty path
returns `null` too. Mirrors how the UI driver resolves `get(a).get(b)`.

#### `drawHit`

```ts
export function drawHit(doc: Document, hit: ReportStepHit | null): HitResult
```

Draws the one press overlay (a box and a dot at `hit.point`, default the centre) on `hit`'s target in a document, scrolling the target into view if it is outside the viewport. Returns what it found; with no hit it hides the overlay.

#### `paintSnapshot`

```ts
export function paintSnapshot(
  doc: Document,
  snap: { readonly key: string; readonly html: string },
  hit: ReportStepHit | null
): HitResult
```

Paints one snapshot into `doc` (already a shell, see `ensureShell`) and draws `hit`. `key` identifies the snapshot for
parse caching (256 entries, oldest dropped first): it must change whenever `html` does, or the earlier parse is
reused.

#### `createSnapshotHost`

```ts
export function createSnapshotHost(): HTMLDivElement
```

Creates the in-page snapshot surface: a `div.sr-snap` with an open shadow tree, sized to the phone viewport, ready for `paintSnapshotHost`. No iframe.

#### `paintSnapshotHost`

```ts
export function paintSnapshotHost(
  host: HTMLElement,
  snap: { readonly key: string; readonly html: string; readonly css: string },
  hit: ReportStepHit | null
): HitResult
```

Paints one snapshot into the shadow tree `createSnapshotHost` built, installs `snap.css` (the frame stylesheet) and
draws `hit`. Painting is skipped, and only the overlay redrawn, when the same `key` and `html` were painted last.
Returns `none` when `host` was not built by `createSnapshotHost`.

### Source content references

Source: `packages/reports/src/source-content.ts`. Import: `@crvouga/atlas/reports/source-content`

A source (one package bucket of recorded tests in a commit) either owns commit-local files under
`commits/<sha>/tests/<source>/`, or references a reusable, content-addressed copy under
`content/v2/<generation>/<taskHash>/<source>/` that an identical earlier passing run already uploaded. This module
names those prefixes, writes and resolves the reference, and decides when a copy is reusable. Only a passing source
is ever reused, and a reference whose prefix does not fit the pattern is rejected, so a record cannot point a reader
at another path.

#### `SourceIdentity`

```ts
export type SourceIdentity = {
  /** The hash of the exact task that produced the source: 16 to 64 lowercase hex digits. */
  readonly taskHash: string;
  /** The retention window the source belongs to, from `reportGeneration`. A new generation never reuses an older copy, so old content can expire. */
  readonly generation: number;
};
```

What makes a recorded source reusable: the exact task that produced it, within a retention window.

#### `reportGeneration`

```ts
export function reportGeneration(nowMs: number, retentionDays: number): number
```

The retention window index for a time: `floor(nowMs / (retentionDays * 86 400 000))`. Throws `Report time must be nonnegative` for a negative or non-finite time and `Report retention must be a positive number of days` for a non-integer or less than 1.

#### `sourceContentPrefix`

```ts
export function sourceContentPrefix(
  identity: SourceIdentity,
  source: string
): string
```

The key prefix of a reusable source's content: `content/v2/<generation>/<taskHash>/<source>/`. Throws
`Report identity needs an exact task hash`, `Report generation must be a nonnegative integer` or `Invalid report
source` when an input is malformed.

#### `attachSource`

```ts
export async function attachSource(
  store: ObjectStore,
  args: {
    readonly sha: string;
    readonly record: SourceRecord;
    readonly contentPrefix: string;
  }
): Promise<void>
```

Points a commit's source record at reusable content: writes `commits/<sha>/sources/<source>.json` as `{ record, contentPrefix }`.

#### `reuseSource`

```ts
export async function reuseSource(
  store: ObjectStore,
  args: {
    readonly sha: string;
    readonly packageDir: string;
    readonly bucket: string;
    readonly identity: SourceIdentity;
  }
): Promise<SourceRecord | null>
```

Reuses an earlier passing run of the same task: when the content for `identity` is complete in the store, attaches it
to `sha` and returns its record; otherwise returns `null` and writes nothing. Returns `null` also when the stored
record is for another package or bucket, or did not pass. Throws for a malformed identity or a stored record that is
not JSON.

#### `readStoredSource`

```ts
export async function readStoredSource(
  store: ObjectStore,
  sha: string,
  source: string
): Promise<SourceReference | null>
```

Reads a commit's record of one source and where its test files live, or `null` when the commit has no such source.
A reference written by `attachSource` yields its content prefix; a plain record yields
`commits/<sha>/tests/<source>/`. Throws `Invalid report content reference` when a reference's prefix does not match
the expected pattern or names another source.

#### `sourceTestPrefix`

```ts
export async function sourceTestPrefix(
  store: ObjectStore,
  args: {
    readonly sha: string;
    readonly source: string;
    readonly testId: string;
  }
): Promise<string | null>
```

The key prefix of one test's files, `<content prefix><testId>/`, or `null` when the source is not in the commit. Throws `Invalid report test` when `testId` is not a safe key segment.

### Source file entries

Source: `packages/reports/src/source-entries.ts`. Import: `@crvouga/atlas/reports/source-entries`

Streams the files of a recorded source (each test's timeline and its captured frame files) as bundle entries ready to
be packed into blobs. Entries come in a fixed order (tests by id, files by name) so the same source always packs into
the same blobs.

#### `sourceEntries`

```ts
export async function* sourceEntries(
  args: PublishSourceArgs,
  source: string,
  tests: readonly HtmlReportTest[],
  runId: string
): AsyncGenerator<BundleEntry>
```

Yields, for each test of `tests` in `testId` order, its `report.json` and then each file the report names (sorted by
name), keyed by the commit-relative layout `commits/<sha>/tests/<source>/<testId>/...`. Frame files are read from
`args.local` under `runId` as the generator is consumed, one at a time. Throws `Missing report snapshot: <file>` when
a named file is absent locally, and a `not a ...` error for an unsafe source, test id or file name.

### Report parts of a recorded source

Source: `packages/reports/src/source-part.ts`. Import: `@crvouga/atlas/reports/source-part`

Turns a recorded source (a package bucket's tests with their outcomes) into the report parts (checks grouped by kind)
that become a layer's `parts`. Fail-closed: a source that failed as a whole always carries at least one failed check,
so recorded passes cannot hide a producer that did not complete.

#### `sourcePart`

```ts
export function sourcePart(sha: string, source: SourceRecord): ReportPart
```

The main part of a source: its own evidence part (the first one that is not `performance`) re-keyed to the source,
or else one check per test. Check ids become `<source>/<testId>` so two packages can name a test alike. The part's
`kind` is `ui-quality` for the `ui-quality` bucket and `behavior` otherwise (unless its evidence says otherwise); a
skipped test is `not-run`. When the source failed but no check did, a failing `<source>:producer-failure` check is
added.

#### `sourceParts`

```ts
export function sourceParts(
  sha: string,
  source: SourceRecord
): readonly ReportPart[]
```

The parts of a source: `sourcePart`, then each `performance` evidence part as its own part with id `<source>--performance`, re-keyed to the source's time and check ids.

### Reading a source's files

Source: `packages/reports/src/source-reader.ts`. Import: `@crvouga/atlas/reports/source-reader`

Chooses how to read the files of one source of a commit: through its bundle index when it has one, otherwise as
individual objects (stores written before bundles existed stay readable).

#### `sourceReader`

```ts
export async function sourceReader(
  store: ObjectStore,
  args: { sha: string; source: string }
)
```

Returns a function that reads one file of a source by key, resolving to its bytes and media type or `null` when it is
absent. Reads through the bundle index at `commits/<sha>/bundles/<source>.json` when that has entries, otherwise reads
the key directly from `store`. Throws when the index is present but not JSON.

### Matching recorded tests to specs

Source: `packages/reports/src/spec-evidence.ts`. Import: `@crvouga/atlas/reports/spec-evidence`

Small lookups from a spec to the recorded tests that ran it, by the source file each test reports. Pure functions
over `HtmlReportTest`.

#### `testsForSpec`

```ts
export function testsForSpec(
  entry: SpecEntry,
  tests: readonly HtmlReportTest[]
): readonly HtmlReportTest[]
```

The tests whose reported `sourceFile` is the spec's path or ends with `/<path>` (so a runner's absolute path matches), after turning backslashes into `/`. A longer name that merely ends with the same letters does not match.

#### `specEvidenceCounts`

```ts
export function specEvidenceCounts(
  tests: readonly HtmlReportTest[]
): ReadonlyMap<string, number>
```

Counts recorded tests per spec path in one pass, so large suites never scan all tests per row. A test's path is its
`sourceFile` (with backslashes turned into `/`) from the first occurrence of `specs/`, wherever that occurs, or the whole
path when there is none; tests with no `sourceFile` are not counted.

### Spec inventory of a commit

Source: `packages/reports/src/spec-inventory.ts`. Import: `@crvouga/atlas/reports/spec-inventory`

The older, commit-keyed record of which spec documents a commit has: `commits/<sha>/inventory.json` (the entries) and
`commits/<sha>/specs/<path>` (their bodies). Document bodies are written first, so an inventory always names readable
content. The newer form is the spec set (`spec-set.ts`).

#### `isSpecPath`

```ts
export function isSpecPath(path: string): boolean
```

Whether `path` is a safe spec path: starts with `specs/` and no segment is empty, `.`, `..`, or contains a backslash or control character.

#### `specEntry`

```ts
export function specEntry(path: string, content: string): SpecEntry
```

Describes one spec document: its `path`, a text `fingerprint`, a `kind` (the file extension, `openslo` for
`*.openslo.yaml`, `document` when there is none), a `title` (the first `Feature:` line, else the first `# ` heading,
else the file name) and a `domain` (the folder right under `specs/`, or `Overview` for a file directly in it).
Throws `Invalid spec path` unless `isSpecPath(path)`.

#### `publishInventory`

```ts
export async function publishInventory(
  store: ObjectStore,
  args: {
    readonly sha: string;
    readonly documents: readonly {
      readonly path: string;
      readonly content: string;
    }[];
  }
): Promise<SpecInventory>
```

Publishes a commit's spec documents and its inventory, and returns the inventory (entries sorted by path).
Publish document bodies first; an inventory always names readable content. Throws `Duplicate spec` for a repeated
path (before writing anything), `Invalid spec path` or `Invalid commit` for malformed input. Publishing the same
documents again writes the same keys.

#### `readInventory`

```ts
export async function readInventory(
  store: ObjectStore,
  sha: string
): Promise<SpecInventory | null>
```

Reads a commit's inventory, or `null` when it has none. Throws `Invalid spec inventory` when the stored one is for another sha, malformed, or names an unsafe path, and `Invalid commit` for a bad sha.

#### `readSpecDocument`

```ts
export async function readSpecDocument(
  store: ObjectStore,
  sha: string,
  path: string
): Promise<string | null>
```

Reads one spec document's text, or `null` when the commit has no inventory or the inventory does not list `path`. Throws `Invalid spec path` for an unsafe path.

### Linking checks to specs

Source: `packages/reports/src/spec-link.ts`. Import: `@crvouga/atlas/reports/spec-link`

Decides which spec each imported check belongs to, so results from a JUnit or CTRF file land under the right spec in
the report. It reads only the specs directory and the one spec file the caller names explicitly; a report is data and
does not choose which files Atlas opens. Uses Node's `fs`.

#### `SpecLinks`

```ts
export type SpecLinks = {
  /** Every file under this directory is a spec named `specs/<its path>`. Relative to `base`. */
  readonly specsDirectory?: string;
  /** Every check in the report belongs to this spec. A path relative to `base`. */
  readonly spec?: string;
  /** The directory that relative paths (`specsDirectory`, `spec`) resolve against, usually the repository root. */
  readonly base: string;
};
```

Where specs are and how to resolve them for `linkChecksToSpecs`.

#### `linkChecksToSpecs`

```ts
export async function linkChecksToSpecs(ingested: IngestedChecks, links: SpecLinks): Promise<{ readonly checks: readonly EvidenceCheck[]; readonly specs: readonly SpecEntry[] }>
```

A test report rarely says which spec a test checks. Say so here, in the order of how sure it is:

1. `spec`: the whole report is one spec's checks (a report per feature file).
2. A path the report gives that is one of the specs.
3. A name the report gives for the suite, class or file that is a spec's title or file name
   (Cucumber writes the feature's title as the suite), or the first part of a check's title before
   ` > `.

What cannot be linked stays unlinked, and is reported under no spec rather than a wrong one.
Returns the checks and the specs they now belong to, with fingerprints, so a later reader can warn
when a spec changed after the layer was recorded.

### Spec sets

Source: `packages/reports/src/spec-set.ts`. Import: `@crvouga/atlas/reports/spec-set`

Publishes and finds spec sets: the specs of one commit, stored in the store itself so a viewer needs no checkout. Bodies
are content-addressed in `layers/specs/blobs/<sha256>.txt`, the set is `layers/specs/sets/<id>.json`, and the catalog
entry `layers/specs/index/<inverted-time>-<branch>-<flag>-<id>.json` is written last. `latestSpecSet` picks the outline
a report is laid over: the newest set of `main` (then `master`, then any branch), preferring a set from a clean
commit over one from a modified checkout.

See docs/report-contract.md#where-bytes-go

#### `PublishSpecSetInput`

```ts
export type PublishSpecSetInput = {
  /** The spec files and their text; see `collectSpecFiles`. */
  readonly files: readonly SpecFileText[];
  /** The branch the specs are from, or `null`. Part of the set's identity and of its catalog key. */
  readonly branch: string | null;
  /** The commit the specs are from, or `null`. Part of the set's identity. */
  readonly sha: string | null;
  /** When the specs were recorded, epoch milliseconds; orders the catalog (newest first). */
  readonly recordedAtMs: number;
  /** `modified` for a checkout with uncommitted edits, `unknown` outside git; absent for a clean checkout. Part of the set's identity. */
  readonly freshness?: 'unknown' | 'modified';
  /** The group shown in the viewer for every file. Default `product`. */
  readonly domain?: string;
};
```

What to publish as one spec set.

#### `publishSpecSet`

```ts
export async function publishSpecSet(store: ObjectStore, input: PublishSpecSetInput): Promise<SpecSet>
```

Publishes the specs of one version and returns the set. Bodies are stored by content, so a spec that did not change
costs nothing, and the set is named by what it holds: publishing the same specs from the same commit twice
writes the same set. The catalog entry is written last.

The set's `id` is the SHA-256 of the branch, sha, freshness and each file's path and digest, so the same specs from a
developer's edited worktree and from CI are different sets. Store errors reject; a failure part-way leaves bodies
no set names, never a set whose bodies are missing.

#### `readSpecSet`

```ts
export async function readSpecSet(store: ObjectStore, id: string): Promise<SpecSet | null>
```

Reads and validates a spec set by id, or `null` when it is missing. Throws `Spec set <id> is not valid: ...` when it fails the schema, and a `SyntaxError` when it is not JSON.

#### `readSpecBody`

```ts
export async function readSpecBody(store: ObjectStore, digest: string): Promise<string | null>
```

Reads the text of a spec body by its SHA-256 digest, or `null` when it is missing or `digest` is not 64 lowercase hex digits.

#### `latestSpecSet`

```ts
export async function latestSpecSet(stores: readonly ObjectStore[], branch?: string, cache: Map<string, SpecSet> = new Map()): Promise<Found | null>
```

The spec set the report is laid over: the newest one of `branch` in any of the stores. Without a
branch, the newest of `main` or `master`, and failing that the newest of all, so a project that
only ever publishes from other branches still has an outline.

A set from a modified checkout (a developer's uncommitted edits) is used only when no set from a
commit exists: the shared view does not follow anyone's work in progress. The branch and cleanliness
are read from the catalog's keys, so choosing costs a listing and a read or two, however many sets
other branches have published. `cache` keeps sets already read: they never change.

Resolves to the set and the store it was found in, or `null` when no store has a fitting set (with an explicit
`branch`, only that branch counts). A store that fails is skipped; the first error is thrown only when every store
failed. A set that cannot be read is skipped.

### Suite status

Source: `packages/reports/src/status.ts`. Import: `@crvouga/atlas/reports/status`

The one rule for rolling test outcomes up into a suite or commit outcome, used wherever a recorded run is summarised.

#### `suiteStatus`

```ts
export function suiteStatus(
  tests: readonly { readonly status: ReportTestStatus }[]
): ReportTestStatus
```

The worst outcome of a set of tests or sources: `failed` if any failed, `skipped` if there is at least one and all
were skipped, otherwise `passed`. An empty list is `passed`: callers that need "no evidence" to mean something else
(for example `closeCommit`) check for emptiness themselves.

### Prefix-scoped object store

Source: `packages/reports/src/store-prefix.ts`. Import: `@crvouga/atlas/reports/store-prefix`

A decorator that makes a store look like it starts at a key prefix: callers use short keys, the shared bucket stays
partitioned by prefix, and prefixes compose. It guards the keys it is given (no leading `/`, no `..`) so a scoped
store cannot reach outside its prefix by key.

#### `normalizeObjectStorePrefix`

```ts
export function normalizeObjectStorePrefix(prefix: string): string
```

Returns `prefix` with exactly one trailing `/` added when missing. Throws `ObjectStoreWithPrefix: prefix must be non-empty` for an empty prefix.

#### `ObjectStoreWithPrefix`

```ts
export class ObjectStoreWithPrefix implements ObjectStore
```

Decorator that scopes every {@link ObjectStore} operation to a fixed key
prefix. Used at composition roots (e.g. API bindings) so feature code uses
logical keys while a shared bucket stays partitioned by prefix.

Keys passed to `get`, `put`, `head`, `delete`, `deleteMany`, `getUri` are checked (`assertLogicalObjectKey`: not
empty, no leading `/`, no `..`) and throw otherwise. The `prefix` argument of `listKeys` and `listPage` is not
checked here; the store underneath is responsible for it. Returned keys have the prefix removed.

- `get(key: string): Promise<StoredObject | null>` — Reads `prefix + key` from the underlying store; `null` when missing. Throws for an invalid key.
- `put(key: string, bytes: Uint8Array, contentType: string): Promise<void>` — Writes `prefix + key` in the underlying store. Throws for an invalid key.
- `head(key: string): Promise<boolean>` — Whether `prefix + key` exists in the underlying store. Throws for an invalid key.
- `delete(key: string): Promise<void>` — Removes `prefix + key`; a no-op when missing. Throws for an invalid key.
- `deleteMany(keys: readonly string[]): Promise<void>` — Removes every `prefix + key`. Throws for an invalid key, before deleting any.
- `getUri(key: string): Promise<string | null>` — The underlying store's URL for `prefix + key`, or `null`. Throws for an invalid key.
- `async listKeys(prefix = ''): Promise<readonly string[]>` — Lists keys under `prefix` (relative to this store's prefix) in the underlying store's order, with this store's prefix removed.
- `listPage?: (prefix: string, options?: { readonly after?: string; readonly limit?: number })` — Paged listing with this store's prefix removed from keys and from `next`; present only when the store underneath has `listPage`.
- `withPrefix(subPrefix: string): ObjectStore` — A store scoped to this prefix followed by `subPrefix`, over the same underlying store (`a/` then `b/` is `a/b/`).

### Stores named by URL

Source: `packages/reports/src/store-url.ts`. Import: `@crvouga/atlas/reports/store-url`

Turns a store name (`./folder`, `s3://bucket/prefix`, `r2://…`, `gs://…`, `https://atlas.example.com`) into an opened
`ObjectStore`, and a list of names (`ATLAS_STORE`, `--store`) into backends with unique ids. Secrets never travel in a
URL: S3 credentials come from the environment, an Atlas server's token from `ATLAS_TOKEN` (or `ATLAS_TOKEN_<ID>` for a
named store when several servers are used), and a token is never sent to a server over plain `http://` beyond this machine.

See docs/deploying.md#1-where-results-are-kept

#### `StoreLocation`

```ts
export type StoreLocation =
  | { readonly kind: 'directory'; readonly directory: string }
  | { readonly kind: 's3'; readonly bucket: string; readonly prefix: string; readonly region?: string; readonly endpoint?: string; readonly pathStyle?: boolean }
  /** An Atlas server: uploads go to it, and it shows everyone the combined report. */
  | { readonly kind: 'server'; readonly url: string };
```

Where a store is, parsed: a `directory`, an S3-compatible `s3` bucket and prefix (with region, endpoint and addressing), or an Atlas `server` URL.

#### `OpenedStore`

```ts
export type OpenedStore = {
  readonly store: ObjectStore;
  /** What to show people: no credentials, ever. */
  readonly label: string;
  readonly location: StoreLocation;
  /** The S3 handle, for credential source and ping. */
  readonly s3?: S3Store;
  /** The server handle, for ping. */
  readonly server?: HttpStore;
};
```

A store opened from a location: the `ObjectStore`, a `label` for people, the parsed `location`, and, by kind, the `s3` or `server` store with its extra methods.

#### `parseStoreLocation`

```ts
export function parseStoreLocation(spec: string, base: string, env: Env = {}): StoreLocation
```

Where a store is, from one string:

- `./atlas-reports`, `/srv/atlas`, `file:///srv/atlas`: a directory.
- `s3://bucket/prefix`: S3. Add `?region=eu-west-1`, `?endpoint=https://…` for R2, MinIO and the
  rest, `?pathStyle=1`. Keys are never in the URL: they come from the environment (see
  `credentialChain`).
- `r2://bucket/prefix?account=<id>` (Cloudflare R2) and `gs://bucket/prefix` (Google Cloud Storage with
  HMAC keys): the same store with the endpoint filled in. Atlas does not test against these two.

#### `StoreRole`

```ts
export type StoreRole = { readonly id: string; /** The only Atlas server among them: the one `ATLAS_TOKEN` is for. */ readonly soleServer: boolean };
```

Which store this is among those opened together, so a token goes only to the server it is for.

#### `openStore`

```ts
export function openStore(spec: string, options: { readonly base: string; readonly env?: Env; readonly fetch?: typeof fetch; readonly role?: StoreRole }): OpenedStore
```

Opens one store from its name. A directory is not created here (commands that write create it). Throws for a name it cannot make sense of, and for a token that would be sent over plain `http://` beyond this machine.

**Example**

```ts
const { store } = openStore('s3://my-bucket/atlas/my-project?region=us-east-1', { base: process.cwd(), env: process.env });
```

#### `serverToken`

```ts
export function serverToken(env: Env, role: StoreRole = { id: '', soleServer: true }, readFile: (file: string) => string | null = file => { try { return readFileSync(file, 'utf8'); } catch { return null; } }): string | null
```

The token a client sends to one Atlas server. `ATLAS_TOKEN_<ID>` (or the first line of the file `ATLAS_TOKEN_FILE_<ID>`
names) is for the store called `<ID>`; `ATLAS_TOKEN` / `ATLAS_TOKEN_FILE` is for the only server there is. With
several servers, `ATLAS_TOKEN` is for none of them: a token is a secret of one server, never sent to another.

#### `storeId`

```ts
export function storeId(location: StoreLocation, taken: ReadonlySet<string>): string
```

A short id for a store, unique among the given ones: `my-bucket-ci`, `reports`.

#### `storeSpecs`

```ts
export function storeSpecs(flags: readonly string[], env: Env): string[]
```

`--store` values, or `ATLAS_STORE` when there are none: one store, or several separated by commas or new lines (a folder may have spaces in its name).

#### `openBackends`

```ts
export function openBackends(specs: readonly string[], options: { readonly base: string; readonly env?: Env; readonly fetch?: typeof fetch; readonly mustExist?: boolean }): (BackendInput & OpenedStore)[]
```

`id=url` or a bare url, opened and given a unique id.

### Test as a catalog row

Source: `packages/reports/src/test-catalog-entity.ts`. Import: `@crvouga/atlas/reports/test-catalog-entity`

Maps a recorded test to the flat row the viewer's searchable, groupable list draws.

#### `testCatalogEntity`

```ts
export function testCatalogEntity(test: HtmlReportTest): CatalogEntity
```

Flattens a recorded test into a `CatalogEntity`: its id, title, status and duration; the base name of its source
file; the package (the part of the viewer test id's source before `--`, or `report`); its runtime; and the first
line of its error as the detail. `search` joins the title, ids, paths, system, runtime, package and error for text
matching. `href` is `null`; the caller sets where a row links to.

### Test catalog, history and runs

Source: `packages/reports/src/test-catalog.ts`. Import: `@crvouga/atlas/reports/test-catalog`

What a person or an agent asks of a report once it holds more than a handful of checks: every test with where it ran,
how it went over time and how long it takes; the specs, domains, environments and producers they fall under; the CI
runs that produced them and which tests each one ran.

- `TestHistory` keeps every recorded result of every test (bounded per test) and every run's results, folded in one
  layer at a time, in any order, with the same outcome. It never decides a status: the current status of a test is
  always the report's winner (`combineEvidence`), and history only describes how it got there.
- `testCatalog` turns the report's winners (plus a history, when there is one) into a `TestCatalog`: a summary with
  insights (slowest, flaky, failing), facets to filter by, and the tests that match a `TestQuery`.
- `testHistory`, `runList` and `runDetail` answer for one test, every run, and one run.
- `catalogMarkdown`, `historyMarkdown`, `runsMarkdown` and `runMarkdown` say the same in Markdown, for an agent or a
  terminal.

A test is a check identity (its spec path and id) regardless of producer, environment and parameters; each of those
combinations is one of its results. A result that is not `passed` is never counted as a pass, and a test with no
completed result has no pass rate.

See docs/server.md#reading-the-report-as-an-agent

#### `TEST_CATALOG_VERSION`

```ts
export const TEST_CATALOG_VERSION = …
```

The version of the documents this module writes (`TestCatalog`, `TestHistoryDocument`, `RunList`, `RunDetail`). Only optional fields are added within it.

#### `HISTORY_PER_TEST`

```ts
export const HISTORY_PER_TEST = …
```

Recorded results kept per test, newest first. Older ones are counted in no statistic.

#### `TestResultEntry`

```ts
export type TestResultEntry = {
  /** When it was recorded, epoch ms. */
  readonly at: number;
  readonly status: EvidenceStatus;
  /** How long it took, ms, or null when the producer did not measure it. */
  readonly durationMs: number | null;
  /** The client it checked (`desktop-web`, `api`, `ios`…), or null. */
  readonly environment: string | null;
  readonly producer: string;
  /** The kind of the part that held it (`checks`, `behavior`, `performance`…). */
  readonly kind: string;
  /** Other choices that made it its own result (a device size, a locale…). */
  readonly parameters: Readonly<Record<string, string>>;
  readonly branch: string | null;
  readonly sha: string | null;
  readonly runUrl: string | null;
  /** The key of the run it belongs to (see `runKey`). */
  readonly run: string;
  /** The id of the layer that recorded it. */
  readonly layer: string;
  readonly backend: string;
  /** Why it has its status: the first 500 characters of the check's detail. */
  readonly detail: string;
  /** What it carried beyond its outcome (attachments, steps, retries, tags, labels), when anything. */
  readonly evidence?: EvidenceSummary;
};
```

One recorded result of a test: when, where, how it went and how long it took, and the layer and run it came from.

#### `TestOutcome`

```ts
export type TestOutcome = TestResultEntry;
```

The current result of a test in one producer, environment and parameter set: the report's winner for that slot.

#### `DurationStats`

```ts
export type DurationStats = {
  readonly count: number;
  readonly totalMs: number;
  readonly avgMs: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly minMs: number;
  readonly maxMs: number;
  /** The newest recorded duration. */
  readonly lastMs: number;
};
```

Durations of a set of results, ms. Only results that recorded one are counted.

#### `TestStats`

```ts
export type TestStats = {
  /** Recorded results: passed, failed and not-run (progress reported as `running` is not history). */
  readonly results: number;
  readonly passed: number;
  readonly failed: number;
  /** passed / (passed + failed), or null with no completed result. */
  readonly passRate: number | null;
  /** True when the same code both passed and failed, a retry was needed to pass, or the producer said so. */
  readonly flaky: boolean;
  /** Why it is flaky, for a person; empty when it is not. */
  readonly flakyReason: string;
  /** How many times the completed outcome changed, per result, newest history first. */
  readonly flips: number;
  readonly durations: DurationStats | null;
  readonly firstSeenMs: number | null;
  readonly lastSeenMs: number | null;
  readonly lastPassedAtMs: number | null;
  readonly lastFailedAtMs: number | null;
  /** Distinct runs it was recorded in. */
  readonly runs: number;
  /** Branches it was recorded on, most recent first, at most ten. */
  readonly branches: readonly string[];
};
```

How a test has gone across its recorded history (at most `HISTORY_PER_TEST` results).

#### `CatalogSpec`

```ts
export type CatalogSpec = {
  readonly path: string;
  readonly title: string;
  /** The group it belongs to: the spec's own domain, else the folder under `specs/`. */
  readonly domain: string;
  readonly kind: string;
};
```

A spec as the catalog shows it: recorded by a layer or published in a spec set, or derived from the path alone.

#### `TestSummary`

```ts
export type TestSummary = {
  /** The check identity, `JSON.stringify([specPath, id])`. Stable; use it to ask for the test's history. */
  readonly key: string;
  readonly id: string;
  readonly title: string;
  readonly specPath: string | null;
  readonly spec: CatalogSpec | null;
  /** The worst current outcome across its results (failed, then running, then not-run, then passed). */
  readonly status: EvidenceStatus;
  readonly environments: readonly string[];
  readonly producers: readonly string[];
  /** The current result per producer, environment and parameter set, newest first. */
  readonly outcomes: readonly TestOutcome[];
  readonly stats: TestStats;
  readonly tags: readonly string[];
  readonly labels: Readonly<Record<string, string>>;
  /** What its current results carry: attachments, steps, retries, and the kinds of attachment. */
  readonly evidence: { readonly attachments: number; readonly steps: number; readonly attempts: number; readonly roles: readonly string[] };
  /** The newest time any of its results was recorded. */
  readonly lastRecordedAtMs: number;
  /** True while one of its results comes from a run still in progress. */
  readonly live: boolean;
};
```

One test: what it is, its current status per environment, and how it has gone.

#### `TestRef`

```ts
export type TestRef = {
  readonly key: string;
  readonly title: string;
  readonly specPath: string | null;
  readonly status: EvidenceStatus;
  /** Average duration (ms) for `slowest`, flips for `flaky`, failures for `failing`. */
  readonly value: number;
};
```

A test named in an insight list, with the number that put it there.

#### `CatalogGroup`

```ts
export type CatalogGroup = {
  readonly name: string;
  readonly tests: number;
  readonly counts: StatusCounts;
  /** Average of its tests' average durations, ms, or null when none was measured. */
  readonly avgMs: number | null;
};
```

A group in the summary (an environment, a producer, a domain, a spec): how many tests, by status (for an environment, by how they went on it), and their timing.

#### `CatalogSummary`

```ts
export type CatalogSummary = {
  readonly tests: number;
  /** Tests by their current status. */
  readonly counts: StatusCounts;
  /** Current results (a test checked on two environments has two). */
  readonly outcomes: number;
  readonly flaky: number;
  /** Over each test's average duration. */
  readonly durations: DurationStats | null;
  /** Tests with at least one measured duration. */
  readonly measured: number;
  readonly withAttachments: number;
  readonly environments: readonly CatalogGroup[];
  readonly producers: readonly CatalogGroup[];
  readonly domains: readonly CatalogGroup[];
  readonly slowest: readonly TestRef[];
  readonly flakiest: readonly TestRef[];
  readonly failing: readonly TestRef[];
  /** Runs the history knows of. */
  readonly runs: number;
  readonly lastRecordedAtMs: number | null;
  /** True when statistics come from recorded history, false when only the current results were available. */
  readonly history: boolean;
};
```

The report at a glance: counts, timing and insights over every test (not only those a query matched).

#### `FacetValue`

```ts
export type FacetValue = { readonly value: string; readonly count: number };
```

A value to filter by, and how many tests have it.

#### `CatalogFacets`

```ts
export type CatalogFacets = {
  readonly statuses: readonly FacetValue[];
  readonly environments: readonly FacetValue[];
  readonly producers: readonly FacetValue[];
  readonly domains: readonly FacetValue[];
  readonly specs: readonly (CatalogSpec & { readonly tests: number; readonly counts: StatusCounts })[];
  readonly tags: readonly FacetValue[];
  readonly branches: readonly FacetValue[];
  readonly labels: Readonly<Record<string, readonly FacetValue[]>>;
};
```

Everything the tests can be filtered and grouped by, with counts over every test.

#### `TEST_SORTS`

```ts
export const TEST_SORTS = …
```

How tests are ordered.

#### `TestSort`

```ts
export type TestSort = (typeof TEST_SORTS)[number];
```

One of `TEST_SORTS`. `spec` (the default) orders by domain, spec and title.

#### `TestQuery`

```ts
export type TestQuery = {
  /** Words that must all appear in the title, id, spec, domain, tags, labels, environments or producers. Case does not matter. */
  readonly q?: string;
  /** Current status, or `flaky`. */
  readonly status?: readonly string[];
  readonly environment?: readonly string[];
  readonly producer?: readonly string[];
  readonly domain?: readonly string[];
  /** Spec paths (`specs/...`). */
  readonly spec?: readonly string[];
  readonly tag?: readonly string[];
  /** Only tests recorded in this run (a key from `runList`). */
  readonly run?: string;
  readonly sort?: TestSort;
  readonly offset?: number;
  /** At most this many tests (default 500, at most 20000). */
  readonly limit?: number;
};
```

Which tests to list. Every field is optional; several values of one field match any of them, and fields combine.

#### `TestCatalog`

```ts
export type TestCatalog = {
  readonly schemaVersion: typeof TEST_CATALOG_VERSION;
  /** Changes whenever the report or its history does. */
  readonly version: string;
  readonly generatedAtMs: number;
  readonly summary: CatalogSummary;
  readonly facets: CatalogFacets;
  /** Tests that matched, before `offset` and `limit`. */
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
  readonly tests: readonly TestSummary[];
};
```

`GET /api/reports/tests`: the summary, the facets and the tests that match a query.

#### `TestHistoryDocument`

```ts
export type TestHistoryDocument = {
  readonly schemaVersion: typeof TEST_CATALOG_VERSION;
  readonly version: string;
  readonly test: TestSummary;
  readonly history: readonly TestResultEntry[];
};
```

`GET /api/reports/tests/history`: one test and every result recorded for it, newest first.

#### `RunSummary`

```ts
export type RunSummary = {
  /** Stable key: `run:<id>` for an execution a producer named, else the run URL, else `branch@sha`. */
  readonly key: string;
  /** The execution id a producer named for it, when it did. Layers that share it are one run, however many uploads they took; another invocation at the same commit has another. */
  readonly runId?: string;
  /** The human title the producer gave the execution (the newest layer's). Presentation only: the key, the commit and `freshness` are unaffected. */
  readonly title?: string;
  /** `modified` when any of its layers was recorded from a checkout with uncommitted changes, else `unknown` when any origin was not captured; absent when every layer is from a clean commit. Advisory; never changes a status. */
  readonly freshness?: 'unknown' | 'modified';
  readonly runUrl: string | null;
  readonly branch: string | null;
  readonly sha: string | null;
  readonly startedAtMs: number;
  readonly endedAtMs: number;
  /** From its first to its last recorded result, ms. */
  readonly spanMs: number;
  readonly producers: readonly string[];
  readonly environments: readonly string[];
  readonly layers: number;
  /** Distinct tests it recorded. */
  readonly tests: number;
  /** Its results by status (its last word on each test, environment and producer). */
  readonly counts: StatusCounts;
  /** Sum of its results' durations, ms, when any was measured. */
  readonly totalDurationMs: number | null;
  /** Up to twenty tests that failed in it. */
  readonly failing: readonly { readonly key: string; readonly title: string; readonly environment: string | null; readonly detail: string }[];
};
```

A run: the layers that name the same execution (`run.id`), else share a CI run URL, else a branch and commit. When,
where, and how its tests went.

#### `RunList`

```ts
export type RunList = {
  readonly schemaVersion: typeof TEST_CATALOG_VERSION;
  readonly version: string;
  readonly total: number;
  readonly runs: readonly RunSummary[];
};
```

`GET /api/reports/runs`: runs, newest first.

#### `RunResult`

```ts
export type RunResult = {
  readonly key: string;
  readonly id: string;
  readonly title: string;
  readonly specPath: string | null;
  readonly environment: string | null;
  readonly producer: string;
  readonly status: EvidenceStatus;
  readonly durationMs: number | null;
  readonly at: number;
  readonly layer: string;
  readonly detail: string;
};
```

One test's last result within one run.

#### `RunDetail`

```ts
export type RunDetail = {
  readonly schemaVersion: typeof TEST_CATALOG_VERSION;
  readonly version: string;
  readonly run: RunSummary;
  readonly results: readonly RunResult[];
};
```

`GET /api/reports/runs/detail`: one run and every result it recorded.

#### `runKey`

```ts
export function runKey(layer: Pick<LayerHeader, 'runUrl' | 'branch' | 'sha'> & { readonly run?: { readonly id: string } }): string
```

The run a layer belongs to: the execution its producer named (`run:<id>`), else its run URL, else `branch@sha`, else
`local`. Layers with the same key are one run. Only grouping: it is never part of the slot a result fills.

#### `TestHistory`

```ts
export class TestHistory
```

Every recorded result of every test (the newest `HISTORY_PER_TEST` per test, leaving out `running` progress) and the
runs they came from. A run's results are read from that history, so memory follows the number of tests and not the age
of the project: a run older than a test's last hundred results no longer lists that test. Add each layer once with
`add`; the order layers arrive in does not change what it holds. It never decides a status.

**Example**

```ts
const history = new TestHistory();
for (const { layer, rows } of layers) history.add(layer, rows, specs, layer.backend);
const catalog = testCatalog(catalogModel(layers, { history }));
```

- `get rev(): number { return this.#rev; }` — Changes each time a layer is added.
- `get specs(): RecordedSpecs { return this.#specs; }` — The specs the added layers recorded.
- `get layers(): number { return this.#seen.size; }` — How many layers were added.
- `add(layer: LayerHeader, rows: readonly LayerRow[], specs: readonly SpecEntry[] = [], backend = layer.backend): void` — Takes in one layer: its header, its rows, the specs it recorded and the backend it was read from. A layer id already added is ignored.
- `of(key: string): readonly TestResultEntry[]` — The recorded results of one test (by `TestSummary.key`), newest first. Empty when none.
- `get runCount(): number { return this.#runs.size; }` — How many runs it knows of.
- `runs(): RunSummary[]` — Every run, newest first.
- `run(key: string): { readonly run: RunSummary; readonly results: RunResult[] } | null` — One run and its results (failed first, then by spec and title), or null.
- `testsIn(key: string): ReadonlySet<string>` — The keys of the tests one run recorded.

#### `durationStats`

```ts
export function durationStats(values: readonly number[]): DurationStats | null
```

Durations of a list of numbers (ms), or null when empty. `lastMs` is the first value, so give them newest first.

#### `catalogSpec`

```ts
export function catalogSpec(path: string | null, known: (path: string) => SpecEntry | undefined): CatalogSpec | null
```

The spec a path names: the recorded one, or one derived from the path (`specs/<domain>/<name>.<ext>`).

#### `CatalogSources`

```ts
export type CatalogSources = {
  /** Recorded results; without it, statistics describe only the current results. */
  readonly history?: TestHistory | null;
  /** Specs by path, published or recorded. Defaults to those the history recorded. */
  readonly specs?: readonly SpecEntry[];
  /** The report's version, echoed in the documents. */
  readonly version?: string;
  readonly now?: number;
};
```

Where the catalog's statistics and specs come from.

#### `CatalogModel`

```ts
export type CatalogModel = {
  readonly version: string;
  readonly generatedAtMs: number;
  readonly tests: readonly TestSummary[];
  readonly byKey: ReadonlyMap<string, TestSummary>;
  readonly summary: CatalogSummary;
  readonly facets: CatalogFacets;
  readonly haystacks: ReadonlyMap<string, string>;
  readonly history: TestHistory | null;
};
```

The tests of a report, built once and queried many times: what `testCatalog` and `testHistory` read from.

#### `haystackOf`

```ts
export function haystackOf(test: TestSummary): string
```

The lowercase text a search matches a test against: title, id, spec, domain, tags, labels, environments and producers.

#### `catalogModel`

```ts
export function catalogModel(layers: readonly LayerEvidence[], sources: CatalogSources = {}): CatalogModel
```

Builds the tests of a report from its winners (`layers`, as the effective report holds them: each layer with the rows
that win) and, when given, a history. The model is what `testCatalog` and `testHistory` query; build it once per
version and reuse it.

#### `matchesQuery`

```ts
export function matchesQuery(model: CatalogModel, test: TestSummary, query: TestQuery, inRun?: ReadonlySet<string> | null): boolean
```

Whether one test matches a query (everything but sorting and paging).

#### `testCatalog`

```ts
export function testCatalog(model: CatalogModel, query: TestQuery = {}): TestCatalog
```

The catalog document for a query: the model's summary and facets, and the matching tests, sorted and paged.

#### `testHistory`

```ts
export function testHistory(model: CatalogModel, key: string): TestHistoryDocument | null
```

One test and its recorded results, or null when the report has no test with that key.

#### `runList`

```ts
export function runList(history: TestHistory, version: string, limit = 100): RunList
```

Every run the history knows of, newest first, `limit` at most (default 100).

#### `runDetail`

```ts
export function runDetail(history: TestHistory, version: string, key: string): RunDetail | null
```

One run with every result it recorded, or null when no run has that key.

#### `parseTestQuery`

```ts
export function parseTestQuery(params: URLSearchParams): TestQuery
```

Reads a `TestQuery` from URL search parameters: `q`, `sort`, `offset`, `limit`, `run`, and repeatable or comma-separated `status`, `environment`, `producer`, `domain`, `spec`, `tag`.

#### `formatMs`

```ts
export function formatMs(ms: number | null | undefined): string
```

A duration for a person: `850 ms`, `12.3 s`, `4m 05s`.

#### `catalogMarkdown`

```ts
export function catalogMarkdown(catalog: TestCatalog): string
```

The catalog as Markdown: the summary, insights, groups and the listed tests as a table.

#### `historyMarkdown`

```ts
export function historyMarkdown(document: TestHistoryDocument): string
```

One test's history as Markdown.

#### `runsMarkdown`

```ts
export function runsMarkdown(list: RunList): string
```

The run list as Markdown.

#### `runMarkdown`

```ts
export function runMarkdown(detail: RunDetail): string
```

One run as Markdown.

### Report viewer data

Source: `packages/reports/src/types.ts`. Import: `@crvouga/atlas/reports/types`

The data shape the standalone and Solid report viewers render: a recorded run plus its title.

#### `ReportData`

```ts
export type ReportData = HtmlReportBundle & {
  readonly title: string;
};
```

A run's tests (`HtmlReportBundle`) plus the document title shown for them, for the standalone / Solid report viewer.

### Report viewer navigation state

Source: `packages/reports/src/use-report-nav.ts`. Import: `@crvouga/atlas/reports/use-report-nav`

The Solid state behind the report viewer's navigation: the current route (kept in the URL hash), help and command
palette visibility, frame stepping and auto-play, keyboard shortcuts and the document title. Everything outside the
reactive state (the location, the keyboard, timers) is injected, so it runs the same in a browser and in tests. It
creates signals and effects, so it must be called inside a Solid root, which also owns its cleanup.

#### `ReportNav`

```ts
export type ReportNav = {
  /** The current route: the list, or one test with its params. Updates at once, before the URL is written. */
  route: Accessor<Route>;
  /** Whether the keyboard help is open. */
  showHelp: Accessor<boolean>;
  /** Whether the command palette is open. */
  showPalette: Accessor<boolean>;
  /** Whether frames are advancing on a timer. */
  playing: Accessor<boolean>;
  /** Goes to `route`. A normal navigation adds a history entry and writes the URL now; with `replace` true it updates the route at once and writes the URL, replacing the entry, 200 ms after the last such call. */
  navigate: (route: Route, replace?: boolean) => void;
  /** Write the in-memory route to the URL now (end of a scrub drag). */
  commitHash: () => void;
  /** Sets one param of the current test route (replacing history); does nothing on the list route. */
  setParam: (key: string, value: string) => void;
  /** Selects a frame of the current test (its 1-based position goes into the `frame` param), or clears the selection with `null`; `node` also sets the `node` param. Does nothing on the list route. */
  goFrame: (frame: FlatFrame | null, node?: string | undefined) => void;
  /** Moves the selected frame by `delta` (negative goes back); does nothing at either end or off a test route. */
  stepFrame: (delta: number) => void;
  /** Opens the help if closed, else closes it. */
  toggleHelp: () => void;
  /** Closes the help. */
  closeHelp: () => void;
  /** Opens the palette if closed, else closes it. */
  togglePalette: () => void;
  /** Closes the palette. */
  closePalette: () => void;
  /** Starts advancing one frame every 700 ms, or stops if playing. Stops by itself at the last frame, or when the route stops being a test. */
  togglePlay: () => void;
  /** Stops playback. */
  stopPlay: () => void;
};
```

What the viewer's views read and call to move around a report.

#### `useReportNav`

```ts
export function useReportNav(
  data: ReportData,
  navigation: ReportNavigation,
  timers: Timers
): ReportNav
```

Creates the navigation state for a report: the route from the URL hash (and kept in sync when it changes), help and
palette state, playback, keyboard shortcuts and the page title (`<test title> · <report title>`).

Reading the hash is the only way in: an unrecognised hash is the list route, and `parseHash` throws `URIError` on a
malformed percent-escape. Subscriptions and timers are released when the surrounding Solid root is disposed. Must be
called inside a Solid root.

- `data`: the report whose tests the routes name.

- `navigation`: where the hash, keys and title live (the browser, or a fake).

- `timers`: timer functions for the hash-write debounce and playback.
