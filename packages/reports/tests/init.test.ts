/**
 * @module `atlas init` tests
 *
 * Detection of a project's suites, specs and CI, the plan it produces, that applying it is idempotent and never
 * overwrites what is not Atlas's, and server verification.
 */
import { afterAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import YAML from 'yaml';

import { InitPlanSchema } from '../../schema/src/cli-results';
import { initMain, planInit } from '../src/init';

const roots: string[] = [];
afterAll(async () => { for (const root of roots) await rm(root, { recursive: true, force: true }); });

async function project(files: Record<string, string>) {
  const root = await mkdtemp(path.join(tmpdir(), 'atlas-init-'));
  roots.push(root);
  for (const [name, text] of Object.entries(files)) { await mkdir(path.dirname(path.join(root, name)), { recursive: true }); await writeFile(path.join(root, name), text); }
  return root;
}
const noGit = () => null;
const FEATURE = 'Feature: Cart\n  Scenario: add\n    Given a cart\n';

describe('what it finds', () => {
  test('a Bun project with Vitest and Playwright, Gherkin specs and GitHub: two suites, the specs folder, a workflow', async () => {
    const root = await project({ 'package.json': JSON.stringify({ name: 'shop', devDependencies: { vitest: '^2', '@playwright/test': '^1' } }), 'bun.lock': '', 'specs/cart.feature': FEATURE, 'specs/notes.md': '# notes', '.github/keep': '' });
    const plan = await planInit({ directory: root, server: 'https://atlas.example.com/', git: noGit });
    expect(InitPlanSchema.parse(plan)).toBeTruthy();
    expect(plan).toMatchObject({ project: { name: 'shop', packageManager: 'bun', languages: ['javascript'] }, ci: 'github-actions', server: { url: 'https://atlas.example.com' }, specs: { directory: 'specs', kinds: { gherkin: 1 } }, git: { defaultBranch: 'main' } });
    expect(plan.suites.map(suite => suite.id)).toEqual(['vitest', 'playwright']);
    const playwright = plan.suites[1]!;
    expect(playwright).toMatchObject({ format: 'junit', environment: 'desktop-web' });
    expect(playwright.run).toContain('bunx playwright test');
    expect(playwright.publish).toBe('bunx @crvouga/atlas report publish --producer playwright --junit atlas-playwright.xml --specs specs --environment desktop-web');
    expect(plan.files.map(file => [file.path, file.action])).toEqual([['AGENTS.md', 'create'], ['.github/workflows/atlas.yml', 'create']]);
    expect(plan.written).toEqual([]);
  });

  test('other ecosystems: pytest, Go and Cucumber are found by what the project declares, and what each needs is said', async () => {
    const py = await planInit({ directory: await project({ 'pyproject.toml': '[tool.pytest.ini_options]\n', 'requirements.txt': 'pytest\n' }), git: noGit });
    expect(py.suites).toMatchObject([{ id: 'pytest', run: 'pytest --junitxml=atlas-pytest.xml' }]);
    expect(py.project.languages).toEqual(['python']);
    const go = await planInit({ directory: await project({ 'go.mod': 'module x\n' }), git: noGit });
    expect(go.suites[0]).toMatchObject({ id: 'go-test', prerequisites: [expect.stringContaining('go-junit-report')] });
    const jest = await planInit({ directory: await project({ 'package.json': JSON.stringify({ devDependencies: { jest: '1', '@cucumber/cucumber': '1' } }), 'package-lock.json': '{}' }), git: noGit });
    expect(jest.project.packageManager).toBe('npm');
    expect(jest.suites.find(suite => suite.id === 'jest')!.prerequisites).toEqual(['npm install -D jest-junit']);
    expect(jest.suites.find(suite => suite.id === 'cucumber')!.run).toContain('--format junit:atlas-cucumber.xml');
    expect(jest.nextSteps.join('\n')).toContain('npm install -D jest-junit');
  });

  test('a project it cannot read is said, not guessed: no suites, a warning that says what to do, and still an AGENTS.md section', async () => {
    const plan = await planInit({ directory: await project({ 'README.md': 'hi' }), git: noGit });
    expect(plan.suites).toEqual([]);
    expect(plan.warnings.join('\n')).toContain('No test runner was recognised');
    expect(plan.warnings.join('\n')).toContain('No server given');
    expect(plan.files.map(file => file.path)).toEqual(['AGENTS.md']);
  });

  test('the default branch comes from the repository, not an assumption', async () => {
    const git = (args: readonly string[]) => (args[0] === 'symbolic-ref' ? 'origin/trunk' : args[0] === 'branch' ? 'feat/x' : null);
    const plan = await planInit({ directory: await project({ 'package.json': '{}' }), git });
    expect(plan.git).toEqual({ branch: 'feat/x', defaultBranch: 'trunk' });
  });
});

describe('what it writes', () => {
  test('--write creates the files, the workflow is valid YAML that sends and gates, and running again changes nothing', async () => {
    const root = await project({ 'package.json': JSON.stringify({ devDependencies: { vitest: '2' } }), 'bun.lock': '', 'specs/a.feature': FEATURE, '.github/keep': '' });
    const first = await planInit({ directory: root, server: 'https://atlas.example.com', write: true, git: noGit });
    expect(first.written.sort()).toEqual(['.github/workflows/atlas.yml', 'AGENTS.md']);
    const workflow = YAML.parse(await readFile(path.join(root, '.github/workflows/atlas.yml'), 'utf8')) as { jobs: Record<string, { needs?: string[]; steps: { run?: string; if?: string; 'continue-on-error'?: boolean }[] }>; env: Record<string, string> };
    expect(Object.keys(workflow.jobs)).toEqual(['vitest', 'gate']);
    expect(workflow.env.ATLAS_STORE).toBe('${{ vars.ATLAS_URL }}');
    const suite = workflow.jobs.vitest!.steps;
    expect(suite.find(step => step.run?.includes('vitest run'))).toMatchObject({ 'continue-on-error': true });
    expect(suite.find(step => step.run?.includes('report publish'))).toMatchObject({ if: 'always()' });
    expect(workflow.jobs.gate!.needs).toEqual(['vitest']);
    expect(workflow.jobs.gate!.steps.at(-1)!.run).toContain('report status --branch');
    expect(workflow.jobs.gate!.steps.at(-1)!.run).toContain('--require-all-specs');

    const second = await planInit({ directory: root, server: 'https://atlas.example.com', write: true, git: noGit });
    expect(second.written).toEqual([]);
    expect(second.files.every(file => file.action === 'unchanged')).toBe(true);
  });

  test('AGENTS.md: the section is replaced between its markers, what the project wrote around it is kept, and it tells the next agent what to run', async () => {
    const root = await project({ 'package.json': JSON.stringify({ devDependencies: { vitest: '2' } }), 'AGENTS.md': '# Ours\n\nDo not delete this.\n' });
    await planInit({ directory: root, server: 'https://a.example.com', write: true, git: noGit });
    const once = await readFile(path.join(root, 'AGENTS.md'), 'utf8');
    expect(once.startsWith('# Ours\n\nDo not delete this.')).toBe(true);
    expect(once).toContain('<!-- atlas:begin -->');
    expect(once).toContain('https://a.example.com/api/openapi.json');
    expect(once).toContain('report publish --producer vitest');
    // The server moved: the section follows it; the rest stays.
    await planInit({ directory: root, server: 'https://b.example.com', write: true, git: noGit });
    const twice = await readFile(path.join(root, 'AGENTS.md'), 'utf8');
    expect(twice).toContain('https://b.example.com');
    expect(twice).not.toContain('https://a.example.com');
    expect(twice.match(/atlas:begin/g)!.length).toBe(1);
    expect(twice).toContain('Do not delete this.');
  });

  test('a workflow the project wrote itself is never overwritten', async () => {
    const root = await project({ 'package.json': JSON.stringify({ devDependencies: { vitest: '2' } }), '.github/workflows/atlas.yml': 'name: ours\n' });
    const plan = await planInit({ directory: root, server: 'https://a.example.com', write: true, git: noGit });
    expect(await readFile(path.join(root, '.github/workflows/atlas.yml'), 'utf8')).toBe('name: ours\n');
    expect(plan.warnings.join('\n')).toContain('left alone');
  });

  test('nothing is written without --write', async () => {
    const root = await project({ 'package.json': JSON.stringify({ devDependencies: { vitest: '2' } }) });
    await planInit({ directory: root, server: 'https://a.example.com', git: noGit });
    expect(await Bun.file(path.join(root, 'AGENTS.md')).exists()).toBe(false);
  });
});

describe('proving the server', () => {
  const answering = (role: string, status = 200) => (async () => (status === 200 ? new Response(JSON.stringify({ role }), { status }) : new Response(JSON.stringify({ error: 'x' }), { status }))) as unknown as typeof fetch;

  test('--verify says whether the server answers and whether this token may upload', async () => {
    const root = await project({ 'package.json': '{}' });
    const good = await planInit({ directory: root, server: 'https://a.example.com', verify: true, env: { ATLAS_TOKEN: 'publish-token-12345' }, fetch: answering('publish'), git: noGit });
    expect(good.verification).toEqual({ reachable: true, role: 'publish', canPublish: true, error: null });
    expect(good.ok).toBe(true);
    const reader = await planInit({ directory: root, server: 'https://a.example.com', verify: true, env: { ATLAS_TOKEN: 'read-token-1234567' }, fetch: answering('read'), git: noGit });
    expect(reader.ok).toBe(false);
    expect(reader.verification!.error).toContain('can look but not upload');
    const refused = await planInit({ directory: root, server: 'https://a.example.com', verify: true, fetch: answering('', 401), git: noGit });
    expect(refused).toMatchObject({ ok: false, verification: { reachable: true, canPublish: false } });
  });
});

describe('the command', () => {
  test('--format json prints the plan as a document, and exit code 1 when verification fails; 2 for a directory that is not there', async () => {
    const root = await project({ 'package.json': JSON.stringify({ devDependencies: { vitest: '2' } }) });
    let out = '';
    const io = (fetch?: typeof fetch) => ({ out: (text: string) => { out += text; }, env: { ATLAS_TOKEN: 'read-token-1234567' }, cwd: root, ...(fetch ? { fetch } : {}) });
    expect(await initMain(['--server', 'https://a.example.com', '--format', 'json'], io())).toBe(0);
    expect(InitPlanSchema.parse(JSON.parse(out)).suites[0]!.id).toBe('vitest');
    out = '';
    const readOnly = (async () => new Response(JSON.stringify({ role: 'read' }))) as unknown as typeof fetch;
    expect(await initMain(['--server', 'https://a.example.com', '--verify'], io(readOnly))).toBe(1);
    expect(out).toContain('can look but not upload');
    let err = '';
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((text: string) => { err += text; return true; }) as typeof process.stderr.write;
    try { expect(await initMain(['--dir', '/nonexistent-atlas-dir', '--json'], io())).toBe(2); } finally { process.stderr.write = original; }
    expect(JSON.parse(err)).toMatchObject({ ok: false, error: { code: 'usage' } });
    out = '';
    expect(await initMain(['--help'], io())).toBe(0);
    expect(out).toContain('atlas init');
  });
});
