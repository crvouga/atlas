/** @module Mutation checks for the generated-block safeguards. */
import { expect, test } from 'bun:test';
import { renderBlocks } from './blocks';

const renderers = { facts: () => 'current facts', other: () => 'other facts' };
const block = '<!-- generated:facts -->\nstale facts\n<!-- /generated:facts -->';

test('replaces only the generated body and is idempotent', () => {
  const rendered = renderBlocks(`before\n${block}\nafter\n`, renderers, ['facts']);
  expect(rendered).toBe(`before\n${block.replace('stale facts', 'current facts')}\nafter\n`);
  expect(renderBlocks(rendered, renderers, ['facts'])).toBe(rendered);
});

test('fills an empty block with adjacent marker lines (the server tables must not stay empty)', () => {
  expect(renderBlocks('<!-- generated:facts -->\n<!-- /generated:facts -->', renderers)).toBe(block.replace('stale facts', 'current facts'));
});

const mutations: [string, string, RegExp][] = [
  ['both markers deleted', 'stale facts', /Missing required/],
  ['opening deleted', block.replace('<!-- generated:facts -->\n', ''), /Unpaired/],
  ['closing deleted', block.replace('\n<!-- /generated:facts -->', ''), /Unclosed/],
  ['misspelled marker', block.replace('generated:facts -->', 'generated:facts-->'), /Malformed/],
  ['unknown name', block.replaceAll('facts', 'missing'), /Unknown/],
  ['mismatched names', block.replace('/generated:facts', '/generated:other'), /Unpaired/],
  ['duplicate block', `${block}\n${block}`, /Duplicate/],
  ['nested blocks', block.replace('stale facts', '<!-- generated:other -->\n<!-- /generated:other -->'), /Nested/]
];
test.each(mutations)('rejects drift when %s', (_name, changed, error) => {
  expect(() => renderBlocks(changed, renderers, ['facts'])).toThrow(error);
});
