/**
 * @module UI catalog comparison
 *
 * What changed in the UI catalog between two commits, or between two profiles, without claiming more than the evidence
 * supports. Pure functions of {@link UiCatalog} documents (and of the layers they came from), safe in a browser; nothing here
 * changes a status, a slot or a winner.
 *
 * - **Two commits.** The catalog of a commit is the catalog of the layers recorded at that commit ({@link uiCatalogAtCommit}).
 *   A state is paired with itself in the same profile. A layer replaces the older one of its slot, so the effective report no
 *   longer holds an earlier commit's captures: compare from the layers themselves ({@link readBackendLayers}), which keep them.
 * - **Two profiles.** Within one catalog, each state's cell in one profile is set beside its cell in another
 *   ({@link diffUiProfiles}): desktop against mobile, light against dark.
 * - **Pictures are compared by content.** Two captures have the same picture when their stored bytes have the same SHA-256.
 *   A different hash means different bytes, which is not a measure of how different the pixels are. When a side has no
 *   content hash (a picture given only by address, or left out), whether it changed is `unverified`, never "unchanged".
 * - **A state only one side has** is `added` or `removed`. It may be new or renamed, or the other side's shard may not have
 *   run, and the comparison cannot tell which: it is not called a regression.
 * - **A capture that did not pass is not a picture.** A cell that failed, is being taken or was skipped on a side is a change of
 *   `coverage`, never compared by picture.
 *
 * @see docs/ui-catalog.md
 */
import type { LayerEvidence } from './evidence-types';
import { uiCatalog, type UiCatalog, type UiCatalogOptions, type UiCell, type UiImage, type UiProfile } from './ui-catalog';

/** The `schemaVersion` of the comparison document. */
export const UI_DIFF_VERSION = 1;

/**
 * How one pair of cells stands. `added`: only the after side has the cell. `removed`: only the before side has it.
 * `coverage`: both have it and it stands differently (captured against failed, for example). `picture`: both captured and
 * the bytes differ. `unverified`: both captured, but a side has no content hash, so whether the picture changed is unknown.
 * `unchanged`: the same coverage and, when captured, the same bytes.
 */
export type UiCellChange = 'added' | 'removed' | 'coverage' | 'picture' | 'unverified' | 'unchanged';

/** The values of {@link UiCellChange}, in the order a review reads them. */
export const UI_CELL_CHANGES = ['coverage', 'picture', 'unverified', 'added', 'removed', 'unchanged'] as const;

/** One state in one profile on each side. */
export type UiDiffEntry = {
  /** The state's id. */
  readonly id: string;
  /** Its title, from the after side when it has the state. */
  readonly title: string;
  /** The profile both sides are in (a comparison of commits), or null when the two sides are different profiles. */
  readonly profile: UiProfile | null;
  readonly before: UiCell | null;
  readonly after: UiCell | null;
  readonly change: UiCellChange;
};

/** A comparison, as `atlas ui-catalog diff --format json` prints it and the viewer shows it. */
export type UiCatalogDiff = {
  readonly schemaVersion: typeof UI_DIFF_VERSION;
  /** How many entries are in each {@link UiCellChange}. */
  readonly summary: Readonly<Record<UiCellChange, number>> & { readonly total: number };
  /** Every pair, ordered by state id and then profile label. */
  readonly entries: readonly UiDiffEntry[];
};

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const SHA256 = /^[0-9a-f]{64}$/;

/**
 * What identifies a picture's content: its recorded SHA-256, else the hash in a content-addressed bundle key
 * (`attachments/<sha256>`), else `null`. A picture given only by address, or left out, has no identity here: its content is
 * not Atlas's to vouch for.
 */
export function pictureIdentity(image: UiImage | null | undefined): string | null {
  if (!image || image.omitted) return null;
  const hash = image.sha256?.toLowerCase();
  if (hash && SHA256.test(hash)) return hash;
  const keyed = /^attachments\/([0-9a-fA-F]{64})$/.exec(image.bundleKey ?? '')?.[1];
  return keyed ? keyed.toLowerCase() : null;
}

function changeOf(before: UiCell | null, after: UiCell | null): UiCellChange {
  if (!before) return 'added';
  if (!after) return 'removed';
  if (before.coverage !== after.coverage) return 'coverage';
  if (before.coverage !== 'captured') return 'unchanged';
  const a = pictureIdentity(before.capture?.image), b = pictureIdentity(after.capture?.image);
  if (a === null || b === null) return 'unverified';
  return a === b ? 'unchanged' : 'picture';
}

function summarize(entries: readonly UiDiffEntry[]): UiCatalogDiff['summary'] {
  const counts: Record<UiCellChange, number> = { coverage: 0, picture: 0, unverified: 0, added: 0, removed: 0, unchanged: 0 };
  for (const entry of entries) counts[entry.change] += 1;
  return { ...counts, total: entries.length };
}

function ordered(entries: UiDiffEntry[]): UiCatalogDiff {
  entries.sort((a, b) => compare(a.id, b.id) || compare(a.profile?.label ?? '', b.profile?.label ?? '') || compare(a.before?.profile.label ?? '', b.before?.profile.label ?? ''));
  return { schemaVersion: UI_DIFF_VERSION, summary: summarize(entries), entries };
}

