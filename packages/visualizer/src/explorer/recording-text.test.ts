import type { CheckDetail } from '@crvouga/atlas/reports/evidence-detail';
import { indexCorpus, matchText } from '../find/rank';
import { parseSearch } from '../find/query';
import type { Attachment } from '@crvouga/atlas/schema';
import { expect, test } from 'bun:test';

import { clock, coverageCounts, coverageOf, indexTrack, parseTimestamp, rangeWord, segmentDoc, segmentsOf, tracksOf, trackReadable, uncertaintyWord } from './recording-text';
import type { PlaylistEntry } from './playlist-entries';

const video = (name: string, extra: Partial<Attachment> = {}): Attachment => ({ name, contentType: 'video/webm', bundleKey: `attachments/${name}`, sha256: name, ...extra });
const track = (name: string, extra: Partial<Attachment> = {}): Attachment => ({ name, contentType: 'text/vtt', bundleKey: `attachments/${name}`, ...extra });
const detail = (check: Record<string, unknown>): CheckDetail => ({ layer: 'l', kind: 'gherkin', check: { id: 'pay', title: 'Pay', status: 'passed', ...check } as never, run: {} });
const entry: PlaylistEntry = { id: 'e', title: 'Pay', key: 'k', specPath: 'a.feature', status: 'failed', environment: 'web', producer: 'p', at: 1, layer: 'l', backend: 'local', check: 'pay', kind: null, tags: [], videos: [] };

const VTT = `WEBVTT

NOTE a comment

1
00:00:01.000 --> 00:00:03.500 align:start
Please confirm the <b>delivery</b> address

00:01:02.5 --> 00:01:04.000
Thank you
`;

test('WebVTT and SubRip cues become timed segments with their markup removed', () => {
  const result = indexTrack(tracksOf(detail({ attachments: [video('a.webm'), track('t.vtt')] }))[0]!, VTT);
  expect(result.state).toBe('indexed');
  expect(result.timing).toBe('valid');
  expect(result.segments).toEqual([
    { text: 'Please confirm the delivery address', startMs: 1000, endMs: 3500 },
    { text: 'Thank you', startMs: 62_500, endMs: 64_000 }
  ]);
  const srt = indexTrack(tracksOf(detail({ attachments: [video('a.webm'), track('t.srt', { contentType: 'application/x-subrip' })] }))[0]!, '1\n00:00:01,200 --> 00:00:02,000\nHello there\n');
  expect(srt.segments).toEqual([{ text: 'Hello there', startMs: 1200, endMs: 2000 }]);
});

test('JSON segments take seconds or milliseconds and keep only a confidence between 0 and 1', () => {
  const t = tracksOf(detail({ attachments: [video('a.webm'), track('o.json', { contentType: 'application/json', role: 'ocr' })] }))[0]!;
  const result = indexTrack(t, JSON.stringify({ segments: [{ start: 1, end: 2.5, text: 'Order total', confidence: 0.62 }, { startMs: 4000, endMs: 3000, text: 'Backwards' }, { text: 'No time' }, { text: 'Odd', confidence: 7 }] }));
  expect(result.segments.map((s) => [s.text, s.startMs, s.endMs, s.confidence])).toEqual([
    ['Order total', 1000, 2500, 0.62],
    ['Backwards', null, null, undefined],
    ['No time', null, null, undefined],
    ['Odd', null, null, undefined]
  ]);
  expect(result.timing).toBe('partial');
});

test('timing that is absent or invalid keeps the words searchable and says it cannot seek', () => {
  const plain = indexTrack(tracksOf(detail({ attachments: [video('a.webm'), track('t.txt', { contentType: 'text/plain', role: 'transcript' })] }))[0]!, 'delivery address\n\nthanks');
  expect(plain.timing).toBe('absent');
  expect(plain.segments.map((s) => s.startMs)).toEqual([null, null]);
  const bad = indexTrack(tracksOf(detail({ attachments: [video('a.webm'), track('t.vtt')] }))[0]!, 'WEBVTT\n\nlater --> sooner\nThe words');
  expect(bad.state).toBe('indexed');
  expect(bad.timing).toBe('invalid');
  expect(rangeWord({ segment: bad.segments[0]!, timing: bad.timing })).toBe('Time unusable');
  expect(rangeWord({ segment: plain.segments[0]!, timing: plain.timing })).toBe('No time given');
});

test('a form that is not read is unsupported, text that does not parse failed, and an empty file failed', () => {
  const t = tracksOf(detail({ attachments: [video('a.webm'), track('t.vtt')] }))[0]!;
  expect(indexTrack({ ...t, attachment: track('x.bin', { contentType: 'application/pdf', role: 'transcript' }) }, '').state).toBe('unsupported');
  expect(indexTrack({ ...t, attachment: track('x.json', { contentType: 'application/json', role: 'transcript' }) }, '{nope').state).toBe('failed');
  expect(indexTrack({ ...t, attachment: track('x.json', { contentType: 'application/json', role: 'transcript' }) }, '{"nothing":1}').state).toBe('failed');
  expect(indexTrack(t, 'WEBVTT\n').state).toBe('failed');
});

