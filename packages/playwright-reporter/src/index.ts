/**
 * @module Playwright Test reporter
 *
 * `@crvouga/atlas/playwright-reporter` is a Playwright Test reporter that streams every test to an Atlas server (or any
 * store) as it runs, with the evidence Playwright already has: durations, failure details, steps as a timeline, retries
 * as attempts (and `flaky`), tags, annotations, and the videos, screenshots and traces it attached. Each Playwright
 * project is its own stream of layers, so a desktop and a mobile project are two environments of the same checks, and
 * every check is labelled with its browser, device, viewport, operating system and Playwright version.
 *
 * It never throws into the test run: a destination that is not configured, a store that is down or a file that cannot
 * be read is said once, and the run goes on. Playwright is only imported for its types, so importing this module loads
 * nothing of Playwright.
 *
 * @see docs/rich-evidence.md
 */
import path from 'node:path';

import type { FullConfig, FullProject, Reporter as PlaywrightReporter, Suite, TestCase, TestResult } from 'playwright/types/testReporter';
import type { PublishChecksInput } from '../../schema/src/layer';
import type { ObjectStore } from '../../reports/src/object-store';
import { createReporter, type Reporter } from '../../reports/src/reporter';
import { detectFreshness, detectOrigin } from '../../reports/src/report-cli';
import { openStore } from '../../reports/src/store-url';
import { bddFeaturePath, checkOf, findRepoRoot, projectEnvironment, projectLabels, repoPath, willRetry, type AttachmentMode, type CheckInput } from './evidence';

export { bddFeaturePath, checkOf, errorDetail, findRepoRoot, flattenSteps, projectEnvironment, projectLabels, repoPath, resultAttachments, resultStatus, stepKind, stripAnsi, willRetry } from './evidence';
export type { AttachmentMode, AttachmentPolicy, CheckContext, CheckInput } from './evidence';

/** A value given once for every project, or worked out from each project. */
export type PerProject<T> = T | ((project: FullProject) => T);

/**
 * Options of the Playwright Test reporter, given as the second element of its entry in `reporter` in
 * `playwright.config.ts`. Every one is optional: with `ATLAS_SERVER_URL`, `ATLAS_TOKEN` and `ATLAS_PROJECT` set, none
 * is needed.
 */
