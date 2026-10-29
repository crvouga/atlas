# Command line reference

> Generated from the usage text each command prints (`atlas <command> --help`) by `bun run docs`. Do not edit.

Add `--format json` (alias `--json`) to `init`, `report publish`, `stream`, `merge`, `doctor`, `status`, every `ui-catalog` command and `critic list`, `setup`, `doctor`, `run`, `watch`, `review` and `calibrate` for a JSON document on standard output (schemas in `@crvouga/atlas/schemas`). Exit codes: `0` it worked, `1` it ran and the answer is no, `2` the command was wrong.

## atlas

```text
atlas — executable statecharts

  atlas lint   [--config atlas.config.ts | --specs <dir>] [--require-implementations]
  atlas plan   [--config atlas.config.ts] [--state <name>]
  atlas run    [--config atlas.config.ts] [--mode fast|showcase] [--workers n] [--state <name>]
               [--seed <name>]... [--paths id,id] [--shard i/n] [--rerun-failed | --reuse <run-dir>]
               [--no-retry] [--output <dir>]
  atlas merge  [--config atlas.config.ts] [--output <dir>] <run-dir> <run-dir>...
  atlas export --specs <dir> --format scxml|mermaid|markdown|json [--out <file>]
  atlas server [--port 8080]                                     one Atlas node: API, projects and client; needs ATLAS_S3_* (atlas serve --help)
  atlas client build [--no-data] [--out <dir>]                    build the project-agnostic Atlas client
  atlas dev    [--port 5180]                                     develop the Atlas server and client on one host
  atlas init   [--server <url>] [--write]                         integrate this project: detect its suites, print the plan (atlas init --help)
  atlas report publish|stream|status|merge|doctor|policy …       layered evidence for any kind of spec (atlas report --help)
  atlas critic list|setup|doctor|run …                           automated reviewers that mark which UIs need polish (atlas critic --help)
  atlas ui-catalog plan|publish|status|diff|export …              the UI catalog of captured states (atlas ui-catalog --help)

  --workers       path attempts that run at once (default: one per CPU, capped by the driver)
  --seed          only paths that start from this seed ("start" for paths setup starts); repeatable
  --shard 2/4     run the second quarter of the plan; merge the shards' runs afterwards
  --rerun-failed  keep the newest run's passed paths and run only the rest
```

## atlas init

```text
atlas init — integrate a project with an Atlas server

  atlas init [--dir <project>] [--server <url>] [--write] [--verify] [--format json]

  Looks at the project (package manager, test runners, spec files, CI) and prints a plan: for each suite the command
  that runs it and the command that sends its results, a CI workflow, and an AGENTS.md section that tells the next
  agent how to use Atlas here. Nothing is changed until --write; running it again changes nothing more.

  --dir <path>     the project (default: the current directory)
  --server <url>   the Atlas server results go to (default: an http(s) store in ATLAS_STORE)
  --write          create or update the files of the plan (AGENTS.md between its atlas markers, .github/workflows/atlas.yml)
  --verify         ask the server who this token is and whether it may upload (token: ATLAS_TOKEN)
  --format json    print the plan as one JSON document (schema: init-plan.schema.json)

  Exit codes: 0 planned (and verified), 1 --verify failed, 2 the command was wrong.
```

## atlas serve

```text
atlas serve: the Atlas server

  atlas serve [--config atlas.server.json] [--port 8080] [--host 127.0.0.1] [--site <dir>]
              [--outline-branch <b>] [--branch <name>]... [--ignore-modified] [--refresh <seconds>]
              [--anonymous-read] [--insecure] [--no-log]

  One process serves the client and the API. Test results are uploaded to it from anywhere (laptops, CI) and it
  shows everyone the combined report, live.

  Storage is required. ALL reports and ALL user state (the garbage collection policy, saved settings) are kept in
  S3-compatible object storage and nowhere else; there is no local-disk, in-memory or database fallback. Without
  these environment variables the server prints every one of them with what is wrong, and exits with status 2:
    ATLAS_S3_ENDPOINT  ATLAS_S3_BUCKET  ATLAS_S3_REGION  ATLAS_S3_ACCESS_KEY_ID  ATLAS_S3_SECRET_ACCESS_KEY
  Optional: ATLAS_S3_PREFIX, ATLAS_S3_PATH_STYLE, ATLAS_S3_SESSION_TOKEN. See .env.example.

  Tokens (ATLAS_TOKEN admin, ATLAS_PUBLISH_TOKEN, ATLAS_READ_TOKEN, or "auth.tokens" in the config) are required
  to listen beyond this machine unless --insecure. Every option has an environment variable (docs/deploying.md).
```

