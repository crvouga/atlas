/** Issue #86: the About dialog names the viewer's build and the server's build apart, says unknown for what is missing, and copies a sanitized summary. */
import { afterEach, expect, test } from 'bun:test';

import { openAtlas, type Atlas } from './atlas';

let atlas: Atlas | null = null;
afterEach(async () => {
  await atlas?.close();
  atlas = null;
});

const SHA = '8a5f0907f2c1d4e5b6a7980a1b2c3d4e5f607182';

async function about(info: Record<string, unknown>) {
  atlas = await openAtlas({ at: '/', deps: {}, serverInfo: () => Response.json(info) });
  await atlas.click('button', 'View options');
  await atlas.click('button', 'About this deployment');
  await atlas.until(() => !!document.querySelector('table[aria-label="Server build"]') || atlas!.text().includes('could not be asked'), 'the server build');
  const rows = (label: string) => Object.fromEntries([...document.querySelectorAll(`table[aria-label="${label}"] tr`)].map(row => [row.querySelector('th')!.textContent, row.querySelector('td')!.textContent]));
  return { viewer: rows('Viewer build'), server: rows('Server build') };
}

test('1 and 2. a source-built server names its revision though its version is unknown, apart from the viewer', async () => {
  const written: string[] = [];
  const clipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value: string) => { written.push(value); } } });
  try {
    const { viewer, server } = await about({
      name: 'atlas', version: null, role: 'read', open: false, ready: true, write: 's3',
      build: { version: null, revision: SHA, builtAt: '2026-11-10T09:30:00.000Z', imageDigest: null },
      backends: [{ id: 's3', label: 's3://secret-bucket at https://minio.internal', available: true, write: true }], capabilities: { events: true, catalogIndex: true }
    });
    expect(server).toEqual({ Version: 'unknown', Revision: SHA, Built: '2026-11-10T09:30:00.000Z', 'Image digest': 'unknown' });
    // A test build of the viewer recorded nothing: each of its facts is unknown, never the server's.
    expect(viewer).toEqual({ Version: 'unknown', Revision: 'unknown', Built: 'unknown' });
    await atlas!.click('button', 'Copy support summary');
    await atlas!.sees('Copied');
    // 4. Only provenance: no storage address, backend label or anything else the server said.
    expect(written[0]).toContain(`revision: ${SHA}`);
    expect(written[0]).not.toContain('secret-bucket');
    expect(written[0]).not.toContain('minio');
  } finally {
    if (clipboard) Object.defineProperty(navigator, 'clipboard', clipboard); else Reflect.deleteProperty(navigator, 'clipboard');
  }
});

test('3. an older server without build metadata reads as unknown, and a server that cannot be asked says so', async () => {
  const { server } = await about({ name: 'atlas', version: '1.20.0', role: 'read', open: true, ready: true, write: 'data', backends: [], capabilities: {} });
  expect(server).toEqual({ Version: '1.20.0', Revision: 'unknown', Built: 'unknown', 'Image digest': 'unknown' });
  await atlas!.close();
  atlas = await openAtlas({ at: '/', deps: {}, serverInfo: () => new Response('nope', { status: 500 }) });
  await atlas.click('button', 'View options');
  await atlas.click('button', 'About this deployment');
  await atlas.sees('The server could not be asked');
  expect(atlas.find('button', 'Try again')).toBeDefined();
});
