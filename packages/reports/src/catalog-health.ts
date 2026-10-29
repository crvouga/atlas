/**
 * @module Catalog health: spec identity, domains and denominators
 *
 * Explains why the Specs and the Tests of a report may disagree, and what a producer or an operator can change about it.
 * `catalogHealth` reads a `CatalogModel` (the tests of a report and the specs it is laid over) and writes a
 * `CatalogHealth` document:
 *
 * - **Spec identity.** The same promise can reach Atlas under two paths (`checkout/cart.feature` published,
 *   `specs/checkout/cart.feature` recorded). Atlas joins two paths only when a declared root mapping (`RootMapping`)
 *   relates them, and then shows one logical spec with its original paths. Without a mapping it never merges by a
 *   similar title or file name: it reports the pair as ambiguous and names the candidates.
 * - **Domains.** A domain is whatever the spec's metadata says. When almost every spec shares one value, often the root
 *   folder, the document says so; it never replaces explicit metadata.
 * - **Denominators.** Defined specs, specs with an executed test, tests (check identities), examples and per-environment
 *   observations are different numbers. `reconciliation` walks from the number the Specs view shows to the number the
 *   Tests view groups by, step by step, and `counts.scenarios` tells one outline, its examples and their observations apart.
 * - **Fallback identity.** A check whose id is its title has no stable id; renaming it starts a new check. Counted, not
 *   guessed at.
 *
 * - **Declared ids.** A producer may say what a check is with the labels `behavior-id` (the promise) and `example-id`
 *   (one example of an outline). Atlas counts them and names ids that sit on more than one check; it does not join the
 *   checks, because a check is still its spec path and id.
 *
 * It only reads: it never changes a status, a slot or a winner, so it cannot disagree with the report it describes.
 * Optional label `outline` on a check names the scenario outline its example belongs to.
 *
 * @see docs/server.md#reading-the-report-as-an-agent
 */
import type { EvidenceStatus, SpecEntry } from './explorer-types';
import { specPath } from './layer-merge';
import type { CatalogModel, TestSummary } from './test-catalog';

/** The version of the `CatalogHealth` document. Only optional fields are added within it. */
export const CATALOG_HEALTH_VERSION = 1;

/** The most paths listed in one finding; its `count` is always the whole. */
export const HEALTH_ITEM_LIMIT = 25;

/** The most candidates named for one ambiguous path. */
const CANDIDATE_LIMIT = 5;

/** Folder names that say where a spec lives, not what it is about. A domain with one of these names is likely a root folder. */
const GENERIC_DOMAINS = new Set(['specs', 'spec', 'product', 'features', 'feature', 'tests', 'test', 'e2e', 'src', 'app', 'docs', 'overview', 'root', 'default']);

/** The label a producer puts on a check to give its behavior (the promise) an id that outlives renames and moves. */
export const BEHAVIOR_ID_LABEL = 'behavior-id';

/** The label a producer puts on a check to give one example of a scenario outline an id of its own. */
export const EXAMPLE_ID_LABEL = 'example-id';

/**
 * Declares that paths under `from` are the same specs as paths under `to`, e.g. `{ from: '', to: 'specs/' }`. Empty `from`
 * matches every path. `source` says where it was declared (the server's configuration or the request); it changes nothing.
 */
export type RootMapping = { readonly from: string; readonly to: string; readonly source?: 'configuration' | 'request' };

/** One thing worth a look. */
export type HealthItem = {
  readonly path: string;
  /** Other paths it could be the same promise as, when any; Atlas has not merged them. */
  readonly candidates?: readonly { readonly path: string; readonly reason: string }[];
};

/** Codes of `HealthFinding.code`. The set grows; a reader treats an unknown code as informational. */
export type HealthCode =
  | 'ambiguous-spec-path'
  | 'unmatched-spec-path'
  | 'duplicate-spec-content'
  | 'duplicate-spec-title'
  | 'generic-domain'
  | 'tests-without-spec'
  | 'no-spec-definitions'
  | 'fallback-identity'
  | 'unused-root-mapping'
  | 'declared-id-split'
  | 'spec-without-execution'
  | 'historical-only';

