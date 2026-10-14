# @crvouga/atlas/schema

The Atlas contract, as Zod schemas and as JSON Schema (draft 2020-12) documents in `schemas/`:

| Schema | Describes |
| --- | --- |
| `state-node.schema.json` | One state of an XState machine config, with the `meta` fields Atlas reads |
| `journeys.schema.json` | `journeys.yaml`: named event sequences through a chart |
| `atlas.schema.json` | `atlas.yaml`: the optional product map (contexts, hand-offs, exclusions) |
| `manifest.schema.json` | `manifest.json`: one run, its states, transitions, paths and coverage |
| `state-record.schema.json`, `transition-record.schema.json`, `path-record.schema.json` | Records inside a manifest |
| `timeline-entry.schema.json` | One step of a clip's timeline (taps, typing, system events) |
| `cloud-event.schema.json` | A CloudEvents 1.0 business event a run observed |
| `runs-index.schema.json` | `runs/index.json`: the runs a host serves |
| `layer.schema.json` | A layer: the checks one producer ran on one environment. The unit of evidence for specs of any kind |
| `publish-checks.schema.json` | The input of `publishChecks` and `atlas report publish --checks` |
| `report-status.schema.json` | The output of `atlas report status --format json` |

Regenerate the JSON Schemas after changing a Zod schema:

```sh
bun run schemas
```

## Stability

The layer contract is versioned by `schemaVersion` (currently 1). Within a version, changes only add
optional fields, and readers ignore fields they do not know. The closed vocabularies (`status`,
`freshness`) change only with a new major version, and a reader refuses a layer of a newer major
version by name instead of guessing. `packages/reports/tests/fixtures/layer-v1.json` must keep
parsing, and a test keeps these files equal to what the Zod schemas emit. The full policy is in
[the report contract](../../docs/report-contract.md#versioning-and-stability).

Readers validate each record on its own and keep the ones that parse, so a newer or partly broken
manifest still renders what it can.
