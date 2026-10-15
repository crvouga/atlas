# Command line reference

> Generated from the usage text each command prints (`atlas <command> --help`) by `bun run docs`. Do not edit.

Add `--format json` (alias `--json`) to `init`, `report publish`, `stream`, `merge`, `doctor` and `status` for a JSON document on standard output (schemas in `@crvouga/atlas/schemas`). Exit codes: `0` it worked, `1` it ran and the answer is no, `2` the command was wrong.

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
  atlas server [--data <dir>] [--port 8080] [--store <url>]...   one Atlas node: API, projects and client
  atlas client build [--no-data] [--out <dir>]                    build the project-agnostic Atlas client
  atlas dev    [--port 5180]                                     develop the Atlas server and client on one host
  atlas init   [--server <url>] [--write]                         integrate this project: detect its suites, print the plan (atlas init --help)
  atlas report publish|stream|status|merge|doctor|policy …       layered evidence for any kind of spec (atlas report --help)

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

  atlas serve [--config atlas.server.json] [--data <dir>] [--port 8080] [--host 127.0.0.1]
              [--store <url|id=url>]... [--write <id>] [--site <dir>]
              [--outline-branch <b>] [--branch <name>]... [--ignore-modified] [--refresh <seconds>]
              [--anonymous-read] [--insecure] [--no-log]

  One process serves the client and the API. Test results are uploaded to it from anywhere (laptops, CI) and it
  shows everyone the combined report, live. It keeps its data in --data (default ./atlas-data) and can read more
  backends (--store): S3, other servers, folders. Uploads go to the data folder unless --write names another.

  Tokens (ATLAS_TOKEN admin, ATLAS_PUBLISH_TOKEN, ATLAS_READ_TOKEN, or "auth.tokens" in the config) are required
  to listen beyond this machine unless --insecure. Every option has an environment variable (docs/deploying.md).
```

## atlas dev

```text
atlas dev: the Atlas server and the client, for working on either

  atlas dev [--port 5180] [--host 127.0.0.1] [--data <dir>] [--store <url|id=url>]... [--config atlas.server.json]

  Starts the server (API only, on a port of its own) and the client's dev server, which proxies /api to it, so the
  browser talks to one host and a change to the client shows at once. In production `atlas serve` does both from
  one process.
```

## atlas report

```text
atlas report — layered evidence for any kind of spec

  atlas report publish [--store <dir|s3://bucket/prefix>] [--producer <name>]
                       ( --ctrf <file> | --junit <file> | --manifest <file> | --checks <file.json> )
                       [--environment <name>] [--branch <b>] [--sha <s>] [--run-url <u>]
                       [--spec <path> | --specs <dir>] [--upload-run]
                       [--param key=value]... [--kind <k>] [--title <t>] [--recorded-at <iso|ms>]
                       [--attach [role=]<file>]... [--label key=value]... [--link [name=]<url>]...
                       [--attach-root <dir>]... [--max-attachment-mb <n>] [--max-total-attachment-mb <n>]
  atlas report stream  [--store <dir|s3://…|https://atlas.example.com>] --producer <name> [--environment <name>]
                       [--branch <b>] [--sha <s>] [--run-url <u>] [--kind <k>] [--param key=value]...
                       [--flush-ms 1000] [--batch 100]       (checks as JSON lines on standard input)
  atlas report status  [--store <dir|s3://…|id=url>]... [--backends <module>]
                       [--specs <dir>] [--format text|json|markdown]
                       [--require-environments a,b] [--require-all-specs]
                       [--branch <name>]... [--ignore-modified]
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
            --upload-run    with --manifest: also upload the run's screenshots and clips for the viewer
            --attach <file>   attach a file to the whole layer: a CI log, a coverage report, a trace archive
                              (screenshots, videos and traces of a single test go in its CTRF or checks file)
            --label k=v       a fact about the run, not part of what it checks: build, os, browser
            --link [n=]<url>  a link to the run, a dashboard, an issue
            Files a report names (CTRF attachments, JUnit [[ATTACHMENT|path]] lines) come from the report's own
            folder and each --attach-root, and never from a hidden file or a link out: a report is data from a
            test run, not instructions. One that is missing or not allowed is skipped with a warning.
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
  merge     Copy the layers of several stores into one.
  doctor    Check that a store works: credentials, listing, writing, and what it holds.
  policy    Print the least-privilege IAM policy for publishers, readers, or both.

  --backends <module>  A TypeScript or JavaScript module whose default export is a list of
                       { id, label?, store } (or a function returning it): a device lab, anything
                       that implements ObjectStore.

  --format json (alias --json)   publish, stream, merge, doctor and status print one JSON document instead of prose
                       (schemas: publish-result, stream-result, merge-result, doctor-result, report-status). A command
                       that is wrong is {"ok":false,"error":{"message":…,"code":"usage"}} on standard error.
  A store may be an Atlas server (https://…): ATLAS_STORE=https://atlas.example.com, with ATLAS_TOKEN.

  Exit codes: 0 ok, 1 the report does not pass (or a check failed), 2 the command was wrong.
```
