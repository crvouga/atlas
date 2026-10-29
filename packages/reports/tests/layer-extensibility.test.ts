import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod/v4';

import { parseLayerDocument } from '../../schema/src/layer';
import { layerEvidence } from '../src/layer-merge';
import type { LayerSummary } from '../src/layer-types';

const fixture = JSON.parse(readFileSync(path.join(import.meta.dir, 'fixtures', 'layer-v1-extended.json'), 'utf8')) as Record<string, unknown>;
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe('evidence is open', () => {
  test('reading evidence preserves the original document and its content-addressed bytes', () => {
    const doc = clone(fixture);
    const before = JSON.stringify(doc);
    expect(parseLayerDocument(doc).ok).toBe(true);
    expect(JSON.stringify(doc)).toBe(before);
  });
  test('a layer that carries every kind of evidence parses, and keeps all of it', () => {
    const parsed = parseLayerDocument(fixture);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const check = parsed.layer.parts[0]!.checks[0]!;
    expect(check.steps!.map(step => [step.id, step.parentId ?? null])).toEqual([['s1', null], ['s2', 's1'], ['s3', null]]);
    expect(check.attachments!.map(item => item.role)).toEqual(['video', 'screenshot', 'captions', 'snapshot', 'trace', 'hologram']);
    expect(check.attachments![0]!.tags).toEqual(['demo']);
    expect(check.attachments![0]!.scope).toMatchObject({ surface: 'browser', audioCaptured: false, verified: ['audioCaptured'], 'com.example.future': true });
    expect(check.attempts!.length).toBe(2);
    expect(check.tags).toEqual(['smoke', 'payments']);
    expect(check.labels).toEqual({ owner: 'payments-team', severity: 'high' });
    expect(check.extensions).toEqual({ 'com.example.coverage': { lines: 0.82 }, 'io.playwright': { retries: 1 } });
    expect(parsed.layer.attachments![0]!.name).toBe('ci.log');
    expect(parsed.layer.labels).toEqual({ build: '4821', os: 'linux' });
    expect(parsed.layer.extensions).toEqual({ 'com.example.cost': { cents: 12 } });
  });

  test('a vocabulary nobody has heard of is kept: the role, the media type, the kind of note, the step status', () => {
    const doc = clone(fixture) as { parts: { checks: { steps: { status: string }[]; annotations: { type: string; level: string }[] }[] }[] };
    doc.parts[0]!.checks[0]!.steps[0]!.status = 'quantum-superposition';
    doc.parts[0]!.checks[0]!.annotations[0]!.level = 'existential';
    const parsed = parseLayerDocument(doc);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const check = parsed.layer.parts[0]!.checks[0]!;
    expect(check.steps![0]!.status).toBe('quantum-superposition');
    expect(check.annotations![0]!.level).toBe('existential');
    expect(check.attachments!.at(-1)).toMatchObject({ role: 'hologram', contentType: 'application/x-hologram' });
  });

  test('a field added to any object in a later minor version survives a read, wherever it is', () => {
    const doc = clone(fixture);
    const marked: string[] = [];
    const walk = (value: unknown, where: string) => {
      if (Array.isArray(value)) { value.forEach((item, i) => walk(item, `${where}[${i}]`)); return; }
      if (value === null || typeof value !== 'object') return;
      const holder = value as Record<string, unknown>;
      // Maps whose keys are data, not fields.
      if (!/(labels|extensions|parameters|bundle)$/.test(where)) { holder['x-from-the-future'] = { where }; marked.push(where); }
      for (const [key, inner] of Object.entries(holder)) if (key !== 'x-from-the-future') walk(inner, `${where}.${key}`);
    };
    walk(doc, 'layer');
    const parsed = parseLayerDocument(doc);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const lost: string[] = [];
    const check = (value: unknown, where: string) => {
      if (Array.isArray(value)) { value.forEach((item, i) => check(item, `${where}[${i}]`)); return; }
      if (value === null || typeof value !== 'object') return;
      const holder = value as Record<string, unknown>;
      if (!/(labels|extensions|parameters|bundle)$/.test(where)) { if ((holder['x-from-the-future'] as { where?: string } | undefined)?.where !== where) lost.push(where); }
      for (const [key, inner] of Object.entries(holder)) if (key !== 'x-from-the-future') check(inner, `${where}.${key}`);
    };
    check(parsed.layer, 'layer');
    expect(marked.length).toBeGreaterThan(30);
    expect(lost).toEqual([]);
  });

  test('a reader of the first version of the format reads a layer that carries all of this', () => {
    // The format as it was before evidence existed. If a later change makes any new field required, this fails.
    const first = z.looseObject({
      schemaVersion: z.literal(1), id: z.string().regex(/^[0-9a-f]{64}$/), producer: z.string().min(1), recordedAtMs: z.number().nonnegative(),
      sha: z.string().nullable(), branch: z.string().nullable(), runUrl: z.string().nullable(), environment: z.string().nullable().optional(),
      parameters: z.record(z.string(), z.string()).default({}), specs: z.array(z.looseObject({ path: z.string(), domain: z.string(), kind: z.string(), title: z.string() })).default([]),
      parts: z.array(z.looseObject({ id: z.string(), kind: z.string(), title: z.string(), recordedAtMs: z.number(), checks: z.array(z.looseObject({ id: z.string(), title: z.string(), status: z.enum(['passed', 'failed', 'running', 'not-run']), detail: z.string().default(''), measurements: z.array(z.looseObject({ name: z.string(), value: z.number(), unit: z.string() })).default([]) })) }))
    });
    expect(first.safeParse(fixture).success).toBe(true);
  });
});

