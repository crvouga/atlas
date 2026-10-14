/**
 * @module Documentation coverage test
 *
 * Fails when a library module has no `@module` comment or an exported declaration has no doc comment. See
 * `coverage.ts`: the reference documentation is generated from these comments.
 */
import { expect, test } from 'bun:test';

import { findGaps } from './coverage';

test('every library module and every exported declaration is documented where it is written', () => {
  const gaps = findGaps();
  expect(gaps.map(gap => `${gap.file}:${gap.line}  ${gap.what}`)).toEqual([]);
});