/** A finding: what is inconsistent, how many it affects, and what to change. */
export type HealthFinding = {
  readonly code: HealthCode;
  /** `warning` is something that makes a count or a filter misleading; `info` explains a number. */
  readonly severity: 'warning' | 'info';
  readonly message: string;
  /** How many paths, specs or tests it affects. */
  readonly count: number;
  /** Up to `HEALTH_ITEM_LIMIT` of them. */
  readonly items: readonly HealthItem[];
};

/** A spec that reached Atlas under more than one path and was joined by a declared root mapping. */
export type SpecAlias = {
  /** The logical spec's path after mapping. */
  readonly path: string;
  /** Every original path it was seen under, sorted. */
  readonly sources: readonly string[];
};

/** One step from the Specs count to the Tests count. */
export type ReconciliationStep = {
  readonly code: 'merged-by-mapping' | 'defined-without-results' | 'results-without-definition';
  readonly label: string;
  /** The change to the running total: negative removes specs, positive adds them. */
  readonly delta: number;
};

/** The `GET /api/reports/tests/health` document. */
export type CatalogHealth = {
  readonly schemaVersion: typeof CATALOG_HEALTH_VERSION;
  readonly version: string;
  readonly generatedAtMs: number;
  /** True when there is no warning. Informational findings do not count. */
  readonly ok: boolean;
  readonly counts: {
    readonly specs: {
      /** Spec files the report is laid over (before mapping). */
      readonly files: number;
      /** Logical specs among them: files joined by a root mapping count once. */
      readonly defined: number;
      /** Logical specs, defined or not, with at least one test. */
      readonly withTests: number;
      /** Defined logical specs with a test that has a passed or failed result. They are the denominator of execution coverage. */
      readonly executed: number;
      /** Defined logical specs with no test that has a passed or failed result: the defined coverage gaps. */
      readonly withoutExecution: number;
    };
    readonly tests: {
      readonly total: number;
      readonly withSpec: number;
      readonly withoutSpec: number;
      /** Tests whose current status is `passed`. A definition with no test never adds to it. */
      readonly passed: number;
      /** Tests the history holds but the report has no current result for. */
      readonly historicalOnly: number;
    };
    readonly scenarios: {
      /** Outlines: tests sharing the label `outline` count once; a test without it is its own outline. */
      readonly outlines: number;
      /** Concrete examples: tests (a check identity), however many environments ran them. */
      readonly examples: number;
      /** Current results per producer, environment and parameter set. */
      readonly observations: number;
      /** Observations that passed or failed. */
      readonly executedObservations: number;
      readonly passedObservations: number;
    };
  };
  readonly reconciliation: {
    /** What the Specs view counts: spec files. */
    readonly specs: number;
    /** What the Tests view groups by: logical specs with at least one test. */
    readonly testSpecs: number;
    readonly steps: readonly ReconciliationStep[];
    /** Tests that name no spec; they are in no group above. */
    readonly testsWithoutSpec: number;
    /** In words, for a person or an agent. */
    readonly explanation: readonly string[];
  };
  readonly identity: {
    readonly checks: number;
    /** Checks whose id equals their title: no stable id was given. */
    readonly fallbackIdentity: number;
    /** Checks that declare a `behavior-id` label. Optional: absent from documents written before it existed. */
    readonly declaredBehaviorIds?: number;
    /** Checks that declare an `example-id` label. */
    readonly declaredExampleIds?: number;
    readonly basis: string;
  };
  readonly domains: readonly { readonly name: string; readonly specs: number }[];
  readonly roots: readonly { readonly from: string; readonly to: string; readonly matched: number; readonly source?: 'configuration' | 'request' }[];
  readonly aliases: readonly SpecAlias[];
  readonly findings: readonly HealthFinding[];
};

/** Parses `from>to` (as `?root=` gives it) into a mapping. Returns null when there is no `>`. Whitespace around each side is trimmed. */
export function parseRootMapping(text: string): RootMapping | null {
  const at = text.indexOf('>');
  if (at < 0) return null;
  return { from: text.slice(0, at).trim(), to: text.slice(at + 1).trim() };
}

/** Reads the repeatable `root` search parameter: each value `from>to`, several may be comma-separated. Values without `>` are ignored. */
export function parseRootMappings(params: URLSearchParams): RootMapping[] {
  return params.getAll('root').flatMap(value => value.split(',')).map(parseRootMapping).filter((mapping): mapping is RootMapping => mapping !== null);
}

