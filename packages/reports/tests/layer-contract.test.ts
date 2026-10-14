import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { LAYER_SCHEMA_VERSION, parseLayerDocument } from '../../schema/src/layer';
import { layerEvidence, specPath } from '../src/layer-merge';
import { layerKey, publishLayerBundle, readLayer } from '../src/layer-store';
import type { LayerSummary } from '../src/layer-types';
import { writeUtf8 } from '../src/object-io';
import { memoryStore } from './memory-store';

const golden = JSON.parse(readFileSync(path.join(import.meta.dir, 'fixtures', 'layer-v1.json'), 'utf8')) as Record<string, unknown>;

describe('naming a spec', () => {
  test('a spec is named from the first folder called specs, and only a folder called exactly that', () => {
    expect(specPath('specs/join.feature')).toBe('specs/join.feature');
    expect(specPath('./specs/join.feature')).toBe('specs/join.feature');
    expect(specPath('packages/app/specs/nested/join.feature')).toBe('specs/nested/join.feature');
    expect(specPath('C:\\work\\app\\specs\\join.feature')).toBe('specs/join.feature');
    expect(specPath('myspecs/join.feature')).toBe('myspecs/join.feature');
    expect(specPath('features/join.feature')).toBe('features/join.feature');
    expect(specPath('a/specs/b/specs/c.feature')).toBe('specs/b/specs/c.feature');
  });
});

describe('the layer contract, version 1', () => {
  test('the golden v1 layer is readable forever: this fixture must never need editing to keep passing', () => {
    const parsed = parseLayerDocument(golden);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.layer.producer).toBe('gherkin');
    expect(parsed.layer.parts[0]!.checks.map(check => check.status)).toEqual(['passed', 'failed']);
    // Fields from a later minor version survive untouched, so a copy never loses them.
    expect((parsed.layer as Record<string, unknown>).addedByALaterMinorVersion).toEqual({ anything: true });
    const evidence = layerEvidence(parsed.layer as unknown as LayerSummary, 'any');
    expect(evidence.layer.environment).toBe('ios');
    expect(evidence.rows.map(row => row.durationMs)).toEqual([120, null]);
  });

  test('a layer written before schemaVersion existed is version 1', () => {
    const { schemaVersion: _, ...legacy } = golden;
    expect(parseLayerDocument(legacy).ok).toBe(true);
  });

  test('a layer of a newer major version is refused by name, never half read', () => {
    const parsed = parseLayerDocument({ ...golden, schemaVersion: LAYER_SCHEMA_VERSION + 1 });
    expect(parsed).toEqual({ ok: false, reason: expect.stringContaining('Upgrade @crvouga/atlas') });
  });

  test.each([
    ['an unknown status', { parts: [{ ...(golden.parts as object[])[0], checks: [{ id: 'a', title: 'a', status: 'flaky' }] }] }],
    ['a check without an id', { parts: [{ ...(golden.parts as object[])[0], checks: [{ title: 'a', status: 'passed' }] }] }],
    ['a non-finite time', { recordedAtMs: -1 }],
    ['no producer', { producer: '' }],
    ['a malformed id', { id: 'not-a-digest' }],
    ['parts that are not a list', { parts: {} }],
  ])('%s is invalid, and the reason says where', (_, change) => {
    const parsed = parseLayerDocument({ ...golden, ...change });
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toStartWith('Not a valid layer:');
  });

  test('nothing but a JSON object is a layer', () => {
    for (const value of [null, 'text', 7, [], undefined]) expect(parseLayerDocument(value).ok).toBe(false);
  });

  const summary: Omit<LayerSummary, 'id'> = { producer: 'p', recordedAtMs: 1, sha: null, branch: null, runUrl: null, parameters: {}, specs: [], source: null, recording: null, parts: [] };

  test('a published layer is written with its schema version and reads back identically', async () => {
    const store = memoryStore();
    const layer = await publishLayerBundle(store, summary, {});
    const raw = JSON.parse(await new Response((await store.get(layerKey(layer.id)))!.body).text());
    expect(raw.schemaVersion).toBe(LAYER_SCHEMA_VERSION);
    expect(await readLayer(store, layer.id)).toEqual(layer);
  });

  test('publishing the same layer again changes nothing, whoever publishes it', async () => {
    const a = memoryStore(), b = memoryStore();
    const first = await publishLayerBundle(a, summary, {});
    const again = await publishLayerBundle(a, summary, {});
    const elsewhere = await publishLayerBundle(b, { ...summary }, {});
    expect(again.id).toBe(first.id);
    expect(elsewhere.id).toBe(first.id);
    expect((await a.listKeys()).length).toBe(2);
  });

  test('a layer that cannot be read says why instead of breaking the page', async () => {
    const store = memoryStore();
    const id = 'f'.repeat(64);
    await writeUtf8(store, layerKey(id), JSON.stringify({ ...golden, schemaVersion: 9 }), 'application/json');
    await expect(readLayer(store, id)).rejects.toThrow('Upgrade @crvouga/atlas');
    await writeUtf8(store, layerKey(id), '{not json', 'application/json');
    await expect(readLayer(store, id)).rejects.toThrow('is not JSON');
  });
});
