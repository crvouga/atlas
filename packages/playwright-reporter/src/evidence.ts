/**
 * @module Playwright results as Atlas evidence
 *
 * The pure half of the Playwright Test reporter: how one Playwright test and its results become one Atlas check, with
 * its status, failure detail, duration, tags, annotations, links, timeline steps, retry attempts and attachments, and
 * how a project becomes an environment and labels. Nothing here talks to a store; the only input/output is reading the
 * files Playwright attached (videos, traces, screenshots) and looking for a repository root or a `.feature` file.
 *
 * @see docs/rich-evidence.md
 */
import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

import type { FullProject, TestCase, TestError, TestResult, TestStep } from 'playwright/types/testReporter';
import type { PublishChecksInput } from '../../schema/src/layer';

/** One check as handed to the streaming reporter: the input type of a check in `PublishChecksSchema`. */
export type CheckInput = PublishChecksInput['checks'][number];
type AttachmentInput = NonNullable<CheckInput['attachments']>[number];
type StepInput = NonNullable<CheckInput['steps']>[number];
type AttemptInput = NonNullable<CheckInput['attempts']>[number];
type AnnotationInput = NonNullable<CheckInput['annotations']>[number];
type LinkInput = NonNullable<CheckInput['links']>[number];

/** Which results upload their attachments: every one, only failed checks and failed attempts, or none. */
export type AttachmentMode = 'all' | 'failures' | 'none';

/** What to upload of the files Playwright attached: the `mode`, and the largest single file in bytes (`maxBytes`). */
export type AttachmentPolicy = {
  /** `all`, `failures` (failed checks and failed attempts only) or `none`. */
  readonly mode: AttachmentMode;
  /** A larger file is not uploaded; the check gets an `attachment-skipped` annotation instead. */
  readonly maxBytes: number;
};

/** Where a check comes from and how it is recorded, as worked out by the reporter before its evidence is collected. */
export type CheckContext = {
  /** The check's stable id: `<specPath>#<describe titles > test title>`. */
  readonly id: string;
  readonly title: string;
  /** The spec the check belongs to, relative to the repository. */
  readonly specPath: string;
  /** Facts about where it ran: browser, device, viewport, os, playwright version. */
  readonly labels: Readonly<Record<string, string>>;
  /** Relative paths (source locations) are written relative to this directory. */
  readonly root: string;
  readonly attachments: AttachmentPolicy;
  /** The most timeline steps recorded per result; the rest are counted in an annotation. */
  readonly maxSteps: number;
};

const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

/**
 * Removes terminal colour and cursor codes, which Playwright puts in error messages and step titles.
 * @example
 * stripAnsi('\u001b[31mExpected\u001b[39m'); // 'Expected'
 */
export function stripAnsi(text: string): string {
  return text.replace(ANSI, '');
}

/**
 * The failure detail of an error: its message and stack without terminal codes, the message once, cut to `maxChars`.
 * An absent error is the empty string.
 * @param error A Playwright `TestError` (a result's or a step's).
 * @param maxChars The longest detail kept. Default 8000.
 */
