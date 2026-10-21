import type { CheckSlot, EvidenceView } from '@crvouga/atlas/reports/evidence-view';
import { isStatechartFile, type RunStatus } from '@crvouga/atlas/schema';

import type { AtlasView, ItemStatus } from '../data/model';
import { worstOf } from '../data/model/status';
import { featureModel, scenarioLabel, slotsByScenario } from '../evidence/gherkin';
import { kindOfFile, outlinePath, specFile } from '../spec-kind';
import type { FindDoc, FindField, FindStatus, FindTarget } from './rank';

export type CorpusChart = { readonly id: string; readonly name: string };

export type CorpusState = {
  readonly name: string;
  readonly chartId: string;
  readonly kind: string;
  readonly description: string;
  readonly status: ItemStatus;
};

export type CorpusTransition = {
  readonly id: string;
  readonly chartId: string;
  readonly event: string;
  readonly source: string;
  readonly target: string | null;
  readonly status: ItemStatus;
  readonly carriedBy?: string | null;
};

export type CorpusPath = {
  readonly id: string;
  readonly name: string;
  readonly status: RunStatus;
  readonly events: readonly string[];
};

export type CorpusJourney = {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly chartId: string;
  readonly events: readonly string[];
  readonly endsIn: readonly string[];
  readonly status: ItemStatus;
  readonly paths: readonly CorpusPath[];
};

export type CorpusFile = { readonly path: string; readonly title: string };

export type CorpusSlot = {
  readonly key: string;
  readonly id: string;
  readonly title: string;
  readonly specPath: string | null;
  readonly status: FindStatus;
  readonly detail: string;
  readonly recording: boolean;
};

export type CorpusSource = {
  readonly charts: readonly CorpusChart[];
  readonly states: readonly CorpusState[];
  readonly transitions: readonly CorpusTransition[];
  readonly journeys: readonly CorpusJourney[];
  readonly files: readonly CorpusFile[];
  readonly slots: readonly CorpusSlot[];
  readonly texts: ReadonlyMap<string, string>;
  /** The project home is the test explorer (no statecharts): a check without a published spec opens there. */
  readonly explorer?: boolean;
};

function itemStatus(status: ItemStatus): FindStatus {
  if (status === 'passed') return 'passed';
  if (status === 'failed' || status === 'flaky') return 'failed';
  if (status === 'not-yet-run') return 'running';
  return 'none';
}

function runStatus(status: RunStatus): FindStatus {
  if (status === 'passed') return 'passed';
  if (status === 'failed' || status === 'flaky') return 'failed';
  return 'not-run';
}

function chartTarget(chartId: string, search: FindTarget['search']): FindTarget {
  return { to: '/chart/$chartId', chartId, search };
}

function specTarget(kind: string, spec: string, check?: string, recording = false): FindTarget {
  return {
    to: '/specs/$kind',
    kind,
    search: { spec, ...(check ? { check } : {}), ...(recording ? { view: 'recording' as const } : {}) }
  };
}

/** The first slot that has a timeline, opened as a recording. */
function timelineTarget(kind: string | null, file: string, slots: readonly CorpusSlot[]): FindTarget | null {
  if (!kind) return null;
  const slot = slots.find((item) => item.recording);
  return slot ? specTarget(kind, file, slot.id, true) : null;
}

function fieldsOf(title: string, steps: string, description: string, path: string): FindField[] {
  const fields: FindField[] = [{ name: 'title', text: title }];
  if (steps) fields.push({ name: 'steps', text: steps });
  if (description) fields.push({ name: 'description', text: description });
  if (path) fields.push({ name: 'path', text: path });
  return fields;
}

function places(names: readonly string[]): string {
  const unique = [...new Set(names.filter(Boolean))];
  if (unique.length <= 3) return unique.join(', ');
  return `${unique.slice(0, 3).join(', ')}, and ${unique.length - 3} more`;
}

function slotsFor(file: string, slots: readonly CorpusSlot[]): CorpusSlot[] {
  return slots.filter((slot) => slot.specPath === outlinePath(file) || (slot.specPath !== null && specFile(slot.specPath) === file));
}

function worstStatus(statuses: readonly FindStatus[]): FindStatus {
  const rank: Record<FindStatus, number> = { failed: 3, running: 2, 'not-run': 1, passed: 0, none: 0 };
  return statuses.reduce((worst, status) => (rank[status] > rank[worst] ? status : worst), 'passed');
}

const ACTION = /^\s*action\s+([A-Za-z_][A-Za-z0-9_]*)/gm;

function actionsIn(text: string): string[] {
  return [...new Set([...text.matchAll(ACTION)].map((match) => match[1]!))];
}

