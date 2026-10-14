import type { z } from 'zod/v4';

/** Parse input with a schema, and fail with every problem named by its path. */
export function parseWith<S extends z.ZodType>(schema: S, input: unknown, subject: string): z.output<S> {
  const parsed = schema.safeParse(input);
  if (parsed.success) return parsed.data;
  throw new Error(`${subject}: ${parsed.error.issues.map(issue => `${issue.path.join('.') || '(input)'}: ${issue.message}`).join('; ')}`);
}