export function errorDetail(error: TestError | undefined, maxChars = 8000): string {
  if (!error) return '';
  const message = stripAnsi(error.message ?? error.value ?? '').trim();
  const stack = stripAnsi(error.stack ?? '').trim();
  const text = !stack ? message : !message || stack.includes(message) ? stack : `${message}\n${stack}`;
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

/**
 * The Atlas status of one Playwright result: skipped is `not-run`; the status the test expected (`passed`, or `failed`
 * for a `test.fail()`) is `passed`; anything else (failed, timed out, interrupted, an expected failure that passed) is
 * `failed`.
 */
export function resultStatus(test: Pick<TestCase, 'expectedStatus'>, result: Pick<TestResult, 'status'>): 'passed' | 'failed' | 'not-run' {
  if (result.status === 'skipped') return 'not-run';
  if (result.status === test.expectedStatus) return 'passed';
  return 'failed';
}

/** Whether Playwright will run this test again after this result: it did not get what it expected and has retries left. */
export function willRetry(test: Pick<TestCase, 'expectedStatus' | 'retries'>, result: Pick<TestResult, 'status' | 'retry'>): boolean {
  return result.status !== 'skipped' && result.status !== 'interrupted' && result.status !== test.expectedStatus && result.retry < test.retries;
}

const GHERKIN = /^(given|when|then|and|but)\b/i;
const STEP_KINDS: Readonly<Record<string, string>> = { expect: 'assertion', 'pw:api': 'action', hook: 'hook', fixture: 'fixture', 'test.attach': 'attach' };

/**
 * The timeline kind of a Playwright step, by its category: `test.step` is `step` (or the Gherkin keyword, `given`,
 * `when`, `then`, `and`, `but`, for a playwright-bdd step), `expect` is `assertion`, `pw:api` is `action`, `hook`,
 * `fixture`; any other category is kept as it is.
 */
export function stepKind(step: Pick<TestStep, 'category' | 'title'>): string {
  if (step.category === 'test.step') return GHERKIN.exec(stripAnsi(step.title).trim())?.[1]?.toLowerCase() ?? 'step';
  return STEP_KINDS[step.category] ?? step.category;
}

/**
 * Playwright's step tree as Atlas's flat timeline: each step gets an id (`s1`, `s2`, …), its parent's id, its kind,
 * when it started after the result did (`offsetMs`), how long it took, and `failed` with the error as detail when it
 * failed. At most `max` steps are kept, in order; `dropped` counts the rest.
 * @param steps `result.steps`.
 * @param startedAtMs When the result started (`result.startTime`), in epoch milliseconds.
 * @param max The most steps kept.
 */
export function flattenSteps(steps: readonly TestStep[], startedAtMs: number, max: number): { steps: StepInput[]; dropped: number } {
  const out: StepInput[] = [];
  let dropped = 0;
  const count = (list: readonly TestStep[]): number => list.reduce((sum, step) => sum + 1 + count(step.steps ?? []), 0);
  const visit = (list: readonly TestStep[], parentId: string | undefined) => {
    for (const step of list) {
      if (out.length >= max) { dropped += 1 + count(step.steps ?? []); continue; }
      const id = `s${out.length + 1}`;
      const skipped = (step.annotations ?? []).some(annotation => annotation.type === 'skip');
      const started = step.startTime instanceof Date ? step.startTime.getTime() : Number.NaN;
      out.push({
        id,
        ...(parentId ? { parentId } : {}),
        name: stripAnsi(step.title),
        kind: stepKind(step),
        status: step.error ? 'failed' : skipped ? 'skipped' : 'passed',
        ...(Number.isFinite(started) ? { offsetMs: Math.max(0, started - startedAtMs) } : {}),
        ...(Number.isFinite(step.duration) && step.duration >= 0 ? { durationMs: step.duration } : {}),
        ...(step.error ? { detail: errorDetail(step.error, 2000) } : {})
      });
      visit(step.steps ?? [], id);
    }
  };
  visit(steps, undefined);
  return { steps: out, dropped };
}

/**
 * The closest directory at or above `start` that holds `.git` (a folder, or a file in a worktree), or null. Reads the
 * file system only; it never runs git.
 */
export function findRepoRoot(start: string, exists: (file: string) => boolean = existsSync): string | null {
  for (let dir = path.resolve(start); ; dir = path.dirname(dir)) {
    if (exists(path.join(dir, '.git'))) return dir;
    if (path.dirname(dir) === dir) return null;
  }
}

/** `file` relative to `root`, with forward slashes on every OS. */
export function repoPath(file: string, root: string): string {
  return path.relative(root, path.resolve(root, file)).replaceAll('\\', '/');
}

const GENERATED = /\.feature\.spec\.[cm]?[jt]s$/;

/**
 * The `.feature` file a playwright-bdd generated test came from, or undefined for any other test file. playwright-bdd
 * writes `<outputDir>/<path>.feature.spec.js` (its outputDir is `.features-gen` by default, mirroring the feature
 * folders); this returns the first `<path>.feature` that exists beside `.features-gen` (dropping leading folders, such
 * as a per-project output folder, until one does), else the mapped path even if no such file is found.
 * @param file The absolute path of the test file (`test.location.file`).
 * @example
 * bddFeaturePath('/repo/e2e/.features-gen/features/login.feature.spec.js'); // '/repo/e2e/features/login.feature'
 */
export function bddFeaturePath(file: string, exists: (file: string) => boolean = existsSync): string | undefined {
  const normalized = file.replaceAll('\\', '/');
  if (!GENERATED.test(normalized)) return undefined;
  const marker = normalized.lastIndexOf('/.features-gen/');
  if (marker < 0) return normalized.replace(GENERATED, '.feature');
  const base = normalized.slice(0, marker);
  const rest = normalized.slice(marker + '/.features-gen/'.length).replace(GENERATED, '.feature').split('/');
  for (let skip = 0; skip < rest.length; skip++) {
    const candidate = `${base}/${rest.slice(skip).join('/')}`;
    if (exists(candidate)) return candidate;
  }
  return `${base}/${rest.join('/')}`;
}

/** The environment a project tests by default: `mobile-web` when it emulates a mobile device (`use.isMobile`), else `desktop-web`. */
export function projectEnvironment(project: Pick<FullProject, 'use'> | undefined): string {
  return project?.use?.isMobile ? 'mobile-web' : 'desktop-web';
}

/**
 * What every check of a project carries as labels: `browser` (`use.browserName`, else the device's
 * `defaultBrowserType`), `channel`, `device` (the project name), `viewport` (`<width>x<height>`), `os`
 * (`process.platform`) and `playwright` (its version). Labels describe a result; they never split its slot.
 * @param project The Playwright project, or undefined when it is not known.
 * @param version Playwright's version (`config.version`).
 */
export function projectLabels(project: Pick<FullProject, 'name' | 'use'> | undefined, version?: string): Record<string, string> {
  const use = (project?.use ?? {}) as { browserName?: string; defaultBrowserType?: string; channel?: string; viewport?: { width: number; height: number } | null };
  const labels: Record<string, string> = {};
  const browser = use.browserName ?? use.defaultBrowserType;
  if (browser) labels.browser = browser;
  if (use.channel) labels.channel = use.channel;
  labels.device = project?.name || 'default';
  if (use.viewport && Number.isFinite(use.viewport.width) && Number.isFinite(use.viewport.height)) labels.viewport = `${use.viewport.width}x${use.viewport.height}`;
  labels.os = process.platform;
  if (version) labels.playwright = version;
  return labels;
}

const ROLES: Readonly<Record<string, string>> = { video: 'video', screenshot: 'screenshot', trace: 'trace' };

function wanted(policy: AttachmentPolicy, failed: boolean): boolean {
  return policy.mode === 'all' || (policy.mode === 'failures' && failed);
}

function skippedNote(name: string, message: string): AnnotationInput {
  return { type: 'attachment-skipped', level: 'warning', message: `${name} ${message}` };
}

/**
 * The files and output of one result as attachments with their bytes: every `result.attachments` entry (role `video`,
 * `screenshot` or `trace` by its Playwright name, else the name itself; bytes from `body`, or read from `path`), and
 * standard output and error as `log` text. A file over the size limit, or that cannot be read, is left out with an
 * `attachment-skipped` annotation saying why. Never throws.
 * @param result The Playwright result.
 * @param failed Whether the result failed, for the `failures` mode.
 * @param policy What to upload.
 */
export async function resultAttachments(result: Pick<TestResult, 'attachments' | 'stdout' | 'stderr'>, failed: boolean, policy: AttachmentPolicy): Promise<{ attachments: AttachmentInput[]; annotations: AnnotationInput[] }> {
  const attachments: AttachmentInput[] = [];
  const annotations: AnnotationInput[] = [];
  if (!wanted(policy, failed)) return { attachments, annotations };
  for (const given of result.attachments ?? []) {
    const role = ROLES[given.name] ?? given.name;
    const name = given.path ? path.basename(given.path) : given.name;
    const meta = { name, role, ...(given.contentType ? { contentType: given.contentType } : {}) };
    try {
      if (given.body) {
        if (given.body.length > policy.maxBytes) { annotations.push(skippedNote(name, `(${given.body.length} bytes) was not uploaded: larger than maxAttachmentBytes (${policy.maxBytes})`)); continue; }
        attachments.push({ ...meta, data: new Uint8Array(given.body) });
      } else if (given.path) {
        const size = (await stat(given.path)).size;
        if (size > policy.maxBytes) { annotations.push(skippedNote(name, `(${size} bytes) was not uploaded: larger than maxAttachmentBytes (${policy.maxBytes})`)); continue; }
        attachments.push({ ...meta, data: new Uint8Array(await readFile(given.path)) });
      }
    } catch (error) {
      annotations.push(skippedNote(name, `could not be read: ${error instanceof Error ? error.message : String(error)}`));
    }
  }
  for (const [stream, chunks] of [['stdout', result.stdout], ['stderr', result.stderr]] as const) {
    const text = (chunks ?? []).map(chunk => (typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk))).join('');
    if (!text.trim()) continue;
    const bytes = new TextEncoder().encode(text).length;
    if (bytes > policy.maxBytes) { annotations.push(skippedNote(stream, `(${bytes} bytes) was not uploaded: larger than maxAttachmentBytes (${policy.maxBytes})`)); continue; }
    attachments.push({ name: stream, role: 'log', contentType: 'text/plain', text });
  }
  return { attachments, annotations };
}

