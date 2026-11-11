import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'bun:test';

import { viewerBuild } from './build-info';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('a viewer build records the revision and build time it was given, and nothing it was not (#86)', () => {
  const now = () => new Date('2026-11-10T12:00:00Z');
  // This checkout's package.json holds the release placeholder: the version is unknown, not 0.0.0.
  expect(viewerBuild(appRoot, { ATLAS_REVISION: 'abc1234', ATLAS_BUILD_TIME: '2026-11-09T08:00:00Z' }, true, now)).toEqual({ version: null, revision: 'abc1234', builtAt: '2026-11-09T08:00:00.000Z' });
  expect(viewerBuild(appRoot, { ATLAS_REVISION: 'unknown' }, true, now)).toEqual({ version: null, revision: null, builtAt: '2026-11-10T12:00:00.000Z' });
  // A development server is not a build.
  expect(viewerBuild(appRoot, {}, false, now)).toEqual({ version: null, revision: null, builtAt: null });
  expect(viewerBuild(appRoot, { ATLAS_REVISION: '$(rm -rf /)', ATLAS_BUILD_TIME: 'soon' }, false, now)).toEqual({ version: null, revision: null, builtAt: null });
});
