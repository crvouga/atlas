/**
 * @module Reliability of a test
 *
 * How often a test passed, counted so the number can be trusted or doubted. A pass rate over raw history is easy to
 * overinterpret: one execution is published as several snapshots, a retry is not a second trial, desktop and phone are
 * different questions, and an earlier version of a behavior says nothing about the current one. This module answers
 * from the recorded results of one test and a {@link ReliabilityScope}, and states what it counted:
 *
 * - **Independent executions.** The snapshots one run recorded for one producer, environment, parameter set and kind
 *   (running, finished, enriched) are one execution; its last word counts once, with the tries it recorded. Raw
 *   snapshots stay inspectable (`snapshots`) and are never weighted as new trials.
 * - **First try and eventual.** Where tries were recorded, `firstAttempt` counts executions whose first try passed and
 *   `rate` counts those that passed in the end. An execution that recorded no tries is not assumed to have passed first
 *   time: it is left out of `firstAttempt` and counted in `unrecordedAttempts`.
 * - **Scope.** Environment, producer, parameters, branch, commit, spec revision and a time window select the executions;
 *   the rest are shown as `outsideScope`, never mixed in. By default only the newest recorded revision of the spec
 *   counts, and earlier ones are shown as `historical` context.
 * - **What is not a trial.** Only `passed` and `failed` executions are in the denominator. `not-run` and unfinished
 *   executions are excluded and counted by name; nothing missing becomes a pass.
 * - **Limits, in words.** `notes` say when the sample is too small to establish anything, when environments, producers
 *   or branches are pooled, when failed cases were published again, and when history is bounded. A rate is never a
 *   production failure probability: the checks are a selection.
 *
 * It only reads results; it never changes a status, a slot or a winner.
 *
 * @see docs/server.md#reading-the-report-as-an-agent
 */
import { parseTime, splitList } from './artifact-query';
import { HISTORY_PER_TEST, type TestResultEntry } from './test-catalog';

/** Version of the reliability document. */
export const RELIABILITY_VERSION = 1;

/** Completed executions below which a rate is shown but not treated as established. */
export const MIN_EXECUTIONS = 10;

/** What a reliability figure is about. Every field is optional; nothing asked is everything the history holds (of the current spec revision). */
export type ReliabilityScope = {
  /** Environments or devices (`phone`, `desktop-web`). Executions in others never count towards these. */
  readonly environment?: readonly string[];
  readonly producer?: readonly string[];
  /** `key=value` parameter choices (`device=small`). */
  readonly parameter?: readonly string[];
  readonly branch?: readonly string[];
  /** Commits: a full id, or a prefix of at least seven characters. */
  readonly sha?: readonly string[];
  /** Only executions recorded against these spec fingerprints. Overrides `revision`. */
  readonly specRevision?: readonly string[];
  /** `current` (the default): only the newest spec revision recorded in the rest of the scope, the older ones shown as context. `any`: every revision, pooled. */
  readonly revision?: 'current' | 'any';
  /** Only executions at or after this time, epoch ms. */
  readonly since?: number;
  /** Only executions at or before this time, epoch ms. */
  readonly until?: number;
};

/** Why an execution is not in the denominator. */
export type ReliabilityExclusion = 'not-run' | 'unfinished' | 'unknown-status' | 'historical-revision' | 'revision-not-recorded';

