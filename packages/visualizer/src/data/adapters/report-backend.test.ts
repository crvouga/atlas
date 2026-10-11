import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { selectReport } from '../queries';
import { createHttpAdapter, LoadError } from './adapter';
import { createReportBackend, reportKey, sourceRuns } from './report-backend';

beforeEach(() => vi.stubGlobal('window', { location: { href: 'https://atlas.example.test/site/' } }));
afterEach(() => vi.unstubAllGlobals());

describe('report backends', () => {
  it('keeps identical report ids from different backends separate and routes selection', () => {
    const first = createReportBackend({ id: 'local', label: 'Local', type: 'http', baseUrl: '/local/' });
    const second = createReportBackend({ id: 'ci', label: 'CI', type: 'api', baseUrl: '/ci/' });
    const runs = [
      ...sourceRuns(second, [{ id: 'same report', startedAt: '2026-10-09T12:00:00Z', progress: 'running' }]),
      ...sourceRuns(first, [{ id: 'same report', startedAt: '2026-10-08T12:00:00Z', progress: 'complete' }])
    ];
    expect(new Set(runs.map((run) => run.id)).size).toBe(2);
    expect(selectReport(runs, [first, second])?.backend.id).toBe('ci');
    expect(selectReport(runs, [first, second], runs[1]!.id)?.backend.id).toBe('local');
    expect(second.mediaUrl('same report', 'media/a.png')).toBe('https://atlas.example.test/ci/runs/same%20report/files/media/a.png');
    expect(first.mediaUrl('same report', 'media/a.png')).toBe('https://atlas.example.test/local/runs/same%20report/media/a.png');
  });

  it('resolves qualified links before the source index arrives and retains legacy workspace links', () => {
    const backend = createReportBackend({ id: 'workspace', label: 'Local', type: 'http', baseUrl: '/local/' });
    expect(selectReport([], [backend], 'old-run')?.nativeId).toBe('old-run');
    expect(selectReport([], [backend], reportKey('workspace', 'id with ~ and spaces'))?.nativeId).toBe('id with ~ and spaces');
    expect(selectReport([], [backend], 'missing~run')).toBeNull();
    expect(selectReport([], [backend], 'workspace~%broken')).toBeNull();
  });

  it('reads the API contract and reports an API outage instead of treating it as an empty source', async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL) => new Response('{"runs":[]}'));
    vi.stubGlobal('fetch', fetch);
    const adapter = createHttpAdapter('/api/', 'api');
    await adapter.runsIndex();
    expect(fetch.mock.calls[0]?.[0]).toBe('https://atlas.example.test/api/runs');
    await adapter.manifest('run');
    expect(fetch.mock.calls[1]?.[0]).toBe('https://atlas.example.test/api/runs/run/manifest');
    fetch.mockImplementation(async () => new Response('', { status: 404 }));
    await expect(adapter.runsIndex()).rejects.toBeInstanceOf(LoadError);
    await expect(createHttpAdapter('/files/').runsIndex()).resolves.toEqual({ runs: [] });
  });

  it.each(['../private.png', '/private.png', '..\\private.png', 'media/../../secret'])('rejects media escaping its report: %s', (file) => {
    expect(createHttpAdapter('/data/').mediaUrl('run', file)).toBe('');
  });

  it.each(['javascript:alert(1)', 'file:///reports', 'https://token@example.test/data'])(
    'rejects an unsafe backend location: %s',
    (url) => {
      expect(() => createHttpAdapter(url)).toThrow();
    }
  );

  it('refreshes after event-stream reconnection, ignores malformed events, and closes on unsubscribe', () => {
    const streams: Stream[] = [];
    class Stream extends EventTarget {
      close = vi.fn();
      constructor(readonly url: string) {
        super();
        streams.push(this);
      }
    }
    vi.stubGlobal('EventSource', Stream);
    const adapter = createHttpAdapter('/api/', 'api', './events');
    const receive = vi.fn();
    const unsubscribe = adapter.subscribe!(receive);
    const stream = streams[0]!;
    expect(stream.url).toBe('https://atlas.example.test/api/events');
    stream.dispatchEvent(new Event('open'));
    expect(receive).toHaveBeenLastCalledWith({ scope: 'runs', files: [], runIds: [] });
    stream.dispatchEvent(new MessageEvent('atlas:change', { data: '{"scope":"runs","runIds":["live"]}' }));
    expect(receive).toHaveBeenLastCalledWith({ scope: 'runs', files: [], runIds: ['live'] });
    stream.dispatchEvent(new MessageEvent('message', { data: '{broken' }));
    stream.dispatchEvent(new MessageEvent('message', { data: '{"scope":"unknown"}' }));
    expect(receive).toHaveBeenCalledTimes(2);
    unsubscribe();
    expect(stream.close).toHaveBeenCalledOnce();
  });
});
