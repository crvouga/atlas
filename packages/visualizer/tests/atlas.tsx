import type { ObjectStore } from '@crvouga/atlas/reports/object-store';
import { createReportsApp, type ReportsAppDeps } from '@crvouga/atlas/reports/reports-route';
import { textFingerprint } from '@crvouga/atlas/reports/layer-merge';
import { publishLayer } from '@crvouga/atlas/reports/layer-store';
import type { LayerSummary } from '@crvouga/atlas/reports/layer-types';
import type { RunReport } from '@crvouga/atlas/reports/report-types';
import type { LiveRun } from '@crvouga/atlas/schema';
import { ALL_SOURCES } from '@crvouga/atlas/reports/evidence-view';
import { QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router';
import { expect } from 'bun:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

import { createAtlasRouter } from '../src/app/router';
import type { AtlasAdapter } from '../src/data/adapters';
import { AdapterContext, createQueryClient } from '../src/data/queries';
import { useUiStore } from '../src/state/ui-store';
import { memoryStore, testClock } from '../../reports/tests/memory-store';
import { REPORTS_URL } from './preload';

export { memoryStore };

export const SHA = 'a'.repeat(40);

export const FEATURE = `Feature: Share a list
  People keep one list together.

  Rule: Owners add items

    Scenario: Add an item
      Given a list
      When adding tea
      Then the list includes tea

    Scenario Outline: Add several
      When adding "<item>"
      Examples:
        | item |
        | Tea |
        | Milk |

    Scenario: Remove an item
      Given a list with tea
      When removing tea
`;

export const SPECS: Record<string, string> = {
  'lists/add.feature': FEATURE,
  'lists/empty.feature': 'Feature: Empty the list\n  Scenario: Clear\n    When clearing\n',
  'lists/list.qnt': 'module list {\n  var size: int\n  action add = size\' = size + 1\n}\n'
};

export type Check = { test: string; title: string; status: 'passed' | 'failed'; spec?: string; steps?: RunReport['steps']; artifacts?: RunReport['artifacts']; error?: string };

export function step(index: number, title: string, status: 'passed' | 'failed' = 'passed', extra: Partial<RunReport['steps'][number]> = {}): RunReport['steps'][number] {
  return { index, title, kind: 'when', status, startedAtMs: index, endedAtMs: index + 1, durationMs: 1, frames: [], steps: [], ...extra };
}

export function recorded(check: Check): RunReport {
  return {
    meta: { testId: check.test, runId: 'latest', title: check.title, system: 'list', runtime: 'gherkin', seed: check.test, status: check.status, actorIds: [], startedAtMs: 0, endedAtMs: 3, durationMs: 3, sourceFile: check.spec ?? 'specs/lists/add.feature', ...(check.error ? { error: check.error } : {}) },
    steps: check.steps ?? [],
    ...(check.artifacts?.length ? { artifacts: check.artifacts } : {})
  };
}

/** Publish one run of a package as a layer, each check with its recorded timeline. */
export async function publishRun(store: ObjectStore, args: { producer?: string; at: number; branch?: string; sha?: string; environment?: string; parameters?: Record<string, string>; checks: readonly Check[]; fingerprint?: boolean }) {
  const producer = args.producer ?? 'lists';
  const reports = args.checks.map(recorded);
  const summary: Omit<LayerSummary, 'id'> = {
    producer,
    recordedAtMs: args.at,
    sha: args.sha ?? SHA,
    branch: args.branch ?? 'main',
    ...(args.environment ? { environment: args.environment } : {}),
    runUrl: null,
    parameters: args.parameters ?? {},
    specs: args.fingerprint === false ? [] : Object.entries(SPECS).map(([file, text]) => ({ path: `specs/${file}`, domain: 'lists', kind: 'feature', title: file, fingerprint: textFingerprint(text) })),
    recording: { type: 'layer' },
    source: { source: producer, packageDir: `libs/${producer}`, bucket: 'all', status: 'passed', updatedAtMs: args.at, tests: reports.map((report) => report.meta) },
    parts: [{ sha: SHA, id: producer, kind: 'behavior', title: producer, recordedAtMs: args.at, checks: args.checks.map((check) => ({ id: `${producer}/${check.test}`, title: check.title, status: check.status, detail: check.error ?? '', specPath: check.spec ?? 'specs/lists/add.feature', measurements: [] })) }]
  };
  async function* entries() {
    for (const report of reports) yield { key: `tests/${report.meta.testId}/report.json`, bytes: new TextEncoder().encode(JSON.stringify(report)), contentType: 'application/json' };
  }
  return publishLayer(store, summary, entries());
}

export type Atlas = Awaited<ReturnType<typeof openAtlas>>;

/** The whole viewer at an address, reading specs from `specs` and reports from an in-memory reports API. */
export async function openAtlas(args: { at: string; deps: Partial<ReportsAppDeps>; specs?: Record<string, string>; down?: { value: boolean }; live?: () => readonly LiveRun[] | Promise<readonly LiveRun[]>; projects?: () => Response; events?: boolean; /** An Atlas node to answer `/evidence/effective`, as a deployed one does. */ node?: { fetch: (request: Request) => Promise<Response> } }) {
  const specs = args.specs ?? SPECS;
  const time = testClock(1_000_000);
  const app = createReportsApp({
    store: null,
    ...time,
    outline: async () => ({ specs: Object.entries(specs).map(([file, text]) => ({ path: `specs/${file}`, domain: file.split('/')[0]!, kind: file.split('.').at(-1)!, title: /Feature:\s*(.+)/.exec(text)?.[1] ?? file.split('/').at(-1)!, fingerprint: textFingerprint(text) })), sha: SHA, changedFiles: [], readSpec: async (path) => specs[path.replace(/^specs\//, '')] ?? null }),
    ...args.deps
  });
  const requests: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === 'http://atlas.test/api/projects' && args.projects) return args.projects();
    if (url === 'http://atlas.test/api/live' && args.live) return Response.json({ runs: await args.live() });
    if (!url.startsWith(REPORTS_URL)) return new Response('not found', { status: 404 });
    requests.push(url.slice(REPORTS_URL.length));
    if (args.down?.value) return new Response('{"error":"reports_unavailable"}', { status: 503 });
    // What a node answers beyond the report itself: one result's evidence, and the files it points to.
    if (args.node && /^\/(evidence\/(effective|detail)|layers\/)/.test(url.slice(REPORTS_URL.length))) return args.node.fetch(new Request(url));
    return app.request(url.slice(REPORTS_URL.length));
  }) as typeof fetch;
  const adapter: AtlasAdapter = {
    kind: 'dev',
    label: 'Test specs',
    specIndex: async () => ({ schemaVersion: 1, generatedAt: '2026-10-10T00:00:00.000Z', files: Object.keys(specs) }),
    specFile: async (path) => {
      const text = specs[path];
      if (text === undefined) throw new Error('missing spec');
      return text;
    },
    runsIndex: async () => ({ schemaVersion: 1, runs: [] }),
    manifest: async () => ({}),
    manifestPath: (id) => id,
    mediaUrl: (_, path) => path,
    subscribe: null
  };
  (globalThis as { __ATLAS_CONFIG__?: unknown }).__ATLAS_CONFIG__ = args.node || args.live || args.projects ? { reportsUrl: REPORTS_URL, effective: !!args.node, ...(args.live || args.projects ? { api: 'http://atlas.test/api' } : {}), ...(args.events ? { eventsUrl: 'http://atlas.test/api/events' } : {}), ...(args.projects ? { projectsUrl: 'http://atlas.test/api/projects' } : {}) } : undefined;
  useUiStore.setState({ excluded: ALL_SOURCES, resultFilter: 'all', sourcesOpen: false });
  const router = createAtlasRouter(createMemoryHistory({ initialEntries: [args.at] }));
  const client = createQueryClient();
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () =>
    root.render(
      <AdapterContext.Provider value={adapter}>
        <QueryClientProvider client={client}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </AdapterContext.Provider>
    )
  );
  const text = () => document.body.textContent ?? '';
  const until = async (ready: () => boolean, what: string) => {
    for (let i = 0; i < 200 && !ready(); i++) await act(async () => new Promise((resolve) => setTimeout(resolve, 5)));
    if (!ready()) throw new Error(`Never saw: ${what}\n${text().slice(0, 1500)}`);
  };
  const find = (selector: string, label: string | RegExp) =>
    [...document.body.querySelectorAll<HTMLElement>(selector)].find((element) => {
      const name = `${element.getAttribute('aria-label') ?? ''} ${element.textContent ?? ''}`;
      return typeof label === 'string' ? name.includes(label) : label.test(name);
    });
  return {
    host,
    router,
    time,
    requests,
    text,
    until,
    sees: (expected: string) => until(() => text().includes(expected), expected),
    find,
    async click(selector: string, label: string | RegExp) {
      const element = find(selector, label);
      expect(element, `${selector} "${String(label)}"`).toBeDefined();
      await act(async () => element!.click());
    },
    async go(to: string) {
      await act(async () => {
        router.history.push(to);
        await router.load();
      });
    },
    /** What the viewer does on its own every few seconds while a suite is running. */
    async poll() {
      await act(async () => client.refetchQueries({ queryKey: ['evidence-index'] }));
    },
    /** The same for a page served by a node, which reads the whole report in one request. */
    async pollReport() {
      await act(async () => client.refetchQueries({ queryKey: ['evidence-effective'] }));
    },
    async pollLive() {
      await act(async () => client.refetchQueries({ queryKey: ['live-runs'] }));
    },
    async close() {
      (globalThis as { __ATLAS_CONFIG__?: unknown }).__ATLAS_CONFIG__ = undefined;
      await act(async () => root.unmount());
      host.remove();
      document.body.replaceChildren();
      client.clear();
    }
  };
}
