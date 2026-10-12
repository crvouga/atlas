---
name: Bug
about: Atlas crashes, gives a wrong result, contradicts its README or docs, or fails to install, build or type-check.
title: "[<part>] bug: <what breaks>"
labels: agent-reported, bug
---

<!-- Guide: docs/reporting-issues.md. Redact every key, token and secret; no proprietary specs or screenshots. -->

## Version

- Package: `@crvouga/atlas@<exact installed version>`
- Part: <core | playwright | bun | webdriver | detox | vitest | schema | reports | visualizer>
- Runtime: Bun <version> / Node <version>, <package manager and version>, OS <os>
- Driver: <playwright@version | bun | webdriver + browser | detox | http | function | none>

## What breaks

<!-- One or two sentences: what you did, what you expected (cite the README or doc that says so), what happened. -->

## Reproduction

<!-- The smallest spec, config and command that reproduce it from a clean install. Rename states
     and events so nothing identifies your product. -->

```yaml
# specs/<chart>.machine.yaml (or .scxml)
```

```ts
// atlas.config.ts
```

```sh
# the command you ran
```

## Output

```
error message, stack trace, lint finding, or the wrong part of the manifest
```

## Workaround

<!-- What your project does in the meantime, or "none: blocked". -->