const slashes = (path: string) => path.replaceAll('\\', '/').replace(/^\.\//, '');
const folder = (prefix: string) => (prefix === '' || prefix.endsWith('/') ? prefix : `${prefix}/`);

/**
 * The logical path of a spec path: the path Atlas already normalises (`specPath`), after the first mapping whose `from`
 * is a prefix of it (the longest `from` wins). A path already under `to` is left alone. Returns the path and the mapping
 * that changed it, if any.
 */
export function canonicalSpecPath(path: string, roots: readonly RootMapping[]): { readonly path: string; readonly mapping: RootMapping | null } {
  const raw = slashes(path);
  for (const mapping of roots) {
    const from = folder(mapping.from);
    const to = folder(mapping.to);
    for (const candidate of [raw, specPath(raw)]) {
      if (!candidate.startsWith(from) || (to !== '' && candidate.startsWith(to))) continue;
      const mapped = specPath(to + candidate.slice(from.length));
      if (mapped !== specPath(raw)) return { path: mapped, mapping };
    }
  }
  return { path: specPath(raw), mapping: null };
}

type Group = {
  readonly key: string;
  readonly defined: Map<string, SpecEntry>;
  readonly results: Set<string>;
  readonly tests: TestSummary[];
};

const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const executed = (status: EvidenceStatus) => status === 'passed' || status === 'failed';
const tail = (path: string) => path.split('/').at(-1)!.toLowerCase();

/** Why two paths with the same file name might be one promise: one ends with the other, or only the name is shared. */
function relation(a: string, b: string): string {
  return a.endsWith(`/${b}`) || b.endsWith(`/${a}`) ? 'one path ends with the other' : 'same file name';
}

function finding(code: HealthCode, severity: HealthFinding['severity'], message: string, items: readonly HealthItem[], count = items.length): HealthFinding {
  return { code, severity, message, count, items: items.slice(0, HEALTH_ITEM_LIMIT) };
}

/**
 * Diagnoses a report's spec identity, domains and counts. `roots` are the declared path-root mappings. Pure: the same
 * model and mappings give the same document, and nothing in it changes what the report says passed.
 *
 * @example
 * ```ts
 * const health = catalogHealth(model, [{ from: '', to: 'specs/' }]);
 * if (!health.ok) console.log(healthMarkdown(health));
 * ```
 */
export function catalogHealth(model: CatalogModel, roots: readonly RootMapping[] = []): CatalogHealth {
  const ordered = [...roots].sort((a, b) => b.from.length - a.from.length);
  const matched = new Map<RootMapping, Set<string>>(ordered.map(mapping => [mapping, new Set()]));
  const groups = new Map<string, Group>();
  const group = (path: string): Group => {
    const { path: key, mapping } = canonicalSpecPath(path, ordered);
    if (mapping) matched.get(mapping)?.add(path);
    let found = groups.get(key);
    if (!found) groups.set(key, found = { key, defined: new Map(), results: new Set(), tests: [] });
    return found;
  };
  const specs = model.specs ?? [];
  for (const spec of specs) group(spec.path).defined.set(spec.path, spec);
  for (const test of model.tests) {
    if (test.specPath === null) continue;
    const found = group(test.specPath);
    found.results.add(test.specPath);
    found.tests.push(test);
  }

  const all = [...groups.values()].sort((a, b) => byText(a.key, b.key));
  const definedGroups = all.filter(item => item.defined.size > 0);
  const withTests = all.filter(item => item.tests.length > 0);
  const resultsOnly = all.filter(item => item.defined.size === 0);
  const definedOnly = definedGroups.filter(item => item.tests.length === 0);
  const withoutExecution = definedGroups.filter(item => !item.tests.some(test => test.outcomes.some(outcome => executed(outcome.status))));
  const files = specs.length;
  const hasOutline = files > 0;

  const findings: HealthFinding[] = [];

  // Aliases: one logical spec under several original paths. Joined only because a mapping said so.
  const aliases: SpecAlias[] = all
    .map(item => ({ path: item.key, sources: [...new Set([...item.defined.keys(), ...item.results])].sort(byText) }))
    .filter(item => item.sources.length > 1);

  // Ambiguity: a path with results and no definition, beside a definition with no results, that might be the same promise.
  if (hasOutline) {
    const byName = new Map<string, Group[]>();
    for (const item of definedOnly) for (const path of item.defined.keys()) { const name = tail(path); byName.set(name, [...(byName.get(name) ?? []), item]); }
    const ambiguous: HealthItem[] = [];
    const unmatched: HealthItem[] = [];
    for (const item of resultsOnly) {
      for (const path of [...item.results].sort(byText)) {
        const candidates = new Map<string, string>();
        for (const near of byName.get(tail(path)) ?? []) for (const other of near.defined.keys()) if (tail(other) === tail(path)) candidates.set(other, relation(path, other));
        if (candidates.size) ambiguous.push({ path, candidates: [...candidates].sort(([a], [b]) => byText(a, b)).slice(0, CANDIDATE_LIMIT).map(([candidate, reason]) => ({ path: candidate, reason })) });
        else unmatched.push({ path });
      }
    }
    if (ambiguous.length) findings.push(finding('ambiguous-spec-path', 'warning', 'These paths have results but no definition, and a defined spec with no results looks like the same promise. Atlas has not merged them. If they are one, declare a root mapping (`?root=<from>><to>`); if not, nothing to do.', ambiguous));
    if (unmatched.length) findings.push(finding('unmatched-spec-path', 'warning', 'These paths have results but no definition in the specs the report is laid over, and nothing looks like them. Publish the spec set that defines them, or correct the path the producer records.', unmatched));
  } else if (withTests.length) {
    findings.push(finding('no-spec-definitions', 'info', 'No specs are defined for this report, so each test\'s spec and domain come from the path of its results alone. Publish the specs with the results (`--specs <dir>`) to define them.', [], withTests.length));
  }

  // Duplicates among definitions: the same content, or the same title, under different logical paths.
  const byFingerprint = new Map<string, string[]>();
  const byTitle = new Map<string, { path: string; fingerprint: string }[]>();
  for (const item of definedGroups) {
    const spec = [...item.defined.values()].sort((a, b) => byText(a.path, b.path))[0]!;
    if (spec.fingerprint) byFingerprint.set(spec.fingerprint, [...(byFingerprint.get(spec.fingerprint) ?? []), item.key]);
    const title = spec.title.trim().toLowerCase();
    if (title && title !== tail(item.key)) byTitle.set(title, [...(byTitle.get(title) ?? []), { path: item.key, fingerprint: spec.fingerprint ?? '' }]);
  }
  const sameContent = [...byFingerprint.values()].filter(paths => paths.length > 1);
  if (sameContent.length) findings.push(finding('duplicate-spec-content', 'warning', 'These specs have identical content under different paths. They are counted separately; if they are one promise, declare a root mapping.', sameContent.flatMap(paths => paths.map(path => ({ path, candidates: paths.filter(other => other !== path).slice(0, CANDIDATE_LIMIT).map(other => ({ path: other, reason: 'identical content' })) })))));
  const sameTitle = [...byTitle.values()].filter(list => list.length > 1 && new Set(list.map(item => item.fingerprint)).size > 1);
  if (sameTitle.length) findings.push(finding('duplicate-spec-title', 'info', 'These specs share a title but differ in content or path. Atlas keeps them apart; the title alone is never an identity.', sameTitle.flatMap(list => list.map(item => ({ path: item.path, candidates: list.filter(other => other.path !== item.path).slice(0, CANDIDATE_LIMIT).map(other => ({ path: other.path, reason: 'same title' })) })))));

  // Domains over logical specs.
  const domainCounts = new Map<string, number>();
  for (const item of all) {
    const domain = [...item.defined.values()].sort((a, b) => byText(a.path, b.path))[0]?.domain || item.tests[0]?.spec?.domain || '';
    if (domain) domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1);
  }
  const domains = [...domainCounts].map(([name, specs]) => ({ name, specs })).sort((a, b) => b.specs - a.specs || byText(a.name, b.name));
  const withDomain = domains.reduce((sum, domain) => sum + domain.specs, 0);
  const top = domains[0];
  if (top && withDomain >= 3 && top.specs / withDomain >= 0.8) {
    const generic = GENERIC_DOMAINS.has(top.name.toLowerCase());
    findings.push(finding('generic-domain', 'warning', `${top.specs} of ${withDomain} specs are in the domain "${top.name}"${generic ? ', which looks like a root folder rather than an area of the product' : ''}, so filtering by domain will not separate them. Give specs an explicit domain (the spec set's \`domain\`, or each spec entry's); explicit metadata always wins over the folder.`, [], top.specs));
  }

  const testsWithoutSpec = model.tests.filter(test => test.specPath === null);
  if (testsWithoutSpec.length) findings.push(finding('tests-without-spec', 'info', 'These tests name no spec, so they are in no spec or domain group (the Tests view shows them under "(no spec)").', testsWithoutSpec.map(test => ({ path: test.id })), testsWithoutSpec.length));

  const fallback = model.tests.filter(test => test.id === test.title);
  if (fallback.length) findings.push(finding('fallback-identity', 'info', 'These checks use their title as their id. A check is its spec path and id, so renaming one starts a new check and splits its history. Have the producer send a stable `id`.', fallback.map(test => ({ path: test.id })), fallback.length));

  const split: HealthItem[] = [];
  for (const label of [BEHAVIOR_ID_LABEL, EXAMPLE_ID_LABEL]) {
    const byId = new Map<string, TestSummary[]>();
    for (const test of model.tests) { const id = test.labels[label]; if (id) byId.set(id, [...(byId.get(id) ?? []), test]); }
    for (const [id, tests] of [...byId].sort(([a], [b]) => byText(a, b))) {
      if (tests.length > 1) split.push({ path: `${label}=${id}`, candidates: tests.map(test => test.specPath ? `${test.specPath}  ${test.id}` : test.id).sort(byText).slice(0, CANDIDATE_LIMIT).map(path => ({ path, reason: `same ${label}` })) });
    }
  }
  if (split.length) findings.push(finding('declared-id-split', 'info', 'These declared ids sit on more than one check: the promise was renamed or moved, or two checks claim it. Atlas keeps the checks apart (a check is its spec path and id), so their histories are separate.', split));

  const unused = ordered.filter(mapping => !matched.get(mapping)?.size);
  if (unused.length) findings.push(finding('unused-root-mapping', 'warning', 'These root mappings matched no spec path. Check `from` against the paths in the report.', unused.map(mapping => ({ path: `${mapping.from}>${mapping.to}` }))));

  if (withoutExecution.length) findings.push(finding('spec-without-execution', 'info', 'These defined specs have no test with a passed or failed result. They are coverage gaps; they add nothing to any passed count.', withoutExecution.map(item => ({ path: item.key })), withoutExecution.length));

  const known = new Set(model.tests.map(test => test.key));
  const historical = (model.history?.tests() ?? []).filter(test => !known.has(test.key));
  if (historical.length) findings.push(finding('historical-only', 'info', 'The history holds results for these tests, but the report has no current result for them (removed, renamed or not yet re-run). The Tests view does not count them.', historical.map(test => ({ path: test.specPath ? `${test.specPath}  ${test.id}` : test.id })), historical.length));

  // Scenarios: outlines, examples, observations.
  const outlines = new Set(model.tests.map(test => (test.labels.outline ? `${test.specPath ?? ''}\u0000${test.labels.outline}` : test.key)));
  let observations = 0, executedObservations = 0, passedObservations = 0;
  for (const test of model.tests) for (const outcome of test.outcomes) {
    observations += 1;
    if (executed(outcome.status)) executedObservations += 1;
    if (outcome.status === 'passed') passedObservations += 1;
  }

  const mergedDefined = files - definedGroups.length;
  const steps: ReconciliationStep[] = [];
  if (mergedDefined) steps.push({ code: 'merged-by-mapping', label: `${mergedDefined} spec files are the same promise as another under a declared root mapping`, delta: -mergedDefined });
  if (definedOnly.length) steps.push({ code: 'defined-without-results', label: `${definedOnly.length} defined specs have no test`, delta: -definedOnly.length });
  if (resultsOnly.length) steps.push({ code: 'results-without-definition', label: `${resultsOnly.length} specs have tests but no definition in the specs the report is laid over`, delta: resultsOnly.length });
  const explanation = [
    `The Specs view lists ${files} spec files; the Tests view groups ${model.tests.length - testsWithoutSpec.length} tests into ${withTests.length} specs.`,
    ...steps.map(step => `${step.delta < 0 ? 'Minus' : 'Plus'} ${Math.abs(step.delta)}: ${step.label}.`),
    ...(testsWithoutSpec.length ? [`${testsWithoutSpec.length} tests name no spec and belong to neither count.`] : []),
    ...(historical.length ? [`${historical.length} more tests exist only in history and are in neither view.`] : []),
    `${model.tests.length} tests have ${observations} current results (one per producer, environment and parameter set); ${executedObservations} were executed and ${passedObservations} passed.`
  ];

  return {
    schemaVersion: CATALOG_HEALTH_VERSION,
    version: model.version,
    generatedAtMs: model.generatedAtMs,
    ok: findings.every(item => item.severity !== 'warning'),
    counts: {
      specs: { files, defined: definedGroups.length, withTests: withTests.length, executed: definedGroups.length - withoutExecution.length, withoutExecution: withoutExecution.length },
      tests: { total: model.tests.length, withSpec: model.tests.length - testsWithoutSpec.length, withoutSpec: testsWithoutSpec.length, passed: model.tests.filter(test => test.status === 'passed').length, historicalOnly: historical.length },
      scenarios: { outlines: outlines.size, examples: model.tests.length, observations, executedObservations, passedObservations }
    },
    reconciliation: { specs: files, testSpecs: withTests.length, steps, testsWithoutSpec: testsWithoutSpec.length, explanation },
    identity: {
      checks: model.tests.length,
      fallbackIdentity: fallback.length,
      declaredBehaviorIds: model.tests.filter(test => test.labels[BEHAVIOR_ID_LABEL]).length,
      declaredExampleIds: model.tests.filter(test => test.labels[EXAMPLE_ID_LABEL]).length,
      basis: 'A check is its spec path and its id. A check whose producer sent no id is known by its title, so a rename is a new check; a spec is known by its path, joined to another only by a declared root mapping. The labels behavior-id and example-id are counted and checked for ids shared by several checks; they do not change which check a result belongs to.'
    },
    domains,
    roots: ordered.map(mapping => ({ from: mapping.from, to: mapping.to, matched: matched.get(mapping)?.size ?? 0, ...(mapping.source ? { source: mapping.source } : {}) })),
    aliases,
    findings
  };
}

