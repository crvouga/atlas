import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

import { publishManifest } from './lib.ts';

const manifest = JSON.parse(publishManifest(
  readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
  '0.0.0-smoke',
  new Map()
));

// Keep the published ranges from reintroducing the consumer audit failures in #14 and #16.
test.each([
  { name: 'vite', vulnerable: ['7.3.6'], patched: '7.3.7' },
  { name: 'zod', vulnerable: ['3.25.76', '4.6.5'], patched: '4.6.6' }
])('$name excludes vulnerable releases and installs a patched version', ({ name, vulnerable, patched }) => {
  const range = manifest.dependencies[name];
  for (const version of vulnerable) expect(Bun.semver.satisfies(version, range)).toBe(false);
  const installed = JSON.parse(readFileSync(new URL(import.meta.resolve(`${name}/package.json`)), 'utf8'));
  expect(Bun.semver.satisfies(installed.version, `>=${patched}`)).toBe(true);
  expect(Bun.semver.satisfies(installed.version, range)).toBe(true);
});