## atlas dev

```text
atlas dev: the Atlas server and the client, for working on either

  atlas dev [--port 5180] [--host 127.0.0.1] [--config atlas.server.json]

  Starts the server (API only, on a port of its own) and the client's dev server, which proxies /api to it, so the
  browser talks to one host and a change to the client shows at once. In production `atlas serve` does both from
  one process. Storage is the same as for `atlas serve`: the required ATLAS_S3_* environment variables name the S3
  bucket that holds all reports and user state; without them it exits with status 2 and lists every variable.
```

## atlas report

```text
atlas report — layered evidence for any kind of spec

  atlas report publish [--store <dir|s3://bucket/prefix>] [--producer <name>]
                       ( --ctrf <file> | --junit <file> | --manifest <file> | --checks <file.json> )
                       [--environment <name>] [--branch <b>] [--sha <s>] [--run-url <u>]
                       [--run-id <id>] [--run-title <t>] [--run-started-at <iso|ms>] [--run-ended-at <iso|ms>]
                       [--spec <path> | --specs <dir>] [--upload-run]
                       [--param key=value]... [--kind <k>] [--title <t>] [--recorded-at <iso|ms>]
                       [--attach [role=]<file>]... [--label key=value]... [--link [name=]<url>]...
                       [--attach-root <dir>]... [--max-attachment-mb <n>] [--max-total-attachment-mb <n>]
                       [--require-recordings]
  atlas report stream  [--store <dir|s3://…|https://atlas.example.com>] --producer <name> [--environment <name>]
                       [--branch <b>] [--sha <s>] [--run-url <u>] [--kind <k>] [--param key=value]...
                       [--run-id <id>] [--run-title <t>]
                       [--flush-ms 1000] [--batch 100]       (checks as JSON lines on standard input)
  atlas report status  [--store <dir|s3://…|id=url>]... [--backends <module>]
                       [--specs <dir>] [--format text|json|markdown]
                       [--require-environments a,b] [--require-all-specs]
                       [--branch <name>]... [--ignore-modified]
  atlas report verify-recordings [--store <dir|s3://…|id=url>]... [--backends <module>] [--layer <id>]...
                       [--limit <n>] [--branch <name>]... [--ignore-modified] [--format text|json]
  atlas report merge   [--store …]... [--backends <module>] --into <dir|s3://…>
  atlas report doctor  [--store …]... [--role publisher|reader|both]
  atlas report policy  --store s3://bucket/prefix [--role publisher|reader|both]

  A store is a directory or s3://bucket/prefix (add ?region=…&endpoint=… for R2, MinIO and the
  rest). Select a project on an Atlas node with --project <slug> or ATLAS_PROJECT. This scopes specs, reports and recordings together.
  When no --store is given, ATLAS_STORE is used. Keys never go in the URL: set
  AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY, or sign in with `aws sso login`, or use a role.

  publish   Write one immutable layer: the checks of one producer, on one environment. Safe to repeat.
            --producer is required, unless the --checks file names one
            --spec <path>   every check in the report belongs to this spec (a report per feature file)
            --specs <dir>   link checks to the spec files in <dir> by path, or by the suite, class or
                            file name the report gives; also publishes the specs themselves, so the
                            node can show them without a checkout
            --run-id <id>   name this execution (a local or manual run with no CI run URL; also ATLAS_RUN_ID).
                            Layers that share an id are one run, however many shards or batches uploaded them;
                            another invocation at the same commit gets another id. Never part of what a check is
            --run-title <t> a human name for the run (also ATLAS_RUN_TITLE); --run-started-at and --run-ended-at
                            record when it ran. Without --run-id a run is its CI run URL, else branch@sha
            --upload-run    with --manifest: also upload the run's screenshots and clips for the viewer
            --attach <file>   attach a file to the whole layer: a CI log, a coverage report, a trace archive
                              (screenshots, videos and traces of a single test go in its CTRF or checks file)
            --label k=v       a fact about the run, not part of what it checks: build, os, browser
            --link [n=]<url>  a link to the run, a dashboard, an issue
            Files a report names (CTRF attachments, JUnit [[ATTACHMENT|path]] lines) come from the report's own
            folder and each --attach-root, and never from a hidden file or a link out: a report is data from a
            test run, not instructions. One that is missing or not allowed is skipped with a warning.
            --require-recordings   exit 1 when a check that declared recordingExpectation "required" has no
                              uploaded video (absent, left out as too large or not allowed, or refused). The layer is
                              still written and the checks keep their results; only this command fails. The receipt of
                              what was uploaded (counts, sizes, checksums) is in the JSON result under layer.recordings.
            From a checkout with uncommitted changes the layer is marked "modified".
  stream    Send checks as they finish: one JSON object per line on standard input (the fields of one
            check: id, title, status, and any evidence). Each second's worth becomes one layer, so a server
            shows the run while it is still going. A check sent again with the same id (running, then
            passed) is replaced by the later. Ends when the input does; exit 1 if anything could not be sent.
            Point it at an Atlas server with --store https://… and a token in ATLAS_TOKEN.
  status    Combine every layer of every store, and exit 1 unless the report passes.
            --specs <dir>          lay the results over these spec files (default: the specs in the store)
            --require-all-specs    fail while any spec has no results
            --branch <name>        only layers recorded on this branch (repeatable)
            --ignore-modified      leave out layers from modified checkouts and unknown origins
  verify-recordings   Read back the videos the layers published and check they are still there as published: the
            layer still lists the file, its blob is still stored, its size and SHA-256 are the recorded ones, and it
            begins like the container its media type names. Exit 1 when any video is missing, unreadable, corrupt or
            not that container, naming the layer and check; test results are never changed. This checks stored bytes,
            not playback in a browser. Videos given only by address are counted, not checked.
            --layer <id>   only the layer whose id starts with this (repeatable; at least 7 digits)
            --limit <n>    only the newest n layers
  merge     Copy the layers of several stores into one.
  doctor    Check that a store works: credentials, listing, writing, and what it holds.
  policy    Print the least-privilege IAM policy for publishers, readers, or both.

  --backends <module>  A TypeScript or JavaScript module whose default export is a list of
                       { id, label?, store } (or a function returning it): a device lab, anything
                       that implements ObjectStore.

  --format json (alias --json)   publish, stream, merge, doctor, status and verify-recordings print one JSON document instead of prose
                       (schemas: publish-result, stream-result, merge-result, doctor-result, report-status, verify-recordings-result). A command
                       that is wrong is {"ok":false,"error":{"message":…,"code":"usage"}} on standard error.
  A store may be an Atlas server (https://…): ATLAS_STORE=https://atlas.example.com, with ATLAS_TOKEN.

  Exit codes: 0 ok, 1 the report does not pass (or a check failed), 2 the command was wrong.
```

