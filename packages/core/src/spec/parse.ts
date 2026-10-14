/**
 * @module Chart and journeys parsers
 *
 * Turns the text of one spec file into a `Chart` or a list of `Journey`. Pure functions of their
 * input (no file access), so they run in a browser too. They check only the shape that later stages
 * rely on; whether the chart is executable is the linter's job.
 *
 * @see docs/statecharts.md
 */
import YAML from 'yaml';

import type { Chart, Journey, MachineConfig } from './types';
import { scxmlToMachine } from './scxml';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Parses one chart from its text. The file name picks the format: `.scxml` is SCXML (the machine id
 * falls back to the file's base name), `.json` is an XState config, anything else is read as YAML.
 *
 * @param file the file name, relative to the specs directory; stored as `Chart.file`.
 * @param text the file contents.
 * @throws Error when an XState config is not an object with a string `id` and a `states` object, or
 *   when the text is not valid JSON/YAML/SCXML.
 */
export function parseChart(file: string, text: string): Chart {
  if (file.endsWith('.scxml')) {
    return { file, format: 'scxml', machine: scxmlToMachine(text, file.replace(/^.*[\\/]/, '').replace(/\.scxml$/, '')) };
  }
  const value: unknown = file.endsWith('.json') ? JSON.parse(text) : YAML.parse(text);
  if (!isRecord(value) || typeof value['id'] !== 'string' || !isRecord(value['states'])) {
    throw new Error(`${file} is not an XState machine config with an id and states`);
  }
  return { file, format: 'xstate', machine: value as MachineConfig };
}

/**
 * Parses a journeys file of the form `{ journeys: { <name>: { description, events, endsIn } } }`
 * (JSON when the name ends in `.json`, otherwise YAML). Journeys come back in declaration order.
 * `description` defaults to `''` and `endsIn` to `[]`; events are coerced to strings.
 *
 * @throws Error when there is no `journeys` map, or a journey has no `events` list.
 */
export function parseJourneys(file: string, text: string): Journey[] {
  const value: unknown = file.endsWith('.json') ? JSON.parse(text) : YAML.parse(text);
  if (!isRecord(value) || !isRecord(value['journeys'])) throw new Error(`${file} has no journeys map`);
  return Object.entries(value['journeys']).map(([name, raw]) => {
    if (!isRecord(raw) || !Array.isArray(raw['events'])) throw new Error(`${file}: journey "${name}" needs an events list`);
    return {
      name,
      description: typeof raw['description'] === 'string' ? raw['description'] : '',
      events: raw['events'].map(String),
      endsIn: Array.isArray(raw['endsIn']) ? raw['endsIn'].map(String) : []
    };
  });
}
