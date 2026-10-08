# @crvouga/atlas-schema

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

Regenerate the JSON Schemas after changing a Zod schema:

```sh
pnpm --filter @crvouga/atlas-schema schemas
```

Readers validate each record on its own and keep the ones that parse, so a newer or partly broken
manifest still renders what it can.
