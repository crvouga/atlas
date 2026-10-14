import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { renderSchemas } from '../scripts/schemas';

const directory = path.join(import.meta.dir, '..', 'schemas');

test('the JSON Schema files are the ones the Zod schemas emit (run `bun run schemas`)', () => {
  const rendered = renderSchemas();
  expect(readdirSync(directory).sort()).toEqual(Object.keys(rendered).sort());
  for (const [file, text] of Object.entries(rendered)) expect(readFileSync(path.join(directory, file), 'utf8')).toBe(text);
});

test('every schema names itself and its dialect', () => {
  for (const file of readdirSync(directory)) {
    const schema = JSON.parse(readFileSync(path.join(directory, file), 'utf8')) as { $id: string; $schema: string };
    expect(schema.$id).toBe(`https://github.com/crvouga/atlas/schemas/${file}`);
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
  }
});

test('the layer contract requires what a reader needs and nothing a producer cannot know', () => {
  const layer = JSON.parse(readFileSync(path.join(directory, 'layer.schema.json'), 'utf8')) as { required: string[]; properties: Record<string, { const?: unknown }>; additionalProperties?: unknown };
  expect(layer.required.sort()).toEqual(['branch', 'id', 'parts', 'producer', 'recordedAtMs', 'runUrl', 'schemaVersion', 'sha']);
  expect(layer.properties.schemaVersion!.const).toBe(1);
  // Loose: a newer minor version may add fields, and an older reader must not reject them.
  expect(layer.additionalProperties).not.toBe(false);
});
