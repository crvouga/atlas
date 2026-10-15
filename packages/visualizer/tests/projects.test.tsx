import { afterEach, expect, test } from 'bun:test';
import { currentProject, runtimeConfig } from '../src/runtime';
import { reportAssetUrl } from '../src/evidence/api';
import { createAdapter } from '../src/data/adapters';
import { openAtlas, memoryStore, publishRun, type Atlas } from './atlas';
let atlas: Atlas | undefined;

const originalFetch = globalThis.fetch;
afterEach(async () => {
  await atlas?.close(); atlas = undefined;
  globalThis.fetch = originalFetch;
  history.replaceState({}, '', '/');
  (globalThis as { __ATLAS_CONFIG__?: unknown }).__ATLAS_CONFIG__ = undefined;
});

test('a project with only Gherkin opens a report home with spec navigation instead of an empty statechart', async () => {
  atlas = await openAtlas({ at: '/', deps: { localStore: memoryStore() } });
  await atlas.sees('Project reports');
  await atlas.sees('2 features');
  expect(atlas.text()).not.toContain('This spec has no screens yet.');
  await atlas.click('nav[aria-label="Project specs"] a', 'Gherkin');
  await atlas.sees('Share a list');
});

test('a runner-only project displays test reports even with no specification documents', async () => {
  const localStore = memoryStore();
  await publishRun(localStore, { at: 20, checks: [{ test: 'native-test', title: 'Runs without statecharts', spec: 'tests/native.test.ts', status: 'passed' }] });
  atlas = await openAtlas({ at: '/', specs: {}, deps: { localStore } });
  await atlas.sees('Runs without statecharts');
  expect(atlas.text()).not.toContain('This spec has no screens yet.');
  await atlas.click('li.result button', 'Runs without statecharts');
  await atlas.sees('Passed');
});

test('the selected project scopes every data, evidence, media and stream address while discovery stays node-wide', async () => {
  (globalThis as { __ATLAS_CONFIG__?: unknown }).__ATLAS_CONFIG__ = { api: './api', dataUrl: './api/data/', reportsUrl: './api/reports', eventsUrl: './api/events', projectsUrl: './api/projects', effective: true };
  history.replaceState({}, '', '/?project=alpha#/specs/gherkin');
  expect(currentProject()).toBe('alpha');
  expect(runtimeConfig()).toEqual({ api: 'http://atlas.test/api/projects/alpha', dataUrl: 'http://atlas.test/api/projects/alpha/data/', reportsUrl: 'http://atlas.test/api/projects/alpha/reports', eventsUrl: 'http://atlas.test/api/projects/alpha/events', projectsUrl: './api/projects', effective: true });
  expect(reportAssetUrl('/layers/shared/picture.png')).toBe('http://atlas.test/api/projects/alpha/reports/layers/shared/picture.png');
  const requests: string[] = [];
  globalThis.fetch = (async (url: string | URL | Request) => { requests.push(String(url)); return Response.json({ schemaVersion: 1, files: [], generatedAt: new Date().toISOString() }); }) as typeof fetch;
  await createAdapter().specIndex();
  expect(requests).toEqual(['http://atlas.test/api/projects/alpha/data/specs/index.json']);
  history.replaceState({}, '', '/?project=beta#/');
  expect(reportAssetUrl('/layers/shared/picture.png')).toBe('http://atlas.test/api/projects/beta/reports/layers/shared/picture.png');
});

test('unqualified addresses retain the default project protocol and unrelated origins remain unchanged', () => {
  (globalThis as { __ATLAS_CONFIG__?: unknown }).__ATLAS_CONFIG__ = { api: './api', reportsUrl: 'https://external.test/reports', projectsUrl: './api/projects' };
  expect(currentProject()).toBeNull();
  expect(runtimeConfig()?.api).toBe('./api');
  history.replaceState({}, '', '/?project=alpha#/');
  expect(runtimeConfig()?.reportsUrl).toBe('https://external.test/reports');
});
