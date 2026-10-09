# @crvouga/atlas

Executable statecharts. Load charts in W3C SCXML or XState v5 machine config, compose child charts,
lint them, plan paths that cover every transition, run those paths against a real system through
any driver, and write a manifest with JUnit, CTRF, Mermaid and WebVTT alongside.

```sh
pnpm add -D @crvouga/atlas
```

Needs Node 22.18 or later.

## Use

```ts
// atlas.config.ts
import { defineConfig, functionDriver } from '@crvouga/atlas';

import { Door } from './door';

export default defineConfig<Door>({
  specs: './specs',
  driver: functionDriver(() => new Door()),
  implementation: {
    setup: async () => undefined,
    events: {
      Opens: { kind: 'user', how: 'door.open()', run: async (door) => door.open() },
      Closes: { kind: 'user', how: 'door.close()', run: async (door) => door.close() }
    },
    states: {
      Closed: { recognize: async (door) => ({ matched: !door.isOpen, signals: [] }) },
      Open: { recognize: async (door) => ({ matched: door.isOpen, signals: [] }) }
    }
  }
});
```

```sh
atlas lint --require-implementations
atlas plan
atlas run --mode fast
atlas export --specs ./specs --format mermaid
```

## API

| Export | Purpose |
| --- | --- |
| `defineConfig`, `prepare`, `runConfig` | Typed config; load + lint + plan; run and write reports |
| `loadSpecDirectory`, `parseChart`, `parseJourneys`, `bundleOf` | Read charts and journeys |
| `scxmlToMachine`, `machineToScxml`, `scxmlToken`, `ATLAS_NS` | SCXML ↔ XState config |
| `composeCharts` | Inline invoked child charts into one machine, with their hand-offs |
| `lintBundle` | Purity, reachability, dead ends, journeys, implementations |
| `chartScope`, `planChart`, `runnableSteps` | What a run covers and the paths that cover it |
| `ChartGraph` | A pure simulator: replay, explore, which transitions an event fires |
| `runPaths`, `functionDriver`, `Timeline` | The runner and the simplest driver |
| `httpDriver`, `httpClient` | An HTTP API client as a driver: base URL, cookie jar, every call on the timeline |
| `combineDrivers`, `combineImplementations`, `onClient` | Several clients in one run (a phone, a web dashboard, an API), each on its own driver |
| `recordFrames` | Clips encoded from screenshots, for drivers without a screen recorder |
| `cloudEventsHttpSource`, `cloudEventsFromHttp`, `logFileSource`, `compareBusinessEvents` | Business events |
| `DEFAULT_PRIVACY`, `mergePrivacy`, `privacyFindings`, `assertAllowedTarget` | Privacy rules |
| `toJUnit`, `toCtrf`, `toWebVtt`, `toMermaid` | Report formats |

`@crvouga/atlas/spec` exports the browser-safe part (types, parsing, SCXML conversion and
composition) with no Node built-ins.

`@crvouga/atlas/signals` exports the driver-neutral screen vocabulary: the signals (`testId`,
`role`, `label`, `text`, `css`), `SignalContext` (what the Playwright, Bun, WebDriver and Detox
contexts all provide), `screen` (a recogniser for any `SignalContext`), `signatureScreen` (build
`screen` for a new driver) and `DOM_PROBE` (resolve a signal inside a page).

Spec conventions, the driver interface, the config reference and the manifest are documented in the
[Atlas README](../../README.md).

## License

MIT