/** One independent execution: the last word of one run on one producer, environment, parameter set and kind. */
export type ReliabilityExecution = {
  /** The key of the run it belongs to (see `runKey`). */
  readonly run: string;
  /** When its last word was recorded, epoch ms. */
  readonly at: number;
  /** Its last word. */
  readonly status: string;
  /** True when it is in the denominator. */
  readonly counted: boolean;
  /** Why it is not, when it is not. */
  readonly excluded?: ReliabilityExclusion;
  readonly environment: string | null;
  readonly producer: string;
  readonly kind: string;
  readonly parameters: Readonly<Record<string, string>>;
  readonly branch: string | null;
  readonly sha: string | null;
  readonly runUrl: string | null;
  /** The layer holding its last word (open it with `/api/reports/evidence/detail/{backend}/{layer}?check=`). */
  readonly layer: string;
  readonly backend: string;
  readonly durationMs: number | null;
  readonly specRevision?: string;
  /** How many raw snapshots (layers) recorded it. They are one execution, not that many trials. */
  readonly snapshots: number;
  /** The status of each recorded try, in order. Absent when no try was recorded. */
  readonly attempts?: readonly string[];
  /** The first try's status, when tries were recorded. */
  readonly firstAttempt?: string;
  /** True when a failed snapshot of this execution was followed by a later one: it was published again after a failure. */
  readonly republished: boolean;
};

/** Counts and rates over a set of executions. */
export type ReliabilityRate = {
  /** Independent executions that passed or failed. */
  readonly executions: number;
  readonly passed: number;
  readonly failed: number;
  /** passed / executions, or null with none. This is the eventual success rate. */
  readonly rate: number | null;
};

/** A confidence interval and what it assumes. */
export type ReliabilityInterval = {
  readonly method: 'wilson';
  readonly level: number;
  readonly lower: number;
  readonly upper: number;
  /** What must hold for the interval to mean anything. */
  readonly assumptions: string;
};

/** A reason to doubt or qualify the figure. An open set: treat a code you do not know as informational. */
export type ReliabilityNote = {
  readonly code: string;
  /** `warning`: the figure should not be read as representative without this in mind. */
  readonly severity: 'warning' | 'info';
  readonly message: string;
};

/** One environment, producer and parameter set among the counted executions, with its own rate. */
export type ReliabilityCohort = ReliabilityRate & {
  readonly environment: string | null;
  readonly producer: string;
  readonly parameters: Readonly<Record<string, string>>;
};

/** `GET /api/reports/tests/reliability`: how reliable a test is within a scope, and how that figure was counted. */
export type ReliabilityDocument = {
  readonly schemaVersion: typeof RELIABILITY_VERSION;
  readonly key: string;
  readonly scope: ReliabilityScope;
  /** Completed executions below which the sample is `insufficient`. */
  readonly minimumExecutions: number;
  /** Count only: `none` without an independent execution, `insufficient` below the minimum, `sufficient` otherwise. Says nothing about representativeness; read `notes`. */
  readonly sample: 'none' | 'insufficient' | 'sufficient';
  /** Eventual success over the counted executions. */
  readonly eventual: ReliabilityRate;
  readonly interval: ReliabilityInterval | null;
  /** Executions whose first try is known (tries were recorded), and how many of those passed first time. */
  readonly firstAttempt: ReliabilityRate;
  /** Counted executions that recorded no tries: unknown first try, left out of `firstAttempt`. */
  readonly unrecordedAttempts: number;
  readonly attempts: {
    /** Tries recorded across the counted executions. */
    readonly total: number;
    /** Counted executions that needed more than one try. */
    readonly retried: number;
    /** Counted executions that failed first and passed in the end. */
    readonly recovered: number;
  };
  /** The revision `revision: 'current'` counted, or null when none is recorded. */
  readonly currentRevision: string | null;
  /** Earlier spec revisions, shown as context and counted nowhere above. */
  readonly historical: { readonly executions: number; readonly passed: number; readonly failed: number; readonly revisions: readonly { readonly specRevision: string; readonly executions: number }[] };
  /** What was left out, by name. */
  readonly excluded: Readonly<Record<ReliabilityExclusion, number>>;
  /** Executions the scope did not select. */
  readonly outsideScope: number;
  /** Raw recorded snapshots behind the counted executions. */
  readonly snapshots: number;
  /** Counted executions per environment, producer and parameter set. */
  readonly cohorts: readonly ReliabilityCohort[];
  /** What the scope could choose among: the values the history holds, with their independent executions. */
  readonly available: {
    readonly environments: readonly { readonly value: string; readonly count: number }[];
    readonly producers: readonly { readonly value: string; readonly count: number }[];
    readonly branches: readonly { readonly value: string; readonly count: number }[];
    readonly specRevisions: readonly { readonly value: string; readonly count: number }[];
  };
  readonly notes: readonly ReliabilityNote[];
  /** Every independent execution the history holds for the scope's selection (counted or not), newest first: the denominator, open to inspection. */
  readonly executions: readonly ReliabilityExecution[];
};

