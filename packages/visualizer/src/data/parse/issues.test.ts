import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';

import { createIssueSink, formatPath, parseFields, parseOne, plainZodMessage } from './issues';

describe('plainZodMessage', () => {
  it.each<[string, z.ZodType, unknown, string]>([
    ['a missing field', z.object({ name: z.string() }), {}, '"name" is missing.'],
    ['text where a number belongs', z.object({ count: z.number() }), { count: 'many' }, '"count" should be a number, but is text.'],
    ['a number where text belongs', z.object({ name: z.string() }), { name: 3 }, '"name" should be text, but is a number.'],
    ['text where a list belongs', z.array(z.string()), 'abc', 'should be a list, but is text.'],
    ['a list where fields belong', z.object({ a: z.string() }), ['x'], 'should be a group of fields, but is a list.'],
    ['a nested yes-or-no', z.object({ a: z.object({ on: z.boolean() }) }), { a: { on: 'yes' } }, '"a › on" should be yes or no, but is text.'],
    ['null where text belongs', z.object({ name: z.string() }), { name: null }, '"name" should be text, but is empty.'],
    ['a value outside a list of choices', z.enum(['confirmed', 'assumed']), 'maybe', 'should be one of "confirmed", "assumed", but is "maybe".'],
    ['empty text', z.string().min(1), '', 'is empty.'],
    ['an unknown shape', z.union([z.string(), z.object({ target: z.string() })]), 5, 'is not in a shape this app understands.']
  ])('explains %s', (_label, schema, value, expected) => {
    const result = schema.safeParse(value);
    expect(result.success).toBe(false);
    expect(plainZodMessage(result.error!, value)).toBe(expected);
  });

  it('falls back to the schema message for other problems', () => {
    const value = 5;
    const result = z.number().max(3).safeParse(value);
    expect(plainZodMessage(result.error!, value)).toMatch(/3/);
  });
});

describe('formatPath', () => {
  it.each<[(string | number)[], string]>([
    [[], ''],
    [['states', 'Drink ready'], 'states › Drink ready'],
    [['paths', 0, 'steps', 2], 'paths › item 1 › steps › item 3']
  ])('formats %j as %j', (path, expected) => {
    expect(formatPath(path)).toBe(expected);
  });
});

describe('parseFields', () => {
  const shape = { name: z.string(), count: z.number(), tags: z.array(z.string()) };

  it.each<[string, unknown, Record<string, unknown>, { path: string; message: string }[]]>([
    ['all valid', { name: 'x', count: 2, tags: ['a'] }, { name: 'x', count: 2, tags: ['a'] }, []],
    ['one invalid field', { name: 'x', count: 'many', tags: ['a'] }, { name: 'x', tags: ['a'] }, [{ path: 'meta › count', message: 'should be a number, but is text.' }]],
    [
      'two invalid fields',
      { name: 1, count: 2, tags: 'a' },
      { count: 2 },
      [
        { path: 'meta › name', message: 'should be text, but is a number.' },
        { path: 'meta › tags', message: 'should be a list, but is text.' }
      ]
    ],
    ['unknown fields', { name: 'x', colour: 'red', future: { a: 1 } }, { name: 'x' }, []],
    ['missing fields', { count: 1 }, { count: 1 }, []],
    ['nothing at all', undefined, {}, []],
    ['null', null, {}, []],
    ['a list instead of fields', ['x'], {}, [{ path: 'meta', message: 'should be a group of fields, but is a list.' }]]
  ])('keeps valid fields and reports invalid ones: %s', (_label, raw, expected, issues) => {
    const sink = createIssueSink();
    expect(parseFields(shape, raw, sink, 'machine.yaml', ['meta'])).toEqual(expected);
    expect(sink.issues.map(({ path, message }) => ({ path, message }))).toEqual(issues);
    expect(sink.issues.every((i) => i.file === 'machine.yaml' && i.severity === 'warning')).toBe(true);
  });

  it('reports at the severity asked for', () => {
    const sink = createIssueSink();
    parseFields(shape, { count: 'x' }, sink, 'f', [], 'error');
    expect(sink.issues[0]).toMatchObject({ severity: 'error', path: 'count' });
  });
});

describe('parseOne', () => {
  it('returns the value or null and an issue, never throwing', () => {
    const sink = createIssueSink();
    expect(parseOne(z.object({ a: z.string() }), { a: 'x' }, sink, 'f', [])).toEqual({ a: 'x' });
    expect(parseOne(z.object({ a: z.string() }), { a: 1 }, sink, 'f', ['root'])).toBeNull();
    expect(sink.issues).toEqual([{ severity: 'warning', file: 'f', path: 'root', message: '"a" should be text, but is a number.' }]);
  });
});
