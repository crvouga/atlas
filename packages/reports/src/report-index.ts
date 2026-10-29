/**
 * @module Incremental report index
 *
 * `ReportIndex` is the report, maintained as layers arrive. Each immutable layer is read once and folded into the winning
 * result of every slot it fills, then dropped unless it still holds a winner, so memory follows the number of checks and not
 * the age of the project. The winner rule is a total order, so folding is exact in any order and equals combining every layer
 * from scratch (a test proves it over random partial runs). It also keeps what each layer sends (rows, JSON, a digest) until
 * that layer changes, so taking in a result costs one layer, answers viewers a version hash, a cached JSON text and a delta,
 * and tells listeners what arrived.
 *
 * @see docs/report-contract.md
 * @see docs/server.md#performance
 */

import { createHash } from 'node:crypto';

import { eachLimited } from './completion-order';
import type { BackendInfo, LayerEvidence, LayerHeader } from './evidence-types';
import { LAYER_INDEX, layerSummary, readLayer } from './layer-store';
import { layerEvidence, layerResultKeys, replaces, type EvidenceResult } from './layer-merge';
import { readUtf8 } from './object-io';
import type { BackendInput } from './compose';
import type { ReportLayer } from './layer-types';
import { isPaged } from './object-store';
import type { SpecEntry } from './explorer-types';
import { TestHistory } from './test-catalog';

/** What a viewer needs to show the report, and nothing that is only history. */
export type EffectiveEvidence = {
  /** A hash of the report itself: the same on every replica, and different exactly when the report is. Use it as an ETag. */
  readonly version: string;
  /** Only layers that fill at least one slot, each with only the rows that win. */
  readonly layers: readonly LayerEvidence[];
  readonly backends: readonly BackendInfo[];
  readonly notices: readonly string[];
  /** Every layer read, superseded or not. */
  readonly totalLayers: number;
};

/** What changed, told to those who asked to know: the report's new version, and the layers that arrived. */
export type IndexChange = {
  readonly version: string;
  /** Layers read since the last change, newest first, whether or not they won anything. */
  readonly added: readonly LayerHeader[];
  readonly totalLayers: number;
};

/**
 * A layer that holds winners. What is sent about it (its winning rows, as an object, as JSON, and a digest of
 * both) is made when first asked for and dropped when a winner changes, so a change to one layer costs one layer.
 */
type Held = { evidence: LayerEvidence; wins: Set<string>; rev: number; entry: LayerEvidence | null; json: string | null; digest: string | null };
const RETRY_FAILED_MS = 5 * 60_000;
/** Versions a viewer may still be holding, remembered so it can be sent only what changed. */
const REMEMBERED_VERSIONS = 256;
const REMEMBERED_REMOVALS = 4096;

/**
 * The report, maintained as layers arrive. Each layer is read once and folded into the winning result
 * of every slot it fills, then dropped unless it still holds a winner. Because the winner rule is a
 * total order, folding is exact in any order, so this equals combining every layer from scratch, with
 * memory proportional to the number of checks and not to how long the project has existed.
 *
 * It reads only immutable layers (`layers/index/…`), which is what makes "read once" correct.
 */
export class ReportIndex {
  readonly #backends: readonly BackendInput[];
  readonly #concurrency: number;
  readonly #now: () => number;
  readonly #winners = new Map<string, EvidenceResult>();
  /** Every result of every test (bounded per test) and every run, for the test catalog. It never decides a winner. */
  readonly #history = new TestHistory();
  readonly #held = new Map<string, Held>();
  /** The smallest backend id a layer was found in, so attribution does not depend on read order. */
  readonly #attribution = new Map<string, string>();
  readonly #folded = new Set<string>();
  readonly #failed = new Map<string, { at: number; message: string }>();
  readonly #available = new Map<string, boolean>();
  /** Counts every change to what the report shows. A layer remembers the count at which it last changed. */
  #rev = 0;
  /** The counts at which versions were seen, oldest first. */
  readonly #versions = new Map<string, number>();
  /** Layers that stopped holding any winner, and when. Older removals are forgotten; `#forgotten` says how far. */
  #removed: { id: string; rev: number }[] = [];
  #forgotten = 0;
  /** Layers that were read, took part in the report, and no longer decide any result: all their checks were replaced by newer layers. */
  readonly #superseded = new Set<string>();
  #refreshing: Promise<boolean> | null = null;
  #timer: ReturnType<typeof setInterval> | null = null;
  #refreshedAt = 0;
  #cached: { key: string; value: EffectiveEvidence; json: string | null; held: Held[] } | null = null;

