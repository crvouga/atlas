/**
 * @module UI catalog failure groups
 *
 * A large population of failed catalog cells is usually a few causes repeated. `uiCatalogFailureGroups` groups the failed
 * cells of a catalog (already narrowed to the scope a person looks at: a definition, filters, a profile) in one pass:
 *
 * - by the **fingerprint the producer supplied** on the capture, the `fingerprint` label (and per producer, so two
 *   collectors' words never merge). Cells with different fingerprints stay apart however alike their messages read.
 * - otherwise by the **exact message** after whitespace is collapsed and volatile or secret parts are redacted. Such a
 *   group is marked `inferred`: the cells only read the same, which never proves a shared cause.
 *
 * Each group has its count, the phase and attempts when the producer said (`phase` and `attempts` labels), the affected
 * states and profiles (each a cell a viewer can link to), first and last occurrence and one redacted sample. A document says
 * whether it is complete: a backend or layer that could not be read, a definition scope that is unavailable, captures still
 * in progress or a page of a catalog are named, so the visible groups are never taken for all the failures.
 *
 * Nothing here changes a result: the groups describe failed cells and decide nothing about them.
 *
 * @see docs/ui-catalog.md#grouping-failures
 */
import type { UiCatalog, UiCatalogScope } from './ui-catalog';

/** The `schemaVersion` of the failure groups document. */
export const UI_FAILURES_VERSION = 1;

/** The capture labels a producer sets to describe a failure: its fingerprint, the phase it failed in, and how many attempts it took. All optional. */
export const UI_FAILURE_LABELS = { fingerprint: 'fingerprint', phase: 'phase', attempts: 'attempts' } as const;

/** One affected cell of a group: a state in a profile, with where its failed capture came from. */
export type UiFailureCell = {
  readonly state: string;
  readonly title: string;
  /** The profile key (`UiProfile.key`): with `state`, the cell to link to. */
  readonly profile: string;
  readonly profileLabel: string;
  readonly recordedAtMs: number;
  readonly producer: string;
  readonly layer: string;
  readonly backend: string;
  readonly phase: string | null;
  readonly attempts: number | null;
};

/** Cells that failed the same way. */
export type UiFailureGroup = {
  /** Stable within a document: `fingerprint:<producer>:<fingerprint>` or `message:<normalized message>`. */
  readonly key: string;
  /** `fingerprint`: the producer said these share a fingerprint. `message`: only the normalized messages are equal. */
  readonly basis: 'fingerprint' | 'message';
  /** True for a message group: the grouping is inferred from text and does not show a shared cause. */
  readonly inferred: boolean;
  readonly fingerprint: string | null;
  readonly producers: readonly string[];
  /** Failed cells in the group. */
  readonly count: number;
  /** Distinct states and profiles affected. */
  readonly states: number;
  readonly profiles: number;
  /** The phases the producer named, in name order; empty when none did. */
  readonly phases: readonly string[];
  /** The fewest and most attempts the producer reported, or null when none did. */
  readonly attempts: { readonly min: number; readonly max: number } | null;
  readonly firstRecordedAtMs: number;
  readonly lastRecordedAtMs: number;
  /** The newest failure's message, redacted ({@link redactFailureMessage}). */
  readonly sample: string;
  /** The affected cells, newest first, at most `maxCells`; `count` is all of them. */
  readonly cells: readonly UiFailureCell[];
};

/** The failure groups of a catalog. */
export type UiCatalogFailures = {
  readonly schemaVersion: typeof UI_FAILURES_VERSION;
  readonly version?: string;
  /** The catalog's scope, when it had one. */
  readonly scope?: UiCatalogScope;
  readonly total: {
    /** Failed cells in the catalog given. */
    readonly failed: number;
    readonly groups: number;
    /** Failed cells grouped by a producer's fingerprint, and by message only. */
    readonly fingerprinted: number;
    readonly inferred: number;
  };
  /** False when something may hide failures: then `incomplete` says what, and the totals are a lower bound. */
  readonly complete: boolean;
  readonly incomplete: readonly string[];
  /** Largest first. */
  readonly groups: readonly UiFailureGroup[];
};

/** How failures are grouped and how much of each group is listed. */
export type UiFailureOptions = {
  /** Most cells listed per group (default 200); `count` is always the whole group. */
  readonly maxCells?: number;
  /** Most groups listed (default all); `total.groups` is all of them. */
  readonly maxGroups?: number;
};

const MAX_SAMPLE = 500;

/**
 * A failure message with what should not be copied into a summary taken out: the query and fragment of a URL and any user
 * and password in it, the value after a word like `token`, `secret`, `password` or `authorization`, `Bearer` credentials,
 * long hex or base64 runs, and the directories of an absolute path (its last part is kept). Whitespace is collapsed and the
 * text is cut at 500 characters. Conservative: it may leave something sensitive in a message it does not recognize, so a
 * producer should not put secrets in a failure detail in the first place.
 */