const COMPLETED = new Set(['passed', 'failed']);
const SEVERITY: Record<string, number> = { failed: 2, passed: 1 };

type Cell = { readonly entries: TestResultEntry[] };

function cellKey(entry: TestResultEntry): string {
  return JSON.stringify([entry.run, entry.producer, entry.environment, entry.kind, Object.entries(entry.parameters).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))]);
}

/** The last word among a cell's snapshots: a completed one beats an unfinished one, then the newer, then the more severe, then the larger layer id. */
function lastWord(entries: readonly TestResultEntry[]): TestResultEntry {
  let best = entries[0]!;
  for (const entry of entries) {
    const a = COMPLETED.has(entry.status), b = COMPLETED.has(best.status);
    if (a !== b ? a : entry.at !== best.at ? entry.at > best.at : (SEVERITY[entry.status] ?? 0) !== (SEVERITY[best.status] ?? 0) ? (SEVERITY[entry.status] ?? 0) > (SEVERITY[best.status] ?? 0) : entry.layer > best.layer) best = entry;
  }
  return best;
}

function matches(list: readonly string[] | undefined, value: string | null): boolean {
  return !list?.length || (value !== null && list.includes(value));
}

function matchesSha(list: readonly string[] | undefined, sha: string | null): boolean {
  if (!list?.length) return true;
  if (!sha) return false;
  const full = sha.toLowerCase();
  return list.some(wanted => { const w = wanted.toLowerCase(); return full === w || (w.length >= 7 && full.startsWith(w)); });
}

function matchesParameters(list: readonly string[] | undefined, parameters: Readonly<Record<string, string>>): boolean {
  return !list?.length || list.every(item => { const at = item.indexOf('='); return at < 0 ? item in parameters : parameters[item.slice(0, at)] === item.slice(at + 1); });
}

function rate(passed: number, failed: number): ReliabilityRate {
  const executions = passed + failed;
  return { executions, passed, failed, rate: executions ? passed / executions : null };
}

/** The Wilson score interval for `passed` of `n`, at 95%. It assumes independent executions under identical conditions. */
function wilson(passed: number, n: number): ReliabilityInterval | null {
  if (n === 0) return null;
  const z = 1.96, p = passed / n, z2 = z * z;
  const centre = (p + z2 / (2 * n)) / (1 + z2 / n);
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return { method: 'wilson', level: 0.95, lower: Math.max(0, centre - half), upper: Math.min(1, centre + half), assumptions: 'Executions are independent and ran under the same conditions, and the checks are representative of what is being asked about. Pooled environments, shared causes of failure and selected reruns break these assumptions.' };
}

function tally(values: readonly (string | null)[]): { value: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const value of values) if (value !== null) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || (a.value < b.value ? -1 : 1));
}

/**
 * How reliable one test is inside a scope, from the recorded results of that test (`TestHistoryDocument.history`, any
 * order). See the module comment for what is counted and what is left out.
 *
 * @param key The test's key, echoed in the document.
 * @param history Every recorded result of the test the caller holds. When it holds as many as `HISTORY_PER_TEST` the
 *   document says the history is bounded.
 * @param scope What to count; see {@link ReliabilityScope}.
 * @example
 * ```ts
 * const document = reliability(test.key, history.history, { environment: ['phone'], since: Date.now() - 30 * 86_400_000 });
 * if (document.sample !== 'sufficient') console.log(`only ${document.eventual.executions} executions`);
 * ```
 */