  readonly #include: (layer: LayerHeader) => boolean;
  readonly #fullListEvery: number;
  readonly #listeners = new Set<(change: IndexChange) => void>();
  #added: LayerHeader[] = [];
  #announced = '';
  #passes = 0;
  /** Layers handed over by an uploader, read one at a time in the order they came. */
  #accepting: Promise<void> = Promise.resolve();

  constructor(backends: readonly BackendInput[], options: { readonly concurrency?: number; readonly now?: () => number; /** Look at the whole catalog every this many refreshes; in between only its newest page. Default 30. */ readonly fullListEvery?: number; /** Leave layers out of the report, as a gate on `main` does. */ readonly include?: (layer: LayerHeader) => boolean } = {}) {
    this.#backends = backends;
    this.#include = options.include ?? (() => true);
    this.#fullListEvery = Math.max(1, options.fullListEvery ?? 30);
    this.#concurrency = options.concurrency ?? 64;
    this.#now = options.now ?? Date.now;
  }

  /** Read what is new in every backend and fold it in. Resolves true when the report changed. Calls overlap safely. */
  refresh(): Promise<boolean> {
    this.#refreshing ??= this.#refresh().finally(() => { this.#refreshing = null; });
    return this.#refreshing;
  }

  /**
   * A refresh that surely starts after this call: one already under way may have looked before whatever
   * made the caller ask. Used when something was just written.
   */
  async refreshNow(): Promise<boolean> {
    const running = this.#refreshing;
    const earlier = running ? await running.catch(() => false) : false;
    return (await this.refresh()) || earlier;
  }

