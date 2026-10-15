# Reporting issues

How people and coding agents in a project that uses Atlas report a bug or a missing feature. Issues
are the only way a project changes Atlas: maintainers and agents in this repository pick them up,
fix them here, and the fix reaches you as a new version ([dogfooding.md](dogfooding.md)).

This guide is written for coding agents. Read it top to bottom once, then use
[Quick reference](#quick-reference) as the checklist every time you file.

## Quick reference

| You found | Kind | Title | Template |
| --- | --- | --- | --- |
| Atlas crashes, gives a wrong result, contradicts its README or docs, or does not install, build or type-check | `bug` | `[<part>] bug: <what breaks>` | [bug.md][t-bug] |
| Atlas lacks an API, option, driver capability, CLI flag, schema field or visualizer view you need | `feature` | `[<part>] feature: <what is missing>` | [feature.md][t-feature] |

`<part>` is the part of `@crvouga/atlas` the issue is about: `core` (the main import and the
`atlas` command), or the import path after the package name: `playwright`, `bun`, `webdriver`,
`detox`, `vitest`, `schema`, `reports`; `visualizer` for the `atlas client` command. Use `core`
when you cannot tell.

1. [Search for an existing issue](#1-search-first). Comment on it instead of opening a duplicate.
2. [Leave out](#never-include) secrets, personal data and anything that identifies your product.
3. Copy the kind's template, fill in every section, and save it to a file.
4. File it:

   ```sh
   gh issue create --repo crvouga/atlas \
     --title "[core] bug: plan skips a transition guarded by a parallel region" \
     --label agent-reported,bug \
     --body-file issue.md
   ```

5. Give your human the issue URL, and note the workaround you are using next to the code it is in.

File one issue per bug or missing feature, so each can be fixed, tested and closed on its own. The
title prefix alone is enough: a workflow applies the `agent-reported` and kind labels from it,
including when your account cannot set labels.

## When to file, and when not to

File when:

- **bug**: Atlas throws or hangs; lint, plan or a run gives a result the spec does not support;
  a driver taps, types, waits or records differently from what its README says; the manifest or a
  report does not match its JSON Schema; the Atlas client shows something other than what the run
  recorded; the package fails to install, import, build or type-check.
- **feature**: you need something Atlas does not have: a spec construct, a config option, a driver
  capability, a CLI flag, a field in the manifest, a view in the Atlas client, an export format. Check
  that part's README and `docs/` first.

Do not file when:

- The cause is your own spec, implementation or configuration: a recogniser that matches the wrong
  screen, a missing `implementation`, state left over from an earlier run. `atlas lint` findings
  about your charts are Atlas working.
- You are on an old version. Upgrade (`bun update @crvouga/atlas --latest`) and try again first.
- You only suspect a problem. Reproduce it, and say what you ran and what happened.

Never fix Atlas from your project instead of filing: no edits to `node_modules`, no patch, no fork.

## Never include

Issues are public. Before you file, remove:

- API keys, tokens, passwords, cookies and signed URLs. Replace each with `<redacted>`.
- Real personal data. Use obviously fake values (`jane@example.com`).
- Your product: its name, real screen and event names, screenshots, clips and run manifests, and
  your project's source. Rename states and events (`Screen A`, `Submits the form`) and reduce the
  spec until it shows only the problem.

When you cannot show the problem without something on this list, stop and ask your human.

## 1. Search first

```sh
gh issue list --repo crvouga/atlas --state all --search "<part> <what breaks or is missing> in:title,body"
```

If an open issue covers the same thing, add a comment with your evidence (versions, reproduction,
the behavior you need) instead of opening a duplicate. A 👍 on a `feature` issue also counts as
demand. If a closed issue covers it, check that you are on the version its release comment names,
or a later one, before you reopen it.

## 2. Bugs: reduce to a reproduction

A bug report is ready when someone can reproduce it from a clean install without your project.

- **Versions.** The exact installed version (`bun pm ls`, or your package manager's equivalent), Bun
  or Node, the driver and its browser or device.
- **The smallest spec.** One chart with only the states and transitions that show the problem.
  `atlas lint --specs <dir>` needs no config and no implementation; say so when that alone
  reproduces it.
- **The smallest config and command.** `atlas.config.ts` with a `functionDriver` or `httpDriver`
  when the bug is not about a browser; the exact command line.
- **Expected and actual.** Quote the README or doc sentence Atlas contradicts. Paste the error and
  stack trace, the lint finding, or the wrong part of the manifest, not the whole file.
- **Workaround.** What your project does in the meantime, or that you are blocked.

## 3. Features: describe the behavior

Describe what Atlas should do, not how your project is built.

- **What is missing.** What you are trying to specify, run or see, and where Atlas stops.
- **Proposed surface.** The option, API, spec metadata, CLI flag or view as you would want to use
  it. A short code block is better than a paragraph.
- **Behaviors.** Numbered Given / When / Then statements, each one checkable by a test in this
  repository, covering the failures as well as the happy path:

  ```text
  B1. Given a chart with a `<parallel>` state, when I run `atlas plan --state Sync`, then only
      paths that enter the Sync region are planned.
  B2. Given `--state` names a state that does not exist, then the command exits 1 and names the
      states it could have been.
  ```

- **Out of scope.** What you do not need, so the feature stays small.

A feature with a clear surface and concrete behaviors is ready to build. One that only names a goal
waits, labelled `needs-info`, until someone supplies them.

## 4. File the issue

Copy the template for the kind, fill in every section, delete the HTML comments, and save it to a
file. Then run:

```sh
gh issue create --repo crvouga/atlas \
  --title "<title in the format from the quick reference>" \
  --label agent-reported,<kind> \
  --body-file issue.md
```

| Kind | Template (raw, for copying) |
| --- | --- |
| `bug` | <https://raw.githubusercontent.com/crvouga/atlas/main/.github/ISSUE_TEMPLATE/bug.md> |
| `feature` | <https://raw.githubusercontent.com/crvouga/atlas/main/.github/ISSUE_TEMPLATE/feature.md> |

Each template begins with a `---` front-matter block; leave it out of the body file.

If `gh` is not installed or not authenticated, do not install it or log in on your own. Give your
human the finished title and body and the link to the matching form, for example
<https://github.com/crvouga/atlas/issues/new?template=bug.md>.

## What happens next

Maintainers and agents in this repository work the `agent-reported` queue.

- **bug**: they reproduce it, add a failing regression test, fix it, and merge a change that closes
  the issue. If Atlas behaves as documented, they comment with what they observed and close it.
- **feature**: they settle the surface with you in the comments if it is not clear, then ship it
  with a test for each behavior you listed.

An issue labelled `needs-info` is waiting on you: answer the question in the comments.

Merging the fix publishes it. The release then comments on the issue with the exact version that
carries it. Upgrade (`bun update @crvouga/atlas --latest`) and remove your workaround.

[t-bug]: https://github.com/crvouga/atlas/blob/main/.github/ISSUE_TEMPLATE/bug.md
[t-feature]: https://github.com/crvouga/atlas/blob/main/.github/ISSUE_TEMPLATE/feature.md
