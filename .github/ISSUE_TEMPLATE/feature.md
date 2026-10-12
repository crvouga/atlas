---
name: Missing feature
about: Atlas lacks an API, option, driver capability, CLI flag, schema field or visualizer view your project needs.
title: "[<part>] feature: <what is missing>"
labels: agent-reported, feature
---

<!-- Guide: docs/reporting-issues.md#3-features-describe-the-behavior.
     Describe what Atlas should do, not your project's source. Redact secrets. -->

## Version

- Package: `@crvouga/atlas@<exact installed version>`
- Part: <core | playwright | bun | webdriver | detox | vitest | schema | reports | visualizer>
- Runtime: Node <version> / Bun <version>, OS <os>
- Driver: <playwright@version | bun | webdriver + browser | detox | http | function | none>
- Checked that part's README and `docs/`: <yes, not covered | covered, and here is why it is not enough>

## What is missing

<!-- One or two sentences: what you are trying to specify, run or see, and where Atlas stops. -->

## Proposed surface

<!-- The API, config option, spec metadata, CLI flag or view as you would want to use it. -->

```ts
```

## Behaviors

<!-- Numbered Given / When / Then, each checkable by a test in this repository. Include the failures. -->

1. Given …, when …, then …

## Workaround

<!-- What your project does in the meantime, or "none: blocked". -->
