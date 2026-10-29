import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { publishChecks } from '../../reports/src/publish-checks';
import { fakeS3, S3_TEST_ENV } from './fake-s3';
import { storeOn } from './fake-s3-store';
import { listen } from '../src/host';
import { devMain } from '../src/dev';

const cleanup: string[] = [];
afterAll(async () => { for (const dir of cleanup) await rm(dir, { recursive: true, force: true }); });

describe('atlas dev', () => {
  test('one host: the viewer is served, /api reaches the server behind it, and the stream passes through', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'atlas-dev-'));
    cleanup.push(dir);
    const s3 = fakeS3();
    await publishChecks(storeOn(s3), { producer: 'p', recordedAtMs: 1, checks: [{ id: 'a', title: 'a', status: 'passed' }] });
    const controller = new AbortController();
    let output = '';
    const port = 20_000 + Math.floor(Math.random() * 20_000);
    const done = devMain(['--port', String(port)], { out: text => { output += text; }, env: { HOME: dir, ...S3_TEST_ENV }, cwd: dir, signal: controller.signal, fetch: s3.fetch });
    const base = `http://127.0.0.1:${port}`;
    let page = '';
    for (let i = 0; i < 150 && !page; i++) {
      page = await fetch(base).then(r => r.text(), () => '');
      if (!page) await new Promise(resolve => setTimeout(resolve, 100));
    }
    const config = JSON.parse(/window.__ATLAS_CONFIG__=(\{[^<]*\})/.exec(page)![1]!);
    expect(config).toMatchObject({ api: './api', reportsUrl: './api/reports', dataUrl: './api/data/', eventsUrl: './api/events', projectsUrl: './api/projects', effective: true });
    const admin = await fetch(`${base}/admin`);
    expect(admin.status).toBe(200);
    expect(await admin.text()).toContain('Atlas server settings');
    const settings = await fetch(`${base}/api/settings`);
    expect(settings.status).toBe(200);
    expect((await settings.json()).active.refreshSeconds).toBe(10);
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
    expect(output).toContain('Reports are stored in s3://atlas-test/');
  }, 60_000);

  test('without the S3 variables it refuses to start and lists every one', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'atlas-dev-nos3-'));
    cleanup.push(dir);
    let output = '';
    expect(await devMain(['--port', '0'], { cwd: dir, env: { HOME: dir }, out: text => { output += text; } })).toBe(2);
    expect(output).toContain('ATLAS_S3_BUCKET');
    expect(output).toContain('[MISSING]');
  });

  test('a busy viewer port fails instead of silently sending publishers to another server', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'atlas-dev-busy-'));
    cleanup.push(dir);
    const occupied = await listen(() => Response.json({ other: true }), { host: '127.0.0.1', port: 0, maxBodyBytes: 1024 });
    try {
      await expect(devMain(['--port', String(occupied.port)], { cwd: dir, env: { HOME: dir, ...S3_TEST_ENV }, out: () => {}, fetch: fakeS3().fetch })).rejects.toThrow('already in use');
    } finally { await occupied.close(); }
  }, 60_000);
});