function runDoc(slot: CorpusSlot, title: string, kind: string | null, file: string, explorer = false): FindDoc {
  if (explorer) {
    return { id: `run:${slot.key}`, group: 'Runs', kind: 'run', title, subtitle: file, fields: fieldsOf(title, '', slot.detail, file), status: slot.status, related: [], target: { to: '/', search: { test: slot.key } }, recording: null };
  }
  const recording = timelineTarget(kind, file, [slot]);
  return {
    id: `run:${slot.key}`,
    group: 'Runs',
    kind: 'run',
    title,
    subtitle: file,
    fields: fieldsOf(title, '', slot.detail, file),
    status: slot.status,
    related: [],
    // Enter opens the recording when this check has a timeline.
    target: recording ?? (kind ? specTarget(kind, file, slot.id) : { to: '/' as const, search: {} }),
    recording
  };
}

/** Every flow, spec and recorded run the finder can open. */
export function buildCorpus(source: CorpusSource): FindDoc[] {
  const chartName = new Map(source.charts.map((chart) => [chart.id, chart.name]));
  const docs: FindDoc[] = [];
  const seenRuns = new Set<string>();

  for (const state of source.states) {
    if (state.kind !== 'screen' && state.kind !== 'final') continue;
    docs.push({
      id: `screen:${state.chartId}:${state.name}`,
      group: 'Flows',
      kind: 'screen',
      title: state.name,
      subtitle: chartName.get(state.chartId) ?? '',
      fields: fieldsOf(state.name, '', state.description, ''),
      status: itemStatus(state.status),
      related: [],
      target: chartTarget(state.chartId, { screen: state.name }),
      recording: null
    });
  }

  const events = new Map<string, CorpusTransition[]>();
  for (const transition of source.transitions) {
    if (!transition.event) continue;
    const key = `${transition.chartId}\0${transition.event}`;
    const group = events.get(key);
    if (group) group.push(transition);
    else events.set(key, [transition]);
  }
  for (const group of events.values()) {
    const first = group.find((transition) => !transition.carriedBy) ?? group[0]!;
    const where = places(group.flatMap((transition) => [transition.source, transition.target ?? '']));
    docs.push({
      id: `event:${first.chartId}:${first.event}`,
      group: 'Flows',
      kind: 'event',
      title: first.event,
      subtitle: where,
      fields: fieldsOf(first.event, '', where, ''),
      status: itemStatus(worstOf(group.map((transition) => transition.status), 'spec-only')),
      related: [],
      target: chartTarget(first.chartId, { event: first.id }),
      recording: null
    });
  }

  for (const journey of source.journeys) {
    const pathIds = journey.paths.map((path) => `path:${journey.id}:${path.id}`);
    docs.push({
      id: `journey:${journey.id}`,
      group: 'Flows',
      kind: 'journey',
      title: journey.name,
      subtitle: chartName.get(journey.chartId) ?? '',
      fields: fieldsOf(journey.name, journey.events.join('\n'), [journey.description, ...journey.endsIn].filter(Boolean).join('\n'), ''),
      status: itemStatus(journey.status),
      related: pathIds,
      target: chartTarget(journey.chartId, { journey: journey.id }),
      recording: null
    });
    for (const path of journey.paths) {
      docs.push({
        id: `path:${journey.id}:${path.id}`,
        group: 'Runs',
        kind: 'run',
        title: path.name || journey.name,
        subtitle: journey.name,
        fields: fieldsOf(path.name || journey.name, path.events.join('\n'), '', ''),
        status: runStatus(path.status),
        related: [],
        target: chartTarget(journey.chartId, { journey: journey.id }),
        recording: null
      });
    }
  }

  const pushRun = (slot: CorpusSlot, title: string, kind: string | null, file: string, explorer = false) => {
    const id = `run:${slot.key}`;
    if (seenRuns.has(id)) return;
    seenRuns.add(id);
    docs.push(runDoc(slot, title, kind, file, explorer));
  };

  for (const file of source.files) {
    const kind = kindOfFile(file.path);
    if (!kind) continue;
    const text = source.texts.get(file.path);
    const mine = slotsFor(file.path, source.slots);
    if (kind.id === 'gherkin' && text) {
      let feature: ReturnType<typeof featureModel> = null;
      try {
        feature = featureModel(text);
      } catch {
        feature = null;
      }
      if (feature) {
        const filed = slotsByScenario(feature, mine as unknown as CheckSlot[]);
        docs.push({
          id: `spec:${file.path}`,
          group: 'Specs',
          kind: 'spec',
          title: feature.name || file.title,
          subtitle: file.path,
          fields: fieldsOf(feature.name || file.title, '', feature.description, file.path),
          status: null,
          related: [],
          target: specTarget(kind.id, file.path),
          recording: null
        });
        for (const rule of feature.rules) {
          for (const scenario of rule.scenarios) {
            if (scenario.background) continue;
            const recorded = (filed.byScenario.get(scenario.name) ?? []) as unknown as CorpusSlot[];
            const steps = [
              ...scenario.steps.map((step) => `${step.keyword} ${step.text}`.trim()),
              ...scenario.examples.flatMap((example) => example.rows.flat())
            ].join('\n');
            docs.push({
              id: `scenario:${file.path}:${scenario.name}`,
              group: 'Specs',
              kind: 'scenario',
              title: scenario.name,
              subtitle: feature.name || file.title,
              fields: fieldsOf(scenario.name, steps, [rule.name ?? '', rule.description, scenario.description].filter(Boolean).join('\n'), file.path),
              status: recorded.length ? worstStatus(recorded.map((slot) => slot.status)) : null,
              related: recorded.map((slot) => `run:${slot.key}`),
              target: specTarget(kind.id, file.path, recorded[0]?.id ?? `scenario:${scenario.name}`),
              recording: timelineTarget(kind.id, file.path, recorded)
            });
          }
        }
        for (const slot of mine) pushRun(slot, scenarioLabel(feature.name, slot.title), kind.id, file.path);
        continue;
      }
    }
    if (kind.id === 'quint' && text) {
      for (const name of actionsIn(text)) {
        docs.push({
          id: `action:${file.path}:${name}`,
          group: 'Specs',
          kind: 'action',
          title: name,
          subtitle: file.title,
          fields: fieldsOf(name, '', '', file.path),
          status: null,
          related: mine.map((slot) => `run:${slot.key}`),
          target: specTarget(kind.id, file.path, mine[0]?.id),
          recording: timelineTarget(kind.id, file.path, mine)
        });
      }
    }
    docs.push({
      id: `spec:${file.path}`,
      group: 'Specs',
      kind: 'spec',
      title: file.title,
      subtitle: file.path,
      fields: fieldsOf(file.title, '', text ?? '', file.path),
      status: null,
      related: mine.map((slot) => `run:${slot.key}`),
      target: specTarget(kind.id, file.path, mine[0]?.id),
      recording: timelineTarget(kind.id, file.path, mine)
    });
    for (const slot of mine) pushRun(slot, slot.title, kind.id, file.path);
  }

  for (const slot of source.slots) {
    const file = slot.specPath ? specFile(slot.specPath) : '';
    // Its spec was not published: in a project without statecharts the explorer has it, with everything recorded for it.
    pushRun(slot, slot.title, file ? kindOfFile(file)?.id ?? null : null, file, source.explorer === true);
  }
  return docs;
}

