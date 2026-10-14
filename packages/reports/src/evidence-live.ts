/**
 * @module Live evidence from running suites
 *
 * Shows results the moment each test finishes, before its package has been collected into an archived layer. A
 * running suite announces itself with a record under `active/` in the local store (see {@link LiveRunRecord});
 * this module reads the test reports that suite has written so far into a temporary layer (id `live-<source>`,
 * `live: true`) and drops it once the archived layer arrives or after a short linger. Live layers are a viewing
 * aid only (this module writes nothing), and an unreadable or half-written report is skipped, not guessed at.
 */
import type { Clock } from './clock';
import { eachLimited } from './completion-order';
import type { ActiveRun, LayerEvidence, LayerHeader } from './evidence-types';
import { environmentOf } from './evidence-view';
import { sourceId } from './keys';
import { normalizeEnvironment } from './layer-axes';
import { layerEvidence } from './layer-merge';
import type { LayerParameters, LayerSummary } from './layer-types';
import { readUtf8 } from './object-io';
import type { ObjectStore } from './object-store';
import type { SourceRecord } from './protocol';
import { SPEC_RUN_ID } from './publish';
import { testPrefix } from './recording-keys';
import type { RunReport, RunReportMeta } from './report-types';
import { sourcePart } from './source-part';
import { suiteStatus } from './status';

/** What a running spec suite announces under `active/` in the local store. */
export type LiveRunRecord = {
  /** The package directory the suite runs in, relative to the repository (`libs/chess`); with `bucket`, it names the source. */
  readonly packageDir: string;
  /** The suite's bucket within the package (`part-2`); where the run writes each finished test. */
  readonly bucket: string;
  /** When the run started, epoch milliseconds. A new value for the same source means a new run: tracking restarts. */
  readonly startedAtMs: number;
  /** How many checks the run expects to execute, when known. */
  readonly plannedChecks?: number;
  /** The client this suite is checking. A different client does not replace it. */
  readonly environment?: string;
  /** Other string choices that make the results their own slot; non-string or empty values are dropped on reading. */
  readonly parameters?: LayerParameters;
};

function readParameters(value: unknown): LayerParameters {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const parameters: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) if (typeof item === 'string' && item) parameters[key] = item;
  return parameters;
}

/**
 * Validates a parsed `active/` announcement and keeps only the fields the live layer can trust (the environment is
 * normalised to its slug, parameters are string-to-string). Null when `packageDir`, `bucket` or a numeric
 * `startedAtMs` is missing, so garbage in `active/` is ignored rather than shown.
 */
export function liveRunRecord(value: unknown): LiveRunRecord | null {
  if (!value || typeof value !== 'object') return null;
  const run = value as Partial<LiveRunRecord>;
  if (!run.packageDir || !run.bucket || typeof run.startedAtMs !== 'number') return null;
  const parameters = readParameters(run.parameters);
  const environment = typeof run.environment === 'string' ? normalizeEnvironment(run.environment) : null;
  return {
    packageDir: run.packageDir,
    bucket: run.bucket,
    startedAtMs: run.startedAtMs,
    ...(typeof run.plannedChecks === 'number' ? { plannedChecks: run.plannedChecks } : {}),
    ...(environment ? { environment } : {}),
    ...(Object.keys(parameters).length > 0 ? { parameters } : {}),
  };
}

/** How the host reaches the results a spec run has written so far. */
export type LiveSource = {
  /** The bucket the run writes each finished test into, or null when it cannot be read (the run is then not tracked). */
  readonly bucket: (run: LiveRunRecord) => ObjectStore | null;
  /** The checkout the runs execute: its commit and branch, stamped on every live layer. Asked once per refresh pass. */
  readonly origin?: () => Promise<{ readonly sha: string | null; readonly branch: string | null }>;
  /** The stylesheet the runs' snapshots render with (served as `frame.css`). */
  readonly frameCss?: () => Promise<string | null>;
};

/** A finished run stays visible this long while its layer is being collected. */
const LINGER_MS = 30_000;
const REPORT = '/report.json';

type Tracked = {
  readonly run: LiveRunRecord;
  readonly store: ObjectStore;
  readonly metas: Map<string, RunReportMeta>;
  evidence: LayerEvidence | null;
  goneAt: number | null;
};

/** The id of the temporary layer for a source: `live-<source>`. Not a content hash, unlike an archived layer's id. */
export function liveLayerId(source: string): string {
  return `live-${source}`;
}

function sourceOf(run: LiveRunRecord): string | null {
  try {
    return sourceId(run.packageDir, run.bucket);
  } catch {
    return null;
  }
}

/**
 * Creates the tracker of finished tests of runs that have not been collected into a layer yet, so a
 * result appears the moment its test ends instead of when its package does.
 *
 * The tracker is stateful and meant to live as long as the server: call `refresh` on each poll with the current
 * `active/` records and the newest archived layers. It returns the live layers (only those with at least one result)
 * and the runs still in progress with their completed and failed counts. A run that disappears is read one last
 * time and kept for 30 seconds, or until an archived (non-live) layer of the same producer and environment recorded
 * at or after its start appears. `find(id)` returns a live layer by `live-<source>` id, and `store(source)` the
 * bucket its files are read from. A bucket that is being replaced or a report still being written is skipped until
 * the next pass; `refresh` does not throw for those.
 *
 * @param args.live How the host reaches the buckets; without it nothing is tracked.
 * @param args.backend The backend id stamped on live layers.
 */
