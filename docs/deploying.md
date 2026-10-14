# Running Atlas for a project: one node, one bucket

This is the production setup. A project keeps **one object-store bucket** and runs **one Atlas node**.
Developers' machines and every CI job publish their results into the bucket. The node shows everyone,
developers and the business alike, the whole project at once. Nothing is partitioned by run, branch or
person: results are layered.

```
  a developer's worktree ─┐                                    ┌─▶ developers   (browser)
  a CI job, any branch ───┼─ atlas report publish ─▶  BUCKET ◀─┤   atlas serve  (the server: reads the bucket,
  a device lab, nightly ──┘   (immutable layers)    s3://…     ├─▶ business       keeps uploads in its write backend)
                                                               └─▶ CI gate     atlas report status
```

Why this holds together:

- **Publishing never conflicts.** A layer is one immutable file named by its content. Two machines that
  publish at once write different files; a retry writes the same one. There is no lock, no index to
  corrupt, nothing to merge.
- **The node is disposable.** It reads the bucket and keeps a cache; uploads go to its configured write backend. Replace it, scale it to three
  copies, or run it on a laptop: they all show the same report, because a report is a function of the
  layers in the bucket ([the contract](report-contract.md)).
- **One view.** The newest completed result of every check, in every environment, from anyone. A
  developer's local run on a feature branch, CI on `main` and a device lab's nightly sit side by side.
  Narrow it only when you choose to ([filters](#5-choosing-what-takes-part)).

- [1. The bucket](#1-the-bucket)
- [2. Check it](#2-check-it)
- [3. Publish from CI and from laptops](#3-publish-from-ci-and-from-laptops)
- [4. The node](#4-the-node)
- [5. Choosing what takes part](#5-choosing-what-takes-part)
- [6. Operating it](#6-operating-it)
- [7. Performance](#7-performance)
- [8. Troubleshooting](#8-troubleshooting)

## 1. The bucket

A store is named by a URL. Keys never go in it.

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
   atlas report policy --store s3://my-bucket/atlas/my-project --role reader      # the node and the gate
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
atlas report doctor --role reader      # what the node can do
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

## 3. Publish from CI and from laptops

Every publisher runs the same command. Set `ATLAS_STORE` once and it needs no flags for the store.

### CI

Give CI a role, not a key. On GitHub Actions that is OIDC, so no AWS secret is stored anywhere. Every
node publishes its own layers straight to the bucket: no artifacts to download and merge.
[`examples/deploy/github-actions.yml`](https://github.com/crvouga/atlas/blob/main/examples/deploy/github-actions.yml)
is the whole workflow, publishers and gate.

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
specs themselves, so the node can show them without a checkout (below).

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

Developers can publish and look at the result in the shared view within the node's refresh interval
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

For statecharts, publish each run as a layer and upload it for the viewer:

```sh
bunx atlas run --config atlas.config.ts --shard 1/2
bunx atlas report publish --producer statecharts --environment desktop-web \
  --manifest atlas-runs/<run>/manifest.json --specs ./specs --upload-run
```

A run is uploaded only when its privacy scan passed: the same rule the static viewer applies.

## 4. The node

```sh
atlas serve                    # ATLAS_STORE says where; listens on :8080
```

It serves the viewer, the report and the project's specs and runs from all configured backends. It also
accepts uploads and announces new results on its event stream. Uploads go to `--data` by default;
use a named `--store project=s3://… --write project` to put uploads in a shared bucket, with publisher permissions.

| Flag | Environment | Meaning |
| --- | --- | --- |
| `--store <url>` (repeatable) | `ATLAS_STORE` | Where layers are. Several stores are one report: repeat the flag, or separate them in the variable with commas or new lines. |
| `--data <dir>` | `ATLAS_DATA` | Local upload backend. Default `./atlas-data`. |
| `--write <id>` | `ATLAS_WRITE` | Backend that accepts uploads. Default `data`. |
| `--port <n>` | `ATLAS_PORT` or `PORT` | Default 8080. `0` picks a free one. |
| `--host <h>` | `ATLAS_HOST` or `HOST` | Default `127.0.0.1`. Listening beyond this machine requires tokens or `--insecure`. |
| `--site <dir>` | `ATLAS_SITE` | The built viewer. Default: `./atlas-site`, else built once into `~/.cache/atlas/site`. |
| `--outline-branch <b>` | `ATLAS_OUTLINE_BRANCH` | Which branch's specs the report is laid over. Default `main`, then `master`, then the newest. |
| `--refresh <seconds>` | `ATLAS_REFRESH_SECONDS` | How often the bucket is looked at for new layers. Default 10. |
| `--branch <name>` (repeatable) | `ATLAS_ONLY_BRANCH` | Only layers recorded on these branches take part. |
| `--ignore-modified` | `ATLAS_IGNORE_MODIFIED=1` | Leave out layers from modified checkouts and unknown origins. |
| | `ATLAS_TOKEN`, `ATLAS_PUBLISH_TOKEN`, `ATLAS_READ_TOKEN` | Admin, publisher and reader tokens, each at least 12 characters. Send `Authorization: Bearer <token>`, or HTTP Basic with the token as the password. Probes require no token. |

### Run it

**Docker.** [`examples/deploy/Dockerfile`](https://github.com/crvouga/atlas/blob/main/examples/deploy/Dockerfile)
installs Atlas, builds the viewer once (it is the same for every project: the node tells the page where its
data is) and starts the node:

```sh
docker build -t atlas-node examples/deploy
docker run -p 8080:8080 -e ATLAS_STORE=s3://my-bucket/atlas/my-project -e AWS_REGION=us-east-1 -e ATLAS_READ_TOKEN atlas-node
```

On ECS, EKS or EC2, attach the **reader** role to the task, service account or instance and set no keys.

**Try it on one machine.** [`examples/deploy/compose.yaml`](https://github.com/crvouga/atlas/blob/main/examples/deploy/compose.yaml)
starts an S3 server, a bucket and the node; publish to it from your project and open `http://localhost:8080`.

**Kubernetes.** [`examples/deploy/kubernetes.yaml`](https://github.com/crvouga/atlas/blob/main/examples/deploy/kubernetes.yaml):
a Deployment of two copies, readiness on `/readyz`, an IRSA service account.

**Without a container.** `bun add -d @crvouga/atlas`, then `bunx atlas-visualizer build --no-data --out
atlas-site` and `bunx atlas serve`. It runs on Bun and on Node 22.18 or later.

### Who may look

Set `ATLAS_READ_TOKEN` for a dashboard that only accepts readers. `ATLAS_PUBLISH_TOKEN` also allows
uploads, and `ATLAS_TOKEN` grants administration. Without tokens the server listens on loopback by default. Put it behind what your
company already uses: an ALB with OIDC, Cloudflare Access, `oauth2-proxy`, Tailscale. TLS ends at that
layer too. Pass `--insecure` only when that proxy handles sign-in.

### What it serves

| Path | |
| --- | --- |
| `/` | The viewer. Its page carries the node's address book, so one build serves every project. |
| `/api/reports/evidence/effective` | The whole report in one request: only the layers that win a check, each with only the rows that win. ETag, gzip. |
| `/api/reports/evidence`, `/evidence/rows/<backend>/<id>`, `/outline`, `/outline/spec?path=` | History, one layer's checks, the specs. |
| `/api/reports/evidence/detail/<backend>/<id>?check=<id>&kind=<kind>` | Everything one result carries: its timeline, annotations, retries, attachments and extensions, and the run's own. Without `check`, only the run's. |
| `/api/reports/layers/<id>/blobs/<key>` | One file a layer carries (screenshot, video, trace…), served as untrusted bytes with range support, cached for good. |
| `/api/data/specs/…`, `/api/data/runs/…`, `/api/data/sources.json` | The specs and runs, laid out the way the viewer reads a static host. |
| `/api/checks` | Upload a layer of checks with `POST`. |
| `/api/events` | Live report updates over server-sent events. |
| `/healthz` | The process is up. |
| `/readyz` | `200` once the bucket was read and at least one store answers; `503` otherwise. Route traffic on this. |

The specs come from the newest **spec set** published from `main` (`publish --specs`), so the node needs no
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
| One person's view of what leaving a source out changes | **Sources** in the viewer: leave out a branch, environment, version or layer |

## 6. Operating it

- **Upgrades.** The layer format is a stable, versioned contract. A node reads every layer a publisher of
  an older or the same schema version wrote, and names (never guesses at) a layer of a newer one. Upgrade
  readers (the node, the gate) before publishers when a release bumps `schemaVersion`; within a version
  they never need to move together.
- **Logs.** One JSON line per request to stdout. `/healthz` and `/readyz` are not logged. At start it
  prints what it reads and any store it cannot reach.
- **A store goes down.** The node keeps serving what it has, names the store in the viewer's notices and
  in `/readyz`, and recovers by itself. The gate fails closed: unknown is not a pass.
- **A layer cannot be read** (corrupt, or written by a newer Atlas): a notice names it. It is tried again
  every five minutes.
- **Scaling.** Run as many copies as you like; they share nothing. A copy's memory grows with the number of
  distinct checks, plus about a hundred bytes for each layer ever seen (to know it has read it). A process holding 12,000 checks folded from 2,000 layers measured about
  300 MB in total in a benchmark that also ran its own S3 stand-in.
- **Cost.** Between full listings a refresh asks for one page of the catalog, newest first, and stops at the
  first page it already knows: one `LIST` request every refresh interval, however long the history. A full
  listing (one request per thousand layers) runs at the start and every 30 refreshes (five minutes by
  default), which is also how a layer recorded with an old timestamp is found. One small `GET` per new
  layer, once.
- **Retention.** Atlas deletes nothing. `atlas report doctor` shows what the bucket holds.
- **Disaster recovery.** The bucket is the only state. Replicate or version it as you do any bucket; the
  node is rebuilt from nothing in the time it takes to read the layers (below). It listens at once and answers
  `/readyz` 503 until it has, so a liveness probe never kills a node that is still reading.
- **A second bucket.** Another team's layers, a device lab, an archive: pass several `--store`s. They are one
  report, attributed to the store they came from.

## 7. Performance

Measured, not promised (a laptop, a local S3 server, so these are the client's own costs; real S3 adds its
latency per request, which the node hides by reading 64 at a time):

| What | Cost |
| --- | --- |
| Publish a layer of plain checks | One `HEAD` and two small `PUT`s. Two thousand layers published in under two seconds from one process, in parallel. |
| Node cold start | About 0.2 ms of CPU per layer, plus S3 latency ÷ 64 per layer: 2,000 layers in well under a second on a fast store, a few seconds on S3. Each layer is read once, ever. |
| Refresh with nothing new | One `LIST` request for the newest page of the catalog, whatever the history. |
| The report, to a viewer | One request. 12,000 checks from 2,000 layers is 108 KB gzipped, built once per change. |
| The viewer asking again | `304 Not Modified` in under a millisecond (it asks every five seconds). |
| The viewer in a browser | One request for the report, plus the spec index, outline and run index and the specs it opens. None per layer, whatever the history (measured in Chromium against a node reading S3). |

How: each layer is folded into the winning result of every check once and dropped unless it still holds a
winner, so work and memory follow the number of checks. Because the winner rule is a total order, folding in
any order is exact; a test proves the incremental report equals recomputing from every layer. The viewer
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
| The node says `listening … no store can be reached yet` | The bucket is unreachable from the node. It retries; `/readyz` stays 503 until it can read. |
| A new layer does not show | Wait one refresh interval (10 s). Check `atlas report status --store <url>` sees it. |
| Everything is red because of one laptop | By design the newest result wins. Gate on `--ignore-modified` and a branch ([above](#5-choosing-what-takes-part)). |
| Specs are empty in the viewer | Nothing published with `--specs` yet, or only from a branch other than `main`: set `--outline-branch`. |
| `Run … is not shared: its privacy scan did not pass` | `--upload-run` refuses runs whose scan found real data. Fix what it found and run again. |
