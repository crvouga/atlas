import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Timeline } from '@crvouga/atlas';
import { role, testId, text } from '@crvouga/atlas/signals';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { webdriverDriver } from './driver';
import { ELEMENT_KEY } from './protocol';

/**
 * A fake Appium server for a one-screen native app: a "Book" button (accessibility id `book`)
 * that turns into a "Booked for 9:30" label. It answers the W3C endpoints the driver uses and
 * resolves the XPath the driver builds by its quoted literal.
 */
type Element = { id: string; type: string; label: string; accessibilityId?: string };
let booked = false;
const screenOf = (): Element[] =>
  booked ? [{ id: 'e2', type: 'XCUIElementTypeStaticText', label: 'Booked for 9:30' }] : [{ id: 'e1', type: 'XCUIElementTypeButton', label: 'Book', accessibilityId: 'book' }];
const requests: string[] = [];
let server: Server;
let url: string;

const body = (req: IncomingMessage) =>
  new Promise<Record<string, unknown>>((resolve) => {
    let raw = '';
    req.on('data', (c: Buffer) => (raw += c.toString()));
    req.on('end', () => resolve(raw ? (JSON.parse(raw) as Record<string, unknown>) : {}));
  });

beforeAll(async () => {
  server = createServer(async (req, res) => {
    const send = (value: unknown, status = 200) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify({ value }));
    const route = `${req.method} ${(req.url ?? '').replace(/\/session\/s1/, '/session/:id').replace(/\/element\/e\d/, '/element/:el')}`;
    requests.push(route);
    const input = await body(req);
    if (route === 'POST /session') return send({ sessionId: 's1', capabilities: input.capabilities });
    if (route === 'POST /session/:id/elements') {
      const value = String(input.value);
      const literal = /'([^']*)'/.exec(value)?.[1];
      const found = screenOf().filter((e) =>
        input.using === 'accessibility id' ? e.accessibilityId === value : input.using === 'xpath' ? (literal ? e.label.includes(literal) : true) && (!value.includes('self::XCUIElementTypeButton') || e.type === 'XCUIElementTypeButton') : false
      );
      return send(found.map((e) => ({ [ELEMENT_KEY]: e.id })));
    }
    if (route === 'GET /session/:id/element/:el/displayed') return send(true);
    if (route === 'GET /session/:id/element/:el/rect') return send({ x: 10, y: 20, width: 100, height: 40 });
    if (route === 'POST /session/:id/element/:el/click') {
      booked = true;
      return send(null);
    }
    if (route === 'GET /session/:id/source')
      return send(`<AppiumAUT>${screenOf().map((e) => `<${e.type} label="${e.label}" visible="true"/>`).join('')}</AppiumAUT>`);
    if (route === 'GET /session/:id/screenshot') return send(Buffer.from('png-bytes').toString('base64'));
    if (route === 'DELETE /session/:id') return send(null);
    send({ error: 'unknown command', message: route }, 404);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const address = server.address();
  url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

afterAll(() => new Promise((r) => server.close(r)));

const open = async () => {
  const driver = webdriverDriver({ url, capabilities: { platformName: 'iOS', 'appium:automationName': 'XCUITest', 'appium:app': '/apps/Example.app' } });
  const timeline = new Timeline();
  const ctx = await driver.open({ path: { id: 'p' } as never, attempt: 1, mode: 'fast', directory: tmpdir(), timeline });
  return { driver, ctx, timeline };
};

describe('webdriverDriver on a native app', () => {
  it('infers a native session and resolves signals in the accessibility tree', async () => {
    booked = false;
    const { driver, ctx, timeline } = await open();
    expect(ctx.mode).toBe('native');
    expect(driver.name).toBe('webdriver:ios');
    expect(await ctx.isVisible(testId('book'))).toBe(true);
    expect(await ctx.isVisible(role('button', 'Book'))).toBe(true);
    await ctx.user.tap(testId('book'), 'Book');
    expect(timeline.entries).toMatchObject([{ kind: 'tap', label: 'Book', x: 60, y: 40 }]);
    expect(await ctx.isVisible(text('Booked for'))).toBe(true);
    expect(await ctx.isVisible(text(/booked for \d+:\d+/i))).toBe(true);
    expect(await ctx.isVisible(role('button', 'Book'))).toBe(false);
    expect(await driver.text!(ctx)).toBe('Booked for 9:30');
    await driver.close(ctx, { failed: false, traceFile: '' });
    expect(requests).toContain('DELETE /session/:id');
  });

  it('writes standard screenshots', async () => {
    const { driver, ctx } = await open();
    const directory = mkdtempSync(path.join(tmpdir(), 'atlas-webdriver-'));
    const image = await driver.screenshot!(ctx, path.join(directory, 'shot.png'));
    expect(readFileSync(image!.png, 'utf8')).toBe('png-bytes');
    rmSync(directory, { recursive: true, force: true });
  });

  it('reports WebDriver errors with their code', async () => {
    const { ctx } = await open();
    await expect(ctx.session.command('POST', '/appium/start_recording_screen')).rejects.toThrow('unknown command');
  });
});
