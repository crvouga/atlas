/**
 * @module Schema parsing with readable errors
 *
 * One helper that parses untrusted input with a Zod schema and turns every problem into a single error message that
 * names each failing path, so a publisher can tell a person exactly which field to fix.
 */
import type { z } from 'zod/v4';

/**
 * Parses `input` with `schema` and returns the parsed value, or throws one `Error` naming every problem by its path.
 *
 * The message is `<subject>: <path>: <message>; <path>: <message>`, with `(input)` as the path of a problem at the
 * root. Nothing is returned partially: on any problem it throws.
 *
 * @param subject what is being parsed, as the person would call it (for example `checks file`); prefixes the message.
 */
export function parseWith<S extends z.ZodType>(schema: S, input: unknown, subject: string): z.output<S> {
  const parsed = schema.safeParse(input);
  if (parsed.success) return parsed.data;
  throw new Error(`${subject}: ${parsed.error.issues.map(issue => `${issue.path.join('.') || '(input)'}: ${issue.message}`).join('; ')}`);
}
