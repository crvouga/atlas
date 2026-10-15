# Running Atlas for a project: one server

This is the production setup. A project runs **one Atlas server**. Developers' machines and every CI job send
their results to it, as they finish or when they are done, and it shows everyone, developers and the business
alike, the whole project at once, live. It keeps results on its own disk by default, or in an object-store bucket
if you prefer; either way nothing is partitioned by run, branch or person: results are layered. The server's API,
configuration and protocol are in **[the Atlas server](server.md)**; this page is the path to production.

```
  a developer's worktree ─┐                                       ┌─▶ developers   (browser, live)
  a CI job, any branch ───┼─ atlas report publish|stream ─▶ SERVER ◀┤   atlas serve: keeps layers in ./atlas-data
  a device lab, nightly ──┘   (immutable layers, over HTTP)  or S3  ├─▶ business      or in a bucket (--write)
                                                                    └─▶ CI gate     atlas report status
```

Why this holds together:

- **Publishing never conflicts.** A layer is one immutable file named by its content. Two machines that
  publish at once write different files; a retry writes the same one. There is no lock, no index to
  corrupt, nothing to merge.
- **The server is replaceable.** What it knows is its write backend (a folder, or a bucket). Replace it, restore it
  from a backup, or run a copy on a laptop: they show the same report, because a report is a function of the
  layers ([the contract](report-contract.md)).