## atlas ui-catalog

```text
atlas ui-catalog — a browsable inventory of captured UI states, from any collector

  atlas ui-catalog plan    --states <file.json> --producer <name> [--store <dir|s3://bucket/prefix|https://…>]
                           [--environment <name>] [--param key=value]... [--shard <label>]
                           [--branch <b>] [--sha <s>] [--run-url <u>] [--run-id <id>] [--run-title <t>] [--recorded-at <iso|ms>]
  atlas ui-catalog publish --captures <file.json> --producer <name> [the same flags as plan]
                           [--attach-root <dir>]... [--max-picture-mb <n>]
  atlas ui-catalog status  [--store <dir|s3://…|id=url>]... [--backends <module>] [filters] [--branch <name>]...
                           [--ignore-modified] [--format text|json|markdown]
  atlas ui-catalog diff    --from <commit> --to <commit> [--store …]... [--backends <module>] [filters]
                           [--fail-on-change] [--format text|json|markdown]
  atlas ui-catalog export  --out <file.html> [--store …]... [--backends <module>] [filters]
                           [--images inline|none] [--max-mb <n>] [--manifest <file.json>] [--title <t>]
  atlas ui-catalog collect --catalog <atlas.catalog.ts> --exec "<command>" [--store https://…] [--shard <name>]
                           [--where dimension=value]... [--batch-size <n>] [--lease-seconds <n>]
                           [--max-units <n>] [--max-minutes <n>] [--collection <id>] [--stale-before <iso|ms>]
                           [--producer <name>] [--attach-root <dir>]... [--max-picture-mb <n>]

  filters (status, diff, export): --q <words> --coverage a,b --profile <key|label>... --area a --route r --cohort c
                           --flag f --surface s --producer p

  plan      Write one layer of kind ui-plan: the states (and with "inventory": true, the surfaces) that should exist under
            this profile. Every entry is not-run, so a plan never counts as a pass. The file is {"states":[{"id":…,
            "title"?,"route"?,"fixture"?,"cohort"?,"area"?,"kind"?,"flags"?,"covers"?,"inventory"?}]} or just that list.
  publish   Write one layer of kind ui-state: the states one collector or shard captured under this profile. The file is
            {"states":[{"id":…,"title"?,"status"?:"passed|failed|running|not-run","detail"?,"route"?,"fixture"?,"cohort"?,
            "area"?,"kind"?,"flags"?,"covers"?,"labels"?,"tags"?,"durationMs"?,"screenshot"?:"file.png"|{"path"|"uri",
            "width"?,"height"?,"contentType"?}}]}. A picture file is read from beside the file and each --attach-root, never
            from a hidden file or a link out. A passed state whose picture cannot be read is published as failed, with the
            reason: a state without its picture is not shown as captured.
            --environment and each --param key=value are the profile (a viewport, a color scheme, a device): another
            profile is another result side by side. --shard only describes the layer; it never splits a result.
            --recorded-at defaults to the modification time of the file, so publishing the same file twice is one layer.
  status    Read every store and print the catalog's summary. Exit 1 unless the catalog holds a state and there is nothing
            to attend to: a failed capture, a state a plan expects with nothing captured, a capture still in progress, a
            backend or layer that could not be read. Without a plan nothing is expected, so nothing is missing.
            --profile takes a profile's key or its label, as printed by status.
  diff      Set the catalog recorded at one commit (--from) against another (--to): each state in each profile is paired
            with itself and is unchanged, changed in coverage, changed in picture (the stored bytes differ), unverified (a
            side has no content hash), only in --to (added) or only in --from (removed). A commit is the whole id or at
            least 7 digits of it. Exit 0 unless a store could not be read, or, with --fail-on-change, anything differs.
  export    Write the catalog as one HTML file with its pictures embedded and its manifest in it: no server, no network.
            It is the catalog at the moment it was made. --images none leaves the pictures out. --max-mb (default 32) limits
            the embedded pictures; those past it are listed in the page as left out, and the manifest stays complete.
            --manifest writes the catalog's JSON manifest too.
  collect   Be one shard of a collection that any number of shards share through an Atlas server: publish the catalog's
            definition (the default export of --catalog, made with defineCatalog; the same definition is the same
            version), claim the most urgent work units (failed, then empty, then unknown, then stale), run --exec for each
            claim, publish its captures and claim again until nothing is left or a bound is reached. --exec runs in a shell
            with ATLAS_UI_BATCH (a JSON file: {"claimId","units",[…],"states":[{"item","id",…facts,"profile":{…}}]}) and
            ATLAS_UI_CAPTURES (where it writes {"states":[…]} as publish reads it, each state naming its "item"; pictures
            beside it). An item it wrote nothing for is failed. --where takes the project's own dimension names and
            values (repeatable; a dimension given twice takes either value); an unknown one is exit 2. --stale-before
            also collects captured items recorded before that time, oldest first. On SIGINT or SIGTERM the claim is
            released, so its units go back to the queue at once. Needs a server: there is no order other shards cannot
            see. Exit 0 when nothing collected failed, 1 when something did or the server could not be reached.

  --format json (alias --json)   every subcommand prints one JSON document instead of prose
                       (schemas: ui-catalog-publish-result, ui-catalog-status, ui-catalog-diff-result, ui-catalog-export-result,
                       ui-catalog-collect-result).
                       A command that is wrong is {"ok":false,"error":{"message":…,"code":"usage"}} on standard error.
  A store is a directory, s3://bucket/prefix or an Atlas server (https://…), exactly as for atlas report; select a project
  with --project <slug> or ATLAS_PROJECT. When no --store is given, ATLAS_STORE is used.

  Exit codes: 0 ok, 1 the answer is no (see each command), 2 the command was wrong.
```

