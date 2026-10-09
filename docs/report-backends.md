# Report backends and live snapshots

Atlas maps the product's areas, screens, events and journeys from a spec, then overlays evidence
of what the product did. Specs and reports are independent. Local development, CI, device labs
and hosted runners can supply reports to the same product atlas simultaneously. The viewer works
before the first report exists.

## Connect sources

The default source is the directory passed to `--runs`. Add sources with a JSON file:

```json
{
  "schemaVersion": 1,
  "sources": [
    { "id": "mobile", "label": "Mobile runs", "type": "directory", "runs": "./mobile-runs" },
    { "id": "ci", "label": "CI reports", "type": "http", "baseUrl": "https://reports.example.com/atlas-data/" },
    { "id": "runner", "label": "Hosted runner", "type": "api", "baseUrl": "https://runner.example.com/atlas/", "eventsUrl": "events", "pollMs": 10000 }
  ]
}
```

```sh
atlas-visualizer dev --specs ./specs --runs ./atlas-runs --sources ./atlas.sources.json
atlas-visualizer build --specs ./specs --runs ./atlas-runs --sources ./atlas.sources.json --out ./atlas-site
atlas-visualizer publish-data --specs ./specs --runs ./atlas-runs --sources ./atlas.sources.json --out ./atlas-data
```

Directory paths resolve against the configuration file. Source ids are unique, stable names
containing letters, numbers, underscores or hyphens. `workspace` is reserved for `--runs`.
`ATLAS_SOURCES_FILE` is the environment equivalent. Restart dev after changing the file.
Credentials must not appear in this file or URLs: descriptors are sent to the browser and
included in static output.

Sources can also be added, enabled or disabled in the Sources page. Those preferences are saved
in this browser; shared configuration remains authoritative. Remote services must allow requests
from the viewer's origin. For private services, use an authenticated same-origin gateway. Atlas
does not download private GitHub artifacts or sign object-storage requests itself: expose their
published data over HTTP or implement a gateway using the contract below.

## Transport contracts

| Backend | Index | Snapshot | Media and other reports | Updates |
| --- | --- | --- | --- | --- |
| Directory | Generated from run directories | `<run>/manifest.json` | Files beside the manifest | File watcher and polling fallback |
| HTTP files | `runs/index.json` | `runs/<id>/manifest.json` | `runs/<id>/<path>` | Polling; optional server events |
| HTTP API | `runs` | `runs/<id>/manifest` | `runs/<id>/files/<path>` | Polling; optional server events |

Locations are relative to `baseUrl`. The index follows the Atlas runs-index contract:

```json
{
  "runs": [{
    "id": "build-123",
    "startedAt": "2026-10-09T11:59:00Z",
    "progress": "running",
    "hasManifest": true,
    "execution": {
      "totalPaths": 8,
      "completedPaths": 2,
      "activePaths": ["journey-3"],
      "updatedAt": "2026-10-09T12:00:00Z"
    }
  }]
}
```

Each manifest is a full snapshot of everything received so far, rather than a patch or unfinished
JSON document. Records can be absent; malformed records are reported individually. Set
`run.finishedAt` to `null` while running, then a timestamp when complete. Its absence preserves
the meaning of older completed reports. Optional `run.progress` has the same shape as `execution`
above. Paths can declare `progress: queued | running | complete`.

Unvisited `not-reached` records appear pending during an active run. Passed and failed records
appear immediately. A PNG can arrive before its optional WebP thumbnail. Promised media can
declare `screenshotState: processing` or `clip.state: processing` until ready.

The runner publishes an initial snapshot, each reached screen and completed step, each completed
path and run completion. File replacements are atomic. Active outcomes stay out of
`outcomes.json`, so merging and rerunning reuse only completed paths. Results retain deterministic
plan order across workers.

## Server events

An optional `eventsUrl`, relative to `baseUrl`, serves `text/event-stream`. Send ordinary messages
or named `atlas:change` events:

```text
event: atlas:change
id: 124
data: {"scope":"runs","runIds":["build-123"]}

```

These invalidate the source's index and named snapshots. Empty `runIds` refreshes cached snapshots
for this source. Reconnection does the same to recover missed updates. Malformed notices are
ignored. Polling remains available if a stream disconnects or EventSource is unavailable.

Configured source indexes poll every ten seconds by default (`pollMs` overrides this); selected
running snapshots poll every two seconds. `VITE_ATLAS_POLL_MS` controls spec polling. Pause live
updates to keep a snapshot steady; manual Refresh still works. Resuming refreshes immediately.

## Identity, failures and publishing

Viewer identities combine source ids and native run ids. Cache keys include the backend location
and transport. Matching run names cannot mix results or media. Shared links retain the qualified
identity; old links containing only a run id still resolve to workspace reports.

One unavailable source leaves other sources and the spec usable. Failed refreshes retain the
last valid index and snapshot, with the failure recorded in data issues. A missing first snapshot
is a waiting state for a running report. Latest follows the newest report, including active runs;
choosing a particular report keeps it selected as newer reports arrive.

Publishing includes privacy-checked running snapshots and finished runs. Extra directory sources
are copied under `data/backends/<id>/`; `sources.json` uses relative URLs. Remote descriptors stay
remote. Missing or failed privacy checks exclude the run, and temporary files and work directories
are excluded. `--keep` applies per directory source. Publish updated data to the same host while
a run is active for static viewers to receive its snapshots through polling.

`VITE_ATLAS_BASE_URL` sets the primary spec/data location; `VITE_ATLAS_SOURCES_URL` can point to a
descriptor file hosted elsewhere. Published descriptors translate directory sources into HTTP
URLs and never expose the directory paths.

## Another transport

`src/data/adapters/report-backend.ts` defines `ReportBackend`: stable identity and cache key,
report listing, snapshot loading, media resolution and optional change subscription. The query
layer consumes this separately from the spec adapter. An embedded viewer can supply a backend
through `ReportSourcesContext`; a new built-in transport can add a factory alongside
`createReportBackend`. Screens, maps and journeys require no transport-specific code.

The generated JSON Schemas include `report-sources`, `atlas-change`, `run-info` and `run-summary`
alongside the existing manifest and record schemas.