  /**
   * Take in a layer an uploader has just written, from its catalog entry, without listing anything. Entries
   * are read one after another; one already known is ignored. The regular refresh still reconciles the rest.
   */
  accept(backendId: string, indexKey: string, known?: ReportLayer): Promise<void> {
    const backend = this.#backends.find(item => item.id === backendId);
    if (!backend) return Promise.resolve();
    this.#accepting = this.#accepting.then(async () => {
      const mark = `${backend.id}|${indexKey}`;
      if (this.#folded.has(mark)) return;
      await this.#load(backend, indexKey, known);
      this.#emit();
    }).catch(() => {});
    return this.#accepting;
  }

  /** Be told when the report changes. Returns how to stop. */
  onChange(listener: (change: IndexChange) => void): () => void {
    this.#listeners.add(listener);
    return () => { this.#listeners.delete(listener); };
  }

  #emit(): void {
    if (!this.#listeners.size && !this.#added.length) return;
    const { version, totalLayers } = this.snapshot();
    // Say it once per distinct report, and whenever layers arrived (they are news even if nothing they hold wins).
    if (version === this.#announced && !this.#added.length) return;
    this.#announced = version;
    const added = this.#added.sort((a, b) => b.recordedAtMs - a.recordedAtMs || (a.id < b.id ? -1 : 1));
    this.#added = [];
    for (const listener of this.#listeners) {
      try { listener({ version, added, totalLayers }); } catch { /* a listener that fails does not stop the others */ }
    }
  }

  /** Keep refreshing in the background. The first call returns once the first pass has finished. */
  async start(intervalMs: number): Promise<void> {
    await this.refresh();
    this.#timer = setInterval(() => { void this.refresh().catch(() => {}); }, intervalMs);
    (this.#timer as { unref?: () => void }).unref?.();
  }

/** Stops the background refresh started by `start`. Safe to call twice. */
  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }

/** True once a first pass over the backends has finished, so `snapshot` is a report and not an empty guess. */
  get ready(): boolean {
    return this.#refreshedAt > 0;
  }

  async #refresh(): Promise<boolean> {
    const before = this.#rev;
    // The whole catalog on the first pass and now and then; otherwise only its newest end, where new layers sort.
    const full = this.#passes++ % this.#fullListEvery === 0;
    // Each backend is listed and read on its own, so a slow or unreachable one never holds back the layers of the others: the
    // report fills in as each answers. Oldest first or newest first gives the same report; newest first shows recent work soonest.
    await Promise.all(this.#backends.map(async backend => {
      const fresh: string[] = [];
      try {
        const consider = (key: string) => { if (!this.#folded.has(`${backend.id}|${key}`) && !this.#recentlyFailed(`${backend.id}|${key}`)) fresh.push(key); };
        if (!full && isPaged(backend.store)) {
          // Newest first: pages of keys we already know mean nothing newer is behind them.
          for (let after: string | undefined; ;) {
            const page = await backend.store.listPage(LAYER_INDEX, { ...(after === undefined ? {} : { after }), limit: 1000 });
            let unknown = 0;
            for (const key of page.keys) { if (!this.#folded.has(`${backend.id}|${key}`)) unknown += 1; consider(key); }
            if (page.next === null || unknown < page.keys.length) break;
            after = page.next;
          }
        } else {
          for (const key of await backend.store.listKeys(LAYER_INDEX)) consider(key);
        }
        this.#available.set(backend.id, true);
        this.#failed.delete(`${backend.id}|`);
      } catch (error) {
        this.#available.set(backend.id, false);
        this.#failed.set(`${backend.id}|`, { at: this.#now(), message: `${backend.label ?? backend.id} is unavailable: ${error instanceof Error ? error.message : String(error)}` });
      }
      fresh.sort();
      await eachLimited(fresh, this.#concurrency, key => this.#load(backend, key));
      // This backend has answered (or been named unavailable): the report is a report, if a partial one, and viewers are told now, not when the slowest backend has answered.
      this.#refreshedAt ||= this.#now();
      this.#emit();
    }));
    this.#refreshedAt = this.#now();
    this.#emit();
    return this.#rev !== before;
  }

  async #load(backend: BackendInput, key: string, known?: ReportLayer): Promise<void> {
    const mark = `${backend.id}|${key}`;
    try {
      let layer: ReportLayer | null;
      let id: string | undefined;
      if (known && key.endsWith(`-${known.id}.json`)) {
        // The caller has just written and read this layer: its entry names it, so there is nothing to look up.
        id = known.id;
        layer = known;
      } else {
        const raw = await readUtf8(backend.store, key);
        id = raw ? (JSON.parse(raw) as { id?: string }).id : undefined;
        layer = id ? await readLayer(backend.store, id) : null;
      }
      if (!id || !layer) throw new Error('an indexed layer is missing');
      const summary = layerSummary(layer);
      this.#fold(layerEvidence(summary, backend.id), backend.id, summary.specs);
      this.#folded.add(mark);
      this.#failed.delete(mark);
      this.#refreshedAt ||= this.#now();
    } catch (error) {
      this.#failed.set(mark, { at: this.#now(), message: `${backend.label ?? backend.id}: a layer could not be read, so its outcome is unknown (${error instanceof Error ? error.message : String(error)})` });
    }
  }

  #recentlyFailed(mark: string): boolean {
    const failure = this.#failed.get(mark);
    return failure !== undefined && this.#now() - failure.at < RETRY_FAILED_MS;
  }

  #fold(evidence: LayerEvidence, backend: string, specs: readonly SpecEntry[] = []): void {
    const id = evidence.id;
    const known = this.#attribution.get(id);
    if (known !== undefined) {
      // The same immutable layer in another backend: one layer, attributed to the backend that sorts first.
      if (backend < known) { this.#attribution.set(id, backend); const held = this.#held.get(id); if (held) this.#touch(held); else this.#rev += 1; }
      return;
    }
    this.#attribution.set(id, backend);
    if (!this.#include(evidence.layer)) return;
    this.#added.push({ ...evidence.layer, backend });
    this.#history.add(evidence.layer, evidence.rows, specs, backend, evidence.fingerprints);
    const wins = new Set<string>();
    const keyOf = layerResultKeys(evidence.layer);
    for (const row of evidence.rows) {
      const key = keyOf(row);
      const result: EvidenceResult = { key, slot: '', layer: evidence.layer, row, parameters: evidence.layer.parameters, warning: null };
      const prior = this.#winners.get(key);
      if (prior && !replaces(result, prior)) continue;
      if (prior) this.#release(prior.layer.id, key);
      this.#winners.set(key, result);
      wins.add(key);
    }
    if (wins.size) {
      this.#held.set(id, { evidence, wins, rev: ++this.#rev, entry: null, json: null, digest: null });
    } else {
      this.#superseded.add(id);
    }
  }

  /** What this layer sends has changed. */
  #touch(held: Held): void {
    held.rev = ++this.#rev;
    held.entry = held.json = held.digest = null;
  }

  #release(layerId: string, key: string): void {
    const held = this.#held.get(layerId);
    if (!held) return;
    held.wins.delete(key);
    if (held.wins.size) { this.#touch(held); return; }
    this.#held.delete(layerId);
    this.#superseded.add(layerId);
    this.#removed.push({ id: layerId, rev: ++this.#rev });
    if (this.#removed.length > REMEMBERED_REMOVALS) this.#forgotten = this.#removed.splice(0, this.#removed.length - REMEMBERED_REMOVALS).at(-1)!.rev;
  }

  #entryOf(held: Held): LayerEvidence {
    if (!held.entry) {
      const id = held.evidence.id;
      const rows = [...held.wins].map(key => this.#winners.get(key)!.row);
      held.entry = { id, layer: { ...held.evidence.layer, backend: this.#attribution.get(id) ?? held.evidence.layer.backend }, rows, fingerprints: held.evidence.fingerprints };
    }
    return held.entry;
  }

  /** The current report, ready to send. Built once per change, and only the layers that changed are rebuilt. */
  snapshot(): EffectiveEvidence {
    return this.#current().value;
  }

  #current() {
    const backends = this.#backends.map(backend => ({ id: backend.id, label: backend.label ?? backend.id, live: false, available: this.#available.get(backend.id) ?? false })).sort((a, b) => (a.id < b.id ? -1 : 1));
    const notices = [...new Set([...this.#failed.values()].map(failure => failure.message))].sort();
    const key = [this.#rev, this.#folded.size, backends.map(item => (item.available ? 1 : 0)).join(''), notices.join('\n')].join('|');
    if (this.#cached?.key === key) return this.#cached;
    const held = [...this.#held.values()];
    held.sort((a, b) => b.evidence.layer.recordedAtMs - a.evidence.layer.recordedAtMs || (a.evidence.id < b.evidence.id ? -1 : a.evidence.id > b.evidence.id ? 1 : 0));
    const layers = held.map(item => this.#entryOf(item));
    // A layer's rows are fixed by its id and which of its slots it holds, so a digest of those says when the report differs.
    const hash = createHash('sha256');
    for (const item of held) {
      item.digest ??= `${item.evidence.id}|${this.#attribution.get(item.evidence.id) ?? ''}|${[...item.wins].join('\u0001')}`;
      hash.update(item.digest).update('\n');
    }
    hash.update(JSON.stringify([backends, notices, this.#attribution.size]));
    const version = hash.digest('hex').slice(0, 20);
    if (!this.#versions.has(version)) {
      this.#versions.set(version, this.#rev);
      if (this.#versions.size > REMEMBERED_VERSIONS) this.#versions.delete(this.#versions.keys().next().value!);
    }
    this.#cached = { key, value: { version, layers, backends, notices, totalLayers: this.#attribution.size }, json: null, held };
    return this.#cached;
  }

  /**
   * The report as JSON text: exactly what `JSON.stringify({ ...snapshot(), active: [] })` writes, put together from
   * the text of each layer, which is written once. `active` is what a store without live runs always sends: none.
   */
  json(): { readonly version: string; readonly text: string } {
    const current = this.#current();
    if (current.json === null) {
      const { value, held } = current;
      current.json = `{"version":${JSON.stringify(value.version)},"layers":[${held.map(item => (item.json ??= JSON.stringify(this.#entryOf(item)))).join(',')}],"backends":${JSON.stringify(value.backends)},"notices":${JSON.stringify(value.notices)},"totalLayers":${value.totalLayers},"active":[]}`;
    }
    return { version: current.value.version, text: current.json };
  }

  /**
   * What differs between the report a viewer holds (named by its version) and the current one: the layers that
   * changed in full, and the ids of those that no longer hold a winner. Null when that version is not remembered,
   * and the viewer should ask for the whole report. See `applyEffectiveDelta`.
   */
  delta(since: string): { readonly text: string; readonly version: string } | null {
    const current = this.#current();
    const base = this.#versions.get(since);
    if (base === undefined || base < this.#forgotten) return null;
    const changed = current.held.filter(item => item.rev > base);
    const gone = [...new Set(this.#removed.filter(item => item.rev > base && !this.#held.has(item.id)).map(item => item.id))];
    const { value } = current;
    return {
      version: value.version,
      text: `{"version":${JSON.stringify(value.version)},"base":${JSON.stringify(since)},"delta":true,"layers":[${changed.map(item => (item.json ??= JSON.stringify(this.#entryOf(item)))).join(',')}],"removed":${JSON.stringify(gone)},"backends":${JSON.stringify(value.backends)},"notices":${JSON.stringify(value.notices)},"totalLayers":${value.totalLayers},"active":[]}`
    };
  }

  /**
   * The ids of the layers that were added or changed (took a slot, or lost one) since the report a reader holds, named by
   * its version: what `delta` sends, without the text. `null` when that version is not remembered, and the reader should
   * take everything. Used to answer "what changed" about a view of the report, such as the entries of the UI catalog.
   */
  changedSince(since: string): ReadonlySet<string> | null {
    const current = this.#current();
    const base = this.#versions.get(since);
    if (base === undefined || base < this.#forgotten) return null;
    return new Set(current.held.filter(item => item.rev > base).map(item => item.evidence.id));
  }

  /**
   * Every recorded result of every test and every run, as layers were folded in: what the test catalog, a test's history
   * and the run list are built from. Read-only for callers; `history.rev` changes whenever a layer is taken in.
   */
  get history(): TestHistory {
    return this.#history;
  }

  /**
   * The ids of layers this index has read and that no longer decide any result. Removing one from its store cannot
   * change the report (every slot it filled is held by a newer layer), which is what makes it safe for garbage
   * collection to delete. A layer that failed to load, is hidden by `include`, or still holds a result is not here.
   */
  superseded(): ReadonlySet<string> {
    return this.#superseded;
  }

  /** For `/readyz` and logs. */
  stats() {
    return { backends: this.#backends.length, layers: this.#attribution.size, slots: this.#winners.size, holding: this.#held.size, failed: this.#failed.size, refreshedAt: this.#refreshedAt };
  }
}
