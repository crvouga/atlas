import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { listenChanges, listenLive, resetLiveStreams, throttled, type LiveEvent } from '../src/live/live-stream';

/** An EventSource the test drives by hand. */
class FakeSource {
  static all: FakeSource[] = [];
  static readonly CLOSED = 2;
  readyState = 0;
  readonly handlers = new Map<string, ((event: MessageEvent<string>) => void)[]>();
  closed = false;
  constructor(readonly url: string) { FakeSource.all.push(this); }
  addEventListener(name: string, handler: (event: MessageEvent<string>) => void) { this.handlers.set(name, [...(this.handlers.get(name) ?? []), handler]); }
  close() { this.closed = true; this.readyState = 2; }
  send(name: string, data?: unknown) { for (const handler of this.handlers.get(name) ?? []) handler({ data: data === undefined ? '' : JSON.stringify(data) } as MessageEvent<string>); }
}

const original = (globalThis as { EventSource?: unknown }).EventSource;
beforeEach(() => { FakeSource.all = []; (globalThis as { EventSource?: unknown }).EventSource = FakeSource; });
afterEach(() => { resetLiveStreams(); (globalThis as { EventSource?: unknown }).EventSource = original; });

describe('hearing the server', () => {
  test('everything listening to one address shares one connection, closed with the last listener', () => {
    const stop = [listenLive('http://x/api/events', () => undefined), listenLive('http://x/api/events', () => undefined)];
    expect(FakeSource.all.length).toBe(1);
    stop[0]!();
    expect(FakeSource.all[0]!.closed).toBe(false);
    stop[1]!();
    expect(FakeSource.all[0]!.closed).toBe(true);
  });

  test('announcements and changes reach listeners; a listener that throws does not stop the others', () => {
    const heard: LiveEvent[] = [];
    listenLive('http://x/api/events', () => { throw new Error('bad listener'); });
    listenLive('http://x/api/events', event => heard.push(event));
    const source = FakeSource.all[0]!;
    source.send('open');
    source.send('report', { version: 'v1', totalLayers: 3, addedTotal: 1, added: [{ id: 'a', producer: 'e2e' }] });
    source.send('atlas:change', { scope: 'specs', files: [], runIds: [] });
    source.send('report', 'not an announcement');
    expect(heard.map(event => event.type)).toEqual(['open', 'report', 'change']);
    expect(heard[1]).toMatchObject({ report: { version: 'v1', added: [{ producer: 'e2e' }] } });
  });

  test('a connection means "read everything again": it is announced as a runs change, in case some were missed', () => {
    const changes: unknown[] = [];
    listenChanges('http://x/api/events', change => changes.push(change));
    FakeSource.all[0]!.send('open');
    expect(changes).toEqual([{ scope: 'runs', files: [], runIds: [] }]);
  });

  test('a connection the server refused is tried again, slowly, by the page itself', async () => {
    listenLive('http://x/api/events', () => undefined);
    const first = FakeSource.all[0]!;
    first.readyState = 2;
    first.send('error');
    expect(first.closed).toBe(true);
    expect(FakeSource.all.length).toBe(1);
    await new Promise(resolve => setTimeout(resolve, 1_100));
    expect(FakeSource.all.length).toBe(2);
  });
});

describe('reading again, not too often', () => {
  test('the first call acts at once; calls in a burst are one more act, when the wait is over; cancelling drops it', async () => {
    let acted = 0;
    const act = throttled(() => { acted += 1; }, 40);
    act();
    expect(acted).toBe(1);
    act(); act(); act();
    expect(acted).toBe(1);
    await new Promise(resolve => setTimeout(resolve, 80));
    expect(acted).toBe(2);
    await new Promise(resolve => setTimeout(resolve, 60));
    act();
    expect(acted).toBe(3);
    act();
    act.cancel();
    await new Promise(resolve => setTimeout(resolve, 80));
    expect(acted).toBe(3);
  });
});
