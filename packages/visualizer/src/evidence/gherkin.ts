import { AstBuilder, GherkinClassicTokenMatcher, Parser } from '@cucumber/gherkin';
import { IdGenerator, type Step, type TableRow } from '@cucumber/messages';
import type { CheckSlot } from '@crvouga/atlas-reports/evidence-view';

export function parseFeature(text: string) {
  return new Parser(new AstBuilder(IdGenerator.incrementing()), new GherkinClassicTokenMatcher()).parse(text);
}

export type FeatureStep = { readonly keyword: string; readonly text: string; readonly docString: string | null; readonly table: readonly (readonly string[])[] };
export type FeatureExamples = { readonly name: string; readonly header: readonly string[]; readonly rows: readonly (readonly string[])[] };
export type FeatureScenario = {
  readonly keyword: string;
  readonly name: string;
  readonly description: string;
  readonly background: boolean;
  readonly steps: readonly FeatureStep[];
  readonly examples: readonly FeatureExamples[];
};
export type FeatureRule = { readonly name: string | null; readonly description: string; readonly scenarios: readonly FeatureScenario[] };
export type FeatureModel = { readonly name: string; readonly description: string; readonly rules: readonly FeatureRule[] };

/** Prose as paragraphs: a feature file wraps its lines by hand, a page wraps them itself. */
function prose(text: string) {
  return text.trim().split(/\n\s*\n/).map((paragraph) => paragraph.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean).join('\n\n');
}

function cells(row: TableRow | undefined) {
  return row?.cells.map((cell) => cell.value) ?? [];
}

function steps(list: readonly Step[]): FeatureStep[] {
  return list.map((step) => ({ keyword: step.keyword.trim(), text: step.text, docString: step.docString?.content ?? null, table: step.dataTable?.rows.map(cells) ?? [] }));
}

/** A feature as rules holding scenarios. Scenarios outside a rule share one unnamed group. */
export function featureModel(text: string): FeatureModel | null {
  const feature = parseFeature(text).feature;
  if (!feature) return null;
  const rules: { name: string | null; description: string; scenarios: FeatureScenario[] }[] = [];
  const loose = () => {
    const last = rules.at(-1);
    if (last && last.name === null) return last;
    const group = { name: null, description: '', scenarios: [] as FeatureScenario[] };
    rules.push(group);
    return group;
  };
  for (const child of feature.children) {
    const group = child.rule ? { name: child.rule.name, description: prose(child.rule.description), scenarios: [] as FeatureScenario[] } : loose();
    if (child.rule) rules.push(group);
    for (const entry of child.rule ? child.rule.children : [child]) {
      const background = entry.background;
      const scenario = entry.scenario;
      if (background) group.scenarios.push({ keyword: background.keyword, name: background.name, description: prose(background.description), background: true, steps: steps(background.steps), examples: [] });
      if (scenario) {
        group.scenarios.push({
          keyword: scenario.keyword,
          name: scenario.name,
          description: prose(scenario.description),
          background: false,
          steps: steps(scenario.steps),
          examples: scenario.examples.map((example) => ({ name: example.name, header: cells(example.tableHeader), rows: example.tableBody.map(cells) }))
        });
      }
    }
  }
  return { name: feature.name, description: prose(feature.description), rules };
}

/** What a recorded check is called without the feature in front: the scenario, then the example. */
export function scenarioLabel(feature: string, title: string) {
  const head = `${feature}: `;
  return title.startsWith(head) ? title.slice(head.length) : title;
}

/** The example a result ran, when its scenario has several. */
export function exampleLabel(scenario: string, label: string) {
  return label.startsWith(`${scenario} — `) ? label.slice(scenario.length + 3) : null;
}

/**
 * File each recorded check under the scenario it ran. An outline has one result per example. A
 * result no scenario claims (the scenario was renamed, or the check is not a scenario) is returned
 * as left over, never dropped.
 */
export function slotsByScenario(feature: FeatureModel, slots: readonly CheckSlot[]) {
  const names = feature.rules.flatMap((rule) => rule.scenarios.filter((scenario) => !scenario.background).map((scenario) => scenario.name));
  // The longest name wins, so "Join" never claims "Join — again" from a scenario called that.
  const longestFirst = [...new Set(names)].sort((a, b) => b.length - a.length);
  const byScenario = new Map<string, CheckSlot[]>();
  const leftOver: CheckSlot[] = [];
  for (const slot of slots) {
    const label = scenarioLabel(feature.name, slot.title);
    const owner = longestFirst.find((name) => label === name || label.startsWith(`${name} — `));
    if (owner === undefined) leftOver.push(slot);
    else byScenario.set(owner, [...(byScenario.get(owner) ?? []), slot]);
  }
  return { byScenario, leftOver };
}
