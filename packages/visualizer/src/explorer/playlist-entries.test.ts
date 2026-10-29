import type { VideoRef } from '@crvouga/atlas/reports/evidence-types';
import { expect, test } from 'bun:test';

import { entriesFromRun, playlistCounts, recordingState, stepFrom, type PlaylistEntry } from './playlist-entries';

const video = (recording?: string): VideoRef => ({ name: 'a.webm', owner: 'check', available: recording !== undefined, ...(recording ? { recording } : {}) });
const entry = (id: string, extra: Partial<PlaylistEntry> = {}): PlaylistEntry => ({
  id, title: id, key: id, specPath: null, status: 'passed', environment: 'desktop-web', producer: 'web', at: 1, layer: 'l', backend: 'local', check: id, kind: null, tags: [], videos: [], ...extra
});

test('a recording state never says more than what is stored', () => {
  expect(recordingState(entry('a', { videos: [video('sha256:1')] }))).toBe('playable');
  expect(recordingState(entry('a', { videos: [video()] }))).toBe('unplayable');
  // Bytes exist, but nothing says which backend to read them from.
  expect(recordingState(entry('a', { videos: [video('sha256:1')], backend: null }))).toBe('unplayable');
  expect(recordingState(entry('a', { environment: 'api-rest' }))).toBe('api-only');
  expect(recordingState(entry('a', { environment: null }))).toBe('none');
  expect(recordingState(entry('a'))).toBe('none');
});

test('counts keep failures and gaps visible', () => {
  const counts = playlistCounts([
    entry('a', { videos: [video('sha256:1')] }),
    entry('b', { status: 'failed', videos: [video('sha256:2')] }),
    entry('c', { status: 'failed' }),
    entry('d', { environment: 'api' })
  ]);
  expect(counts).toEqual({ playable: 2, unplayable: 0, 'api-only': 1, none: 1, failed: 2 });
});

test('previous and next walk the watchable entries, skip gaps, wrap only when asked and work from a gap', () => {
  const play = { videos: [video('sha256:1')] };
  const list = [entry('a', play), entry('gap'), entry('b', play), entry('c', play)];
  expect(stepFrom(list, 'a', 1, false)?.id).toBe('b');
  expect(stepFrom(list, 'c', 1, false)).toBeNull();
  expect(stepFrom(list, 'c', 1, true)?.id).toBe('a');
  expect(stepFrom(list, 'a', -1, false)).toBeNull();
  expect(stepFrom(list, 'a', -1, true)?.id).toBe('c');
  expect(stepFrom(list, 'gap', 1, false)?.id).toBe('b');
  expect(stepFrom(list, 'gap', -1, false)?.id).toBe('a');
  expect(stepFrom([list[0]!], 'a', 1, true)?.id).toBe('a');
  expect(stepFrom([entry('gap')], 'gap', 1, true)).toBeNull();
});

test('a run result gets its backend from the layers of the run, and none when they are not known', () => {
  const result = { key: 'k', id: 'c', title: 'T', specPath: null, environment: 'ios', producer: 'p', status: 'failed' as const, durationMs: null, at: 1, layer: 'abc', detail: '', videos: [{ ...video('sha256:1'), tags: ['demo'] }] };
  const layers = [{ id: 'abc', backend: 'shared', producer: 'p', environment: 'ios', recordedAtMs: 1, checks: 1, attachments: 0 }];
  expect(entriesFromRun([result], layers)[0]).toMatchObject({ backend: 'shared', check: 'c', status: 'failed', tags: ['demo'] });
  expect(entriesFromRun([result], undefined)[0]!.backend).toBeNull();
  expect(recordingState(entriesFromRun([result], undefined)[0]!)).toBe('unplayable');
});