export function redactFailureMessage(message: string): string {
  let text = message.replace(/\s+/g, ' ').trim();
  text = text.replace(/\b(https?|wss?|ftp):\/\/[^\s"'<>()]+/gi, url => {
    const cut = url.search(/[?#]/);
    const kept = (cut >= 0 ? url.slice(0, cut) : url).replace(/^([a-z]+:\/\/)[^/@\s]*@/i, '$1');
    return cut >= 0 ? `${kept}?[redacted]` : kept;
  });
  text = text.replace(/\bbearer\s+[\w.~+/=-]+/gi, 'Bearer [redacted]');
  text = text.replace(/\b(token|secret|password|passwd|api[_-]?key|authorization|cookie|session)(["']?\s*[:=]\s*["']?)(?!bearer\b|\[redacted\])[^\s"',;&]+/gi, '$1$2[redacted]');
  text = text.replace(/\b(?:[a-f0-9]{32,}|[A-Za-z0-9+/_-]{40,}={0,2})\b/g, '[redacted]');
  text = text.replace(/(?<![\w:/.~-])(?:[A-Za-z]:\\(?:[^\\\s"']+\\)+|\/(?:[^/\s"':]+\/)+)([^/\\\s"':]+)/g, '…/$1');
  return text.length > MAX_SAMPLE ? `${text.slice(0, MAX_SAMPLE - 1)}…` : text;
}

type Building = {
  key: string; basis: 'fingerprint' | 'message'; fingerprint: string | null; producers: Set<string>; states: Set<string>; profiles: Set<string>;
  phases: Set<string>; min: number; max: number; first: number; last: number; sample: string; sampleAt: number; cells: UiFailureCell[]; count: number;
};

const attemptsOf = (text: string | undefined): number | null => {
  if (text === undefined || !/^\d+$/.test(text.trim())) return null;
  const number = Number(text.trim());
  return Number.isSafeInteger(number) ? number : null;
};

/**
 * The failed cells of `catalog` grouped by producer-supplied fingerprint, else by exact normalized message (marked
 * `inferred`). One pass over the cells; groups are sorted by count, then key. Give it the catalog as the person sees it
 * (scoped with `scopeUiCatalog`, narrowed with `filterUiCatalog`) and its groups and drilldowns are exactly that scope.
 *
 * @example
 * ```ts
 * const failures = uiCatalogFailureGroups(filterUiCatalog(scopeUiCatalog(whole, selection), query));
 * failures.groups[0]; // { basis: 'fingerprint', count: 40, cells: [{ state, profile, … }], … }
 * ```
 */
export function uiCatalogFailureGroups(catalog: UiCatalog & { readonly total?: number }, options: UiFailureOptions = {}): UiCatalogFailures {
  const maxCells = Math.max(0, options.maxCells ?? 200);
  const groups = new Map<string, Building>();
  let failed = 0, fingerprinted = 0, capturing = 0;
  for (const state of catalog.states) for (const cell of state.cells) {
    if (cell.coverage === 'capturing') capturing += 1;
    if (cell.coverage !== 'failed' || !cell.capture) continue;
    failed += 1;
    const capture = cell.capture;
    const labels = capture.labels ?? {};
    const fingerprint = labels[UI_FAILURE_LABELS.fingerprint]?.trim() || null;
    const message = redactFailureMessage(capture.detail ?? '');
    const key = fingerprint ? `fingerprint:${capture.origin.producer}:${fingerprint}` : `message:${message}`;
    if (fingerprint) fingerprinted += 1;
    const phase = labels[UI_FAILURE_LABELS.phase]?.trim() || null;
    const attempts = attemptsOf(labels[UI_FAILURE_LABELS.attempts]);
    const at = capture.origin.recordedAtMs;
    let group = groups.get(key);
    if (!group) {
      groups.set(key, group = {
        key, basis: fingerprint ? 'fingerprint' : 'message', fingerprint, producers: new Set(), states: new Set(), profiles: new Set(), phases: new Set(),
        min: Infinity, max: -Infinity, first: at, last: at, sample: message, sampleAt: at, cells: [], count: 0
      });
    }
    group.count += 1;
    group.producers.add(capture.origin.producer);
    group.states.add(state.id);
    group.profiles.add(cell.profile.key);
    if (phase) group.phases.add(phase);
    if (attempts !== null) { group.min = Math.min(group.min, attempts); group.max = Math.max(group.max, attempts); }
    if (at < group.first) group.first = at;
    if (at > group.last) group.last = at;
    if (at > group.sampleAt) { group.sample = message; group.sampleAt = at; }
    group.cells.push({
      state: state.id, title: state.title, profile: cell.profile.key, profileLabel: cell.profile.label, recordedAtMs: at,
      producer: capture.origin.producer, layer: capture.origin.layer, backend: capture.origin.backend, phase, attempts
    });
  }
  const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  const sorted = [...groups.values()].sort((a, b) => b.count - a.count || compare(a.key, b.key));
  const listed: UiFailureGroup[] = sorted.slice(0, options.maxGroups ?? sorted.length).map(group => ({
    key: group.key, basis: group.basis, inferred: group.basis === 'message', fingerprint: group.fingerprint,
    producers: [...group.producers].sort(compare), count: group.count, states: group.states.size, profiles: group.profiles.size,
    phases: [...group.phases].sort(compare), attempts: Number.isFinite(group.min) ? { min: group.min, max: group.max } : null,
    firstRecordedAtMs: group.first, lastRecordedAtMs: group.last, sample: group.sample,
    cells: group.cells.sort((a, b) => b.recordedAtMs - a.recordedAtMs || compare(a.state, b.state) || compare(a.profile, b.profile)).slice(0, maxCells)
  }));

  const incomplete: string[] = [];
  for (const backend of catalog.sources.backends) if (!backend.available) incomplete.push(`${backend.label} could not be read: failures held there are not counted.`);
  for (const notice of catalog.sources.notices) incomplete.push(notice);
  if (catalog.scope?.status === 'unavailable') incomplete.push('The definition scope is unavailable, so no failure is counted for it.');
  if (capturing > 0) incomplete.push(`${capturing} cell${capturing === 1 ? ' is' : 's are'} still being captured and may yet fail.`);
  if (catalog.total !== undefined && catalog.total > catalog.states.length) incomplete.push(`Only ${catalog.states.length} of ${catalog.total} states were given (a page): failures in the others are not counted.`);
  return {
    schemaVersion: UI_FAILURES_VERSION,
    ...(catalog.version ? { version: catalog.version } : {}),
    ...(catalog.scope ? { scope: catalog.scope } : {}),
    total: { failed, groups: groups.size, fingerprinted, inferred: failed - fingerprinted },
    complete: incomplete.length === 0, incomplete, groups: listed
  };
}

/** Where a failure group's cells link to: a function of a cell, or nothing (no links). */
export type UiFailureMarkdownOptions = {
  /** The address of a cell in a viewer, such as `https://atlas.example/#/catalog?state=…&image=…`. */
  readonly link?: (cell: UiFailureCell) => string | undefined;
  /** Most cells listed per group in the text (default 10). */
  readonly cellsPerGroup?: number;
};

const md = (text: string) => text.replace(/\\/g, '\\\\').replace(/[\[\]`*_<>#|]/g, '\\$&');

/**
 * The failure groups as Markdown for a CI summary: the totals and whether they are complete, then one section per group
 * with its basis (a message group says it is inferred, not a shared cause), count, phases, attempts, occurrence, the redacted
 * sample and the affected cells.
 */
export function uiCatalogFailuresMarkdown(failures: UiCatalogFailures, options: UiFailureMarkdownOptions = {}): string {
  const per = options.cellsPerGroup ?? 10;
  const { total } = failures;
  const lines = ['# UI catalog failures', '', `${total.failed} failed cell${total.failed === 1 ? '' : 's'} in ${total.groups} group${total.groups === 1 ? '' : 's'}: ${total.fingerprinted} by a producer's fingerprint, ${total.inferred} by message only (inferred grouping, not a shared cause).`];
  if (!failures.complete) lines.push('', '> **Incomplete:** these totals are a lower bound.', ...failures.incomplete.map(reason => `> - ${md(reason)}`));
  for (const group of failures.groups) {
    const title = group.basis === 'fingerprint' ? `Fingerprint \`${group.fingerprint}\`` : 'Same message (inferred grouping, not a shared cause)';
    lines.push('', `## ${title}: ${group.count} cell${group.count === 1 ? '' : 's'}`, '',
      `- ${group.states} state${group.states === 1 ? '' : 's'} in ${group.profiles} profile${group.profiles === 1 ? '' : 's'}; producers: ${group.producers.map(md).join(', ')}`,
      `- Phase: ${group.phases.length ? group.phases.map(md).join(', ') : 'not reported'}; attempts: ${group.attempts ? (group.attempts.min === group.attempts.max ? group.attempts.min : `${group.attempts.min}–${group.attempts.max}`) : 'not reported'}`,
      `- First ${new Date(group.firstRecordedAtMs).toISOString()}, last ${new Date(group.lastRecordedAtMs).toISOString()}`,
      `- Sample: ${group.sample ? `\`${group.sample.replace(/`/g, "'")}\`` : 'no message'}`);
    for (const cell of group.cells.slice(0, per)) {
      const href = options.link?.(cell);
      const label = `${md(cell.title)} (${md(cell.state)}, ${md(cell.profileLabel)})`;
      lines.push(`  - ${href ? `[${label}](<${href}>)` : label}`);
    }
    if (group.count > Math.min(per, group.cells.length)) lines.push(`  - … and ${group.count - Math.min(per, group.cells.length)} more`);
  }
  return `${lines.join('\n')}\n`;
}
