import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { SETTINGS_PAGE } from '../../server/src/settings';

test('admin page loads settings and saves with Bearer authentication and optimistic concurrency', async () => {
  const page = new Window({ url: 'http://atlas.test/admin' });
  page.document.write(SETTINGS_PAGE.replace(/<script type="module">[\s\S]*?<\/script>/, ''));
  const requests: { method: string; headers: Record<string, string>; body?: string }[] = [];
  page.fetch = (async (_url: unknown, init: { method: string; headers: Record<string, string>; body?: string }) => {
    requests.push(init);
    return Response.json({ revision: 'a'.repeat(64), settings: { data: './reports' }, active: { data: '/project/reports' }, restartRequired: init.method === 'PUT', precedence: 'Environment overrides saved settings.' });
  }) as typeof page.fetch;
  try {
    page.eval(SETTINGS_PAGE.match(/<script type="module">([\s\S]*?)<\/script>/)![1]!);
    const token = page.document.getElementById('token') as unknown as HTMLInputElement;
    token.value = 'admin-secret';
    const load = page.document.getElementById('load')!;
    await (load as unknown as { onclick(): Promise<void> }).onclick();
    const editor = page.document.getElementById('settings') as unknown as HTMLTextAreaElement;
    expect(editor.disabled).toBe(false);
    expect(JSON.parse(editor.value)).toEqual({ data: './reports' });
    editor.value = '{"data":"./archive"}';
    const save = page.document.getElementById('save')!;
    await (save as unknown as { onclick(): Promise<void> }).onclick();
    expect(requests[1]!.headers).toEqual({ authorization: 'Bearer admin-secret', 'content-type': 'application/json', 'if-match': `"${'a'.repeat(64)}"` });
    expect(JSON.parse(requests[1]!.body!)).toEqual({ data: './archive' });
    expect(page.document.getElementById('status')!.textContent).toContain('Restart Atlas');
    expect(page.localStorage.length).toBe(0);
    expect(page.sessionStorage.length).toBe(0);
    page.fetch = (async () => Response.json({ detail: 'Reload settings before saving.' }, { status: 409 })) as typeof page.fetch;
    await (save as unknown as { onclick(): Promise<void> }).onclick();
    expect(page.document.getElementById('status')!.textContent).toBe('Reload settings before saving.');
  } finally { await page.happyDOM.close(); }
});

test('settings form preserves defaults and backend selection while editing saved values', async () => {
  const page = new Window({ url: 'http://atlas.test/admin?project=todo-app' });
  page.document.write(SETTINGS_PAGE.replace(/<script type="module">[\s\S]*?<\/script>/, ''));
  const saved = { data: './reports', backends: [{ id: 'archive', label: 'Archive', url: 's3://reports/atlas', write: true }] };
  const writes: unknown[] = [];
  page.fetch = (async (_url: unknown, init: { method: string; body?: string }) => {
    if (init.method === 'PUT') writes.push(JSON.parse(init.body!));
    return Response.json({ revision: 'b'.repeat(64), settings: init.body ? JSON.parse(init.body) : saved, active: { data: '/env/reports', refreshSeconds: 17, write: 'archive' } });
  }) as typeof page.fetch;
  try {
    page.eval(SETTINGS_PAGE.match(/<script type="module">([\s\S]*?)<\/script>/)![1]!);
    const click = async (id: string) => (page.document.getElementById(id) as unknown as { onclick(): Promise<void> }).onclick();
    await click('load');
    const input = page.document.getElementById('data') as unknown as HTMLInputElement;
    const refresh = page.document.getElementById('refreshSeconds') as unknown as HTMLInputElement;
    expect(input.value).toBe('./reports');
    expect(refresh.value).toBe('');
    expect(page.document.getElementById('refreshSeconds-current')!.textContent).toBe('Current: 17');
    input.value = './archive';
    input.dispatchEvent(new page.Event('input', { bubbles: true }));
    await click('save');
    expect(writes[0]).toEqual({ ...saved, data: './archive' });
    const destination = page.document.getElementById('write') as unknown as HTMLSelectElement;
    destination.value = 'data';
    destination.dispatchEvent(new page.Event('change', { bubbles: true }));
    await click('save');
    expect(writes[1]).toEqual({ data: './archive', backends: [{ id: 'archive', label: 'Archive', url: 's3://reports/atlas' }], write: 'data' });
    expect(page.document.querySelector('.report-link')!.getAttribute('href')).toBe('/?project=todo-app#/');
  } finally { await page.happyDOM.close(); }
});

test('invalid JSON and stale revisions cannot trigger further saves', async () => {
  const page = new Window({ url: 'http://atlas.test/admin' });
  page.document.write(SETTINGS_PAGE.replace(/<script type="module">[\s\S]*?<\/script>/, ''));
  let requests = 0;
  page.fetch = (async () => {
    requests++;
    return requests === 1 ? Response.json({ revision: 'c'.repeat(64), settings: {}, active: {} }) : Response.json({ detail: 'Reload settings before saving.' }, { status: 409 });
  }) as typeof page.fetch;
  try {
    page.eval(SETTINGS_PAGE.match(/<script type="module">([\s\S]*?)<\/script>/)![1]!);
    const click = async (id: string) => (page.document.getElementById(id) as unknown as { onclick(): Promise<void> }).onclick();
    await click('load');
    const editor = page.document.getElementById('settings') as unknown as HTMLTextAreaElement;
    editor.value = '{';
    await click('save');
    expect(requests).toBe(1);
    expect(page.document.getElementById('status')!.getAttribute('role')).toBe('alert');
    editor.value = '{}';
    await click('save');
    expect(requests).toBe(2);
    expect((page.document.getElementById('save') as unknown as HTMLButtonElement).disabled).toBe(true);
    await click('save');
    expect(requests).toBe(2);
  } finally { await page.happyDOM.close(); }
});

test('settings exposes busy state only while a request is working', async () => {
  const page = new Window({ url: 'http://atlas.test/admin' });
  page.document.write(SETTINGS_PAGE.replace(/<script type="module">[\s\S]*?<\/script>/, ''));
  let finish!: (response: Response) => void;
  page.fetch = (() => new Promise(resolve => { finish = resolve; })) as typeof page.fetch;
  try {
    page.eval(SETTINGS_PAGE.match(/<script type="module">([\s\S]*?)<\/script>/)![1]!);
    const load = page.document.getElementById('load')!;
    const pending = (load as unknown as { onclick(): Promise<void> }).onclick();
    expect(load.getAttribute('aria-busy')).toBe('true');
    expect(load.textContent).toBe('Working…');
    finish(Response.json({ revision: 'd'.repeat(64), settings: {}, active: {} }));
    await pending;
    expect(load.getAttribute('aria-busy')).toBe('false');
    expect(load.textContent).toBe('Reload settings');
  } finally { await page.happyDOM.close(); }
});
