# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Assumption from the Atlas README and report terminology: developers and product teams investigating how an application behaved in a recorded test run.

## Product Purpose

Assumption from the Atlas README and report features: Atlas maps product behavior from specifications and recorded runs, so teams can understand what the app did and inspect the evidence behind outcomes.

## Positioning

Assumption from the Atlas README: Atlas combines current specifications with accumulated run evidence, preserving useful outcomes and their origins across versions rather than presenting only the newest run.

## Operating Context

Assumption from the Atlas docs: people browse specifications, compare accumulated results, inspect a recorded test timeline, and review screenshots, observations, actions, and provenance while investigating behavior.

## Capabilities and Constraints

- The report explorer combines evidence from multiple report layers and retains each result's origin and parameters.
- A recorded test can include steps, captured moments, screenshots, observations, actions, performance data, and model traces.
- A freshness qualification must preserve the recorded outcome and must not imply that a test was rerun.
- User direction for this work: keep the general layout, make the interface simpler and extensible, improve test-run readability, and avoid labeling evidence as partially outdated too readily.
- Assumption from the repository: the interface should remain usable with partial or missing report data and on narrow screens.

## Evidence on Hand

Atlas README, report API documentation, and the report features under `specs/developer-tools/`. No user testimonials, market claims, or performance benchmarks were provided.

## Product Principles

- Make recorded evidence easy to inspect.
- Keep the origin and context of each result visible.
- Preserve evidence when newer runs or app changes arrive.
- State uncertainty precisely without changing the recorded outcome.