/** The view and the evidence the page already holds, in the shape `buildCorpus` reads. */
export function corpusFrom(view: AtlasView | null, files: readonly string[], titleOf: (file: string) => string, evidence: EvidenceView, texts: ReadonlyMap<string, string>): FindDoc[] {
  const slots: CorpusSlot[] = [];
  const take = (slot: CheckSlot) => {
    slots.push({
      key: slot.key,
      id: slot.id,
      title: slot.title,
      specPath: slot.specPath,
      status: slot.status,
      detail: slot.outcomes.map((outcome) => outcome.row.detail).filter(Boolean).join('\n'),
      recording: slot.outcomes.some((outcome) => outcome.row.testId !== null)
    });
  };
  for (const entry of evidence.specs.values()) for (const slot of entry.slots) take(slot);
  for (const slot of evidence.unassigned) take(slot);
  return buildCorpus({
    charts: view ? [...view.charts.values()].map((chart) => ({ id: chart.id, name: chart.name })) : [],
    states: view ? [...view.states.values()].map((state) => ({ name: state.name, chartId: state.chartId, kind: state.kind, description: state.description, status: state.status })) : [],
    transitions: view
      ? [...view.transitions.values()].map((transition) => ({
          id: transition.id,
          chartId: transition.chartId,
          event: transition.event,
          source: transition.source,
          target: transition.target,
          status: transition.status,
          carriedBy: transition.carriedBy
        }))
      : [],
    journeys: view
      ? view.journeys.map((journey) => ({
          id: journey.id,
          name: journey.name,
          description: journey.description,
          chartId: journey.chartIds[0] ?? '',
          events: journey.events,
          endsIn: journey.endsIn,
          status: journey.status,
          paths: journey.runPaths.map((path) => ({ id: path.id, name: path.name, status: path.status, events: path.steps.map((step) => step.event) }))
        }))
      : [],
    files: files.map((path) => ({ path, title: titleOf(path) })),
    slots,
    texts,
    explorer: !files.some(isStatechartFile)
  });
}
