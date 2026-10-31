import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AtlasThemeProvider } from '../src/ui/theme';
import { SettingsPage } from '../src/admin/SettingsPage';
let root: Root | undefined;
const originalFetch = globalThis.fetch;
afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
  globalThis.fetch = originalFetch;
});
async function open() {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <AtlasThemeProvider env="test">
        <SettingsPage />
      </AtlasThemeProvider>
    )
  );
}
async function click(id: string) {
  await act(async () => document.getElementById(id)!.click());
}
async function type(id: string, value: string) {
  const input = document.getElementById(id)! as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      input.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
      'value'
    )!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const revision = 'a'.repeat(64);
const next = 'b'.repeat(64);
type Call = { url: string; init: RequestInit };
const policy = { enabled: true, maxAgeDays: 45, keepLatest: 5, intervalHours: 12 };
/** A server whose settings and policy live behind /api/settings and /api/settings/gc, as in S3. */
function server(saved: { policy: typeof policy | null; settings?: Record<string, unknown> } = { policy: null }) {
  const calls: Call[] = [];
  const state = { ...saved };
  globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    if (url.startsWith('/api/settings/gc/run'))
      return Response.json({
        runs: [{ project: 'default', dryRun: true, at: '2026-10-28T00:00:00Z', candidates: 7, deletedLayers: 0, deletedBlobs: 0, keptLayers: 3 }],
        policy: state.policy
      });
    if (url === '/api/settings/gc') {
      if (init.method === 'PUT') state.policy = JSON.parse(init.body as string);
      return Response.json({ revision: init.method === 'PUT' ? next : revision, policy: state.policy, saved: state.policy !== null, lastRuns: [], stateKey: 'server/state.json' });
    }
    if (init.method === 'PUT') state.settings = JSON.parse(init.body as string);
    return Response.json({ revision: init.method === 'PUT' ? next : revision, settings: state.settings ?? {}, active: { refreshSeconds: 17 }, restartRequired: init.method === 'PUT' });
  }) as typeof fetch;
  return calls;
}
async function change(id: string, value: string) {
  await act(async () => {
    const select = document.getElementById(id) as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked')!.set!.call(select, value === 'true');
    select.dispatchEvent(new Event('click', { bubbles: true }));
  });
}
test('admin page loads settings and the policy with Bearer authentication and saves settings with optimistic concurrency', async () => {
  const calls = server({ policy: null, settings: { refreshSeconds: 20 } });
  await open();
  expect(document.getElementById('configuration')).toBeNull();
  await type('token', 'admin-secret');
  await click('load');
  expect(calls.map((call) => call.url)).toEqual(['/api/settings', '/api/settings/gc']);
  expect((document.getElementById('refreshSeconds') as HTMLInputElement).value).toBe('20');
  expect(document.querySelector('label[for="refreshSeconds"]')?.parentElement?.textContent).toContain('Current: 17');
  await type('refreshSeconds', '25');
  await click('save');
  const put = calls.at(-1)!;
  expect(put.url).toBe('/api/settings');
  expect(put.init.headers).toEqual({ authorization: 'Bearer admin-secret', 'content-type': 'application/json', 'if-match': `"${revision}"` });
  expect(JSON.parse(put.init.body as string)).toEqual({ refreshSeconds: 25 });
  expect(document.getElementById('status')!.textContent).toContain('Restart Atlas');
  expect(localStorage.getItem('token')).toBeNull();
  expect(sessionStorage.getItem('token')).toBeNull();
});
test('the storage section says reports and user state are in S3 and offers no local folder or backend to pick', async () => {
  server();
  await open();
  await click('load');
  const text = document.getElementById('configuration')!.textContent!;
  expect(text).toContain('S3-compatible');
  expect(text).toContain('server/state.json');
  expect(document.getElementById('data')).toBeNull();
  expect(document.getElementById('write')).toBeNull();
});
test('with no policy saved the page says nothing is deleted, and saving one writes it through the API with the revision', async () => {
  const calls = server();
  // Browser storage is shared with other test files, so compare against what was there before this page ran.
  const before = JSON.stringify([{ ...localStorage }, { ...sessionStorage }]);
  await open();
  await type('token', 'admin-secret');
  await click('load');
  expect(document.getElementById('gc-empty')!.textContent).toContain('Garbage collection is off and nothing is deleted');
  expect((document.getElementById('gc-enabled') as HTMLInputElement).checked).toBe(false);
  expect((document.getElementById('gc-preview') as HTMLButtonElement).disabled).toBe(true);
  await type('gc-maxAgeDays', '45');
  await type('gc-keepLatest', '5');
  await type('gc-intervalHours', '12');
  await change('gc-enabled', 'true');
  await click('gc-save');
  const put = calls.at(-1)!;
  expect(put.url).toBe('/api/settings/gc');
  expect(put.init.method).toBe('PUT');
  expect(put.init.headers).toEqual({ authorization: 'Bearer admin-secret', 'content-type': 'application/json', 'if-match': `"${revision}"` });
  expect(JSON.parse(put.init.body as string)).toEqual(policy);
  expect(document.getElementById('status')!.textContent).toContain('saved to S3');
  expect(document.getElementById('gc-empty')).toBeNull();
  expect(JSON.stringify([{ ...localStorage }, { ...sessionStorage }])).toBe(before);
});
test('a saved policy is shown as loaded from S3, and a preview lists what would be deleted without deleting', async () => {
  const calls = server({ policy });
  await open();
  await click('load');
  expect(document.getElementById('gc-empty')).toBeNull();
  expect((document.getElementById('gc-maxAgeDays') as HTMLInputElement).value).toBe('45');
  expect((document.getElementById('gc-enabled') as HTMLInputElement).checked).toBe(true);
  expect((document.getElementById('gc-preview') as HTMLButtonElement).disabled).toBe(false);
  await click('gc-preview');
  expect(calls.at(-1)!.url).toBe('/api/settings/gc/run?dryRun=1');
  expect(calls.at(-1)!.init.method).toBe('POST');
  expect(document.getElementById('gc-runs')!.textContent).toContain('Preview (nothing deleted)');
  expect(document.getElementById('gc-runs')!.textContent).toContain('7');
});
test('invalid JSON and stale revisions block saves until corrected or reloaded', async () => {
  let requests = 0;
  globalThis.fetch = (async (url: string) => {
    requests++;
    if (url === '/api/settings/gc') return Response.json({ revision, policy: null, saved: false, lastRuns: [], stateKey: 'server/state.json' });
    return requests <= 2
      ? Response.json({ revision, settings: {}, active: {} })
      : Response.json({ detail: 'Reload settings before saving.' }, { status: 409 });
  }) as typeof fetch;
  await open();
  await click('load');
  expect(requests).toBe(2);
  await act(async () => [...document.querySelectorAll('button')].find((b) => b.textContent === 'Edit configuration as JSON')!.click());
  await type('settings', '{');
  await click('save');
  expect(requests).toBe(2);
  expect((document.getElementById('settings') as HTMLTextAreaElement).getAttribute('aria-invalid')).toBe('true');
  await type('settings', '{}');
  await click('save');
  expect(requests).toBe(3);
  expect(document.getElementById('status')!.getAttribute('role')).toBe('alert');
  expect(document.getElementById('status')!.textContent).toBe('Reload settings before saving.');
  expect((document.getElementById('save') as HTMLButtonElement).disabled).toBe(true);
  expect((document.getElementById('gc-save') as HTMLButtonElement).disabled).toBe(true);
  await click('save');
  expect(requests).toBe(3);
});
test('load has a busy state while a request is pending and recovers after completion', async () => {
  let finish!: (response: Response) => void;
  globalThis.fetch = ((url: string) =>
    url === '/api/settings/gc'
      ? Promise.resolve(Response.json({ revision, policy: null, saved: false, lastRuns: [], stateKey: 'server/state.json' }))
      : new Promise((resolve) => {
          finish = resolve;
        })) as typeof fetch;
  await open();
  await click('load');
  expect(document.getElementById('load')!.getAttribute('data-loading')).not.toBeNull();
  expect((document.getElementById('load') as HTMLButtonElement).disabled).toBe(true);
  await act(async () => finish(Response.json({ revision, settings: {}, active: {} })));
  expect(document.getElementById('load')!.getAttribute('data-loading')).toBeNull();
  expect(document.getElementById('load')!.textContent).toBe('Reload settings');
});

test('settings actions and fields are reachable through the keyboard command palette', async () => {
  server();
  await open();
  const { setFinderOpen } = await import('../src/find/open');
  try {
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })));
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Settings commands"]')!;
    expect(input).not.toBeNull();
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'focus admin token');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(document.querySelector('[aria-label="Settings actions"]')?.textContent).toContain('Focus');
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true })));
    for (let index = 0; index < 20 && document.activeElement !== document.getElementById('token'); index++) await act(async () => new Promise(resolve => setTimeout(resolve, 5)));
    expect(document.activeElement).toBe(document.getElementById('token'));
    expect(document.querySelector('[aria-label="Settings actions"]')).toBeNull();
  } finally { await act(async () => setFinderOpen(false)); }
});
