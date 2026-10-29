/**
 * @module Project-wide behavior index
 *
 * Every behavior of every Gherkin feature in the project as one list, so a reader can search "what does this product
 * promise?" without knowing which feature file holds the answer. It adds no source of truth: each feature is read
 * through the same {@link featureBehaviors} the feature page uses, so a behavior has the same coverage state, revisions
 * and recording here as there. Features whose text has not arrived, or cannot be parsed, are counted and named rather
 * than silently absent, so an empty answer is never mistaken for "no such behavior".
 */
import type { EvidenceView } from '@crvouga/atlas/reports/evidence-view';
import type { LayerEvidence } from '@crvouga/atlas/reports/evidence-types';
import type { SpecEntry } from '@crvouga/atlas/reports/explorer-types';

import type { DocFacets } from '../find/query';
import type { FindDoc, FindField, FindStatus } from '../find/rank';
import { outlinePath } from '../spec-kind';
import { assessBehavior, type Assessment, type ReleaseIdentity } from './applicability';
import { COVERAGE, featureBehaviors, type Behavior, type RevisionSource } from './behavior';
import { featureModel, scenarioLabel, type FeatureModel } from './gherkin';

/** One behavior of the project, with where it is written. */
export type IndexedBehavior = {
  /** Stable for the behavior within the project: the feature file and the behavior's key in it. Safe in an address. */
  readonly id: string;
  /** The feature file relative to the specs folder. */
  readonly file: string;
  /** The path reports name the feature by (`specs/…`). */
  readonly specPath: string;
  /** The feature's title. */
  readonly feature: string;
  /** The domain the spec metadata declares; empty when it declares none (nothing is invented). */
  readonly domain: string;
  /** The rule the scenario sits under, or null. */
  readonly rule: string | null;
  /** The behavior in words: the scenario, and for an outline's example its example label. */
  readonly title: string;
  readonly behavior: Behavior;
  /** Whether the evidence applies to the promise as written now (no release is named in this index). */
  readonly assessment: Assessment;
};

/** The behaviors of the project and what could not be read into them. */
export type BehaviorIndex = {
  readonly entries: readonly IndexedBehavior[];
  /** Feature files in the project. */
  readonly features: number;
  /** Feature files whose text has not arrived yet; their behaviors are not here yet. */
  readonly unread: number;
  /** Feature files that could not be read or parsed; their behaviors are not here. */
  readonly unreadable: readonly string[];
};

/** What the index reads: the feature files and their texts, the outline (domains, fingerprints) and the report. */
export type IndexInput = {
  /** The feature files, relative to the specs folder. */
  readonly files: readonly string[];
  /** The text of each file read so far; an empty text is a file that could not be read. */
  readonly texts: ReadonlyMap<string, string>;
  readonly specs: readonly SpecEntry[];
  readonly view: EvidenceView;
  /** The layers the report holds, for the spec fingerprint each recorded. */
  readonly evidence: readonly Pick<LayerEvidence, 'layer' | 'fingerprints'>[];
  readonly release?: ReleaseIdentity;
};

function parse(text: string): FeatureModel | null {
  try {
    return featureModel(text);
  } catch {
    return null;
  }
}

/** Reads every feature into behaviors. Pure: the same inputs give the same list, in file then page order. */
export function indexBehaviors(input: IndexInput): BehaviorIndex {
  const fingerprints = new Map(input.evidence.map((layer) => [layer.layer.id, layer.fingerprints] as const));
  const entries: IndexedBehavior[] = [];
  const unreadable: string[] = [];
  let unread = 0;
  for (const file of input.files) {
    const text = input.texts.get(file);
    if (text === undefined) {
      unread += 1;
      continue;
    }
    const feature = text === '' ? null : parse(text);
    if (!feature) {
      unreadable.push(file);
      continue;
    }
    const specPath = outlinePath(file);
    const spec = input.specs.find((candidate) => candidate.path === specPath);
    const revisions: RevisionSource = { current: spec?.fingerprint ?? null, recorded: (id) => fingerprints.get(id)?.[specPath] };
    const found = featureBehaviors(feature, input.view.specs.get(specPath)?.slots ?? [], revisions);
    const ruleOf = new Map(feature.rules.flatMap((rule) => rule.scenarios.map((scenario) => [scenario, rule.name] as const)));
    for (const behavior of found.all) {
      const claimed = found.byScenario.has(behavior.scenario);
      entries.push({
        id: `${file}#${behavior.key}`,
        file,
        specPath,
        feature: feature.name || file.split('/').at(-1)!,
        domain: spec?.domain ?? '',
        rule: ruleOf.get(behavior.scenario) ?? null,
        title: claimed
          ? behavior.example
            ? `${behavior.scenario.name} — ${behavior.example}`
            : behavior.scenario.name
          : scenarioLabel(feature.name, behavior.scenario.name),
        behavior,
        assessment: assessBehavior(behavior, revisions, input.release ?? {})
      });
    }
  }
  return { entries, features: input.files.length, unread, unreadable };
}

/** The check status a behavior's search document filters by, or none when nothing reported on it. */
function statusOf(behavior: Behavior): FindStatus {
  return behavior.slot?.status ?? 'none';
}

/**
 * A behavior as a searchable document for the shared matcher (`find/`): its wording and steps are what a reader searches
 * by; the feature, rule, domain, tags and coverage state are metadata. Its facets feed the typed filters (`status:`,
 * `domain:`, `spec:`, `tag:`, `env:`, `has:video`).
 */
export function behaviorDoc(entry: IndexedBehavior): FindDoc {
  const { behavior } = entry;
  const outcomes = behavior.slot?.outcomes ?? [];
  const steps = behavior.scenario.steps.map((step) => `${step.keyword} ${step.text}`).join('\n');
  const fields: FindField[] = [{ name: 'title', text: entry.title }];
  if (steps) fields.push({ name: 'steps', text: steps });
  const description = [entry.feature, entry.rule ?? '', behavior.scenario.description].filter(Boolean).join('\n');
  if (description) fields.push({ name: 'description', text: description });
  const metadata = [entry.domain, ...behavior.scenario.tags, COVERAGE[behavior.state].label].filter(Boolean);
  fields.push({ name: 'metadata', text: metadata.join('\n') });
  fields.push({ name: 'path', text: entry.specPath });
  const facets: DocFacets = {
    status: behavior.slot ? [behavior.slot.status] : [],
    env: [...new Set(outcomes.map((result) => result.layer.environment ?? '(none)'))],
    producer: [...new Set(outcomes.map((result) => result.layer.producer))],
    domain: [entry.domain || '(no domain)'],
    spec: [entry.specPath],
    tag: behavior.scenario.tags.map((tag) => tag.replace(/^@/, '')),
    branch: [...new Set(outcomes.flatMap((result) => (result.layer.branch ? [result.layer.branch] : [])))],
    video: behavior.demo !== null
  };
  return {
    id: entry.id,
    group: 'Specs',
    kind: 'scenario',
    title: entry.title,
    subtitle: entry.feature,
    fields,
    status: statusOf(behavior),
    related: [],
    target: { to: '/specs/$kind', kind: 'gherkin', search: { spec: entry.file, ...(behavior.slot ? { check: behavior.slot.id } : {}) } },
    recording: null,
    facets
  };
}
