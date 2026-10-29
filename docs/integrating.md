# Integrating Atlas into a project

This guide takes a project from nothing to a layered, gated report of its specs. It is written for
people and for coding agents: every step ends with a command and the output that means it worked, so
an agent can follow it without asking anyone.

Atlas reports on **specs of any kind**: Gherkin features, Quint models, DMN tables, Alloy
structures, OpenSLO objectives, unit and end-to-end tests, linters, and statecharts that Atlas can run
itself. Anything that ends in "this check passed or failed" can publish a **layer**. Atlas lays the
layers over your specs, whatever produced them, whichever machine or branch they came from.

**The fast path:** `bunx @crvouga/atlas init --server <url>` detects your test runners, specs and CI and prints the exact
commands of this guide for your project (`--write` applies them; `--format json` is for agents). See
[Atlas for AI agents](agents.md). The rest of this guide explains what those commands do.

**Only have the repository link?** Start with [the consumer playbook](agents.md#given-only-this-repository-link)
for installation choices and version-matched docs. **No server yet?** [Verify Atlas locally](quickstart.md)
proves publish, repeat-publish, failure and recovery with copyable commands and no credentials. This guide's
directory/artifact integration works without a server too.

Read [the report contract](report-contract.md) once if you want the exact rules. You do not need it to
integrate. To run it for a whole team, with a bucket and one node everyone looks at, see
[running Atlas for a project](deploying.md). This guide ships with the package, matching your version, at
`node_modules/@crvouga/atlas/docs/integrating.md`.

> [!IMPORTANT]
> Install `@crvouga/atlas` from npm. Never edit Atlas from your project: no submodule, no vendored
> copy, no patch to `node_modules`. When Atlas is wrong or missing something, [file an
> issue](reporting-issues.md). See [dogfooding](dogfooding.md).

## How it fits together

```
 node 1: suite A, ios      ──▶ layer ─┐
 node 2: suite A, android  ──▶ layer ─┤        ┌──▶ atlas report status   (gate: exit 1 on failure)
 node 3: suite B, shard 1  ──▶ layer ─┼──▶ backends ──▶ combine ──┼──▶ the client          (browse it)
 node 4: suite B, shard 2  ──▶ layer ─┤        └──▶ your own code          (combineBackends)
 a laptop, one scenario    ──▶ layer ─┘
```

- Each run publishes **a layer**: only the checks it ran.
- Layers go to **backends**: a directory, a bucket, any store. Several backends are one report.
- The report is **computed** from all layers. The newest completed result wins each check, per
  environment. Nothing is overwritten and nothing needs to coordinate.

That is why partial runs work: a shard, a branch, a re-run of one scenario or a device lab each add a
layer, and the report fills in.

## 1. Decide four things

| Decision | Rule of thumb | Example |
| --- | --- | --- |
| **Producers** | One per suite or tool. A short, stable, lowercase name. | `gherkin`, `web-e2e`, `quint`, `slo` |
| **Environments** | One per client you check on. Leave it out when there is only one. | `desktop-web`, `mobile-web`, `ios`, `android` |
| **Check ids** | Stable across runs, unique within a layer. Derive from file, suite and name. | `specs/join.feature > Joins a list` |
| **Backend** | A directory in CI artifacts to start. A shared bucket when reports must outlive a workflow. | `atlas-reports/` |

Check ids and producers are the identity of a result. If a check changes its id or a suite changes its
producer, the old result stays in the report next to the new one. Choose them once.

## 2. Install and check

```sh
bun add -d @crvouga/atlas        # or: npm install -D @crvouga/atlas, pnpm add -D @crvouga/atlas
bunx atlas report --help         # npx atlas report --help
```

Expected: the usage text of `atlas report`. Add the directory you publish to (`atlas-reports/`) to `.gitignore`.

<!-- generated:runtime-requirements -->
Supported runtimes (from `package.json`): **node `>=22.18.0`** or **bun `>=1.2.0`**. Node consumers do not need Bun unless they use the Bun WebView driver.
<!-- /generated:runtime-requirements -->

## 3. Make each suite publish a layer

Pick the first row that fits.

| Your suite writes | Publish with |
| --- | --- |
| JUnit XML. Most runners can: Cucumber (`--format junit:out.xml`), Jest (jest-junit), Vitest (`--reporter=junit`), Bun (`--reporter=junit --reporter-outfile=out.xml`), pytest (`--junitxml`), `gotestsum --junitfile` | `--junit out.xml` |
| [CTRF](https://ctrf.io) JSON | `--ctrf ctrf.json` |
| An Atlas statechart run | `--manifest atlas-runs/<run>/manifest.json` |
| Nothing: a script, a model checker, a linter, an SLO evaluation | `--checks checks.json`, or `publishChecks` from code |

### From a report file

```sh
bunx atlas report publish --store atlas-reports --producer web-e2e --junit out.xml --environment desktop-web
# Published layer 3fa9c2d41b07: 42 checks (41 passed, 1 failed, 0 not run) as "web-e2e" on desktop-web
```

`--sha`, `--branch` and `--run-url` are read from the CI's own variables (GitHub Actions, GitLab,
Buildkite, CircleCI) and then from git. Pass them to override. Outside a git checkout, or before the
first commit, they are `null`: that is provenance missing, not an error, and never changes which
result wins. `--param key=value` (repeatable) adds a parameter that makes a result its own slot, such
as `--param device=iphone-15`.

Without a CI run URL, layers recorded at one branch and commit group into one run, so repeating a local demo
looks like one execution. To keep invocations apart, name each one: `--run-id <id>` (or `ATLAS_RUN_ID`), with
`--run-title <title>` (or `ATLAS_RUN_TITLE`) for a human name and `--run-started-at` / `--run-ended-at` for when
it ran. Every shard or batch of one invocation passes the same id and is one run; the next invocation passes a new
one. A run recorded from a checkout with uncommitted changes keeps saying so beside its commit. The id only
groups: it is not part of which result a check fills or which wins, and a producer that never passes it keeps
the CI-run-URL, then `branch@sha`, grouping.

The time the checks ran comes from the report (CTRF `summary.stop`, a JUnit `timestamp`, a manifest's
`finishedAt`), or failing that from the report file's modification time, in milliseconds. Publish in
the same job that wrote the report and that is the time it ran. If you copy the report first, pass
`--recorded-at <iso|ms>`, which overrides both. Either way, publishing the same report twice writes
the same layer.

### Tell Atlas which spec a check belongs to

A test report rarely says which spec a test checks. Without that, results are counted but listed
under no spec. Say it once, per report:

| Flag | Meaning |
| --- | --- |
| `--spec specs/cart.feature` | Everything in this report checks that spec. Use it when you run one report per spec. |
| `--specs ./specs` | Atlas reads the spec files and links each check: by a path the report gives that is one of the specs; else by the suite, class or file name the report gives that matches a spec's title or file name (Cucumber names each suite after its feature); else by the part of the check's name before ` > `. |

A spec's **title**, which the name is matched against, is: the `Feature:` line of a `.feature` file,
the `module` name of a `.qnt` file, and the file name for everything else (`latency.openslo.yaml`).
Its file name without extensions matches too (`cart` for `specs/cart.feature`). Matching ignores case
and punctuation. If two specs share a title, the one whose path sorts first wins.

A check that matches nothing stays unlinked, never linked to a wrong spec. With either flag the layer
also records the spec and a fingerprint of its text, so a later reader can warn "spec changed since
this ran". A check file or code names the spec per check with `specPath`.

Specs that nothing has run yet are known from where Atlas is told the specs are: `--specs ./specs` on
`status`, or else the spec set that `publish --specs` put in the store (the newest from `main`), so a gate
needs no checkout. `atlas report status --store all` lists them in `specsWithoutEvidence`, and
`--require-all-specs` fails the gate until every spec has a result.

```sh
bunx atlas report publish --store atlas-reports --producer bdd --junit cucumber.xml --specs ./specs --environment ios
```

### From nothing: a checks file

For specs no tool reports on, write what you verified:

```json
{
  "producer": "slo",
  "kind": "objective",
  "environment": "desktop-web",
  "recordedAtMs": 1760000000000,
  "checks": [
    { "id": "specs/latency.openslo.yaml > p99 under 300ms", "title": "p99 under 300ms", "status": "passed",
      "specPath": "specs/latency.openslo.yaml",
      "measurements": [{ "name": "p99", "value": 212, "unit": "ms", "limit": 300 }] },
    { "id": "specs/latency.openslo.yaml > error budget", "title": "Error budget", "status": "failed",
      "specPath": "specs/latency.openslo.yaml", "detail": "42% of the budget burned this week" }
  ]
}
```

```sh
bunx atlas report publish --store atlas-reports --checks checks.json
```

The file is a [`publish-checks`](../packages/schema/schemas/publish-checks.schema.json) document.
`status` is `passed`, `failed`, `running` or `not-run`. The `producer` can be in the file or on the
command line (`--producer`), and any other field may also be given as a flag, which wins.
`recordedAtMs` is when you ran the checks; without it the file's modification time is used.

Take `recordedAtMs` from the measurement itself, or from `Date.now()` in the script that measures. Do
not rely on a data file's modification time in CI: a fresh checkout stamps every file with the time of
the checkout, so an old number would look new and win over a genuinely newer layer.

Atlas records a status, it does not judge a measurement. A measurement over its `limit` is shown and
**never** fails a check by itself, so your script decides `status`. For an SLO, that is a comparison:

```ts
// scripts/slo-checks.ts
import { readFileSync, writeFileSync } from 'node:fs';

const metrics = JSON.parse(readFileSync('metrics.json', 'utf8'));
const limit = 300;
const spec = 'specs/latency.openslo.yaml';
writeFileSync('slo-checks.json', JSON.stringify({
  producer: 'slo',
  kind: 'objective',
  environment: 'desktop-web',
  recordedAtMs: metrics.measuredAtMs ?? Date.now(),             // when the numbers were measured
  checks: [{
    id: `${spec} > checkout p99 under ${limit}ms`, title: `Checkout p99 under ${limit}ms`, specPath: spec,
    status: metrics.checkout_p99_ms <= limit ? 'passed' : 'failed',
    detail: `p99 was ${metrics.checkout_p99_ms}ms`,
    measurements: [{ name: 'p99', value: metrics.checkout_p99_ms, unit: 'ms', limit }]
  }]
}));
```

### From code

```ts
import { directoryStore } from '@crvouga/atlas/reports/directory-store';
import { publishChecks } from '@crvouga/atlas/reports/publish-checks';

await publishChecks(directoryStore('atlas-reports'), {
  producer: 'quint',
  kind: 'model',
  environment: 'desktop-web',
  recordedAtMs: Date.now(),            // when the checks ran
  sha, branch,                         // provenance; never part of a result's identity
  checks: results.map((r) => ({ id: `specs/booking.qnt > ${r.invariant}`, title: r.invariant, status: r.ok ? 'passed' : 'failed', specPath: 'specs/booking.qnt', detail: r.counterexample ?? '' }))
});
```

`publishChecks` validates its input and throws, naming each problem, before anything is written. It
returns the layer.

### Screenshots, videos, traces, logs and the rest

A result may carry any evidence your framework produces: attachments of any media type, a timeline of steps,
annotations, retries, tags and labels. Most of it arrives by itself (files a report names are read from its own
folder and from each `--attach-root`, never from elsewhere): a CTRF report's attachments, screenshots,
logs, steps and retries, and a JUnit report's output and properties, are published with the results. For the
rest, name files in a checks file (`"attachments": [{ "name": "failure.png", "path": "evidence/failure.png" }]`),
or attach files to the whole run:

```sh
bunx atlas report publish --producer e2e --junit out.xml --attach ci.log --attach trace=traces.zip --label build=4821
```

Files are stored in the layer by content, shown by what they are (pictures, videos, page snapshots, text) and
offered for download otherwise. [Evidence](extending.md) is the full model, and why a new kind of evidence never
breaks anything.
[Send rich evidence](rich-evidence.md) lists what to send and what the viewer does with it, and covers the Playwright Test reporter.

### A catalog of every screen

If the project wants a picture of each screen per viewport and color scheme, with the screens nobody captured called out, that is the
[UI catalog](ui-catalog.md): publish what should exist with `atlas ui-catalog plan`, what each collector captured with
`atlas ui-catalog publish` (any shard, any machine, any tool), and gate on `atlas ui-catalog status`. The order of work, the commands and the
mistakes to avoid are in [Capturing and reading the UI catalog](agents.md#capturing-and-reading-the-ui-catalog).

### Statecharts

Atlas can also run statecharts against the real product (see [executable statecharts](statecharts.md)).
Publish each run, shard or re-run as its own layer:

```sh
bunx atlas run --config atlas.config.ts --shard 1/2
bunx atlas report publish --store atlas-reports --producer statecharts --environment desktop-web \
  --manifest atlas-runs/<run>/manifest.json
```

Do this instead of `atlas merge` when you also want the result to combine with other suites,
branches and environments. A path's `key` is its check id, so the same path in a later run replaces
the earlier result.

**Check:** `bunx atlas report status --store atlas-reports` prints `PASS …` (or `FAIL …` naming the
failing checks) and exits 0 or 1. If it prints `No checks were found`, the `--store` directory does not
contain `layers/` yet.

## 4. Build the report across nodes and branches

Every node publishes **its own** layers into **its own** store directory and uploads it. One job
downloads them all, and the gate reads the union. This is the whole GitHub Actions setup, for suites
of one kind on several nodes plus a producer that is not a test runner:

```yaml
name: specs
on: [push, pull_request]

jobs:
  # One matrix entry per node. A node runs `run`, which writes JUnit XML to out.xml, and publishes it.
  suite:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        include:
          - { name: cart-web,     producer: unit, environment: desktop-web, run: bun test tests/cart.test.ts     --reporter=junit --reporter-outfile=out.xml }
          - { name: checkout-web, producer: unit, environment: desktop-web, run: bun test tests/checkout.test.ts --reporter=junit --reporter-outfile=out.xml }
          - { name: e2e-ios,      producer: e2e,  environment: ios,         run: ./scripts/e2e-ios --junit out.xml }
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: ${{ matrix.run }}
        continue-on-error: true      # a failing suite must still publish: a failure is evidence
      - run: >
          bunx atlas report publish --store store --producer ${{ matrix.producer }}
          --junit out.xml --specs ./specs --environment ${{ matrix.environment }}
        if: always()
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: layers-${{ matrix.name }}
          path: store

  # Checks that no test runner reports: your script writes a checks file, Atlas publishes it.
  slo:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - run: bun scripts/slo-checks.ts                                  # writes slo-checks.json
      - run: bunx atlas report publish --store store --checks slo-checks.json
      - uses: actions/upload-artifact@v4
        with: { name: layers-slo, path: store }

  # The aggregate: every node's layers, one gate.
  report:
    needs: [suite, slo]
    if: always()
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install --frozen-lockfile
      - uses: actions/download-artifact@v4
        with: { pattern: 'layers-*', path: all, merge-multiple: true }   # directories merge: layers never collide
      - run: bunx atlas report status --store all --specs ./specs --format markdown >> "$GITHUB_STEP_SUMMARY" || true
      - run: bunx atlas report status --store all --specs ./specs --require-all-specs --require-environments desktop-web,ios
```

Each artifact is a store directory itself (it contains `layers/`), so `merge-multiple` into `all`
produces one store. A `--store` directory that does not exist is an error, not an empty store: a node
that failed to upload is noticed instead of silently contributing nothing.

To try it on one machine first, run the same steps by hand. A failing suite exits non-zero; publish
its report anyway.

```sh
bun test tests/cart.test.ts --reporter=junit --reporter-outfile=out/a.xml
bunx atlas report publish --store out/node-a --producer unit --junit out/a.xml --specs ./specs --environment desktop-web
bun test tests/checkout.test.ts --reporter=junit --reporter-outfile=out/b.xml
bunx atlas report publish --store out/node-b --producer unit --junit out/b.xml --specs ./specs --environment desktop-web

bunx atlas report merge --store out/node-a --store out/node-b --into out/all
bunx atlas report status --store out/all --specs ./specs --require-all-specs; echo "exit $?"
```

Why this is safe to do in any shape:

- Layer files are named by their content. Two nodes cannot write different bytes to one name, so
  merging directories (`merge-multiple`, `cp -R`, `rsync`, `atlas report merge`) is a plain union.
- Shards of one suite check different things, so they fill different slots and need no marker.
  **Never** pass the shard, node or run number as a `--param`: every distinct parameter set is its own
  slot, and shards are re-balanced between runs, so a stale result would sit beside the fresh one.
- Combining is incremental: `atlas report merge --into all` can reuse the same directory again and
  again. It copies only what is missing, so a later run adds its layers and changes nothing else.
- A node that never publishes contributes nothing, and the gate cannot know what it should have run.
  `--require-environments` catches an environment that is missing entirely. A node that publishes late
  only adds its slots.

### Across runs and branches

Layers from another branch or an earlier run fill the same slots by recency. To let a pull request inherit
the unchanged results of `main`, put layers somewhere that outlives the workflow: **a bucket**. Every node
then publishes straight to it, with no artifacts to merge:

```sh
export ATLAS_STORE=s3://my-bucket/atlas/my-project     # AWS credentials from a role, SSO or the environment
bunx atlas report publish --producer unit --junit out.xml --specs ./specs --environment desktop-web
bunx atlas report status --branch "$BRANCH" --branch main --ignore-modified --require-all-specs
```

Developers publish from their laptops the same way, and `atlas serve` shows everyone the whole
project. Better still, point everything at the project's server (`ATLAS_STORE=https://atlas.example.com`,
`ATLAS_TOKEN=…`): the same commands upload to it, results are in everyone's view at once, `atlas report stream`
sends a suite's checks as they finish, and the gate is answered by the server. See [the Atlas server](server.md).
[Running Atlas for a project](deploying.md) is the full guide: the server, the bucket and its IAM policies,
CI with OIDC, auth and filters.

To fold a directory of layers (an artifact, a laptop's `atlas-reports/`) into the bucket after the fact:
`atlas report merge --store ./all --into s3://my-bucket/atlas/my-project`. It copies what is missing and is
safe to repeat; nothing is ever overwritten, so nothing is lost if two workflows copy at once.

## 5. Backends

A backend is any `ObjectStore`. Atlas ships two: a directory, and S3 (AWS S3, Cloudflare R2, MinIO and
anything else that speaks the S3 protocol, with no SDK). Name one with a URL, anywhere a `--store` goes:

| Store | URL |
| --- | --- |
| A folder | `./atlas-reports`, `/srv/atlas` |
| S3 | `s3://bucket/folder`, `s3://bucket/folder?region=eu-west-1` |
| R2, MinIO, others | `s3://bucket/folder?endpoint=https://…&region=auto` |

Keys never go in the URL: they come from `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`, `aws sso login`, or
a role. `atlas report doctor --store <url>` checks a store end to end and says what is missing. From code:
`s3Store({ bucket, prefix, region, endpoint })` from `@crvouga/atlas/reports/s3-store`.

For any other store, implement `ObjectStore` (see [the report contract](report-contract.md#backends)) and
prove the adapter before trusting it:

```ts
import { verifyObjectStore } from '@crvouga/atlas/reports/object-store-conformance';

const { ok, failures } = await verifyObjectStore(myStore);
if (!ok) throw new Error(failures.join('\n'));
```

Combine any number of backends from code:

```ts
import { combineBackends } from '@crvouga/atlas/reports/compose';
import { reportStatus } from '@crvouga/atlas/reports/report-status';
import { s3Store } from '@crvouga/atlas/reports/s3-store';

const report = await combineBackends([
  { id: 'ci', label: 'CI', store: s3Store({ bucket: 'my-bucket', prefix: 'atlas/my-project' }) },
  { id: 'lab', label: 'Device lab', store: deviceLabStore() }
]);
const status = reportStatus(report, { requireEnvironments: ['ios'] });   // status.ok, status.failing, …
```

A backend that is down is named in `report.notices` and the rest is combined; the gate fails because
unknown is not a pass.

## 6. Browse it

The Atlas client lays your stores over your specs directory. Add a module to your project:

```ts
// atlas.reports.ts
import { reportsHost } from '@crvouga/atlas/reports/host';

export const reportsDevFetch = reportsHost({ specs: './specs', stores: ['./atlas-reports', './all'] });
```

```sh
ATLAS_REPORTS_MODULE="$(pwd)/atlas.reports.ts" bunx atlas client dev --specs ./specs
```

`reportsHost(options)` returns `(request: Request, repoRoot: string) => Promise<Response>`, the
function the client calls for every `/api/reports/…` request. `specs` and directory `stores` resolve
against `repoRoot`, which the client sets to where you ran the command (`INIT_CWD`), not against the
module. A wrong path comes back as a JSON error that names it. A `stores` entry that is not a string is
a backend of your own: `{ id, label?, store }`. You can call it yourself to look at what the client
sees:

```ts
import { reportsDevFetch } from './atlas.reports';

const page = await (await reportsDevFetch(new Request('http://x/api/reports/evidence'), process.cwd())).json();
// page.layers: one header per layer (producer, environment, branch, sha, counts, backend), newest first
// page.backends, page.notices: which stores answered, and what could not be read
```

| Route (after `/api/reports`) | Returns |
| --- | --- |
| `/evidence?cursor=` | A page of layer headers, the backends and any notices. The client combines them with the specs. |
| `/evidence/rows/:backend/:id` | One layer's checks. |
| `/outline`, `/outline/spec?path=` | The specs directory as an outline, and one spec's text. |

The combined result of each spec is computed in the client. To get it without a browser, use
`atlas report status --format json`: its `specs` array has each spec's counts per environment.

Specs are the files of the specs directory (`.feature` as Gherkin, `.qnt` as Quint, `.dmn`, `.als`,
`.openslo.yaml`, and the rest by extension); each shows the combined result of its checks, per
environment, with the layer behind it. A check names its spec with `specPath`: the spec file's path
relative to the specs directory, with `specs/` in front, exactly as `atlas report status` prints it
(`specs/cart.feature` for `./specs/cart.feature`, `specs/billing/refunds.feature` for a nested one). Statecharts (`.scxml`, `.machine.yaml`) render as the product map; see the
[visualizer](../packages/visualizer/README.md).

## 7. Done when

An integration is complete when each of these holds. Run them and keep the output.

| Check | Command | Expect |
| --- | --- | --- |
| Each suite publishes | `bunx atlas report publish …` | `Published layer …: N checks` |
| Publishing twice changes nothing | run the same publish again, then `status --format json` | `layers` is unchanged |
| The report combines | `bunx atlas report status --store <dir> --format json` | `ok`, `checks.total` equal to the checks you run, `byEnvironment` listing every environment |
| Every spec has results | `status --specs ./specs --format json` | `specsWithoutEvidence` is empty, or lists only specs you have not run yet. `--require-all-specs` makes it a gate |
| A failure is caught | publish a failing check, run `status` | exit code 1, the check named |
| A fix clears it | publish the same check passing (a later `--recorded-at`), run `status` | exit code 0 |
| The gate is in CI | the `report` job above | red when a layer failed, red when an environment is missing |
| Code compiles | your usual type-check, if you import Atlas from code | no errors |

## Troubleshooting

| You see | Cause and fix |
| --- | --- |
| `No check has completed: everything was skipped or not run` | Every check in every layer is `not-run`. Skipped tests are not evidence: run them, or publish the ones that did run. |
| `No checks were found in any layer` | The `--store` directory is empty or is the wrong level. It must contain `layers/`. |
| Results show under no spec | The report did not say which spec each check belongs to. Pass `--spec <path>` or `--specs <dir>`, or give `specPath`. |
| An old result keeps showing | The new run used a different check id, producer, environment or parameter, so it filled another slot. Or its time is older: check `recordedAtMs` and `--recorded-at`. |
| The same check appears twice | Two environments, two parameter sets, or two kinds. That is by design; compare their layers. |
| One environment has no results | No layer from that environment reached the store. Add it to `--require-environments` so CI says so. |
| `Written with layer schema version 2…` | A newer Atlas wrote it. Upgrade `@crvouga/atlas` where you read it. |
| `a layer could not be read, so its outcome is unknown` | A corrupted or half-copied file. Re-run that node's publish and merge again. |
| `atlas report: Store directory not found` (exit 2) | A `--store` path does not exist. Check the path, and whether the server that should have produced it uploaded its layers. |
| `X is unavailable` | A backend is down. The rest were combined; fix it or leave it out. |
| `check id "…" appears twice` | Your suite emits two checks with one name. Make the names unique. Importers number repeats as `#2`. |
| `Potentially outdated: spec changed` | The spec changed since the layer was recorded. Advisory: the recorded outcome still counts. Re-run to refresh. |
| Client shows `No report store is configured` | `ATLAS_REPORTS_MODULE` is unset, or `stores` is empty. |

## Rules

- Publish even when the suite fails. A failure is the point of evidence.
- Take `recordedAtMs` from the run, not from the moment of publishing.
- Never rewrite or delete a layer by hand. Publish a newer one.
- Keep a check's id and a producer's name stable. Rename deliberately.
- Commit your specs, config and `atlas.reports.ts`. Do not commit `atlas-reports/` or `atlas-runs/`.
- Failure messages are published as written. Keep real personal data out of check ids, details and
  parameters; a layer is meant to be shared. (Statechart runs are also scanned by Atlas's privacy
  check.)
- Do not parse the text output of `atlas report status`. Use `--format json`, which is a
  [stable schema](../packages/schema/schemas/report-status.schema.json).