- **One view.** The newest completed result of every check, in every environment, from anyone. A
  developer's local run on a feature branch, CI on `main` and a device lab's nightly sit side by side.
  Narrow it only when you choose to ([filters](#5-choosing-what-takes-part)).

- [1. Where results are kept](#1-where-results-are-kept)
- [2. Check it](#2-check-it)
- [3. Send results from CI and from laptops](#3-send-results-from-ci-and-from-laptops)
- [4. The server](#4-the-server)
- [5. Choosing what takes part](#5-choosing-what-takes-part)
- [6. Operating it](#6-operating-it)
- [7. Performance](#7-performance)
- [8. Troubleshooting](#8-troubleshooting)

## 1. Where results are kept

**By default, on the server's own disk** (`./atlas-data`, or the volume you mount at `ATLAS_DATA`). Nothing else
needs to exist: skip to [section 3](#3-send-results-from-ci-and-from-laptops). Back that folder up like any data
directory; starting a new server on a restored copy shows the same report.

**To keep results in a bucket instead** (so a replaced server loses nothing, or CI already has bucket access),
name it and make it the place uploads go: `ATLAS_STORE=project=s3://my-bucket/atlas/my-project ATLAS_WRITE=project`.
The rest of this section is that setup. A store is named by a URL. Keys never go in it.

| Store | URL |
| --- | --- |
| AWS S3 | `s3://my-bucket/atlas/my-project` (add `?region=eu-west-1` if `AWS_REGION` is not set) |
| A folder | `/srv/atlas`, `./atlas-reports` (a CI workspace, an NFS mount, a laptop) |
| Cloudflare R2 | `r2://bucket/atlas/my-project?account=<account id>` (or `R2_ACCOUNT_ID`), with the R2 token's keys in `ATLAS_S3_ACCESS_KEY_ID` / `ATLAS_S3_SECRET_ACCESS_KEY` |
| Google Cloud Storage | `gs://bucket/atlas/my-project`, with an HMAC key pair in `ATLAS_S3_*` |
| MinIO, Backblaze B2, Wasabi, SeaweedFS, any S3-compatible | `s3://bucket/atlas/my-project?endpoint=https://host&region=auto` |

Atlas talks to S3 itself, signing requests with Signature Version 4 and sending them with `fetch`: no
SDK, no extra install, the same on Bun and Node. It is tested against AWS's published signing vectors
and, for real, against a live S3 server (SeaweedFS) in CI. Stores other than AWS and SeaweedFS speak the
same protocol; the `r2://` and `gs://` shorthands only fill in the endpoint. None of them is part of Atlas's own tests,
so run `atlas report doctor` against yours before relying on it.

**On AWS:**

1. Create a bucket. Keep "block all public access" on. Default encryption (SSE-S3) needs nothing more; with
   SSE-KMS the roles below also need `kms:Decrypt` and `kms:GenerateDataKey` on the key.
2. Use one folder per project (`atlas/my-project/`). Several projects can share a bucket.
3. Create two roles. `atlas report policy` prints each, scoped to the bucket and folder:

   ```sh
   atlas report policy --store s3://my-bucket/atlas/my-project --role publisher   # CI and developers
   atlas report policy --store s3://my-bucket/atlas/my-project --role reader      # a server that only reads it, and the gate
   # the server that uploads into it needs --role both (also grants server/live/* for live leases)
   ```

   A publisher may write and read `layers/*` and list the folder. A reader may read `layers/*` and list.
   Nobody needs to delete or overwrite: **do not grant it**. (`s3:ListBucket` is for publishers too: without
   it S3 answers "403 forbidden" instead of "404 not found" when asked whether a layer exists yet.)
4. Do not put a lifecycle rule that expires `layers/`. Old layers are cheap and are history. If storage
   grows, expire `layers/runs/` (screenshots and clips) first.

Versioning and replication are optional: nothing is ever overwritten with different bytes.

## 2. Check it

```sh
export ATLAS_STORE=s3://my-bucket/atlas/my-project
atlas report doctor                    # a role that can do everything
atlas report doctor --role publisher   # what CI and developers can do
atlas report doctor --role reader      # what a reader can do
```

```
my-project
  ✓ store     s3://my-bucket/atlas/my-project/ (us-east-1)
  ✓ list      38 ms, credentials from AWS CLI (profile default)
  ✓ contents  1240 layers (newest 2026-10-09T11:59:00.000Z), 3 spec sets, 12 runs
  ✓ write     wrote, listed, read back and deleted a scratch object: the store meets the ObjectStore contract
All good.
```

Each failure says what to fix: the permission that is missing, the region that is wrong, the clock that is
off. The credentials come from the same places an AWS SDK looks, in this order: `ATLAS_S3_ACCESS_KEY_ID` /
`ATLAS_S3_SECRET_ACCESS_KEY` (so one store can use keys that are not the machine's AWS keys), then
`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`, EKS web identity (IRSA), ECS task roles,
`~/.aws/credentials`, the AWS CLI (which covers SSO, assumed roles and `credential_process`), and EC2
instance metadata. Credentials that expire are refreshed before they do.

## 3. Send results from CI and from laptops

Every environment runs the same command. Set `ATLAS_STORE` once and it needs no flags for the store.

### To the server

```sh
export ATLAS_STORE=https://atlas.example.com     # once, in .envrc, CI variables or your shell profile
export ATLAS_TOKEN=…                             # a publish token of the server (never in the URL)
bun test --reporter=junit --reporter-outfile=out.xml
bunx atlas report publish --producer unit --junit out.xml --specs ./specs --environment desktop-web
```

The result is in everyone's view within a few milliseconds, with no bucket credentials anywhere, and no
artifacts to merge. To show a long suite *while it runs*, stream it: `my-suite --json | atlas report stream
--producer e2e --environment ios` ([sending results](server.md#sending-results)). The gate asks the server for the
verdict, so only the verdict travels: `atlas report status --branch main --ignore-modified`.
[`examples/deploy/github-actions.yml`](https://github.com/crvouga/atlas/blob/main/examples/deploy/github-actions.yml)
is the whole workflow, publishers and gate. The rest of this section is publishing straight to a bucket, for
CI that has bucket access and no route to the server.

### Straight to the bucket

### CI

Give CI a role, not a key. On GitHub Actions that is OIDC, so no AWS secret is stored anywhere. Every
node publishes its own layers straight to the bucket: no artifacts to download and merge. The server finds them
at its next refresh.

```yaml
permissions: { id-token: write, contents: read }
env: { ATLAS_STORE: "s3://my-bucket/atlas/my-project" }
steps:
  - run: bun test --reporter=junit --reporter-outfile=out.xml
    continue-on-error: true            # a failing suite must still publish: a failure is evidence
  - uses: aws-actions/configure-aws-credentials@v4
    with: { role-to-assume: "arn:aws:iam::123456789012:role/atlas-publisher", aws-region: us-east-1 }
  - run: bunx atlas report publish --producer unit --junit out.xml --specs ./specs --environment desktop-web
    if: always()
```

`--sha`, `--branch` and the run URL come from the CI's variables. `--specs ./specs` also publishes the
specs themselves, so the server can show them without a checkout (below).

### A developer's laptop

```sh
aws sso login                                    # or any way you sign in to AWS
export ATLAS_STORE=s3://my-bucket/atlas/my-project   # once, in .envrc or your shell profile
bun test --reporter=junit --reporter-outfile=out.xml
bunx atlas report publish --producer unit --junit out.xml --specs ./specs --environment desktop-web
```

Atlas sees from git whether the worktree has uncommitted edits to tracked files. If it does, the layer is
marked **modified**: it appears in the shared view with the warning "Potentially outdated: recorded from a
modified checkout", never as the commit's own result. Outside a git checkout the origin is **unknown**.
A CI checkout is the commit it names. Untracked files (build output, `out.xml`) do not count.

Through the server a result is in the shared view at once; straight to a bucket, within the server's refresh interval
(10 seconds by default).

### What lands in the bucket

| Key | What | Written by |
| --- | --- | --- |
| `layers/manifests/<id>.json`, `layers/index/…` | One layer of checks, and its catalog entry | `publish` |
| `layers/specs/blobs/<sha256>.txt`, `layers/specs/sets/<id>.json`, `layers/specs/index/…` | The specs of one commit, by content | `publish --specs` |
| `layers/runs/<run>/…`, `layers/runs/index/…` | A statechart run with its screenshots and clips | `publish --manifest … --upload-run` |

Everything is immutable and addressed by its content, so each publish is safe to repeat and safe to run
in parallel. A set of specs is named by the files and the commit, so publishing the same commit from ten
nodes writes it once.

For statecharts, publish each run as a layer and upload it for the client:

```sh
bunx atlas run --config atlas.config.ts --shard 1/2
bunx atlas report publish --producer statecharts --environment desktop-web \
  --manifest atlas-runs/<run>/manifest.json --specs ./specs --upload-run
```

A run is uploaded only when its privacy scan passed: the same rule the static client applies.

## 4. The server

```sh
atlas serve                    # ATLAS_STORE says where; listens on :8080
```

It serves the client, the report and the project's specs and runs from all configured backends. It also
accepts uploads and announces new results on its event stream. Uploads go to `--data` by default;
use a named `--store project=s3://… --write project` to put uploads in a shared bucket, with publisher permissions.

| Flag | Environment | Meaning |
| --- | --- | --- |
| `--store <url>` (repeatable) | `ATLAS_STORE` | Where layers are. Several stores are one report: repeat the flag, or separate them in the variable with commas or new lines. |
| `--data <dir>` | `ATLAS_DATA` | Local upload backend. Default `./atlas-data`. |
| `--write <id>` | `ATLAS_WRITE` | Backend that accepts uploads. Default `data`. |
| `--port <n>` | `ATLAS_PORT` or `PORT` | Default 8080. `0` picks a free one. |
| `--host <h>` | `ATLAS_HOST` or `HOST` | Default `127.0.0.1`. Listening beyond this machine requires tokens or `--insecure`. |
| `--site <dir>` | `ATLAS_SITE` | The built client. Default: `./atlas-site`, else built once into `~/.cache/atlas/site`. |
| `--outline-branch <b>` | `ATLAS_OUTLINE_BRANCH` | Which branch's specs the report is laid over. Default `main`, then `master`, then the newest. |
| `--refresh <seconds>` | `ATLAS_REFRESH_SECONDS` | How often the bucket is looked at for new layers. Default 10. |
| `--branch <name>` (repeatable) | `ATLAS_ONLY_BRANCH` | Only layers recorded on these branches take part. |
| `--ignore-modified` | `ATLAS_IGNORE_MODIFIED=1` | Leave out layers from modified checkouts and unknown origins. |
| | `ATLAS_TOKEN`, `ATLAS_PUBLISH_TOKEN`, `ATLAS_READ_TOKEN` | Admin, publisher and reader tokens, each at least 12 characters. Send `Authorization: Bearer <token>`, or HTTP Basic with the token as the password. Probes require no token. |

### Run it

**Railway (deploy an image, no repository or code changes).** Create a service from the Docker image
`ghcr.io/crvouga/atlas:latest`. Copy the URI below into Railway's image field:

```text
ghcr.io/crvouga/atlas:latest
```

For a specific revision, open a [CI run](https://github.com/crvouga/atlas/actions/workflows/ci.yml)'s
**Summary → Atlas CI**: it includes the published commit image URI, immutable digest and whether that run
updated `latest`. Pull request builds and failed publications are labelled accordingly.

1. In Railway choose **New service → Docker image** and enter `ghcr.io/crvouga/atlas:latest`.
   Leave the start command unset: the image includes the server and the prebuilt viewer.
2. Add `ATLAS_TOKEN` with a long random value (generate one with `openssl rand -hex 24`). It grants admin
   access; optionally add separate `ATLAS_PUBLISH_TOKEN` and `ATLAS_READ_TOKEN` for publishers and readers.
3. Attach a volume at `/data` and set `RAILWAY_RUN_UID=0`: Railway mounts volumes as root, while the image
   normally runs as `bun` ([Railway volume permissions](https://docs.railway.com/volumes#permissions)).
   Keep one replica. The volume retains reports and server settings when the image is replaced.
4. Set the healthcheck path to `/readyz` and generate a public domain. The image listens on `0.0.0.0` and
   honors Railway's `PORT`; leave `ATLAS_PORT` unset. Open the domain and sign in with your token as the
   password (any username), or use the viewer's token sign-in.
5. Under **Settings → Source → Configure Auto Updates**, enable image updates and select **Anytime**.
   Each successful `main` build publishes a new `latest`. Railway detects the changed digest and redeploys
   within its update schedule; detection can be cached for a few hours, so publishing does not mean an
   immediate deployment ([Railway image auto updates](https://docs.railway.com/deployments/image-auto-updates)).

Check the domain with `curl --fail https://YOUR-DOMAIN/readyz`: HTTP 200 means the server read its backend.
Projects publish to that domain with `ATLAS_STORE=https://YOUR-DOMAIN` and their `ATLAS_TOKEN`, as in
[sending results](#3-send-results-from-ci-and-from-laptops). Hosting Atlas needs no project checkout; publishing
your project's test results still needs the integration described there.

For bucket storage instead, set `ATLAS_STORE=project=s3://my-bucket/atlas/my-project`, `ATLAS_WRITE=project`,
and the bucket credentials. Keep the `/data` volume for server settings and local state.

### Deploy without authentication

Use `ghcr.io/crvouga/atlas-insecure:latest` for a server that requires no sign-in or API token. It is built
from the same commit, server and viewer as `ghcr.io/crvouga/atlas:latest`, with `ATLAS_INSECURE=true`
to allow listening on the network without tokens. Anonymous callers have full read, publish and admin access.
Anyone who discovers an unlisted URL can read reports, upload results and change settings; the URL is
not access control.

In Railway, create a **Docker image** service with:

```text
ghcr.io/crvouga/atlas-insecure:latest
```

Leave the start command unset. Attach a persistent volume at `/data`, set `RAILWAY_RUN_UID=0`, keep one
replica, set the healthcheck to `/readyz` and generate a public domain. Leave `ATLAS_PORT` unset so Railway's
`PORT` is used. Enable **Settings → Source → Configure Auto Updates → Anytime** to follow `latest`.
Do not set `ATLAS_TOKEN`, `ATLAS_PUBLISH_TOKEN` or `ATLAS_READ_TOKEN`, or add `auth.tokens` to
`/data/atlas.server.json`: configured tokens still enable authentication. When reusing a volume from an
authenticated deployment, remove its saved auth tokens first. Open the domain directly, including `/admin`
for settings (leave the token field blank and choose **Load settings**).

Verify anonymous reads and uploads without an Authorization header:

```sh
curl --fail https://YOUR-DOMAIN/readyz
curl --fail https://YOUR-DOMAIN/api/server
curl --fail 'https://YOUR-DOMAIN/api/checks?project=my-project' \
  -H 'content-type: application/json' \
  -d '{"producer":"smoke","checks":[{"id":"deployed","title":"Deployed","status":"passed"}]}'
```

Readiness returns HTTP 200, `/api/server` reports `"open":true` and `"role":"admin"`, and the upload returns
HTTP 201. Configure a project with `ATLAS_STORE=https://YOUR-DOMAIN` and `ATLAS_PROJECT=my-project`;
leave its `ATLAS_TOKEN` unset. Use the same publishing commands described in
[sending results](#3-send-results-from-ci-and-from-laptops), omitting credentials.

For local Docker:

```sh
docker run --pull always -p 8080:8080 -v atlas-data:/data ghcr.io/crvouga/atlas-insecure:latest
```

Both images publish full commit tags for pinning or rollback. A new GHCR package must be made Public
once before Railway can pull without registry credentials; see
[image publication](https://github.com/crvouga/atlas/blob/main/docs/releasing.md#server-image).

### Docker

The same published image works anywhere Docker runs. It already contains the client (the same
for every project: the server tells the page where its data is), and keeps results on the volume at `/data`:

```sh
docker run --pull always -p 8080:8080 -v atlas-data:/data \
  -e ATLAS_TOKEN=$(openssl rand -hex 24) ghcr.io/crvouga/atlas:latest
```

The image is built from each checked commit, independently of npm releases. To pin a deployment or roll
back, replace `latest` with the full commit SHA. To build from this repository, use `docker build -t atlas .`;
[`examples/deploy/Dockerfile`](https://github.com/crvouga/atlas/blob/main/examples/deploy/Dockerfile) is the
alternative for building from an npm version or a local package tarball.

For a bucket as the system of record add `-e ATLAS_STORE=project=s3://my-bucket/atlas/my-project -e ATLAS_WRITE=project -e AWS_REGION=us-east-1`.
On ECS, EKS or EC2, attach the combined **both** policy (including `server/live/*` for producer leases) to the task, service account or
instance and set no keys.

**Try it on one machine.** [`examples/deploy/compose.yaml`](https://github.com/crvouga/atlas/blob/main/examples/deploy/compose.yaml)
starts the published image on a volume; `compose.s3.yaml` starts it with an S3 server and a bucket as its storage.
Publish to `http://localhost:8080` from your project and open it.

**Kubernetes.** [`examples/deploy/kubernetes.yaml`](https://github.com/crvouga/atlas/blob/main/examples/deploy/kubernetes.yaml):
one copy (the server is a singleton for the project), results in the bucket, readiness on `/readyz`, an IRSA
service account.

**Without a container.** `bun add -d @crvouga/atlas`, then `bunx atlas client build --no-data --out
atlas-site` and `bunx atlas serve`. Everything it can be told is in
[the Atlas server](server.md#configuration).

<!-- generated:runtime-requirements -->
Supported runtimes (from `package.json`): **node `>=22.18.0`** or **bun `>=1.2.0`**. Node consumers do not need Bun unless they use the Bun WebView driver.
<!-- /generated:runtime-requirements -->

### Who may look

Set `ATLAS_READ_TOKEN` for a dashboard that only accepts readers. `ATLAS_PUBLISH_TOKEN` also allows
uploads, and `ATLAS_TOKEN` grants administration. Without tokens the server listens on loopback by default. Put it behind what your
company already uses: an ALB with OIDC, Cloudflare Access, `oauth2-proxy`, Tailscale. TLS ends at that
layer too. Pass `--insecure` only when that proxy handles sign-in.

### What it serves

| Path | |
| --- | --- |
| `/` | The client. Its page carries the server's address book, so one build serves every project. |
| `/api/reports/evidence/effective` | The whole report in one request: only the layers that win a check, each with only the rows that win. ETag, gzip. |
| `/api/reports/evidence`, `/evidence/rows/<backend>/<id>`, `/outline`, `/outline/spec?path=` | History, one layer's checks, the specs. |
| `/api/reports/evidence/detail/<backend>/<id>?check=<id>&kind=<kind>` | Everything one result carries: its timeline, annotations, retries, attachments and extensions, and the run's own. Without `check`, only the run's. |
| `/api/reports/layers/<id>/blobs/<key>` | One file a layer carries (screenshot, video, trace…), served as untrusted bytes with range support, cached for good. |
| `/api/data/specs/…`, `/api/data/runs/…`, `/api/data/sources.json` | The specs and runs, laid out the way the client reads a static host. |
| `/api/checks` | Upload a layer of checks with `POST`. |
| `/api/events` | Live report updates over server-sent events. |
| `/healthz` | The process is up. |
| `/readyz` | `200` once the bucket was read and at least one store answers; `503` otherwise. Route traffic on this. |

The specs come from the newest **spec set** published from `main` (`publish --specs`), so the server needs no
checkout and no git access. A set from someone's modified worktree is used only if no committed one exists.

## 5. Choosing what takes part

By default every layer takes part: a report is the newest completed result of each check in each
environment, from wherever it was recorded. That is the unified view, and it is honest: a developer's run
on `feat/pay` shows up, labelled, until something newer replaces it.

Narrow it by choice, per consumer, never by moving data:

| You want | Use |
| --- | --- |
| A release gate that no laptop can turn red | `atlas report status --branch main --ignore-modified` |
| A pull request's gate that inherits what it did not re-run from `main` | `--branch "$PR_BRANCH" --branch main --ignore-modified` |
| A business dashboard of what is committed | `atlas serve --ignore-modified` |
| Everything, as the team lives it | nothing (the default) |
| One person's view of what leaving a source out changes | **Sources** in the client: leave out a branch, environment, version or layer |

## 6. Operating it

- **Upgrades.** The layer format is a stable, versioned contract. A server reads every layer a publisher of
  an older or the same schema version wrote, and names (never guesses at) a layer of a newer one. Upgrade
  readers (the server, the gate) before publishers when a release bumps `schemaVersion`; within a version
  they never need to move together.
- **Logs.** One JSON line per request to stdout. `/healthz` and `/readyz` are not logged. At start it
  prints what it reads and any store it cannot reach.
- **A store goes down.** The server keeps serving what it has, names the store in the client's notices and
  in `/readyz`, and recovers by itself. The gate fails closed: unknown is not a pass.
- **A layer cannot be read** (corrupt, or written by a newer Atlas): a notice names it. It is tried again
  every five minutes.
- **Scaling.** One Atlas node supports multiple project namespaces with independently loaded report indexes. It takes in an upload in milliseconds and a
  report of 100,000 checks costs a client kilobytes per change ([performance](server.md#performance)). Memory
  grows with the number of distinct checks, plus about a hundred bytes for each layer ever seen (to know it has
  read it). More than one server on a backend works and shows the same report, but each hears of uploads to
  another only at its next refresh.
- **Cost.** Between full listings a refresh asks for one page of the catalog, newest first, and stops at the
  first page it already knows: one `LIST` request every refresh interval, however long the history. A full
  listing (one request per thousand layers) runs at the start and every 30 refreshes (five minutes by
  default), which is also how a layer recorded with an old timestamp is found. One small `GET` per new
  layer, once.
- **Retention.** Atlas deletes nothing. `atlas report doctor` shows what the bucket holds.
- **Disaster recovery.** The write backend (the data folder, or the bucket) is the only state. Back it up, replicate or version it as you
  do any data; a server is rebuilt from nothing in the time it takes to read the layers (below). It listens at once
  and answers `/readyz` 503 until it has, so a liveness probe never kills one that is still reading.
- **A second bucket.** Another team's layers, a device lab, an archive: pass several `--store`s. They are one
  report, attributed to the store they came from.

## 7. Performance

Measured, not promised (a laptop, a local S3 server, so these are the client's own costs; real S3 adds its
latency per request, which the server hides by reading 64 at a time):

| What | Cost |
| --- | --- |
| Publish a layer of plain checks | One `HEAD` and two small `PUT`s. Two thousand layers published in under two seconds from one process, in parallel. |
| Server start | About 0.2 ms of CPU per layer, plus S3 latency ÷ 64 per layer: 2,000 layers in well under a second on a fast store, a few seconds on S3. Each layer is read once, ever. |
| Refresh with nothing new | One `LIST` request for the newest page of the catalog, whatever the history. |
| The report, to a client | One request. 12,000 checks from 2,000 layers is 108 KB gzipped, built once per change. |
| The client asking again | `304 Not Modified` in under a millisecond. While the live stream is open it asks only when told, and then for only what changed. |
| The client in a browser | One request for the report, plus the spec index, outline and run index and the specs it opens. None per layer, whatever the history (measured in Chromium against a server reading S3). |

How: each layer is folded into the winning result of every check once and dropped unless it still holds a
winner, so work and memory follow the number of checks. Because the winner rule is a total order, folding in
any order is exact; a test proves the incremental report equals recomputing from every layer. The client
reads that compact report in one request and only falls back to reading every layer when you ask it to
leave a source out (which needs the history).

## 8. Troubleshooting

| You see | Cause and fix |
| --- | --- |
| `No AWS credentials found for the object store` | None of the places was set. The message lists them. `aws sso login`, or export `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`. |
| `access denied … s3:PutObject` | The role is missing a permission. `atlas report policy --store <url>` prints the policy. |
| `403` on a layer that should not exist yet | The account cannot list the bucket (`s3:ListBucket`), so S3 answers 403 for a missing object. Grant it on the folder. |
| `the signature was rejected` | Wrong secret, or wrong region/endpoint for these keys, or the clock is off by more than 15 minutes. |
| `the bucket does not exist` | Typo, another account, or the store needs `?endpoint=…` (R2, MinIO). |
| `cannot reach <host>` | Network, DNS or endpoint. Requests are retried with backoff first. |
| The server says `listening … no backend can be read yet` | The bucket is unreachable from the server. It retries; `/readyz` stays 503 until it can read. |
| A new layer does not show | Uploaded through the server it is there at once: check the token (`401`/`403` say so). Written straight to a bucket, wait one refresh interval (10 s). Check `atlas report status --store <url>` sees it. |
| Everything is red because of one laptop | By design the newest result wins. Gate on `--ignore-modified` and a branch ([above](#5-choosing-what-takes-part)). |
| Specs are empty in the client | Nothing published with `--specs` yet, or only from a branch other than `main`: set `--outline-branch`. |
| `Run … is not shared: its privacy scan did not pass` | `--upload-run` refuses runs whose scan found real data. Fix what it found and run again. |