describe('evidence never decides a result', () => {
  test('a piece of evidence that cannot be read is dropped, and the check, its status and the rest of the evidence stay', () => {
    const doc = clone(fixture) as { parts: { checks: Record<string, unknown>[] }[] };
    const check = doc.parts[0]!.checks[0]!;
    check.tags = ['ok', 7, null];
    check.labels = { fine: 'yes', broken: 5 };
    check.links = 'not a list';
    check.attachments = [{ name: 'good.png', contentType: 'image/png' }, { role: 'no-name' }, 'junk', { name: 'bad-bytes', bytes: -1 }];
    check.steps = [{ name: 'fine', status: 'passed', attachments: [{ name: 'inner.png' }, { nope: true }] }, { name: 3 }, 'junk'];
    check.attempts = [{ index: 0, status: 'failed' }, { index: 'zero', status: 'failed' }, { index: 2, status: 'maybe' }];
    check.annotations = [{ type: 'note', message: 'fine' }, { message: 'no type' }];
    check.extensions = 'a string, not a map';
    doc.parts[0]!.checks[1]!.attachments = { not: 'a list' };
    const parsed = parseLayerDocument(doc);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const read = parsed.layer.parts[0]!.checks;
    expect(read[0]).toMatchObject({ id: 'specs/checkout.feature > Pays by card', status: 'failed', detail: 'expected a receipt' });
    expect(read[0]!.tags).toEqual(['ok']);
    expect(read[0]!.labels).toBeUndefined();
    expect(read[0]!.links).toBeUndefined();
    expect(read[0]!.attachments!.map(item => item.name)).toEqual(['good.png']);
    expect(read[0]!.steps!.map(step => [step.name, step.attachments?.map(item => item.name)])).toEqual([['fine', ['inner.png']]]);
    expect(read[0]!.attempts!.map(attempt => attempt.index)).toEqual([0]);
    expect(read[0]!.annotations!.map(note => note.message)).toEqual(['fine']);
    expect(read[0]!.extensions).toBeUndefined();
    expect(read[1]!.attachments).toBeUndefined();
    expect(read[1]).toMatchObject({ status: 'passed' });
  });

  test('evidence changes nothing about which slot a result fills or how it reads in the report', () => {
    const parsed = parseLayerDocument(fixture);
    if (!parsed.ok) throw new Error('fixture');
    const withEvidence = layerEvidence(parsed.layer as unknown as LayerSummary, 'any');
    const bare = clone(fixture) as { parts: { checks: Record<string, unknown>[] }[] };
    for (const key of ['tags', 'labels', 'links', 'steps', 'attachments', 'annotations', 'attempts', 'extensions']) for (const check of bare.parts[0]!.checks) delete check[key];
    const without = parseLayerDocument(bare);
    if (!without.ok) throw new Error('bare');
    const plain = layerEvidence(without.layer as unknown as LayerSummary, 'any');
    expect(withEvidence.rows.map(row => [row.id, row.status, row.kind, row.specPath])).toEqual(plain.rows.map(row => [row.id, row.status, row.kind, row.specPath]));
    expect(withEvidence.layer.counts).toEqual(plain.layer.counts);
  });
});