export function reliability(key: string, history: readonly TestResultEntry[], scope: ReliabilityScope = {}): ReliabilityDocument {
  // One execution per run, producer, environment, parameter set and kind, whatever number of snapshots recorded it.
  const cells = new Map<string, Cell>();
  for (const entry of history) {
    const id = cellKey(entry);
    const cell = cells.get(id);
    if (cell) cell.entries.push(entry); else cells.set(id, { entries: [entry] });
  }
  type Candidate = { readonly last: TestResultEntry; readonly snapshots: number; readonly republished: boolean };
  const candidates: Candidate[] = [...cells.values()].map(({ entries }) => {
    const last = lastWord(entries);
    const completedEarlier = entries.filter(entry => COMPLETED.has(entry.status) && entry !== last && entry.layer !== last.layer);
    return { last, snapshots: new Set(entries.map(entry => entry.layer)).size, republished: COMPLETED.has(last.status) && completedEarlier.some(entry => entry.status === 'failed' && entry.at <= last.at) };
  });
  // Scope, apart from the window and the spec revision: which revision is current is a fact about this selection.
  const inPlace = candidates.filter(({ last }) => matches(scope.environment, last.environment) && matches(scope.producer, last.producer) && matchesParameters(scope.parameter, last.parameters) && matches(scope.branch, last.branch) && matchesSha(scope.sha, last.sha));
  let currentRevision: string | null = null;
  let newest = -Infinity;
  for (const { last } of inPlace) if (last.specRevision && last.at > newest) { newest = last.at; currentRevision = last.specRevision; }
  const revisionsKnown = inPlace.some(({ last }) => last.specRevision);
  const explicit = scope.specRevision?.length ? scope.specRevision : null;
  const onlyCurrent = !explicit && (scope.revision ?? 'current') === 'current' && revisionsKnown;
  const inWindow = (at: number) => (scope.since === undefined || at >= scope.since) && (scope.until === undefined || at <= scope.until);
  const selected = inPlace.filter(({ last }) => inWindow(last.at));
  const outsideScope = candidates.length - selected.length;

  const excluded: Record<ReliabilityExclusion, number> = { 'not-run': 0, unfinished: 0, 'unknown-status': 0, 'historical-revision': 0, 'revision-not-recorded': 0 };
  const executions: ReliabilityExecution[] = [];
  const historicalRevisions = new Map<string, number>();
  let historicalPassed = 0, historicalFailed = 0;
  const counted: Candidate[] = [];
  for (const candidate of selected) {
    const { last } = candidate;
    let reason: ReliabilityExclusion | undefined;
    if (explicit ? !last.specRevision || !explicit.includes(last.specRevision) : onlyCurrent && last.specRevision !== currentRevision) {
      reason = last.specRevision ? 'historical-revision' : 'revision-not-recorded';
    } else if (last.status === 'not-run') reason = 'not-run';
    else if (last.status === 'running') reason = 'unfinished';
    else if (!COMPLETED.has(last.status)) reason = 'unknown-status';
    if (reason === 'historical-revision') {
      historicalRevisions.set(last.specRevision!, (historicalRevisions.get(last.specRevision!) ?? 0) + 1);
      if (last.status === 'passed') historicalPassed += 1; else if (last.status === 'failed') historicalFailed += 1;
    }
    if (reason) excluded[reason] += 1; else counted.push(candidate);
    const attempts = last.evidence?.attemptStatuses;
    executions.push({
      run: last.run, at: last.at, status: last.status, counted: !reason, ...(reason ? { excluded: reason } : {}),
      environment: last.environment, producer: last.producer, kind: last.kind, parameters: last.parameters, branch: last.branch, sha: last.sha, runUrl: last.runUrl,
      layer: last.layer, backend: last.backend, durationMs: last.durationMs, ...(last.specRevision ? { specRevision: last.specRevision } : {}),
      snapshots: candidate.snapshots, ...(attempts?.length ? { attempts, firstAttempt: attempts[0]! } : {}), republished: candidate.republished,
    });
  }
  executions.sort((a, b) => b.at - a.at || (a.layer < b.layer ? 1 : a.layer > b.layer ? -1 : 0));

  const passed = counted.filter(({ last }) => last.status === 'passed').length;
  const eventual = rate(passed, counted.length - passed);
  let firstPassed = 0, firstFailed = 0, unrecorded = 0, totalAttempts = 0, retried = 0, recovered = 0;
  for (const { last } of counted) {
    const tries = last.evidence?.attemptStatuses;
    if (!tries?.length) { unrecorded += 1; continue; }
    totalAttempts += tries.length;
    if (tries.length > 1) retried += 1;
    if (tries[0] === 'passed') firstPassed += 1; else if (tries[0] === 'failed') firstFailed += 1; else unrecorded += 1;
    if (tries[0] === 'failed' && last.status === 'passed') recovered += 1;
  }
  const cohortsMap = new Map<string, { environment: string | null; producer: string; parameters: Readonly<Record<string, string>>; passed: number; failed: number }>();
  for (const { last } of counted) {
    const id = JSON.stringify([last.environment, last.producer, Object.entries(last.parameters).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))]);
    const cohort = cohortsMap.get(id) ?? { environment: last.environment, producer: last.producer, parameters: last.parameters, passed: 0, failed: 0 };
    if (last.status === 'passed') cohort.passed += 1; else cohort.failed += 1;
    cohortsMap.set(id, cohort);
  }
  const cohorts = [...cohortsMap.values()].map(({ passed: p, failed: f, ...rest }) => ({ ...rest, ...rate(p, f) })).sort((a, b) => b.executions - a.executions || (a.environment ?? '').localeCompare(b.environment ?? '') || a.producer.localeCompare(b.producer));

  const bounded = history.length >= HISTORY_PER_TEST;
  const oldest = history.reduce((at, entry) => Math.min(at, entry.at), Infinity);
  const distinct = (list: readonly (string | null)[]) => new Set(list.filter((value): value is string => value !== null)).size;
  const countedBranches = distinct(counted.map(({ last }) => last.branch));
  const sample = eventual.executions === 0 ? 'none' : eventual.executions < MIN_EXECUTIONS ? 'insufficient' : 'sufficient';
  const republished = counted.filter(candidate => candidate.republished).length;
  const notes: ReliabilityNote[] = [];
  if (sample === 'none') notes.push({ code: 'no-observations', severity: 'warning', message: 'No independent execution in this scope passed or failed, so there is no rate. Nothing is assumed to have passed.' });
  else if (sample === 'insufficient') notes.push({ code: 'insufficient-sample', severity: 'warning', message: `Only ${eventual.executions} independent ${eventual.executions === 1 ? 'execution' : 'executions'} in this scope (at least ${MIN_EXECUTIONS} are needed before a rate is read as established). ${eventual.failed === 0 ? 'All of them passed, which is not evidence that the next one will.' : 'The rate moves a great deal with each further execution.'}` });
  if (!scope.environment?.length && distinct(counted.map(({ last }) => last.environment)) > 1) notes.push({ code: 'pooled-environments', severity: 'warning', message: 'Executions from several environments are pooled. Choose an environment to ask about one; each has its own rate under cohorts.' });
  if (!scope.producer?.length && distinct(counted.map(({ last }) => last.producer)) > 1) notes.push({ code: 'pooled-producers', severity: 'warning', message: 'Executions from several producers are pooled. A change of producer can change how a check behaves without any change in the product.' });
  if (!scope.branch?.length && countedBranches > 1) notes.push({ code: 'pooled-branches', severity: 'warning', message: 'Executions from several branches are pooled, so they may not describe the same code.' });
  if (!scope.parameter?.length && new Set(counted.map(({ last }) => JSON.stringify(Object.entries(last.parameters).sort()))).size > 1) notes.push({ code: 'pooled-parameters', severity: 'info', message: 'Executions with different parameter choices are pooled; each has its own rate under cohorts.' });
  if (republished) notes.push({ code: 'selected-reruns', severity: 'warning', message: `${republished} counted ${republished === 1 ? 'execution was' : 'executions were'} published again after a failure, so a failed case may have been rerun until it passed. The rate is not representative of unselected runs.` });
  if (bounded) notes.push({ code: 'history-bounded', severity: 'warning', message: `Only the newest ${HISTORY_PER_TEST} recorded results of this test are kept, so earlier executions are missing and the figure is about recent history only.` });
  if (bounded && scope.since !== undefined && oldest > scope.since) notes.push({ code: 'window-incomplete', severity: 'warning', message: 'The time window begins before the oldest result that is kept, so executions inside it may be missing.' });
  if (eventual.executions && unrecorded) notes.push({ code: 'attempts-not-recorded', severity: 'info', message: `${unrecorded} counted ${unrecorded === 1 ? 'execution recorded' : 'executions recorded'} no tries, so whether they passed first time is unknown and they are left out of the first-try rate.` });
  const left = Object.entries(excluded).filter(([, count]) => count > 0).map(([reason, count]) => `${count} ${reason.replace('-', ' ')}`);
  if (left.length) notes.push({ code: 'excluded', severity: 'info', message: `Left out of the denominator: ${left.join(', ')}. Only passed and failed executions are trials; a result that did not run is never counted as a pass.` });
  if (explicit === null && scope.revision !== 'any' && !revisionsKnown && inPlace.length) notes.push({ code: 'revision-not-recorded', severity: 'info', message: 'No result records which revision of the spec it ran against, so executions of different versions of the behavior cannot be told apart.' });
  if (explicit === null && scope.revision === 'any' && new Set(inPlace.map(({ last }) => last.specRevision).filter(Boolean)).size > 1) notes.push({ code: 'pooled-revisions', severity: 'warning', message: 'Executions against different revisions of the spec are pooled, though the behavior may have changed between them.' });
  if (historicalRevisions.size) notes.push({ code: 'historical-revisions', severity: 'info', message: `${[...historicalRevisions.values()].reduce((sum, count) => sum + count, 0)} executions against earlier spec revisions are shown as historical context and not counted.` });

  return {
    schemaVersion: RELIABILITY_VERSION, key, scope, minimumExecutions: MIN_EXECUTIONS, sample, eventual, interval: wilson(passed, eventual.executions),
    firstAttempt: rate(firstPassed, firstFailed), unrecordedAttempts: unrecorded, attempts: { total: totalAttempts, retried, recovered },
    currentRevision: onlyCurrent ? currentRevision : null,
    historical: { executions: historicalPassed + historicalFailed, passed: historicalPassed, failed: historicalFailed, revisions: [...historicalRevisions].map(([specRevision, executions]) => ({ specRevision, executions })).sort((a, b) => b.executions - a.executions) },
    excluded, outsideScope, snapshots: counted.reduce((sum, candidate) => sum + candidate.snapshots, 0), cohorts,
    available: {
      environments: tally(candidates.map(({ last }) => last.environment)), producers: tally(candidates.map(({ last }) => last.producer)),
      branches: tally(candidates.map(({ last }) => last.branch)), specRevisions: tally(candidates.map(({ last }) => last.specRevision ?? null)),
    },
    notes, executions,
  };
}

