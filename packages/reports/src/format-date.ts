/**
 * @module Date formatting
 *
 * Formats epoch-millisecond timestamps for display in the viewer's locale.
 */

/** Formats epoch milliseconds as a local date and time (`toLocaleString`); an empty string for 0 or missing, and the number as text if it cannot be formatted. */
export function fmtDate(ms: number): string {
  if (!ms) return '';
  try {
    return new Date(ms).toLocaleString();
  } catch {
    return String(ms);
  }
}
