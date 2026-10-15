/** @module Strict generated Markdown blocks: malformed or removed markers must never freeze stale text silently. */

/**
 * Replace complete, uniquely named blocks. Reject malformed, unknown, nested, duplicated or unpaired markers,
 * and require every block assigned to this document even if both of its markers were deleted.
 */
export function renderBlocks(text: string, renderers: Readonly<Record<string, () => string>>, required: readonly string[] = []): string {
  const seen = new Set<string>();
  let active: { name: string; body: number } | undefined;
  let cursor = 0;
  let output = '';
  for (const match of text.matchAll(/^<!--[^\n]*generated:[^\n]*$/gm)) {
    const marker = /^<!-- (\/?)generated:([\w-]+) -->$/.exec(match[0]);
    if (!marker) throw new Error(`Malformed generated marker: ${match[0]}`);
    const closing = marker[1];
    const name = marker[2]!;
    if (!renderers[name]) throw new Error(`Unknown generated block "${name}"`);
    if (!closing) {
      if (active) throw new Error(`Nested generated block "${name}" inside "${active.name}"`);
      if (seen.has(name)) throw new Error(`Duplicate generated block "${name}"`);
      seen.add(name);
      active = { name, body: match.index! + match[0].length };
    } else {
      if (!active || active.name !== name) throw new Error(`Unpaired generated closing marker "${name}"`);
      output += `${text.slice(cursor, active.body)}\n${renderers[name]!()}\n${match[0]}`;
      cursor = match.index! + match[0].length;
      active = undefined;
    }
  }
  if (active) throw new Error(`Unclosed generated block "${active.name}"`);
  const missing = required.filter(name => !seen.has(name));
  if (missing.length) throw new Error(`Missing required generated blocks: ${missing.join(', ')}`);
  return output + text.slice(cursor);
}