/**
 * Sets the catalog of an earlier commit (`before`) against a later one (`after`): each state in each profile is paired with
 * itself. A cell that is only a plan (`missing`) on one side is a change of coverage like any other. The order of the
 * states in either catalog does not matter.
 */
export function diffUiCatalogs(before: UiCatalog, after: UiCatalog): UiCatalogDiff {
  const cells = (catalog: UiCatalog) => new Map(catalog.states.flatMap(state => state.cells.map(cell => [`${state.id}\u0000${cell.profile.key}`, { state, cell }] as const)));
  const left = cells(before), right = cells(after);
  const entries: UiDiffEntry[] = [];
  for (const key of new Set([...left.keys(), ...right.keys()])) {
    const a = left.get(key), b = right.get(key);
    const first = (b ?? a)!;
    entries.push({ id: first.state.id, title: first.state.title, profile: first.cell.profile, before: a?.cell ?? null, after: b?.cell ?? null, change: changeOf(a?.cell ?? null, b?.cell ?? null) });
  }
  return ordered(entries);
}

/**
 * Sets one profile of a catalog (`from`, a {@link UiProfile.key}) against another (`to`): each state's cell in `from` beside its
 * cell in `to`. A state that has a cell in only one of them is `added` or `removed`. Throws when the two are the same profile,
 * because that compares a catalog with itself.
 */
export function diffUiProfiles(catalog: UiCatalog, from: string, to: string): UiCatalogDiff {
  if (from === to) throw new Error('diffUiProfiles: choose two different profiles');
  const entries: UiDiffEntry[] = [];
  for (const state of catalog.states) {
    const a = state.cells.find(cell => cell.profile.key === from) ?? null;
    const b = state.cells.find(cell => cell.profile.key === to) ?? null;
    if (!a && !b) continue;
    entries.push({ id: state.id, title: state.title, profile: null, before: a, after: b, change: changeOf(a, b) });
  }
  return ordered(entries);
}

/** The entries of a comparison that changed, or all of them. A change the comparison cannot verify is a change worth looking at, so it is kept. */
export function changedUiEntries(diff: UiCatalogDiff): readonly UiDiffEntry[] {
  return diff.entries.filter(entry => entry.change !== 'unchanged');
}

/** A commit that has layers of the catalog's producers. */
export type UiCommit = {
  readonly sha: string;
  /** The branch of the newest layer recorded at the commit, or null. */
  readonly branch: string | null;
  /** When the newest layer at the commit was recorded, epoch milliseconds. */
  readonly recordedAtMs: number;
  /** How many layers were recorded at the commit. */
  readonly layers: number;
};

/**
 * The commits layers were recorded at, newest first. A layer with no commit is left out: it cannot be compared by commit.
 * Layers recorded from a checkout with uncommitted changes (`freshness` `modified`) are not the commit's own result and are
 * left out too, as the gate does by default for comparisons.
 */
export function uiCatalogCommits(layers: readonly Pick<LayerEvidence['layer'], 'sha' | 'branch' | 'recordedAtMs' | 'freshness'>[]): UiCommit[] {
  const commits = new Map<string, { sha: string; branch: string | null; recordedAtMs: number; layers: number }>();
  for (const layer of layers) {
    if (!layer.sha || layer.freshness === 'modified') continue;
    const held = commits.get(layer.sha);
    if (!held) commits.set(layer.sha, { sha: layer.sha, branch: layer.branch, recordedAtMs: layer.recordedAtMs, layers: 1 });
    else {
      held.layers += 1;
      if (layer.recordedAtMs > held.recordedAtMs) { held.recordedAtMs = layer.recordedAtMs; held.branch = layer.branch; }
    }
  }
  return [...commits.values()].sort((a, b) => b.recordedAtMs - a.recordedAtMs || compare(a.sha, b.sha));
}

/**
 * The layers recorded at one commit (`sha` is the whole commit id, or a prefix of at least 7 hexadecimal digits that names
 * exactly one commit among `layers`). Throws when a prefix names none, or more than one, so a comparison never silently uses
 * the wrong commit.
 */
export function layersAtCommit(layers: readonly LayerEvidence[], sha: string): LayerEvidence[] {
  const wanted = sha.toLowerCase();
  if (!/^[0-9a-f]{7,64}$/.test(wanted)) throw new Error(`"${sha}" is not a commit: give at least 7 hexadecimal digits of its id`);
  const shas = new Set(layers.flatMap(entry => (entry.layer.sha && entry.layer.freshness !== 'modified' && entry.layer.sha.toLowerCase().startsWith(wanted) ? [entry.layer.sha.toLowerCase()] : [])));
  if (shas.size === 0) throw new Error(`No layer was recorded at commit ${sha}`);
  if (shas.size > 1) throw new Error(`"${sha}" names more than one commit (${[...shas].map(name => name.slice(0, 12)).join(', ')}): give more digits`);
  const [only] = shas;
  return layers.filter(entry => entry.layer.sha?.toLowerCase() === only && entry.layer.freshness !== 'modified');
}

/**
 * The UI catalog as it was recorded at one commit: only the layers recorded there take part. A state the commit's layers do
 * not hold is absent, not failed. See {@link layersAtCommit} for how `sha` is matched.
 */
export function uiCatalogAtCommit(layers: readonly LayerEvidence[], sha: string, options: UiCatalogOptions = {}): UiCatalog {
  return uiCatalog(layersAtCommit(layers, sha), options);
}
