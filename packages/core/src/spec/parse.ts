import YAML from 'yaml';

import type { Chart, Journey, MachineConfig } from './types';
import { scxmlToMachine } from './scxml';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Parse one chart from its text, by file name: SCXML or XState config in JSON or YAML. */
export function parseChart(file: string, text: string): Chart {
  if (file.endsWith('.scxml')) {
    return { file, format: 'scxml', machine: scxmlToMachine(text, file.replace(/^.*[\\/]/, '').replace(/\.scxml$/, '')) };
  }
  const value: unknown = file.endsWith('.json') ? JSON.parse(text) : YAML.parse(text);
  if (!isRecord(value) || typeof value.id !== 'string' || !isRecord(value.states)) {
    throw new Error(`${file} is not an XState machine config with an id and states`);
  }
  return { file, format: 'xstate', machine: value as MachineConfig };
}

/** Parse a journeys file: `{ journeys: { <name>: { description, events, endsIn } } }`. */
export function parseJourneys(file: string, text: string): Journey[] {
  const value: unknown = file.endsWith('.json') ? JSON.parse(text) : YAML.parse(text);
  if (!isRecord(value) || !isRecord(value.journeys)) throw new Error(`${file} has no journeys map`);
  return Object.entries(value.journeys).map(([name, raw]) => {
    if (!isRecord(raw) || !Array.isArray(raw.events)) throw new Error(`${file}: journey "${name}" needs an events list`);
    return {
      name,
      description: typeof raw.description === 'string' ? raw.description : '',
      events: raw.events.map(String),
      endsIn: Array.isArray(raw.endsIn) ? raw.endsIn.map(String) : []
    };
  });
}