test('a track belongs to the video that lists it, else the only video at its level, else to none', () => {
  const linked = tracksOf(detail({ attachments: [video('a.webm', { id: 'v1', captions: ['t1'] }), video('b.webm', { id: 'v2' }), track('t1.vtt', { id: 't1' })] }));
  expect(linked[0]!.recording).toBe('sha256:a.webm');
  const named = tracksOf(detail({ attachments: [video('a.webm', { id: 'v1' }), video('b.webm', { id: 'v2' }), track('t2.vtt', { extensions: { 'atlas.text': { recording: 'v2' } } })] }));
  expect(named[0]!.recording).toBe('sha256:b.webm');
  expect(tracksOf(detail({ attachments: [video('a.webm'), track('t.vtt')] }))[0]!.recording).toBe('sha256:a.webm');
  expect(tracksOf(detail({ attachments: [video('a.webm'), video('b.webm'), track('t.vtt')] }))[0]!.recording).toBeNull();
});

test('each retry attempt keeps its own video and words, with the attempt named', () => {
  const d = detail({
    status: 'passed',
    attempts: [
      { index: 0, status: 'failed', attachments: [video('first.webm'), track('first.vtt')] },
      { index: 1, status: 'passed', attachments: [video('second.webm'), track('second.vtt')] }
    ]
  });
  const tracks = tracksOf(d);
  expect(tracks.map((t) => [t.attempt, t.recording])).toEqual([[0, 'sha256:first.webm'], [1, 'sha256:second.webm']]);
  const results = [
    indexTrack(tracks[0]!, 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\ncard declined banner'),
    indexTrack(tracks[1]!, 'WEBVTT\n\n00:00:05.000 --> 00:00:06.000\npayment accepted banner')
  ];
  const videos = coverageOf(d, results);
  const segments = segmentsOf(entry, d, results, videos);
  expect(segments.map((s) => [s.segment.text, s.attempt, s.attemptLabel, s.recording])).toEqual([
    ['card declined banner', 0, 'Attempt 1 of 2 (failed)', 'sha256:first.webm'],
    ['payment accepted banner', 1, 'Attempt 2 of 2 (passed)', 'sha256:second.webm']
  ]);
});

test('no text, a silent recording, an unreadable file and a searched recording are four different states', () => {
  const d = detail({
    attachments: [
      video('none.webm'),
      video('silent.webm', { scope: { audioCaptured: false } }),
      video('broken.webm', { id: 'b', captions: ['bt'] }),
      track('bt.vtt', { id: 'bt', extensions: { 'atlas.text': { state: 'failed', reason: 'The recognizer crashed.' } } }),
      video('good.webm', { id: 'g', captions: ['gt'] }),
      track('gt.vtt', { id: 'gt' })
    ]
  });
  const tracks = tracksOf(d);
  const results = tracks.map((t) => (trackReadable(t).readable ? indexTrack(t, 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nhello') : { track: t, state: 'failed' as const, reason: (trackReadable(t) as { reason: string }).reason, segments: [], timing: 'absent' as const, truncated: false }));
  const videos = coverageOf(d, results);
  expect(Object.fromEntries(videos.map((v) => [v.name, v.state]))).toEqual({ 'none.webm': 'not-indexed', 'silent.webm': 'unsupported', 'broken.webm': 'failed', 'good.webm': 'searched' });
  expect(videos.find((v) => v.name === 'broken.webm')!.reason).toBe('The recognizer crashed.');
  expect(coverageCounts(videos)).toEqual({ searched: 1, 'not-indexed': 1, unsupported: 1, failed: 1 });
});

test('a file the producer left out, or kept at an address, is never read', () => {
  const [left] = tracksOf(detail({ attachments: [video('a.webm'), track('t.vtt', { omitted: 'not-allowed' })] }));
  expect(trackReadable(left!)).toMatchObject({ readable: false, state: 'failed' });
  const [away] = tracksOf(detail({ attachments: [video('a.webm'), { name: 't.vtt', contentType: 'text/vtt', uri: 'https://example.test/t.vtt' }] }));
  expect(trackReadable(away!)).toMatchObject({ readable: false, state: 'unsupported' });
});

test('the shared matcher finds a phrase, a misspelling and screen text in the indexed words only', () => {
  const t = tracksOf(detail({ attachments: [video('a.webm'), track('t.vtt', { role: 'ocr', extensions: { 'atlas.text': { generated: true, generator: 'ocr-tool' } } })] }))[0]!;
  expect(t.kind).toBe('screen');
  const result = indexTrack(t, VTT);
  const d = detail({ attachments: [video('a.webm'), track('t.vtt')] });
  const items = segmentsOf(entry, d, [result], coverageOf(d, [result]));
  const index = indexCorpus(items.map(segmentDoc));
  const found = (query: string) => matchText(index, parseSearch(query), { snippets: false })?.map((hit) => hit.doc.title) ?? null;
  expect(found('delivery address')).toEqual(['Please confirm the delivery address']);
  expect(found('delivry adress')).toEqual(['Please confirm the delivery address']);
  expect(found('refund')).toEqual([]);
  expect(items[0]!.kind).toBe('screen');
  expect(items[0]!.generated).toBe(true);
  expect(uncertaintyWord({ ...items[0]!, segment: { ...items[0]!.segment, confidence: 0.62 } })).toBe('Generated by ocr-tool, confidence 62%. It may contain errors.');
});

test('clocks and timestamps', () => {
  expect(clock(3_725_000)).toBe('1:02:05');
  expect(clock(62_500)).toBe('1:02');
  expect(parseTimestamp('1:02.5')).toBe(62_500);
  expect(parseTimestamp('00:61:00.000')).toBeNull();
  expect(parseTimestamp('soon')).toBeNull();
});
