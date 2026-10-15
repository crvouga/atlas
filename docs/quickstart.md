# Verify Atlas locally

Prove that the installed Atlas can publish, combine and gate evidence before connecting your project's real
suites. This walkthrough needs no server, token, browser, Docker, existing specs or changes to Atlas itself.
The checks below are synthetic plumbing checks, not evidence about your product.

First [install Atlas with your project's package manager](agents.md#install-in-the-consumer-project).
Run the following from your **consumer project's root** using a POSIX shell (macOS, Linux, or Windows with
WSL/Git Bash). `atlas` means the installed binary: substitute `bunx atlas`, `npm exec -- atlas`,
`pnpm exec atlas` or `yarn exec atlas` on each command. In a package script, `atlas` works directly.

## Publish one check, twice

Create a scratch directory. Keep this shell open for the rest of the walkthrough. Explicit `--store` flags
keep these synthetic checks local even if `ATLAS_STORE` points at a shared server.

<!-- smoke:begin -->
```sh
atlas_smoke=$(mktemp -d)
cat > "$atlas_smoke/pass.json" <<'JSON'
{"producer":"integration-smoke","environment":"local","recordedAtMs":1000,"checks":[{"id":"plumbing","title":"Atlas integration plumbing","status":"passed"}]}
JSON
atlas report publish --store "$atlas_smoke/store" --checks "$atlas_smoke/pass.json" --format json
atlas report status --store "$atlas_smoke/store" --require-environments local --format json
atlas report publish --store "$atlas_smoke/store" --checks "$atlas_smoke/pass.json" --format json
atlas report status --store "$atlas_smoke/store" --require-environments local --format json
```
<!-- smoke:end -->

Expected: each command exits `0`. Both status documents have `ok: true`, `checks.total: 1`,
`checks.passed: 1`, and `layers: 1`. Publishing identical evidence did not add a second layer.

## Prove a failure fails the gate

Publish the same check, from the same producer and environment, with a later time and a failure.
The shell captures the expected nonzero exit so this works under `set -e` too.

<!-- smoke:begin -->
```sh
cat > "$atlas_smoke/fail.json" <<'JSON'
{"producer":"integration-smoke","environment":"local","recordedAtMs":2000,"checks":[{"id":"plumbing","title":"Atlas integration plumbing","status":"failed","detail":"Intentional smoke failure"}]}
JSON
atlas report publish --store "$atlas_smoke/store" --checks "$atlas_smoke/fail.json" --format json
atlas_gate_exit=0
atlas report status --store "$atlas_smoke/store" --format json || atlas_gate_exit=$?
test "$atlas_gate_exit" -eq 1
```
<!-- smoke:end -->

Expected: publish exits `0` because the upload worked. Status exits `1`, with `ok: false`,
`checks.failed: 1` and the check in `failing`. The final `test` exits `0`, proving status returned exactly `1`.
An exit of `2` means a command error and does not satisfy this check.

## Prove a later fix replaces it

Keep the check's identity and publish a newer passing result. Do not delete the failing layer.

<!-- smoke:begin -->
```sh
atlas report publish --store "$atlas_smoke/store" --checks "$atlas_smoke/pass.json" --recorded-at 3000 --format json
atlas report status --store "$atlas_smoke/store" --require-environments local --format json
```
<!-- smoke:end -->

Expected: status exits `0`, with `ok: true`, `checks.total: 1`, `checks.passed: 1`, `checks.failed: 0`,
and `layers: 3`. Three historical layers contribute one current check.

The files are disposable; their location is in `$atlas_smoke`. No file was created in your project.
For automation, parse the JSON documents rather than console prose; the command schemas are listed in
[the agent guide](agents.md#what-an-agent-can-rely-on).

## Connect a real suite

Continue with [integrating Atlas](integrating.md#3-make-each-suite-publish-a-layer). Run a real suite,
publish its JUnit/CTRF file even when it fails, and inspect `status --format json`. A passing synthetic check
does not complete the integration: preserve your suite's original exit code and verify real evidence and CI
as described in [the completion checklist](integrating.md#7-done-when).

For a shared server, use [the server setup](server.md), select a stable `ATLAS_PROJECT` slug, and follow
[the agent workflow](agents.md#the-shortest-path). Statecharts and browser drivers are optional; importing
existing test reports needs neither.
