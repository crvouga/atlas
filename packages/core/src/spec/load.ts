import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { Chart, Journey, MachineConfig, SpecBundle } from './types';
import { parseChart, parseJourneys } from './parse';
import { invokesOf, walkStates } from './types';

export { parseChart, parseJourneys };

const CHART_FILE = /(\.scxml|(^|\.)machine\.(ya?ml|json))$/;
const JOURNEY_FILE = /^journeys\.(ya?ml|json)$/;

/** The ids of the charts a machine composes, by `invoke` or the legacy `meta.childMachine`. */
export function childChartIds(machine: MachineConfig) {
  const ids = new Set<string>();
  for (const { node } of walkStates(machine)) {
    for (const invoke of invokesOf(node)) ids.add(invoke.src);
    if (typeof node.meta?.childMachine === 'string') ids.add(node.meta.childMachine);
  }
  return ids;
}

export function bundleOf(directory: string, charts: Chart[], journeys: Journey[]): SpecBundle {
  const invoked = new Set(charts.flatMap((c) => [...childChartIds(c.machine)]));
  const roots = charts.filter((c) => !invoked.has(c.machine.id));
  const root = roots[0]?.machine.id ?? charts[0]?.machine.id;
  if (!root) throw new Error(`No statechart found in ${directory}`);
  return { directory, charts, journeys, root };
}

/** Load every chart and journeys file directly inside `directory`. */
export function loadSpecDirectory(directory: string): SpecBundle {
  if (!existsSync(directory)) throw new Error(`Spec directory not found: ${directory}`);
  const files = readdirSync(directory).sort();
  const rank = (f: string) => (f.endsWith('.scxml') ? 0 : /\.ya?ml$/.test(f) ? 1 : 2);
  const parsed = files
    .filter((f) => CHART_FILE.test(f))
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map((f) => parseChart(f, readFileSync(path.join(directory, f), 'utf8')));
  const byId = new Map<string, Chart>();
  for (const chart of parsed) if (!byId.has(chart.machine.id)) byId.set(chart.machine.id, chart);
  const charts = [...byId.values()];
  const journeys = files
    .filter((f) => JOURNEY_FILE.test(f))
    .flatMap((f) => parseJourneys(f, readFileSync(path.join(directory, f), 'utf8')));
  return bundleOf(directory, charts, journeys);
}
