import { expect, test } from 'bun:test';

import type { FindDoc } from './rank';
import { applySemantic, cosine, SEMANTIC_FLOOR } from './semantic';

function doc(id: string, title: string): FindDoc {
  return {
    id,
    group: 'Specs',
    kind: 'scenario',
    title,
    subtitle: '',
    fields: [{ name: 'title', text: title }],
    status: null,
    related: [],
    target: { to: '/', search: {} },
    recording: null
  };
}

test('cosine is one for the same direction and zero at a right angle', () => {
  expect(cosine(Float32Array.of(1, 0), Float32Array.of(2, 0))).toBeCloseTo(1);
  expect(cosine(Float32Array.of(1, 0), Float32Array.of(0, 1))).toBeCloseTo(0);
  expect(cosine(Float32Array.of(0, 0), Float32Array.of(1, 0))).toBe(0);
});

test('a close paraphrase joins the list and a vague one stays out', () => {
  const lexicalDoc = doc('lexical', 'Marks all done');
  const close = doc('close', 'Tick every item');
  const vague = doc('vague', 'The weather');
  const query = Float32Array.of(1, 0);
  const vectors = new Map<string, Float32Array>([
    ['lexical', Float32Array.of(1, 0)],
    ['close', Float32Array.of(0.8, 0.6)],
    ['vague', Float32Array.of(0, 1)]
  ]);
  const ranked = applySemantic(
    [lexicalDoc, close, vague],
    [{ doc: lexicalDoc, score: 10, snippet: 'When they tap "Mark all done"' }],
    query,
    vectors
  );
  expect(ranked.map((hit) => hit.doc.id)).toEqual(['lexical', 'close']);
  expect(ranked[0]?.snippet).toContain('Mark all done');
  expect(ranked[1]!.score).toBeLessThan(ranked[0]!.score);
  expect(cosine(query, vectors.get('vague')!)).toBeLessThan(SEMANTIC_FLOOR);
});

test('a paraphrase under the floor is left out', () => {
  const lexicalDoc = doc('lexical', 'Marks all done');
  const almost = doc('almost', 'Something nearby');
  const ranked = applySemantic(
    [lexicalDoc, almost],
    [{ doc: lexicalDoc, score: 4, snippet: '' }],
    Float32Array.of(1, 0),
    new Map([
      ['lexical', Float32Array.of(1, 0)],
      ['almost', Float32Array.of(0.4, 0.9165)]
    ])
  );
  expect(ranked.map((hit) => hit.doc.id)).toEqual(['lexical']);
});
