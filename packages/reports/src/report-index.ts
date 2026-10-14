import { createHash } from 'node:crypto';

import { eachLimited } from './completion-order';
import type { BackendInfo, LayerEvidence, LayerHeader } from './evidence-types';
import { LAYER_INDEX, layerSummary, readLayer } from './layer-store';
import { layerEvidence, layerResultKeys, replaces, type EvidenceResult } from './layer-merge';
import { readUtf8 } from './object-io';
import type { BackendInput } from './compose';
import { isPaged } from './object-store';

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

type Held = { evidence: LayerEvidence; wins: Set<string> };
const RETRY_FAILED_MS = 5 * 60_000;

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
  readonly #held = new Map<string, Held>();
  /** The smallest backend id a layer was found in, so attribution does not depend on read order. */
  readonly #attribution = new Map<string, string>();
  readonly #folded = new Set<string>();
  readonly #failed = new Map<string, { at: number; message: string }>();
  readonly #available = new Map<string, boolean>();
  #changes = 0;
  #refreshing: Promise<boolean> | null = null;
  #timer: ReturnType<typeof setInterval> | null = null;
  #refreshedAt = 0;
  #cached: { key: string; value: EffectiveEvidence } | null = null;

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
  accept(backendId: string, indexKey: string): Promise<void> {
    const backend = this.#backends.find(item => item.id === backendId);
    if (!backend) return Promise.resolve();
    this.#accepting = this.#accepting.then(async () => {
      const mark = `${backend.id}|${indexKey}`;
      if (this.#folded.has(mark)) return;
      await this.#load(backend, indexKey);
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

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }

  get ready(): boolean {
    return this.#refreshedAt > 0;
  }

  async #refresh(): Promise<boolean> {
    const before = this.#changes;
    const fresh: { backend: BackendInput; key: string }[] = [];
    // The whole catalog on the first pass and now and then; otherwise only its newest end, where new layers sort.
    const full = this.#passes++ % this.#fullListEvery === 0;
    await Promise.all(this.#backends.map(async backend => {
      try {
        const consider = (key: string) => { if (!this.#folded.has(`${backend.id}|${key}`) && !this.#recentlyFailed(`${backend.id}|${key}`)) fresh.push({ backend, key }); };
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
    }));
    // Oldest first or newest first gives the same report; newest first shows recent work soonest.
    fresh.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.backend.id < b.backend.id ? -1 : 1));
    await eachLimited(fresh, this.#concurrency, ({ backend, key }) => this.#load(backend, key));
    this.#refreshedAt = this.#now();
    this.#emit();
    return this.#changes !== before;
  }

  async #load(backend: BackendInput, key: string): Promise<void> {
    const mark = `${backend.id}|${key}`;
    try {
      const raw = await readUtf8(backend.store, key);
      const id = raw ? (JSON.parse(raw) as { id?: string }).id : undefined;
      const layer = id ? await readLayer(backend.store, id) : null;
      if (!id || !layer) throw new Error('an indexed layer is missing');
      this.#fold(layerEvidence(layerSummary(layer), backend.id), backend.id);
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

  #fold(evidence: LayerEvidence, backend: string): void {
    const id = evidence.id;
    const known = this.#attribution.get(id);
    if (known !== undefined) {
      // The same immutable layer in another backend: one layer, attributed to the backend that sorts first.
      if (backend < known) { this.#attribution.set(id, backend); this.#changes += 1; }
      return;
    }
    this.#attribution.set(id, backend);
    if (!this.#include(evidence.layer)) return;
    this.#added.push({ ...evidence.layer, backend });
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
      this.#held.set(id, { evidence, wins });
      this.#changes += 1;
    }
  }

  #release(layerId: string, key: string): void {
    const held = this.#held.get(layerId);
    if (!held) return;
    held.wins.delete(key);
    if (!held.wins.size) this.#held.delete(layerId);
  }

  /** The current report, ready to send. Built once per change, however often it is asked for. */
  snapshot(): EffectiveEvidence {
    const backends = this.#backends.map(backend => ({ id: backend.id, label: backend.label ?? backend.id, live: false, available: this.#available.get(backend.id) ?? false })).sort((a, b) => (a.id < b.id ? -1 : 1));
    const notices = [...new Set([...this.#failed.values()].map(failure => failure.message))].sort();
    const key = [this.#changes, this.#folded.size, backends.map(item => (item.available ? 1 : 0)).join(''), notices.join('\n')].join('|');
    if (this.#cached?.key === key) return this.#cached.value;
    const layers: LayerEvidence[] = [];
    for (const [id, held] of this.#held) {
      const rows = [...held.wins].map(key => this.#winners.get(key)!.row);
      const header: LayerHeader = { ...held.evidence.layer, backend: this.#attribution.get(id) ?? held.evidence.layer.backend };
      layers.push({ id, layer: header, rows, fingerprints: held.evidence.fingerprints });
    }
    layers.sort((a, b) => b.layer.recordedAtMs - a.layer.recordedAtMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    const version = createHash('sha256').update(JSON.stringify({ layers, backends, notices, totalLayers: this.#attribution.size })).digest('hex').slice(0, 20);
    const value: EffectiveEvidence = { version, layers, backends, notices, totalLayers: this.#attribution.size };
    this.#cached = { key, value };
    return value;
  }

  /** For `/readyz` and logs. */
  stats() {
    return { backends: this.#backends.length, layers: this.#attribution.size, slots: this.#winners.size, holding: this.#held.size, failed: this.#failed.size, refreshedAt: this.#refreshedAt };
  }
}
