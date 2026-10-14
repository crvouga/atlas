import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { publishChecks } from '../../reports/src/publish-checks';
import { directoryStore } from '../../reports/src/directory-store';
import { devMain } from '../src/dev';

const cleanup: string[] = [];
afterAll(async () => { for (const dir of cleanup) await rm(dir, { recursive: true, force: true }); });

describe('atlas dev', () => {
  test('one host: the viewer is served, /api reaches the server behind it, and the stream passes through', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'atlas-dev-'));
    cleanup.push(dir);
    await publishChecks(directoryStore(dir), { producer: 'p', recordedAtMs: 1, checks: [{ id: 'a', title: 'a', status: 'passed' }] });
    const controller = new AbortController();
    let output = '';
    const port = 20_000 + Math.floor(Math.random() * 20_000);
    const done = devMain(['--port', String(port), '--data', dir], { out: text => { output += text; }, env: { HOME: dir }, cwd: dir, signal: controller.signal });
    const base = `http://127.0.0.1:${port}`;
    let page = '';
    for (let i = 0; i < 150 && !page; i++) {
      page = await fetch(base).then(r => r.text(), () => '');
      if (!page) await new Promise(resolve => setTimeout(resolve, 100));
    }
    expect(page).toContain('window.__ATLAS_CONFIG__={"api":"./api","reportsUrl":"./api/reports","dataUrl":"./api/data/","eventsUrl":"./api/events","effective":true}');
    const effective = await (await fetch(`${base}/api/reports/evidence/effective`)).json() as { layers: unknown[] };
    expect(effective.layers.length).toBe(1);

    const events = await fetch(`${base}/api/events`);
    expect(events.headers.get('content-type')).toContain('text/event-stream');
    const reader = events.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toContain('event: hello');
    // Results sent through the one host arrive on the stream through the same host.
    const sent = await fetch(`${base}/api/checks`, { method: 'POST', body: JSON.stringify({ producer: 'e2e', checks: [{ id: 'b', title: 'b', status: 'failed' }] }) });
    expect(sent.status).toBe(201);
    let text = '';
    for (let i = 0; i < 30 && !text.includes('event: report'); i++) text += new TextDecoder().decode((await reader.read()).value);
    expect(text).toContain('event: report');
    await reader.cancel();
    controller.abort();
    expect(await done).toBe(0);
    expect(output).toContain('Data in');
  }, 60_000);
});