## atlas critic

```text
atlas critic — automated reviewers of the UI catalog

  atlas critic list    [--config atlas.critics.json] [--format text|json]
  atlas critic setup   <name> [--config atlas.critics.json] [--format text|json]
  atlas critic doctor  [--server <url>] [--critic <name>]... [--config atlas.critics.json] [--format text|json]
  atlas critic run     --critic <name>... ( --all | --unjudged | --since <version> | filters ) [--server <url>]
                       [--area a,b] [--profile key] [--state screen,overlay] [--route r] [--q words]
                       [--dry-run] [--yes] [--non-interactive] [--force]
                       [--max-images n] [--max-tokens n] [--max-cost usd] [--concurrency n] [--timeout-ms n]
                       [--mode report|warn|gate] [--threshold state=score]... [--calibration file.json]
                       [--spool dir] [--project slug] [--config atlas.critics.json] [--format text|json]
  atlas critic watch   --critic <name>... [--server <url>] [--since <version>] [filters] [--yes] [--dry-run]
                       [--max-batches n] [--max-images n] [--max-tokens n] [--max-cost usd] [--concurrency n] [--timeout-ms n]
                       [--spool dir] [--project slug] [--config atlas.critics.json] [--format text|json]
  atlas critic review  [--server <url>] [--critic <name>] [--state kind] [--limit n] [--list] [--non-interactive]
                       [--entry <key> ( --accept | --dismiss ) [--finding <id>]... [--note text] [--reviewer name] [--dry-run]]
                       [--project slug] [--config atlas.critics.json] [--format text|json]
  atlas critic calibrate <name> ( --good <dir>... --bad <dir>... [--heldout-good <dir>...] [--heldout-bad <dir>...] [--state kind]
                       | --from-marks [--server <url>] [--critic-version v] ) [--out file.json] [--dry-run] [--yes]
                       [--max-images n] [--concurrency n] [--timeout-ms n] [--config atlas.critics.json] [--format text|json]

  A critic is a producer: it runs here (on a laptop, in CI or in a worker), reads the catalog from an Atlas server, and publishes
  what it thinks as layers of critiques. The server never runs a model and never holds a provider key. A critique is an opinion,
  not a test result: it never changes whether a report passes.

  Configuration is atlas.critics.json, which may be committed: it names credentials by reference (env:NAME, file:PATH) and a
  literal credential in it is refused. The server is --server, "server.url" there, ATLAS_SERVER_URL or an https ATLAS_STORE;
  the token is ATLAS_CRITIC_TOKEN (or ATLAS_TOKEN), never a flag, and is never sent over plain http beyond this machine.

  list      The critics available and configured: type, whether each is ready or needs setup, and where it sends images.
  setup     Provision a critic: fetch and verify a model checkpoint against its pinned SHA-256 (a bad checksum is an error), or
            check that a credential reference resolves. This is the only place anything is downloaded; judging never downloads.
  doctor    Check the server is reachable, the token is accepted and has the scope a critic needs (and warn when the server is
            open, so every caller is an administrator), that the server lists the catalog, and for each configured critic its
            model file, dependencies, credential and provider. Each problem is reported separately, with how to fix it.
  run       Judge the entries in the chosen scope. An entry that already has a current critique of the same critic, version,
            model, parameters and image is skipped without a call; a changed image is judged again. Failures are recorded
            with a reason code and retried by the next run. Critiques that cannot be sent (the server went away) are kept in
            the spool directory (default .atlas/critic-spool) and sent, byte for byte, by the next invocation.
            --dry-run        send and publish nothing: say how many entries would be judged or skipped, and where images would go
            --yes            allow sending images to a third party without asking (required without a terminal)
            --max-images n   stop cleanly after n images; --max-tokens and --max-cost likewise, from what critics report
            --mode           report (default): scores are shown and the exit code is 0; warn: also list scores below their threshold;
                             gate: exit 1 when a score is below its state kind's threshold, refused (exit 2) unless a calibration
                             with held-out evidence of this critic and version is given with --calibration

  watch     A worker: run in a loop over the catalog. It catches up on connecting, judges new or changed entries as they arrive (a picture
            already judged is skipped without a call), publishes as it goes, keeps what the server cannot take and sends it next time.
            It stops on Ctrl-C, after --max-batches batches, or when a budget (for the whole watch) is spent, and prints the version to
            resume from (--since). It reports; it never gates. --dry-run reads the catalog once and sends and publishes nothing.
  review    The ranked "needs polish" list of one critic (lowest first) with its findings and the marks already made. With a terminal it
            walks through the list and asks: accept (the opinion is right: the UI needs polish), dismiss (it is not), skip. With
            --entry and --accept or --dismiss it records one decision, for the whole opinion or for --finding ids. A mark is a layer
            under critic.review.<reviewer> (--reviewer, ATLAS_REVIEWER); it needs no more power than a critic token and never changes
            a result, a count or the gate.
  calibrate Judge labelled pictures (--good and --bad directories; a subdirectory's name is the state kind of the pictures in it) and/or
            read the whole-opinion marks reviewers made (--from-marks), and measure the critic per state kind: sample sizes, precision,
            recall, the threshold, and whether the figures are in-sample. --heldout-* pictures are never used to choose the threshold.
            --out writes the calibration that run --calibration reads. Nothing is published.

  --format json   prints one document (schemas: critic-list-result, critic-setup-result, critic-doctor-result, critic-run-result,
                  critic-watch-result, critic-review-result, critic-calibrate-result).
                  A command that is wrong is {"ok":false,"error":{"message":…,"code":"usage"}} on standard error.
  Exit codes: 0 ok, 1 the answer is no (a critic failed, a gate crossed, a problem found), 2 the command was wrong.
```