export type AtlasPlaywrightReporterOptions = {
  /** Project namespace on a shared Atlas server. Default `ATLAS_PROJECT`. */
  readonly project?: string;
  /** The Atlas server (`https://atlas.example.com`), or any store location (`./atlas-reports`, `s3://bucket/prefix`). Default `ATLAS_SERVER_URL`, else `ATLAS_STORE`. */
  readonly url?: string;
  /** A publish token. Default `ATLAS_PUBLISH_TOKEN`, else `ATLAS_TOKEN` (or the file `ATLAS_TOKEN_FILE` names). */
  readonly token?: string;
  /** Publish to this store instead of a URL: a directory store, an in-memory store in tests, anything that implements `ObjectStore`. */
  readonly store?: ObjectStore;
  /** A stable name for this suite. With the check id, environment and parameters it picks the slot a result fills. Default `playwright`. */
  readonly producer?: string;
  /** The part kind of every layer. Default `checks`. */
  readonly kind?: string;
  /** The environment of a project's checks. Default `mobile-web` for a project with `use.isMobile`, else `desktop-web`. */
  readonly environment?: PerProject<string>;
  /** Choices that make a result its own slot (a locale, a tenant). Empty by default: labels never split slots, parameters do. */
  readonly parameters?: PerProject<Readonly<Record<string, string>>>;
  /** More labels for every check of a project, beside browser, device, viewport, os and playwright. */
  readonly labels?: PerProject<Readonly<Record<string, string>>>;
  /** The commit tested. Default `ATLAS_SHA`, then the CI's own variables (`GITHUB_SHA`…), then git. */
  readonly sha?: string;
  /** The branch tested. Default `ATLAS_BRANCH`, then `GITHUB_HEAD_REF`, `GITHUB_REF_NAME`…, then git. */
  readonly branch?: string;
  /** Where to read the CI run. Default the GitHub Actions run (or the CI's own run URL variable). */
  readonly runUrl?: string;
  /**
   * Names this execution, for a local or manual run with no CI run URL: every shard and project that gets the same `id`
   * is one run, and the next invocation gets another. Default: `ATLAS_RUN_ID` (and `ATLAS_RUN_TITLE`) when set. Only
   * groups and labels runs; it never changes what a check is or which result wins.
   */
  readonly run?: { readonly id: string; readonly title?: string; readonly startedAtMs?: number; readonly endedAtMs?: number };
  /** The spec a test belongs to, relative to the repository. Default: the `.feature` of a playwright-bdd test, else the test file. */
  readonly specPath?: (test: TestCase) => string | undefined;
  /** Paths are relative to this directory. Default the git root above Playwright's `rootDir`, else `rootDir`. */
  readonly rootDir?: string;
  /** Which results upload their attachments (videos, screenshots, traces, output): `all`, `failures` or `none`. Default `all`. */
  readonly attachments?: AttachmentMode;
  /** A larger file is not uploaded; the check says so in an annotation. Default 50 MiB. */
  readonly maxAttachmentBytes?: number;
  /** The most timeline steps recorded per result. Default 500. */
  readonly maxSteps?: number;
  /** Record the project's spec files (path, domain, kind, title) in every layer, so a server can group checks by spec without a published spec set. Default true. */
  readonly specs?: boolean;
  /** Send what has finished this often, in ms. Default 5000 (every layer repeats the spec list). */
  readonly flushMs?: number;
  /** Send at once when this many checks are waiting. Default 50 (their attachments are held in memory until sent). */
  readonly batchSize?: number;
  /** Tries for each layer at the end of the run. Default 5. */
  readonly attempts?: number;
  /** Print nothing, not even the summary line. */
  readonly quiet?: boolean;
  /** Where messages go. Default: the summary to standard output, problems to standard error. */
  readonly log?: (line: string) => void;
  /** The environment variables to read. Default `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
};

type SpecEntry = NonNullable<PublishChecksInput['specs']>[number];
type Stream = { readonly reporter: Reporter; readonly labels: Readonly<Record<string, string>> };
type Identity = { readonly stream: Stream | null; readonly id: string; readonly title: string; readonly specPath: string };

const MiB = 1024 * 1024;

function perProject<T>(value: PerProject<T> | undefined, project: FullProject | undefined): T | undefined {
  if (typeof value !== 'function') return value;
  return project ? (value as (project: FullProject) => T)(project) : undefined;
}

function projectSuiteOf(test: TestCase): Suite | undefined {
  for (let suite: Suite | undefined = test.parent; suite; suite = suite.parent) if (suite.type === 'project') return suite;
  return undefined;
}

/**
 * The Playwright Test reporter of Atlas. Add it beside your console reporter; it streams each test as `running` when
 * it starts and with its full evidence when its last try ends, one stream of layers per Playwright project, and
 * prints one summary line when the run ends. It never fails or slows the run on account of Atlas.
 *
 * @example
 * ```ts
 * // playwright.config.ts
 * import { defineConfig } from '@playwright/test';
 *
 * export default defineConfig({
 *   reporter: [['list'], ['@crvouga/atlas/playwright-reporter', { project: 'checkout', producer: 'e2e-web' }]],
 *   use: { video: 'retain-on-failure', trace: 'retain-on-failure', screenshot: 'only-on-failure' }
 * });
 * ```
 */
export default class AtlasPlaywrightReporter implements PlaywrightReporter {
  private readonly options: AtlasPlaywrightReporterOptions;
  private config: FullConfig | undefined;
  private store: ObjectStore | null = null;
  private label = '';
  private root = process.cwd();
  private identity: { sha: string | null; branch: string | null; runUrl: string | null; run?: NonNullable<AtlasPlaywrightReporterOptions['run']>; freshness?: 'modified' | 'unknown' } = { sha: null, branch: null, runUrl: null };
  private readonly streams = new Map<Suite | undefined, Stream | null>();
  private readonly identities = new WeakMap<TestCase, Identity>();
  private readonly specPaths = new Map<string, string>();
  private readonly running = new Set<TestCase>();
  private readonly pending = new Set<Promise<void>>();
  private warned = false;
  private recorded = 0;

  /** Playwright passes the options given in `playwright.config.ts`. */
  constructor(options: AtlasPlaywrightReporterOptions = {}) {
    this.options = options ?? {};
  }

  /** This reporter prints only a summary line, so Playwright keeps its own console output. */
  printsToStdio(): boolean {
    return false;
  }

  private say(line: string): void {
    if (this.options.quiet) return;
    if (this.options.log) this.options.log(line);
    else process.stdout.write(`${line}\n`);
  }

  /** Said once per run: Atlas problems never flood the test output. */
  private warn(message: string): void {
    if (this.warned || this.options.quiet) return;
    this.warned = true;
    const line = `Atlas: ${message}`;
    if (this.options.log) this.options.log(line);
    else process.stderr.write(`${line}\n`);
  }

  /** Resolves where layers go, where the run came from, and the directory paths are relative to. Never throws. */
  onBegin(config: FullConfig, _suite: Suite): void {
    this.config = config;
    const options = this.options;
    const env = options.env ?? process.env;
    try {
      const base = config?.rootDir ?? process.cwd();
      this.root = options.rootDir ? path.resolve(base, options.rootDir) : (findRepoRoot(base) ?? base);
    } catch { /* keep the working directory */ }
    try {
      if (options.store) {
        this.store = options.store;
        this.label = 'the given store';
      } else {
        const url = options.url ?? env.ATLAS_SERVER_URL ?? env.ATLAS_STORE;
        if (!url) {
          this.warn('not publishing: set ATLAS_SERVER_URL (and ATLAS_TOKEN, ATLAS_PROJECT), or give the reporter { url, token, project }');
        } else {
          const token = options.token ?? env.ATLAS_PUBLISH_TOKEN;
          const project = options.project ?? env.ATLAS_PROJECT;
          const opened = openStore(url, { base: this.root, env: { ...env, ...(token ? { ATLAS_TOKEN: token } : {}), ...(project ? { ATLAS_PROJECT: project } : {}) } });
          this.store = opened.store;
          this.label = opened.label;
        }
      }
    } catch (error) {
      this.store = null;
      this.warn(`not publishing: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!this.store) return;
    const run = options.run ?? (env.ATLAS_RUN_ID ? { id: env.ATLAS_RUN_ID, ...(env.ATLAS_RUN_TITLE ? { title: env.ATLAS_RUN_TITLE } : {}) } : undefined);
    try {
      const explicitSha = options.sha ?? env.ATLAS_SHA;
      const origin = detectOrigin(env);
      const sha = explicitSha ?? origin.sha;
      const freshness = detectFreshness({ sha, ci: origin.ci && !explicitSha });
      this.identity = { sha, branch: options.branch ?? env.ATLAS_BRANCH ?? origin.branch, runUrl: options.runUrl ?? origin.runUrl, ...(run ? { run } : {}), ...(freshness ? { freshness } : {}) };
    } catch {
      this.identity = { sha: options.sha ?? env.ATLAS_SHA ?? null, branch: options.branch ?? env.ATLAS_BRANCH ?? null, runUrl: options.runUrl ?? null, ...(run ? { run } : {}), freshness: 'unknown' };
    }
  }

  private specPathOf(test: TestCase): string {
    try {
      const given = this.options.specPath?.(test);
      if (given) return given.replaceAll('\\', '/');
    } catch { /* fall back to the file */ }
    const file = test.location?.file;
    if (!file) return '';
    let known = this.specPaths.get(file);
    if (known === undefined) {
      known = repoPath(bddFeaturePath(file) ?? file, this.root);
      this.specPaths.set(file, known);
    }
    return known;
  }

  private titleOf(test: TestCase, specPath: string): string {
    // playwright-bdd names a Scenario Outline's examples `Example #1`; the outline's title says which scenario it is.
    if (specPath.endsWith('.feature') && /^Example #\d+/.test(test.title) && test.parent?.type === 'describe' && test.parent.title) return `${test.parent.title}: ${test.title}`;
    return test.title;
  }

  private specsOf(projectSuite: Suite | undefined): SpecEntry[] {
    if (this.options.specs === false || !projectSuite) return [];
    const specs = new Map<string, SpecEntry>();
    for (const test of projectSuite.allTests?.() ?? []) {
      const specPath = this.specPathOf(test);
      if (!specPath || specs.has(specPath)) continue;
      let top: Suite | undefined = test.parent;
      while (top?.parent && top.parent.type === 'describe') top = top.parent;
      const segments = specPath.split('/');
      const file = segments.at(-1) ?? specPath;
      const title = specPath.endsWith('.feature') && top?.type === 'describe' && top.title ? top.title : file;
      specs.set(specPath, { path: specPath, domain: segments.length > 1 ? segments.at(-2)! : 'Overview', kind: file.includes('.') ? file.slice(file.lastIndexOf('.') + 1) : 'document', title });
    }
    return [...specs.values()];
  }

  private streamOf(projectSuite: Suite | undefined): Stream | null {
    if (this.streams.has(projectSuite)) return this.streams.get(projectSuite)!;
    let stream: Stream | null = null;
    const store = this.store;
    if (store) {
      try {
        const options = this.options;
        const project = projectSuite?.project?.();
        const environment = perProject(options.environment, project) ?? projectEnvironment(project);
        const parameters = perProject(options.parameters, project) ?? {};
        const shard = this.config?.shard;
        const labels = { ...projectLabels(project, this.config?.version), ...(shard ? { shard: `${shard.current}/${shard.total}` } : {}), ...(perProject(options.labels, project) ?? {}) };
        const reporter = createReporter({
          producer: options.producer ?? 'playwright',
          kind: options.kind ?? 'checks',
          title: `Playwright${project?.name ? `: ${project.name}` : ''}`,
          sha: this.identity.sha,
          branch: this.identity.branch,
          runUrl: this.identity.runUrl,
          ...(this.identity.run ? { run: this.identity.run } : {}),
          ...(this.identity.freshness ? { freshness: this.identity.freshness } : {}),
          environment,
          parameters: { ...parameters },
          specs: this.specsOf(projectSuite),
          labels
        }, {
          store,
          flushMs: options.flushMs ?? 5000,
          batchSize: options.batchSize ?? 50,
          attempts: options.attempts ?? 5,
          onError: (error, willRetryLayer) => { if (!willRetryLayer) this.warn(`could not send results to ${this.label}: ${error.message}`); }
        });
        stream = { reporter, labels };
      } catch (error) {
        this.warn(`not publishing project ${projectSuite?.title ?? ''}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    this.streams.set(projectSuite, stream);
    return stream;
  }

  private identityOf(test: TestCase): Identity {
    const known = this.identities.get(test);
    if (known) return known;
    const specPath = this.specPathOf(test);
    const titles = [test.title];
    for (let suite: Suite | undefined = test.parent; suite && suite.type === 'describe'; suite = suite.parent) titles.unshift(suite.title);
    const repeat = test.repeatEachIndex ? ` [repeat ${test.repeatEachIndex}]` : '';
    const identity: Identity = { stream: this.streamOf(projectSuiteOf(test)), id: `${specPath || test.id}#${titles.join(' > ')}${repeat}`, title: this.titleOf(test, specPath), specPath };
    this.identities.set(test, identity);
    return identity;
  }

  private send(stream: Stream, check: CheckInput): void {
    try {
      stream.reporter.check(check);
      if (check.status !== 'running') this.recorded += 1;
    } catch (error) {
      this.warn(`a result could not be recorded (${check.id}): ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
    }
  }

  /** Reports the test as `running`, so the report shows it while it runs. */
  onTestBegin(test: TestCase, _result: TestResult): void {
    if (!this.store) return;
    try {
      const { stream, id, title, specPath } = this.identityOf(test);
      if (!stream) return;
      this.running.add(test);
      this.send(stream, { id, title, status: 'running', ...(specPath ? { specPath } : {}), labels: { ...stream.labels } });
    } catch (error) {
      this.warn(`a result could not be recorded: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** On a test's last try, collects its evidence (reading its attached files) and reports it. A try Playwright will repeat leaves the test `running`. */
  onTestEnd(test: TestCase, result: TestResult): void {
    if (!this.store) return;
    try {
      if (willRetry(test, result)) return;
      this.running.delete(test);
      const { stream, id, title, specPath } = this.identityOf(test);
      if (!stream) return;
      const options = this.options;
      const results = test.results?.length ? test.results : [result];
      const work = checkOf(test, results, {
        id, title, specPath, labels: stream.labels, root: this.root,
        attachments: { mode: options.attachments ?? 'all', maxBytes: options.maxAttachmentBytes ?? 50 * MiB },
        maxSteps: options.maxSteps ?? 500
      }).then(
        check => this.send(stream, check),
        error => {
          this.warn(`evidence of ${id} could not be collected: ${error instanceof Error ? error.message : String(error)}`);
          this.send(stream, { id, title, status: result.status === 'skipped' ? 'not-run' : result.status === test.expectedStatus ? 'passed' : 'failed', ...(specPath ? { specPath } : {}), labels: { ...stream.labels } });
        }
      );
      this.pending.add(work);
      void work.finally(() => this.pending.delete(work));
    } catch (error) {
      this.warn(`a result could not be recorded: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Waits for every result, marks tests the run did not finish as `not-run`, sends the rest, and prints one summary line. */
  async onEnd(): Promise<void> {
    if (!this.store) return;
    try {
      await Promise.allSettled([...this.pending]);
      for (const test of this.running) {
        const { stream, id, title, specPath } = this.identityOf(test);
        if (stream) this.send(stream, { id, title, status: 'not-run', detail: 'The run ended before this test finished', ...(specPath ? { specPath } : {}), labels: { ...stream.labels } });
      }
      this.running.clear();
      let layers = 0, lost = 0;
      for (const stream of this.streams.values()) {
        if (!stream) continue;
        const result = await stream.reporter.close();
        layers += result.layers;
        lost += result.lost;
      }
      this.say(`Atlas: ${this.recorded} checks in ${layers} layer${layers === 1 ? '' : 's'} to ${this.label}${lost ? `; ${lost} could not be sent` : ''}`);
    } catch (error) {
      this.warn(`could not finish publishing: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