const cell = (text: string) => text.replaceAll('|', '\\|').replace(/\s+/g, ' ');

/** The health document as Markdown, for an agent or a terminal. */
export function healthMarkdown(health: CatalogHealth): string {
  const { counts } = health;
  const lines = [
    '# Catalog health',
    '',
    health.ok ? 'No warnings.' : `${health.findings.filter(item => item.severity === 'warning').length} warnings.`,
    '',
    '## Counts',
    '',
    `- Specs: ${counts.specs.files} files, ${counts.specs.defined} defined, ${counts.specs.withTests} with tests, ${counts.specs.executed} executed, ${counts.specs.withoutExecution} without an executed test.`,
    `- Tests: ${counts.tests.total} (${counts.tests.passed} passed, ${counts.tests.withoutSpec} without a spec, ${counts.tests.historicalOnly} only in history).`,
    `- Scenarios: ${counts.scenarios.outlines} outlines, ${counts.scenarios.examples} examples, ${counts.scenarios.observations} observations (${counts.scenarios.executedObservations} executed, ${counts.scenarios.passedObservations} passed).`,
    '',
    '## Why Specs and Tests differ',
    '',
    ...health.reconciliation.explanation.map(line => `- ${line}`)
  ];
  if (health.aliases.length) lines.push('', '## Specs under more than one path', '', ...health.aliases.slice(0, HEALTH_ITEM_LIMIT).map(alias => `- ${cell(alias.path)} <- ${alias.sources.map(cell).join(', ')}`));
  if (health.findings.length) {
    lines.push('', '## Findings');
    for (const item of health.findings) {
      lines.push('', `### ${item.code} (${item.severity}, ${item.count})`, '', item.message, '');
      for (const entry of item.items) lines.push(`- ${cell(entry.path)}${entry.candidates?.length ? ` ~ ${entry.candidates.map(candidate => `${cell(candidate.path)} (${candidate.reason})`).join('; ')}` : ''}`);
      if (item.count > item.items.length) lines.push(`- ... ${item.count - item.items.length} more`);
    }
  }
  lines.push('', `Identity: ${health.identity.basis}`);
  return `${lines.join('\n')}\n`;
}
