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
test('admin page loads and saves with Bearer authentication and optimistic concurrency', async () => {
  const requests: RequestInit[] = [];
  globalThis.fetch = (async (_, init) => {
    requests.push(init!);
    return Response.json({
      revision,
      settings: { data: './reports' },
      active: { data: '/project/reports' },
      restartRequired: init?.method === 'PUT'
    });
  }) as typeof fetch;
  await open();
  expect(document.getElementById('configuration')).toBeNull();
  await type('token', 'admin-secret');
  await click('load');
  expect((document.getElementById('data') as HTMLInputElement).value).toBe('./reports');
  await type('data', './archive');
  await click('save');
  expect(requests[1]!.headers).toEqual({
    authorization: 'Bearer admin-secret',
    'content-type': 'application/json',
    'if-match': `"${revision}"`
  });
  expect(JSON.parse(requests[1]!.body as string)).toEqual({ data: './archive' });
  expect(document.getElementById('status')!.textContent).toContain('Restart Atlas');
  expect(localStorage.getItem('token')).toBeNull();
  expect(sessionStorage.getItem('token')).toBeNull();
});
test('settings form preserves defaults and backend write flags until a destination is chosen', async () => {
  const saved = { data: './reports', backends: [{ id: 'archive', label: 'Archive', url: 's3://reports/atlas', write: true }] };
  const writes: unknown[] = [];
  globalThis.fetch = (async (_, init) => {
    if (init?.method === 'PUT') writes.push(JSON.parse(init.body as string));
    return Response.json({
      revision,
      settings: init?.body ? JSON.parse(init.body as string) : saved,
      active: { data: '/env/reports', refreshSeconds: 17, write: 'archive' }
    });
  }) as typeof fetch;
  await open();
  await click('load');
  expect((document.getElementById('refreshSeconds') as HTMLInputElement).value).toBe('');
  expect(document.querySelector('label[for="refreshSeconds"]')?.parentElement?.textContent).toContain('Current: 17');
  await type('data', './archive');
  await click('save');
  expect(writes[0]).toEqual({ ...saved, data: './archive' });
  await act(async () => {
    const select = document.getElementById('write') as HTMLSelectElement;
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!.call(select, 'data');
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await click('save');
  expect(writes[1]).toEqual({
    data: './archive',
    backends: [{ id: 'archive', label: 'Archive', url: 's3://reports/atlas' }],
    write: 'data'
  });
});
test('invalid JSON and stale revisions block saves until corrected or reloaded', async () => {
  let requests = 0;
  globalThis.fetch = (async () => {
    requests++;
    return requests === 1
      ? Response.json({ revision, settings: {}, active: {} })
      : Response.json({ detail: 'Reload settings before saving.' }, { status: 409 });
  }) as typeof fetch;
  await open();
  await click('load');
  await act(async () => [...document.querySelectorAll('button')].find((b) => b.textContent === 'Edit configuration as JSON')!.click());
  await type('settings', '{');
  await click('save');
  expect(requests).toBe(1);
  expect((document.getElementById('settings') as HTMLTextAreaElement).getAttribute('aria-invalid')).toBe('true');
  await type('settings', '{}');
  await click('save');
  expect(requests).toBe(2);
  expect(document.getElementById('status')!.getAttribute('role')).toBe('alert');
  expect(document.getElementById('status')!.textContent).toBe('Reload settings before saving.');
  expect((document.getElementById('save') as HTMLButtonElement).disabled).toBe(true);
  await click('save');
  expect(requests).toBe(2);
});
test('load has a busy state while a request is pending and recovers after completion', async () => {
  let finish!: (response: Response) => void;
  globalThis.fetch = (() =>
    new Promise((resolve) => {
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