export function createLiveEvidence(args: { readonly live: LiveSource | undefined; readonly clock: Clock; readonly backend: string }) {
  const tracked = new Map<string, Tracked>();

  type Origin = { readonly sha: string | null; readonly branch: string | null };

  async function load(source: string, state: Tracked, origin: Origin): Promise<void> {
    const head = testPrefix(SPEC_RUN_ID, '');
    const keys = await state.store.listKeys(head);
    const fresh = keys.flatMap(key => {
      const id = key.endsWith(REPORT) ? key.slice(head.length, -REPORT.length) : '';
      return id && !id.includes('/') && !state.metas.has(id) ? [{ key, id }] : [];
    });
    await eachLimited(fresh, 16, async ({ key, id }) => {
      const text = await readUtf8(state.store, key);
      if (text === null) return;
      // A report still being written parses on a later pass.
      try {
        state.metas.set(id, (JSON.parse(text) as RunReport).meta);
      } catch {
        /* not complete yet */
      }
    });
    const tests = [...state.metas.values()].sort((a, b) => (a.testId < b.testId ? -1 : a.testId > b.testId ? 1 : 0));
    const environment = normalizeEnvironment(state.run.environment ?? state.run.parameters?.environment);
    const record: SourceRecord = { source, packageDir: state.run.packageDir, bucket: state.run.bucket, status: suiteStatus(tests), updatedAtMs: args.clock.now(), ...(environment ? { environment } : {}), ...(state.run.parameters ? { parameters: state.run.parameters } : {}), tests };
    const summary: LayerSummary = { id: liveLayerId(source), producer: source, recordedAtMs: record.updatedAtMs, sha: origin.sha, branch: origin.branch, runUrl: null, ...(environment ? { environment } : {}), parameters: state.run.parameters ?? {}, specs: [], parts: [sourcePart(origin.sha ?? '', record)], source: record, recording: null };
    const evidence = layerEvidence(summary, args.backend);
    const layer: LayerHeader = { ...evidence.layer, live: true, recording: { type: 'live', source }, execution: `live:${state.run.startedAtMs}:${tests.length}` };
    state.evidence = { ...evidence, layer };
  }

  return {
    /** Read what each running suite has finished. `collected` are the newest archived layers. */
    async refresh(runs: readonly LiveRunRecord[], collected: readonly LayerHeader[]): Promise<{ layers: LayerEvidence[]; active: ActiveRun[] }> {
      const now = args.clock.now();
      // One checkout runs every suite, so its revision is asked for once per pass.
      const origin: Origin = runs.length || tracked.size ? ((await args.live?.origin?.()) ?? { sha: null, branch: null }) : { sha: null, branch: null };
      const active: ActiveRun[] = [];
      const running = new Set<string>();
      for (const run of runs) {
        const source = sourceOf(run);
        if (source === null) continue;
        running.add(source);
        let state = tracked.get(source);
        if (!state || state.run.startedAtMs !== run.startedAtMs) {
          const store = args.live?.bucket(run) ?? null;
          state = store ? { run, store, metas: new Map(), evidence: null, goneAt: null } : undefined;
          if (state) tracked.set(source, state);
          else tracked.delete(source);
        }
        if (state) {
          state.goneAt = null;
          try {
            await load(source, state, origin);
          } catch {
            /* the bucket is being replaced; the next pass reads it */
          }
        }
        const counts = state?.evidence?.layer.counts;
        active.push({ source, ...run, completed: counts ? counts.passed + counts.failed + counts['not-run'] : 0, failed: counts?.failed ?? 0 });
      }
      for (const [source, state] of tracked) {
        if (running.has(source)) continue;
        if (state.goneAt === null) {
          state.goneAt = now;
          try {
            await load(source, state, origin);
          } catch {
            /* keep what was read while it ran */
          }
        }
        const declared = normalizeEnvironment(state.run.environment ?? state.run.parameters?.environment) ?? 'unspecified';
        // A collected layer of another client is a different result, so this suite stays up.
        const archived = collected.some(layer => layer.producer === source && !layer.live && layer.recordedAtMs >= state.run.startedAtMs && environmentOf(layer) === declared);
        if (archived || now - state.goneAt > LINGER_MS) tracked.delete(source);
      }
      const layers = [...tracked.values()].flatMap(state => (state.evidence?.rows.length ? [state.evidence] : []));
      return { layers, active };
    },
    find(id: string): LayerEvidence | null {
      for (const state of tracked.values()) if (state.evidence?.id === id) return state.evidence;
      return null;
    },
    store(source: string): ObjectStore | null {
      return tracked.get(source)?.store ?? null;
    },
  };
}
