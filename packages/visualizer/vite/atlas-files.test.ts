import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { DEFAULT_FIXTURE, FIXTURES_ROOT, isSpecFile, listSpecFiles, resolveRoots, safeJoin } from './atlas-files';

const tmp = mkdtempSync(path.join(os.tmpdir(), 'atlas-files-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function touch(file: string, text = '') {
  mkdirSync(path.dirname(path.join(tmp, file)), { recursive: true });
  writeFileSync(path.join(tmp, file), text);
}

describe('resolveRoots', () => {
  const project = path.join(tmp, 'project');
  mkdirSync(path.join(project, 'specs'), { recursive: true });

  it.each<[string, NodeJS.ProcessEnv, string, string]>([
    ['relative roots against INIT_CWD', { INIT_CWD: project, ATLAS_SPECS_ROOT: 'charts', ATLAS_RUNS_ROOT: 'out/runs' }, 'charts', 'out/runs'],
    ['absolute roots as they are', { INIT_CWD: '/elsewhere', ATLAS_SPECS_ROOT: path.join(project, 'a'), ATLAS_RUNS_ROOT: path.join(project, 'b') }, 'a', 'b'],
    ['specs/ and atlas-runs/ where pnpm ran', { INIT_CWD: project }, 'specs', 'atlas-runs'],
    ['only the runs root', { INIT_CWD: project, ATLAS_RUNS_ROOT: 'r' }, 'specs', 'r']
  ])('resolves %s', (_label, env, specs, runs) => {
    expect(resolveRoots(env, '/not/used')).toMatchObject({ specs: path.join(project, specs), runs: path.join(project, runs), label: 'configured' });
  });

  it('falls back to the current directory without INIT_CWD', () => {
    expect(resolveRoots({ ATLAS_SPECS_ROOT: 'x' }, project).specs).toBe(path.join(project, 'x'));
  });

  it('shows the example when nothing is configured and there is no specs/ directory', () => {
    const roots = resolveRoots({ INIT_CWD: path.join(tmp, 'empty') });
    expect(roots.specs).toBe(path.join(FIXTURES_ROOT, DEFAULT_FIXTURE, 'specs'));
    expect(roots.label).toMatch(/^example/);
  });

  it('reads a named fixture and rejects an unknown one', () => {
    expect(resolveRoots({ ATLAS_FIXTURE: 'spec-only' }).specs).toBe(path.join(FIXTURES_ROOT, 'spec-only', 'specs'));
    expect(() => resolveRoots({ ATLAS_FIXTURE: 'nope' })).toThrow(/No fixture called "nope"/);
  });
});

describe('listSpecFiles', () => {
  touch('specs/atlas.yaml');
  touch('specs/README.md');
  touch('specs/a/chart.scxml');
  touch('specs/a/journeys.yaml');
  touch('specs/a/chart.layout.json');
  touch('specs/b/machine.yaml');
  touch('specs/b/open-questions.md');
  touch('specs/c/journeys.yaml');
  touch('specs/node_modules/x/machine.yaml');

  it('lists charts in both formats, and journeys and notes only beside a chart', () => {
    expect(listSpecFiles(path.join(tmp, 'specs'))).toEqual([
      'a/chart.layout.json',
      'a/chart.scxml',
      'a/journeys.yaml',
      'atlas.yaml',
      'b/machine.yaml',
      'b/open-questions.md'
    ]);
  });

  it.each<[string, boolean]>([
    ['x.scxml', true],
    ['x.machine.json', true],
    ['machine.yml', true],
    ['journeys.yaml', true],
    ['x.yaml', false],
    ['notes.md', false]
  ])('%s is a spec file: %s', (file, expected) => {
    expect(isSpecFile(file)).toBe(expected);
  });
});

describe('safeJoin', () => {
  it.each<[string, boolean]>([
    ['a/b.json', true],
    ['../secret', false],
    ['%2e%2e/secret', false],
    ['%E0%A4%A', false]
  ])('%s stays inside the root: %s', (relative, inside) => {
    expect(safeJoin('/root', relative) !== null).toBe(inside);
  });
});
