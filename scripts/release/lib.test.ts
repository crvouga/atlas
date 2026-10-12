import { describe, expect, test } from 'bun:test';
import { exportSpecifiers } from './consumer-smoke.ts';
import { bumpVersion, closedIssues, highestVersion, maxBump, missingEntryPoints, parseCommit, publishManifest, topoSort, unresolvablePins } from './lib.ts';

const commit = (subject: string, body = '') => ({ hash: 'abc', subject, body });

describe('versions', () => {
  test('the highest plain version wins numerically, and prereleases are ignored', () => {
    expect(highestVersion(['0.9.0', '0.10.0', '0.10.1-beta.1', '0.2.11'])).toBe('0.10.0');
    expect(highestVersion([])).toBeNull();
  });

  test('a commit bumps by its type, and a breaking change by its marker or footer', () => {
    expect(parseCommit(commit('feat(core): plan by seed')).bump).toBe('minor');
    expect(parseCommit(commit('fix: retry once')).bump).toBe('patch');
    expect(parseCommit(commit('refactor(core)!: rename Driver')).bump).toBe('major');
    expect(parseCommit(commit('fix: drop option', 'BREAKING CHANGE: `pace` is gone')).bump).toBe('major');
    expect(parseCommit(commit('test(visualizer): cover the index')).bump).toBeNull();
    expect(parseCommit(commit('Merge branch main')).bump).toBeNull();
  });

  test('closing keywords name the issues a release should tell', () => {
    expect(closedIssues([commit('fix(core): retry once (#31)', 'Fixes #12\nSee #99'), commit('feat: seeds', 'closes #7, resolves #12')])).toEqual([7, 12]);
  });

  test('the largest bump of a release decides its version', () => {
    expect(maxBump(['patch', null, 'minor'])).toBe('minor');
    expect(maxBump([null])).toBeNull();
    expect(bumpVersion('0.3.4', 'major')).toBe('1.0.0');
    expect(bumpVersion('0.3.4', 'minor')).toBe('0.4.0');
    expect(bumpVersion('0.3.4', 'patch')).toBe('0.3.5');
  });
});

describe('publishManifest', () => {
  const raw = JSON.stringify({
    name: '@crvouga/atlas-playwright',
    version: '0.0.0-development',
    dependencies: { '@crvouga/atlas': 'workspace:*' },
    peerDependencies: { playwright: '>=1.45' }
  });

  test('pins its own version and every workspace dependency exactly', () => {
    const pinned = JSON.parse(publishManifest(raw, '0.2.0', new Map([['@crvouga/atlas', '0.3.1']])));
    expect(pinned.version).toBe('0.2.0');
    expect(pinned.dependencies).toEqual({ '@crvouga/atlas': '0.3.1' });
    expect(pinned.peerDependencies).toEqual({ playwright: '>=1.45' });
    expect(unresolvablePins(pinned)).toEqual([]);
  });

  test('publishConfig overrides become the published fields, and nothing else of it moves', () => {
    const source = JSON.stringify({ name: '@crvouga/atlas', exports: { '.': './src/index.ts' }, publishConfig: { access: 'public', exports: { '.': './dist/index.js' } } });
    const published = JSON.parse(publishManifest(source, '1.2.3', new Map()));
    expect(published.exports).toEqual({ '.': './dist/index.js' });
    expect(published.publishConfig).toEqual({ access: 'public' });
  });

  test('a workspace dependency with no released version is an error, never a placeholder', () => {
    expect(() => publishManifest(raw, '0.2.0', new Map())).toThrow('@crvouga/atlas');
    expect(unresolvablePins(JSON.parse(raw))).toEqual(['dependencies.@crvouga/atlas = "workspace:*"']);
  });
});

describe('packed entry points', () => {
  const manifest = {
    bin: { atlas: './bin/atlas.mjs' },
    exports: { '.': { types: './dist/index.d.ts', default: './dist/index.js' }, './spec': './dist/spec/index.js', './schemas/*': './schemas/*' }
  };

  test('every exact export and bin target must be in the tarball', () => {
    expect(missingEntryPoints(manifest, ['bin/atlas.mjs', 'dist/index.js', 'dist/index.d.ts', 'dist/spec/index.js'])).toEqual([]);
    expect(missingEntryPoints(manifest, ['bin/atlas.mjs', 'dist/index.js'])).toEqual(['./dist/index.d.ts', './dist/spec/index.js']);
  });

  test('a pattern export expands to one specifier per matching file', () => {
    const reports = { exports: { './*': { types: './dist/*.d.ts', default: './dist/*.js' } } };
    expect(exportSpecifiers('@crvouga/atlas-reports', reports, ['dist/keys.js', 'dist/keys.d.ts', 'dist/nested/skip.js', 'src/keys.ts'])).toEqual(['@crvouga/atlas-reports/keys']);
    expect(exportSpecifiers('@crvouga/atlas', manifest, ['schemas/run.json'])).toEqual(['@crvouga/atlas', '@crvouga/atlas/spec']);
  });
});

describe('topoSort', () => {
  test('dependencies come before their dependents, and a cycle is an error', () => {
    const sorted = topoSort([
      { name: 'visualizer', runtimeDeps: ['core', 'reports'] },
      { name: 'reports', runtimeDeps: [] },
      { name: 'core', runtimeDeps: [] }
    ]);
    expect(sorted.map((p) => p.name)).toEqual(['core', 'reports', 'visualizer']);
    expect(() =>
      topoSort([
        { name: 'a', runtimeDeps: ['b'] },
        { name: 'b', runtimeDeps: ['a'] }
      ])
    ).toThrow('cycle');
  });
});