const startOf = (result: Pick<TestResult, 'startTime'>): number => (result.startTime instanceof Date ? result.startTime.getTime() : 0);

type PlaywrightAnnotation = { type: string; description?: string; location?: { file: string; line: number; column: number } };

function annotationsOf(test: TestCase, result: TestResult | undefined, root: string): { annotations: AnnotationInput[]; types: string[]; links: LinkInput[] } {
  const seen = new Set<string>();
  const annotations: AnnotationInput[] = [];
  const links: LinkInput[] = [];
  const all = [...(test.annotations ?? []), ...(((result as { annotations?: PlaywrightAnnotation[] } | undefined)?.annotations) ?? [])] as PlaywrightAnnotation[];
  for (const annotation of all) {
    const key = `${annotation.type}\u0000${annotation.description ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    annotations.push({
      type: annotation.type,
      message: annotation.description ?? '',
      ...(annotation.location ? { source: { file: repoPath(annotation.location.file, root), line: annotation.location.line, column: annotation.location.column } } : {})
    });
    if (annotation.description && /^https?:\/\//.test(annotation.description)) links.push({ url: annotation.description, rel: annotation.type });
  }
  return { annotations, types: [...new Set(all.map(annotation => annotation.type))], links };
}

/**
 * The final check of a Playwright test from all its results (one per try): status of the last result (`flaky`, as a
 * tag and a label, when it passed after a failed try), failure detail without terminal codes, duration, tags (the
 * test's tags without `@`, and its annotation types), annotations, links (annotations whose description is a URL),
 * timeline steps, one attempt per try when it was retried, attachments, and the test's location under the
 * `playwright` extension. Reads attached files; never throws for a file it cannot read.
 * @param test The Playwright test.
 * @param results Its results, oldest first (`test.results`).
 * @param context Its identity and what to record.
 */
export async function checkOf(test: TestCase, results: readonly TestResult[], context: CheckContext): Promise<CheckInput> {
  const final = results.at(-1);
  if (!final) return { id: context.id, title: context.title, status: 'not-run', specPath: context.specPath, labels: { ...context.labels } };
  const status = resultStatus(test, final);
  const retried = results.length > 1;
  const flaky = retried && status === 'passed';
  const { annotations: noted, types, links } = annotationsOf(test, final, context.root);
  const annotations = [...noted];

  const timeline = flattenSteps(final.steps ?? [], startOf(final), context.maxSteps);
  if (timeline.dropped) annotations.push({ type: 'steps-truncated', level: 'info', message: `${timeline.dropped} more steps were not recorded (maxSteps ${context.maxSteps})` });
  const files = await resultAttachments(final, status === 'failed', context.attachments);
  annotations.push(...files.annotations);

  const attempts: AttemptInput[] = [];
  if (retried) {
    for (const result of results) {
      const attemptStatus = resultStatus(test, result);
      const last = result === final;
      const evidence = last ? null : await resultAttachments(result, attemptStatus === 'failed', context.attachments);
      const steps = last ? null : flattenSteps(result.steps ?? [], startOf(result), context.maxSteps).steps;
      attempts.push({
        index: result.retry,
        status: attemptStatus,
        ...(Number.isFinite(result.duration) && result.duration >= 0 ? { durationMs: result.duration } : {}),
        ...(result.startTime instanceof Date ? { startedAtMs: Math.max(0, startOf(result)) } : {}),
        ...(result.error ? { detail: errorDetail(result.error) } : {}),
        ...(steps?.length ? { steps } : {}),
        ...(evidence?.attachments.length ? { attachments: evidence.attachments } : {}),
        ...(evidence?.annotations.length ? { annotations: evidence.annotations } : {})
      });
    }
  }

  const firstFailure = results.find(result => result.error)?.error;
  const skipReason = (test.annotations ?? []).find(annotation => annotation.type === 'skip' || annotation.type === 'fixme')?.description;
  const detail = status === 'failed' ? (errorDetail(final.error ?? final.errors?.[0]) || `${final.status}`)
    : flaky ? `Passed on retry ${final.retry} (flaky)${firstFailure ? `: ${errorDetail(firstFailure, 500).split('\n')[0]}` : ''}`
    : status === 'not-run' ? (skipReason ? `Skipped: ${skipReason}` : 'Skipped')
    : '';
  const tags = [...new Set([...(test.tags ?? []).map(tag => tag.replace(/^@/, '')), ...types, ...(flaky ? ['flaky'] : [])])].filter(Boolean);
  const labels = { ...context.labels, ...(retried ? { retries: String(results.length - 1) } : {}), ...(flaky ? { flaky: 'true' } : {}) };
  return {
    id: context.id,
    title: context.title,
    status,
    detail,
    specPath: context.specPath,
    ...(Number.isFinite(final.duration) && final.duration >= 0 ? { durationMs: final.duration } : {}),
    ...(tags.length ? { tags } : {}),
    labels,
    ...(links.length ? { links } : {}),
    ...(annotations.length ? { annotations } : {}),
    ...(timeline.steps.length ? { steps: timeline.steps } : {}),
    ...(attempts.length ? { attempts } : {}),
    ...(files.attachments.length ? { attachments: files.attachments } : {}),
    extensions: {
      playwright: {
        testId: test.id,
        ...(test.location ? { location: { file: repoPath(test.location.file, context.root), line: test.location.line, column: test.location.column } } : {}),
        expectedStatus: test.expectedStatus,
        status: final.status,
        retries: test.retries,
        ...(Number.isInteger(final.workerIndex) ? { workerIndex: final.workerIndex } : {})
      }
    }
  };
}
