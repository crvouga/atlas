import type { DataIssue, IssueSeverity } from '@crvouga/atlas-schema';
import type { z } from 'zod/v4';

export type IssueSink = {
  add: (severity: IssueSeverity, file: string, path: readonly (string | number)[], message: string) => void;
};

export function createIssueSink(into: DataIssue[] = []) {
  const sink: IssueSink & { issues: DataIssue[] } = {
    issues: into,
    add: (severity, file, path, message) => {
      into.push({ severity, file, path: formatPath(path), message });
    }
  };
  return sink;
}

export function formatPath(path: readonly (string | number)[]) {
  return path.map((part) => (typeof part === 'number' ? `item ${part + 1}` : part)).join(' › ');
}

function describeValue(value: unknown) {
  if (value === null) return 'empty';
  if (value === undefined) return 'missing';
  if (Array.isArray(value)) return 'a list';
  if (typeof value === 'object') return 'a group of fields';
  if (typeof value === 'string') return value.trim() ? 'text' : 'empty text';
  return `a ${typeof value}`;
}

const EXPECTED_WORDS: Record<string, string> = {
  string: 'text',
  number: 'a number',
  int: 'a whole number',
  boolean: 'yes or no',
  array: 'a list',
  object: 'a group of fields',
  record: 'a group of fields',
  null: 'empty'
};

/** One sentence a non-engineer can read, for the first problem Zod found. */
export function plainZodMessage(error: z.ZodError, value: unknown) {
  const first = error.issues[0];
  if (!first) return 'This value could not be read.';
  const where = first.path.length ? `"${first.path.join(' › ')}" ` : '';
  const actual = first.path.reduce<unknown>(
    (v, key) => (v && typeof v === 'object' ? (v as Record<PropertyKey, unknown>)[key] : undefined),
    value
  );
  switch (first.code) {
    case 'invalid_type':
      return actual === undefined
        ? `${where || 'A required value '}is missing.`
        : `${where}should be ${EXPECTED_WORDS[first.expected] ?? first.expected}, but is ${describeValue(actual)}.`;
    case 'invalid_value':
      return `${where}should be one of ${first.values.map((v) => `"${String(v)}"`).join(', ')}, but is "${String(actual)}".`;
    case 'too_small':
      return `${where}is empty.`;
    case 'invalid_union':
      return `${where}is not in a shape this app understands.`;
    default:
      return `${where}${first.message}`;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Validate an object one field at a time: keep the fields that parse, report the ones that don't,
 * and ignore fields the shape doesn't know, so newer data never breaks an older build.
 */
export function parseFields<Shape extends Record<string, z.ZodType>>(
  shape: Shape,
  raw: unknown,
  sink: IssueSink,
  file: string,
  path: readonly (string | number)[],
  severity: 'warning' | 'error' = 'warning'
) {
  const out: Partial<{ [K in keyof Shape]: z.infer<Shape[K]> }> = {};
  if (raw === undefined || raw === null) return out;
  if (!isRecord(raw)) {
    sink.add(severity, file, path, `should be a group of fields, but is ${describeValue(raw)}.`);
    return out;
  }
  for (const key of Object.keys(shape) as (keyof Shape & string)[]) {
    if (!(key in raw) || raw[key] === undefined) continue;
    const result = shape[key]!.safeParse(raw[key]);
    if (result.success) {
      out[key] = result.data as z.infer<Shape[typeof key]>;
    } else {
      sink.add(severity, file, [...path, key], plainZodMessage(result.error, raw[key]).replace(/^"" /, ''));
    }
  }
  return out;
}

/** Parse a value with a schema, reporting and returning null instead of throwing. */
export function parseOne<T>(
  schema: z.ZodType<T>,
  raw: unknown,
  sink: IssueSink,
  file: string,
  path: readonly (string | number)[],
  severity: IssueSeverity = 'warning'
): T | null {
  const result = schema.safeParse(raw);
  if (result.success) return result.data;
  sink.add(severity, file, path, plainZodMessage(result.error, raw));
  return null;
}
