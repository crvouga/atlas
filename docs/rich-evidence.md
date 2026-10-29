# Send rich evidence

A check that says only its title and `passed` answers one question: did it pass? A check that also has its duration,
the device it ran on, its steps, its retries and its video answers the next ones too: how slow is it, where does it
fail, what happened, is it flaky. This guide covers which fields a producer should send, what the viewer does with
each, and two ways to send them: the Playwright Test reporter, which sends all of them for you, and `createReporter` /
`publishChecks` for any other producer.

Every field here is optional and none of them changes a result: a check's status, its slot and which result wins are
decided exactly as before ([the report contract](report-contract.md)). Evidence only adds information.
[Evidence](extending.md) is the full model, with the rules that keep it compatible.

- [What to send, and what it is for](#what-to-send-and-what-it-is-for)
- [Labels describe, parameters split](#labels-describe-parameters-split)
- [Playwright Test](#playwright-test)
- [Any other producer](#any-other-producer)

## What to send, and what it is for

| Field | Where | What the viewer does with it |
| --- | --- | --- |
| `durationMs` | check, attempt, step | Averages, p95 and the slowest tests, per environment and over time. |
| `environment` | layer | Which client was checked (`desktop-web`, `mobile-web`, `ios`, `android`…). A check on two environments is two results, side by side. |
| `labels` (`browser`, `device`, `os`, `viewport`…) | check, layer | Shows each result's browser, device and system, and lets you filter by them. |
| `attachments` with a `role` | check, attempt, step, layer | Plays `video`, shows a `screenshot`, opens a `trace`, shows logs and offers anything else for download. |
| `steps` (`parentId`, `offsetMs`, `durationMs`, `status`, `kind`) | check, attempt | Draws the check's timeline: nested steps, when each started, how long it took, which one failed. |
| `attempts` | check | Every try of a retried check, with its own status, detail, steps and attachments. A check that passed after failing is flaky. |
| `tags`, `labels` | check, layer | Filters and groups (`smoke`, `flaky`, an owner, a browser). |
| `tags` | attachment | Marks one recording or screenshot, for example `demo`: shown as a `#demo` chip, and searchable. See [Tagging artifacts and demos](#tagging-artifacts-and-demos). |
| `scope` | attachment, attempt, check, part, layer | What a recording does and does not show: where it ran, whether data and dependencies were real, whether audio was captured. See [Evidence scope](#evidence-scope). |
| `annotations`, `links` | check, step, attempt, layer | Notes, warnings and issue links next to the result. |
| `specPath` | check | The spec a check belongs to (a `.feature`, a test file), relative to the repository. Checks are grouped by it. |
| `specs[]` (`path`, `domain`, `kind`, `title`) | layer | Names each spec and its group (`domain`), so a server can group checks by spec with a title even when no [spec set](integrating.md#tell-atlas-which-spec-a-check-belongs-to) has been published. |
| `detail` | check, attempt, step | Why it failed: the error message and stack, as plain text. |

Send `sha`, `branch` and `runUrl` on every layer too. They never change a result, but they tie results to a commit
and to the CI run that produced them.

## Tagging artifacts and demos

To mark one recording as a demo, tag the attachment itself. A tag on a check says something about the result; a tag on
an attachment says something about that file, and no Gherkin tag, label, environment or producer name is needed:

```ts
{ name: 'checkout.webm', role: 'video', tags: ['demo'], labels: { audience: 'business' } }
```

The viewer shows it as a `#demo` chip on the artifact card. Selecting the chip filters the result's evidence to the
attachments with that tag, and says how many match. Tags describe evidence; they never change a status or a slot.

- **One spelling.** A tag is normalized before it is compared or stored: a leading `#` is dropped, letters are
  lower-cased, each run of whitespace becomes `-`, and surrounding space is trimmed, so `demo`, `#demo` and `#Demo ` are
  `demo`. Empty tags and tags over 64 characters are not tags and are ignored (or refused, when a reviewer enters them).
  Everything else is a valid tag (`team/payments`, `release=2`), and repeats are shown once.
- **Inherited.** An attachment is also searchable by the tags of its check and its run. The viewer says `inherited` on
  such a chip, and a switch decides whether the filter counts them: a recording without a tag of its own under a run
  tagged `demo` is found by the inherited query and not by the exact one. In the API,
  `GET /api/reports/tests?artifactTag=demo` is exact and adding `&inherited=1` includes inherited tags.
- **Reviewers.** After upload, a person with a publish token can add tags to an attachment (the viewer's *Add tag*
  button) and remove the ones a reviewer added. Those tags are not written into the layer, which is immutable: the
  server keeps them as an audit trail (who, when, which tags) and the viewer shows them as `added by <name>`, apart
  from the producer's tags. See [Tagging artifacts](server.md#tagging-artifacts). A producer's own tags stay as uploaded.
- **Older layers.** A layer without attachment tags reads exactly as before. Tags on an attachment that cannot be read
  (not a list of strings) are dropped, and the attachment, check and layer stay.

## Evidence scope

A green result and a video do not say whether the speech was real, the replies scripted, the audio recorded, the device
physical or a vendor substituted. Declare it where the evidence is, in an optional `scope`, and the viewer shows it as
short badges above the recording (before it is played), with the exact declaration on demand:

```ts
{
  name: 'checkout.webm', role: 'video',
  scope: {
    surface: 'browser',               // where the product ran: browser, native-app, api…
    deviceKind: 'simulator',          // simulator, emulator, physical, virtual-machine, desktop…
    syntheticData: true,              // made-up data (false: real, absent: unknown)
    dependencies: 'scripted',         // scripted, live or mixed
    audioCaptured: false,             // false: silent, absent: unknown
    pacing: 'paced',                  // paced, real-time
    asserted: ['the receipt is shown'],           // what the result stands on
    limitations: ['Replies are scripted'],
    declaredBy: 'checkout e2e suite',
    verified: ['deviceKind'],         // fields something independent checked
    verifiedBy: 'device farm session log',
    provenance: [{ url: 'https://farm.example/session/1', name: 'Device session' }]
  }
}
```

Every field is optional, and every value except the booleans is an open string.

- **Unknown is not live.** A recording with no scope, or a scope that does not say a thing, shows `Scope unknown` or
  `Not declared`. It is never assumed live, physical, audible or end to end.
- **Declared is not verified.** Atlas shows `scope` as the producer's word. Only the fields named in `verified` are
  marked verified (with `verifiedBy`), and `provenance` links where to check them. Atlas does not check any of it.
- **Only what was asserted.** `asserted` lists the boundaries the result stands on. The viewer says that other activity
  visible in the clip is not verified behavior; with no `asserted` it says that no boundary was declared.
- **The nearest declaration, whole.** A recording takes the `scope` of the attachment, else its attempt, its check, its
  part, its layer, in that order. It is never merged field by field, so a retry on a physical phone does not borrow
  the limitations declared for the simulator try, and the badges change with the exact recording opened.
- **Filtering.** `GET /api/reports/tests?scope=device:physical,audio:recorded` (and the explorer's *Recording scope*
  filter) lists tests with one playable recording that states every token: `surface:<v>`, `device:<v>`,
  `data:synthetic` or `data:real`, `dependencies:<v>`, `audio:recorded` or `audio:silent`, `pacing:<v>`. A simulator
  and a physical phone are separate values. Evidence that did not declare a value is never included, and `unknown`
  asks for recordings that declared nothing. Each test lists its recordings' tokens as `scopeProfiles`, the facets as
  `scopes`, and the search box finds the words in them.
- **It decides nothing.** A scope never changes a status, a slot or a winner. A scope an older Atlas cannot read is
  dropped, and the attachment, check and layer stay.

## Product latency

A test's `durationMs` includes fixture setup, deliberate waits, demo pacing, retries and cleanup, so it says how long the
test ran and nothing about how quickly the product responded. Name the numbers that do, as measurements of `kind`
`product-latency` between two events:

```ts
measurements: [
  { name: 'Fixture setup', value: 20_000, unit: 'ms' },              // just a number: never read as latency
  {
    name: 'Confirmation', value: 500, unit: 'ms', kind: 'product-latency',
    from: 'submit pressed', to: 'confirmation visible',             // the boundaries are part of the claim
    limit: 800,                                                     // the budget
    source: 'app-instrumentation', instrumentation: 'spans-v2',
    labels: { device: 'pixel-8', build: '4821' }                    // what it is comparable with
  }
]
```

The test page shows **Product latency** apart from the test statistics, whose durations are labelled as test execution
time. Every field after `unit` is optional and none of them decides a status, a slot or a winner.

- **Only named measurements are latency.** A check's duration, a video's length, a step and a number with no `kind` are
  never product latency. A test that recorded none shows that its latency is unknown, not fast.
- **Boundaries are part of the claim.** Without both `from` and `to` the numbers are shown but no percentile or product
  claim is made, and the page says so. When the interval you measured is only part of what the name claims, say what it
  claims in `intended` (`{ "to": "audible response" }` on a measurement that ends at `tts dispatch`) and the viewer labels
  it a partial interval, never the complete one.
- **Percentiles need samples.** p50 needs 5 observations and p95 needs 20; fewer shows `Withheld` with the count it has.
  One observation shows no spread or confidence.
- **A timeout is a sample.** `outcome: "timeout"` or `"failed"` (anything but `observed`) means `value` is how long the
  observation waited. It stays in the sample count and the percentiles, counts as over budget whenever a `limit` is set,
  and marks the figures as lower bounds, so a stuck product never looks healthy.
- **Groups.** The viewer groups observations by `device`, `build` or the UTC day they were recorded, taking `device` and
  `build` from the measurement's `labels`, else the result's labels, parameters, environment and commit. Each group has
  its own sample count, p50/p95, budget and breaches. A group that names nothing is `unknown device` or `unknown build`.
- **Baselines.** A group is compared with a chosen baseline by absolute and relative change of p50 (and p95), or of the
  newest observation when percentiles are not supported on both sides. Measurements with different names, units or
  boundaries are not compared. A change of `instrumentation`, environment, other labels or parameters, or budget between
  the two sides is listed beside the change.
- **Reading it from the API.** `GET /api/reports/tests/history` entries carry `latency` (their product-latency
  measurements) next to `durationMs`. The pure functions are in `@crvouga/atlas/reports/latency`.

## Finding runs and artifacts

The viewer's **Runs** and **Artifacts** tabs and the API answer one query, so a link means the same thing everywhere.
"Demo videos for checkout on iPhone, including failed attempts" is:

```sh
curl "$ATLAS_SERVER_URL/api/reports/artifacts?artifactTag=demo&type=video&domain=checkout&label=device%3DiPhone"
```

- **Dimensions.** `artifactTag`, `type` (the media type as a role: `video`, `image`, `audio`, `snapshot`, `text`,
  `file`; `video` means a playable recording), `label` (`key=value`, or `key`), `domain` and `spec` (artifacts only),
  `environment` (the device or client), `producer`, `branch`, `sha` (seven or more characters), `outcome` (`passed`,
  `failed`, `running`, `not-run`), `since` and `until` (epoch milliseconds or an ISO date), and `q` (words).
- **Semantics.** Filters combine with AND across dimensions and OR within one (`environment=ios,android`). With both
  `artifactTag` and `type`, one attachment must be both where the report says which video carries which tag: a tagged
  screenshot beside an untagged video is not a tagged video. `inherited=1` also counts the tags an attachment inherits
  from its check and run. A comma or backslash inside a value is written `\,` or `\\`; the viewer encodes `#` and spaces.
- **History.** Artifacts are recorded results, not only the report's current winners: a recording tagged `demo` is
  found with its original run, commit and status even when a later attempt of the test is untagged. Tags a reviewer
  added after upload are kept apart from the layer and are not searched here.
- **Facets.** Each answer carries `facets`: for every dimension the values on offer. The count beside a value is what
  the list would hold if that value alone were chosen in its dimension with every other filter applied, so the
  chosen value's count is the list's and the others show what adding them would give.
- **Older servers.** A response names the filters it applied in `filters`. A viewer that asked for one that is missing
  filters what a run summary can answer itself and says plainly that the server cannot filter by the rest (tags, types,
  labels); it never presents an unfiltered list as narrowed. A server without `/api/reports/artifacts` is reported as
  such on the Artifacts tab.
- **Views.** *Views* saves the current filters under a name in this browser, per project and tab. A saved view is a
  **live query**: opening it asks again and shows what matches the newest report. It is not a snapshot; an immutable
  review collection is a separate feature. *Copy link* gives the address, which holds the whole query.

## Labels describe, parameters split

A result's **slot** is its producer, check id, part kind, spec, environment and **parameters**. The newest completed
result of a slot wins. So:

- Put what describes a run in `labels`: browser, device name, viewport, operating system, Playwright version, shard.
  Two runs that differ only in labels fill the same slot, and the newer one wins.
- Put what makes a run a different result in `parameters` (a locale, a tenant, a feature flag): each value is a slot
  of its own, kept side by side.
- Put the client in `environment`. It is a parameter that every view understands.

If you label a check `device: Pixel 7` on one run and `device: iPhone 15` on the next, both in `mobile-web`, the report
shows the newer one. To see both, give them different environments or a parameter.

## Playwright Test

`@crvouga/atlas/playwright-reporter` is a Playwright Test reporter. Add it beside your console reporter:

```ts
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['@crvouga/atlas/playwright-reporter', { project: 'checkout', producer: 'e2e-web' }]],
  use: { video: 'retain-on-failure', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'Desktop Chrome', use: { ...devices['Desktop Chrome'] } },
    { name: 'Pixel 7', use: { ...devices['Pixel 7'] } }
  ]
});
```

Then run your tests as usual, with the destination in the environment:

```sh
ATLAS_SERVER_URL=https://atlas.example.com ATLAS_TOKEN=$ATLAS_PUBLISH_TOKEN ATLAS_PROJECT=checkout npx playwright test
# … Playwright's own output …
# Atlas: 3512 checks in 140 layers to https://atlas.example.com
```

What it sends:

- Each test as `running` when it starts, then with its result when its last try ends, every few seconds, so the
  report follows the run as it happens.
- One stream of layers per Playwright project. The environment is `mobile-web` for a project that emulates a mobile
  device (`use.isMobile`), else `desktop-web`. Every check is labelled `browser`, `device` (the project name),
  `viewport`, `os` and `playwright` (its version), and `shard` when the run is sharded.
- A check id of `<specPath>#<describe titles> > <test title>`, the same in every run.
- `passed` for a test that got the result it expected, `failed` for a failure, a timeout or an interruption,
  `not-run` for a skipped test or one the run ended before it finished. A test that passed on a retry is `passed`,
  tagged and labelled `flaky`, with one attempt per try.
- The failure message and stack without terminal colours, the duration, `test.tags` (without `@`) and annotation
  types as tags, annotations, links (annotations whose description is a URL), and Playwright's steps as the timeline
  (`hook`, `fixture`, `action` for `pw:api`, `assertion` for `expect`, `step` for `test.step`).
- Every attachment, bytes included: `video`, `screenshot` and `trace` take that role, other attachments their own
  name, and standard output and error are `log`s. Attachments of earlier tries go with their attempt.
- The project's spec files in `specs[]`, so the server can group checks by spec.

It never fails the run. A destination that is not set, a server that is down or a file that cannot be read is said
once, and the summary line says how many checks could not be sent.

### Options

| Option | Default | |
| --- | --- | --- |
| `url` | `ATLAS_SERVER_URL`, else `ATLAS_STORE` | The Atlas server, or any store location (`./atlas-reports`, `s3://bucket/prefix`). |
| `token` | `ATLAS_PUBLISH_TOKEN`, else `ATLAS_TOKEN` (or `ATLAS_TOKEN_FILE`) | A publish token. A token is never sent over plain `http` beyond this machine. |
| `project` | `ATLAS_PROJECT` | The project on a shared Atlas server. |
| `store` | | Publish to this `ObjectStore` instead of a URL (a directory store, an in-memory store in tests). |
| `producer` | `playwright` | A stable name for this suite. |
| `kind` | `checks` | The part kind of every layer. |
| `environment` | `mobile-web` or `desktop-web` | A string, or `(project) => string`. |
| `parameters` | `{}` | Choices that make a result its own slot. An object, or `(project) => object`. |
| `labels` | | More labels for every check. An object, or `(project) => object`. |
| `sha`, `branch`, `runUrl` | `ATLAS_SHA`, `ATLAS_BRANCH`, then the CI's variables (`GITHUB_SHA`, `GITHUB_HEAD_REF` / `GITHUB_REF_NAME`, the GitHub Actions run URL…), then git | Where the run came from. |
| `specPath` | the `.feature` of a playwright-bdd test, else the test file | `(test) => string`, relative to the repository. |
| `rootDir` | the git root above Playwright's `rootDir` | Paths are relative to it. |
| `attachments` | `all` | `all`, `failures` (failed checks and failed tries only) or `none`. |
| `maxAttachmentBytes` | 50 MiB | A larger file is not uploaded; the check gets an `attachment-skipped` annotation. |
| `maxSteps` | 500 | Timeline steps kept per try; the rest are counted in a `steps-truncated` annotation. |
| `specs` | `true` | Record the project's spec files in each layer. |
| `flushMs`, `batchSize`, `attempts` | 5000, 50, 5 | How often to send, how many checks to send at once, how many tries per layer at the end. |
| `quiet` | `false` | Print nothing, not even the summary. |

Playwright decides what there is to upload: set `video`, `trace` and `screenshot` in `use` (`retain-on-failure` and
`only-on-failure` keep uploads small), and anything you `testInfo.attach()` is uploaded too. Each file is stored once
by its content, in chunks, so a server's object size limit does not cap a video.

### playwright-bdd

Tests generated by [playwright-bdd](https://github.com/vitalets/playwright-bdd) belong to their `.feature` file: a
test in `.features-gen/<path>.feature.spec.js` gets the `specPath` of `<path>.feature`, found beside `.features-gen`
(a per-project output folder in between is skipped). The scenario's title is the check's title (an outline's example
is `<outline>: Example #1`), feature tags are tags, `Given` / `When` / `Then` steps are timeline steps of that kind,
and the feature's name is the spec's title in `specs[]`. If your features are elsewhere, give `specPath`:

```ts
['@crvouga/atlas/playwright-reporter', { specPath: (test) => test.location.file.replace(/^.*\/generated\//, 'features/').replace(/\.spec\.js$/, '') }]
```

## Any other producer

`createReporter` streams checks as they finish, one layer per flush, to a server or any store
([streaming a run](server.md#streaming-a-run-as-it-happens)); `publishChecks` publishes one finished layer. Both take
the same check. Attachment bytes go in as `data` (a `Uint8Array`); read files yourself (only the command line reads a
`path`). Here is a check that carries everything:

```ts
import { readFile } from 'node:fs/promises';
import { createReporter } from '@crvouga/atlas/reports/reporter';
import { httpStore } from '@crvouga/atlas/reports/http-store';

const reporter = createReporter(
  {
    producer: 'e2e-web',
    environment: 'mobile-web',
    sha: process.env.GITHUB_SHA ?? null,
    branch: process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || null,
    runUrl: `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,
    // Names and groups each spec, so checks are grouped by spec without a published spec set.
    specs: [{ path: 'features/checkout/pay.feature', domain: 'checkout', kind: 'feature', title: 'Paying for an order' }]
  },
  { store: httpStore({ url: 'https://atlas.example.com', project: 'shop', token: process.env.ATLAS_TOKEN }) }
);

reporter.check({ id: 'features/checkout/pay.feature#Pays by card', title: 'Pays by card', status: 'running', specPath: 'features/checkout/pay.feature' });

reporter.check({
  id: 'features/checkout/pay.feature#Pays by card',
  title: 'Pays by card',
  status: 'passed',
  detail: 'Passed on retry 1 (flaky)',
  specPath: 'features/checkout/pay.feature',
  durationMs: 4180,
  tags: ['smoke', 'flaky'],
  labels: { browser: 'chromium', device: 'Pixel 7', os: 'linux', viewport: '412x839' },
  steps: [
    { id: 's1', name: 'Given a cart with one item', kind: 'given', status: 'passed', offsetMs: 0, durationMs: 900 },
    { id: 's2', name: 'When I pay by card', kind: 'when', status: 'passed', offsetMs: 900, durationMs: 2600 },
    { id: 's3', parentId: 's2', name: 'click #pay', kind: 'action', status: 'passed', offsetMs: 1200, durationMs: 80 },
    { id: 's4', name: 'Then I see the receipt', kind: 'then', status: 'passed', offsetMs: 3500, durationMs: 680 }
  ],
  attempts: [
    { index: 0, status: 'failed', durationMs: 30000, startedAtMs: Date.now() - 40000, detail: 'Timeout 30000ms exceeded',
      attachments: [{ name: 'retry-0.png', role: 'screenshot', contentType: 'image/png', data: await readFile('test-results/retry-0.png') }] },
    { index: 1, status: 'passed', durationMs: 4180, startedAtMs: Date.now() - 5000 }
  ],
  attachments: [
    { name: 'video.webm', role: 'video', contentType: 'video/webm', data: await readFile('test-results/video.webm') },
    { name: 'trace.zip', role: 'trace', contentType: 'application/zip', data: await readFile('test-results/trace.zip') }
  ]
});

const { checks, layers, lost } = await reporter.close(); // never throws; `lost` counts what never arrived
```

With `publishChecks`, pass the same identity and checks with `recordedAtMs`, once the run is over. From a checks file
or the command line, an attachment may name a `path` instead; `atlas report publish` reads it
([attach evidence](extending.md#attach-evidence)). A CTRF report already carries most of this, and
`atlas report publish --ctrf` keeps it ([native runner reporters](runners.md) cover CodeceptJS, Mocha, Jest and Node's
test runner).

## Run artifacts and direct links

Files attached to a run as a whole (top-level `attachments`: a review movie, a ZIP, an HTML gallery, a summary) are
shown under **Artifacts** when you open a run in the viewer's Runs tab, without opening any test. The movie plays
inline, an archive is a download, and each file keeps its name, role, type, size, duration and tags. They are grouped
by the layer that carries them, with who recorded it and when. A layer may hold no checks at all, only files: it is
listed with `No checks in this layer`, and a run of only such layers shows `No checks recorded`, never `0 passed`.

- **Direct link.** *Link to this file* gives an address that names the project, the run, one immutable layer and one
  attachment: `#/?tab=runs&openRun=<run key>&layer=<layer id>&artifact=<id:… | key:… | name:…>`. Opened in a fresh tab
  it selects that same file of that same layer, whatever runs arrived since. A link whose file is not in the layer says
  so instead of showing another file.
- **Shared recordings.** Tests that reference the same bytes (same SHA-256 or bundle key) are one recording. The run's
  *Recordings in tests* lists each once, with every test that references it, and a run-level file that a test also
  references says so.
- **Unplayable files.** A file with no stored bytes, with an address that is not a web address, in a type the viewer
  has no preview for, or that the browser cannot play, shows what is wrong and, when it can, a download.
- **Safety is unchanged.** Files are served only through the attachment route (never sniffed, sandboxed), and an HTML
  archive renders in an iframe with an empty `sandbox`: it cannot run script.
- **API.** `GET /api/reports/runs/detail` lists the run's `layers` (backend, check count, file count) and
  `GET /api/reports/evidence/detail/{backend}/{id}` returns what a layer carries as a whole (and, as `parts`, what its
  parts carry). Both only gained optional fields.

## Recording completeness

A green run does not say whether the videos you expected were kept and published. Atlas answers that separately from
the checks' outcomes. Mark a check with `recordingExpectation`: `"required"` (expect a video of it) or
`"not-applicable"` (an API-only or intentionally unrecorded check). A check with neither is not part of the answer.

```json
{ "id": "checkout#pays", "title": "Pays", "status": "passed", "recordingExpectation": "required",
  "attachments": [{ "name": "pays.webm", "role": "video", "path": "test-results/pays.webm" }] }
```

When any check carries an expectation, `publishChecks` and `atlas report publish` write a receipt into the layer
(`recordings`): counts of expected, uploaded, referenced (only a `uri`, which Atlas cannot vouch for), skipped and
unresolved recordings, and for each expected check its state, a reason when it is not uploaded, and the size and SHA-256
of every stored video. A video over the size limit, or a file that is missing or not allowed, is kept as an attachment
without bytes whose `omitted` says why (`too-large`, `not-found`, `not-allowed`, `over-budget`) instead of failing the
publish; it never contains a path or a token.

- `atlas report publish --format json` prints the receipt under `layer.recordings` and a summary under `recordings`.
  Add `--require-recordings` to exit 1 when an expected recording is skipped or unresolved. The layer and its test
  results are still written and are not changed; only the command fails, so a CI step can report the evidence gap and
  retry (publishing again reuses the stored files).
- `atlas report status --format json` has `recordings`: `state` is `complete`, `incomplete`, `none-expected` or
  `unknown`, with counts and each gap. It never changes `ok`. A layer without a receipt is `unknown`, never `complete`.
- The viewer shows `Recordings 2 of 3: incomplete` beside the run's origin, apart from its green or red outcomes.

This is a statement about publication. Atlas does not check that a stored video plays in a browser, and does not yet
re-check later that a stored file is still readable.