const percent = (value: number | null) => (value === null ? 'n/a' : `${Math.round(value * 1000) / 10}%`);
const cell = (text: string) => text.replaceAll('|', '\\|').replaceAll('\n', ' ');

/** The scope as a short phrase, or `all recorded executions`. */
export function scopeText(scope: ReliabilityScope): string {
  const parts = [
    scope.environment?.length ? `environment ${scope.environment.join(', ')}` : '', scope.producer?.length ? `producer ${scope.producer.join(', ')}` : '',
    scope.parameter?.length ? scope.parameter.join(', ') : '', scope.branch?.length ? `branch ${scope.branch.join(', ')}` : '', scope.sha?.length ? `commit ${scope.sha.join(', ')}` : '',
    scope.specRevision?.length ? `spec revision ${scope.specRevision.join(', ')}` : scope.revision === 'any' ? 'every spec revision' : '',
    scope.since !== undefined ? `since ${new Date(scope.since).toISOString()}` : '', scope.until !== undefined ? `until ${new Date(scope.until).toISOString()}` : '',
  ].filter(Boolean);
  return parts.length ? parts.join('; ') : 'all recorded executions';
}

/** The reliability document as Markdown, for an agent or a terminal. */
export function reliabilityMarkdown(document: ReliabilityDocument): string {
  const { eventual, firstAttempt } = document;
  const lines = [
    `# Reliability: ${document.key}`, '',
    `Scope: ${scopeText(document.scope)}${document.currentRevision ? ` (current spec revision \`${document.currentRevision}\`)` : ''}`, '',
    `- Independent executions counted: ${eventual.executions} (${eventual.passed} passed, ${eventual.failed} failed) from ${document.snapshots} recorded snapshots`,
    `- Sample: ${document.sample}${document.sample === 'sufficient' ? '' : ` (at least ${document.minimumExecutions} needed)`}`,
    `- Eventual success: ${percent(eventual.rate)}${document.interval ? ` (95% Wilson interval ${percent(document.interval.lower)} to ${percent(document.interval.upper)})` : ''}`,
    `- First-try success: ${percent(firstAttempt.rate)} of ${firstAttempt.executions} executions with recorded tries; ${document.unrecordedAttempts} recorded no tries`,
    `- Tries recorded: ${document.attempts.total}; ${document.attempts.retried} executions retried, ${document.attempts.recovered} failed first and passed in the end`,
    `- Outside the scope: ${document.outsideScope}; excluded: ${Object.entries(document.excluded).map(([reason, count]) => `${count} ${reason}`).join(', ')}`,
  ];
  if (document.historical.executions) lines.push(`- Earlier spec revisions (context, not counted): ${document.historical.executions} executions, ${document.historical.passed} passed`);
  if (document.notes.length) lines.push('', '## Notes', '', ...document.notes.map(note => `- ${note.severity === 'warning' ? '**Warning**: ' : ''}${note.message}`));
  if (document.cohorts.length > 1) lines.push('', '## Cohorts', '', '| Environment | Producer | Parameters | Executions | Passed | Rate |', '| --- | --- | --- | --- | --- | --- |', ...document.cohorts.map(c => `| ${cell(c.environment ?? 'unspecified')} | ${cell(c.producer)} | ${cell(Object.entries(c.parameters).map(([k, v]) => `${k}=${v}`).join(', ') || '—')} | ${c.executions} | ${c.passed} | ${percent(c.rate)} |`));
  if (document.executions.length) lines.push('', '## Executions', '', '| Recorded | Run | Environment | Producer | Status | Tries | Counted |', '| --- | --- | --- | --- | --- | --- | --- |', ...document.executions.map(e => `| ${new Date(e.at).toISOString().replace('.000Z', 'Z')} | ${cell(e.run)} | ${cell(e.environment ?? 'unspecified')} | ${cell(e.producer)} | ${e.status} | ${e.attempts?.join(' → ') ?? 'not recorded'} | ${e.counted ? 'yes' : `no (${e.excluded})`} |`));
  return `${lines.join('\n')}\n`;
}

/**
 * The scope an address asks for: `environment`, `producer`, `parameter`, `branch`, `sha` and `specRevision` (comma-separated
 * lists), `revision` (`any`, else current) and `since` and `until` (epoch milliseconds, or a date).
 */
export function parseReliabilityScope(params: URLSearchParams): ReliabilityScope {
  const list = (name: string) => params.getAll(name).flatMap(splitList);
  const some = (name: string) => { const values = list(name); return values.length ? { [name]: values } : {}; };
  const since = parseTime(params.get('since')), until = parseTime(params.get('until'));
  return {
    ...some('environment'), ...some('producer'), ...some('parameter'), ...some('branch'), ...some('sha'), ...some('specRevision'),
    ...(params.get('revision') === 'any' ? { revision: 'any' as const } : {}),
    ...(since === undefined ? {} : { since }), ...(until === undefined ? {} : { until }),
  };
}
