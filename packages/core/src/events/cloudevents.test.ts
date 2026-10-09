import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import type { CloudEvent } from './cloudevents';
import { cloudEventsFromHttp, cloudEventsHttpSource, compareBusinessEvents, correlated, logFileSource } from './cloudevents';

const ORDER_PLACED: CloudEvent = {
  specversion: '1.0',
  id: 'evt-1',
  source: '/shop',
  type: 'com.example.order.placed',
  time: '2026-01-02T03:04:05Z',
  datacontenttype: 'application/json',
  data: { items: 2 }
};

describe('cloudEventsFromHttp', () => {
  it('reads structured mode: the whole event is the JSON body', () => {
    const events = cloudEventsFromHttp({ 'content-type': 'application/cloudevents+json; charset=utf-8' }, JSON.stringify(ORDER_PLACED));
    expect(events).toEqual([ORDER_PLACED]);
  });

  it('reads batch mode: an array of events', () => {
    const second = { ...ORDER_PLACED, id: 'evt-2', type: 'com.example.order.paid' };
    const events = cloudEventsFromHttp({ 'content-type': 'application/cloudevents-batch+json' }, JSON.stringify([ORDER_PLACED, second]));
    expect(events.map((e) => e.id)).toEqual(['evt-1', 'evt-2']);
  });

  it('reads binary mode: attributes in ce- headers, data in the body, extensions kept', () => {
    const events = cloudEventsFromHttp(
      {
        'content-type': 'application/json',
        'ce-specversion': '1.0',
        'ce-id': 'evt-3',
        'ce-source': '/shop',
        'ce-type': 'com.example.order.placed',
        'ce-time': '2026-01-02T03:04:05Z',
        'ce-subject': 'order-9',
        'ce-traceparent': ['00-abc-def-01', 'ignored']
      },
      '{"items":2}'
    );
    expect(events).toEqual([
      {
        specversion: '1.0',
        id: 'evt-3',
        source: '/shop',
        type: 'com.example.order.placed',
        time: '2026-01-02T03:04:05Z',
        subject: 'order-9',
        datacontenttype: 'application/json',
        traceparent: '00-abc-def-01',
        data: { items: 2 }
      }
    ]);
  });

  it('keeps a binary body as text when it is not JSON, and fills a missing id and source', () => {
    const [event] = cloudEventsFromHttp({ 'content-type': 'text/plain', 'ce-type': 'com.example.ping' }, 'hello');
    expect(event).toMatchObject({ type: 'com.example.ping', source: 'unknown', data: 'hello', datacontenttype: 'text/plain' });
    expect(event?.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('ignores a request that is not a CloudEvent', () => {
    expect(cloudEventsFromHttp({ 'content-type': 'application/json' }, '{}')).toEqual([]);
  });

  it('throws on a malformed structured body', () => {
    expect(() => cloudEventsFromHttp({ 'content-type': 'application/cloudevents+json' }, '{nope')).toThrow();
  });
});

describe('cloudEventsHttpSource', () => {
  it('collects what was delivered since the last mark, in any content mode', async () => {
    const source = await cloudEventsHttpSource();
    try {
      expect(source.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
      const post = (headers: Record<string, string>, body: string) => fetch(source.url, { method: 'POST', headers, body });

      await post({ 'content-type': 'application/cloudevents+json' }, JSON.stringify({ ...ORDER_PLACED, id: 'before-mark' }));
      const mark = await source.mark();
      const structured = await post({ 'content-type': 'application/cloudevents+json' }, JSON.stringify(ORDER_PLACED));
      const binary = await post({ 'content-type': 'application/json', 'ce-specversion': '1.0', 'ce-id': 'b', 'ce-source': '/s', 'ce-type': 'com.example.order.paid' }, '{}');
      const bad = await post({ 'content-type': 'application/cloudevents+json' }, 'not json');

      expect([structured.status, binary.status, bad.status]).toEqual([202, 202, 400]);
      const { events } = await source.collect(mark);
      expect(events.map((e) => e.type)).toEqual(['com.example.order.placed', 'com.example.order.paid']);
    } finally {
      await source.close?.();
    }
  });
});

describe('logFileSource', () => {
  it('returns only the lines appended after the mark', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'atlas-log-'));
    const file = path.join(directory, 'app.log');
    try {
      writeFileSync(file, 'boot\n');
      const source = logFileSource(file, { settleMs: 0 });
      const first = await source.mark();
      appendFileSync(file, 'order placed id=7\n');
      const second = await source.mark();
      appendFileSync(file, 'order placed id=8 user=u-2\n');
      expect(await source.collect(first)).toEqual({ events: [], text: 'order placed id=7\norder placed id=8 user=u-2\n' });
      expect(await source.collect(second)).toEqual({ events: [], text: 'order placed id=8 user=u-2\n' });
      expect(correlated({ events: [], text: 'order placed id=7\norder placed id=8 user=u-2\n' }, ['u-2']).text).toBe('order placed id=8 user=u-2');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('compareBusinessEvents', () => {
  const collected = { events: [ORDER_PLACED], text: 'payment captured for order 9' };

  it('matches by CloudEvent type equal to the name when no matcher is given', () => {
    const result = compareBusinessEvents(['com.example.order.placed', 'com.example.order.shipped'], collected, {}, true);
    expect(result).toMatchObject({ observed: ['com.example.order.placed'], missing: ['com.example.order.shipped'], noSignal: [] });
  });

  it('uses type, pattern and function matchers', () => {
    const result = compareBusinessEvents(
      ['Order placed', 'Payment captured', 'Two items bought', 'Refund issued'],
      collected,
      {
        'Order placed': { type: 'com.example.order.placed' },
        'Payment captured': { pattern: /payment captured/ },
        'Two items bought': (events) => events.some((e) => (e.data as { items?: number }).items === 2),
        'Refund issued': { type: 'com.example.refund.issued' }
      },
      true
    );
    expect(result).toMatchObject({ observed: ['Order placed', 'Payment captured', 'Two items bought'], missing: ['Refund issued'], noSignal: [] });
  });

  it('calls an event with no matcher and no CloudEvents source "no signal", never missing', () => {
    const result = compareBusinessEvents(['Order placed'], { events: [], text: '' }, {}, false);
    expect(result).toMatchObject({ observed: [], missing: [], noSignal: ['Order placed'] });
  });
});
