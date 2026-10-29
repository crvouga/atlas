/**
 * @module Words in recordings
 *
 * What a person said or what was shown on screen in a recording, found as text a producer supplied with it. Atlas never
 * transcribes or reads a screen: it indexes attachments the producer attached on purpose (a WebVTT or SRT file, a JSON
 * list of timed segments, a plain transcript), and says how the text came to be (spoken, on screen, a caption; written
 * by a person or generated, and with what confidence). A match is a way to find a moment, never a statement that the
 * behavior passed: the outcome beside it is the result's own.
 *
 * Which attachment is text for which video: a text track is an attachment whose `extensions["atlas.text"]` says so, whose
 * `role` is `transcript`, `ocr`, `screen-text`, `captions` or `subtitles`, or whose type is WebVTT or SubRip. It belongs to
 * the video that lists its `id` in `captions`, or that its `extensions["atlas.text"].recording` names by `id`, else to the
 * only video held at the same level (the same retry attempt, or the check). Several videos and no link: the words are
 * found but no recording is named. Everything here is pure; reading the files is `RecordingTextSearch.tsx`'s job and
 * goes through the same report API, and so the same access rules, as playing the recording.
 */
import { attachmentIdentity, isVideoAttachment, type CheckDetail } from '@crvouga/atlas/reports/evidence-detail';
import { effectiveScope } from '@crvouga/atlas/reports/evidence-scope';
import { contentTypeOf } from '@crvouga/atlas/reports/media-types';
import type { Attachment, EvidenceScope } from '@crvouga/atlas/schema';

import type { FindDoc } from '../find/rank';
import type { PlaylistEntry } from './playlist-entries';

/** The key of the extension a producer uses to describe a text track. */
export const TEXT_EXTENSION = 'atlas.text';

/** Where the words of a segment came from: said aloud, shown on screen, or captions (which a person or a tool wrote for the sound). */
export type TextKind = 'speech' | 'screen' | 'caption';

/** What each kind is called, in a result. */
export const TEXT_KIND_WORD: Record<TextKind, string> = { speech: 'Spoken (transcript)', screen: 'On screen (OCR)', caption: 'Caption' };

/** The longest text read from one track, in characters; more is left unread and said to be. */
export const MAX_TRACK_CHARS = 2_000_000;
/** The most segments indexed from one track. */
export const MAX_SEGMENTS = 5000;

/** One indexed piece of text. `startMs` and `endMs` are null when the track gave no usable time for it. */
export type TextSegment = {
  readonly text: string;
  readonly startMs: number | null;
  readonly endMs: number | null;
  /** The producer's or tool's own confidence, 0 to 1, when it gave one. */
  readonly confidence?: number;
};

/** How well the times of a track's segments can be trusted: all `valid`, some `partial`, none given (`absent`) or none usable (`invalid`). */
export type TimingState = 'valid' | 'partial' | 'absent' | 'invalid';

/** A text track found in a result's evidence, before its file is read. */
export type TrackRef = {
  readonly attachment: Attachment;
  readonly kind: TextKind;
  readonly generated: boolean;
  readonly generator?: string;
  /** The retry attempt that holds it; null when the check does. */
  readonly attempt: number | null;
  /** The identity of the video it belongs to (`attachmentIdentity`), or null when none is named. */
  readonly recording: string | null;
  /** What the producer declared about its indexing, when it declared a problem. */
  readonly declared?: { readonly state: 'failed' | 'unsupported'; readonly reason: string };
};

/** What reading one track gave: its segments, or why it gave none. */
export type TrackResult = {
  readonly track: TrackRef;
  readonly state: 'indexed' | 'failed' | 'unsupported';
  /** In words, when it is not indexed. */
  readonly reason?: string;
  readonly segments: readonly TextSegment[];
  readonly timing: TimingState;
  /** True when the track was longer than what is indexed. */
  readonly truncated: boolean;
};

/**
 * Whether a recording's words were searched, and if not, why: `searched` (some text was read, so "no match" means no
 * match), `not-indexed` (no text was supplied), `unsupported` (this recording cannot have the text: it is silent, or the
 * text is in a form Atlas does not read) or `failed` (text was supplied and could not be read).
 */
export type CoverageState = 'searched' | 'not-indexed' | 'unsupported' | 'failed';

/** One video of a result and what is known about searching inside it. */
export type VideoCoverage = {
  readonly name: string;
  /** `attachmentIdentity` of the video; null when it names no bytes. */
  readonly recording: string | null;
  readonly attempt: number | null;
  readonly state: CoverageState;
  readonly reason: string;
  readonly tracks: readonly TrackResult[];
};

const ROLES: Readonly<Record<string, TextKind>> = {
  transcript: 'speech',
  transcription: 'speech',
  speech: 'speech',
  ocr: 'screen',
  'screen-text': 'screen',
  captions: 'caption',
  caption: 'caption',
  subtitles: 'caption'
};

const type = (attachment: Attachment) => (attachment.contentType ?? contentTypeOf(attachment.name)).split(';')[0]!.trim().toLowerCase();

function declaration(attachment: Attachment): Record<string, unknown> | null {
  const value = attachment.extensions?.[TEXT_EXTENSION];
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** The kind of text an attachment is, or null when it is not a text track. A video is never one. */
export function textKindOf(attachment: Attachment): TextKind | null {
  if (isVideoAttachment(attachment)) return null;
  const declared = declaration(attachment);
  const said = typeof declared?.kind === 'string' ? declared.kind.toLowerCase() : '';
  if (said === 'speech' || said === 'screen' || said === 'caption') return said;
  const role = attachment.role?.toLowerCase();
  if (role && ROLES[role]) return ROLES[role]!;
  if (declared) return 'speech';
  const media = type(attachment);
  return media === 'text/vtt' || media === 'application/x-subrip' ? 'caption' : null;
}

type Group = { readonly attempt: number | null; readonly attachments: readonly Attachment[]; readonly scope: EvidenceScope | undefined };

/** The attachments of the check, then of each retry attempt, with their steps' attachments, each group with the scope its attempt declares. */
function groupsOf(detail: CheckDetail): Group[] {
  const own = [...(detail.check.attachments ?? []), ...(detail.check.steps ?? []).flatMap((step) => step.attachments ?? [])];
  const groups: Group[] = [{ attempt: null, attachments: own, scope: undefined }];
  for (const attempt of detail.check.attempts ?? []) {
    groups.push({
      attempt: attempt.index,
      attachments: [...(attempt.attachments ?? []), ...(attempt.steps ?? []).flatMap((step) => step.attachments ?? [])],
      scope: attempt.scope
    });
  }
  return groups;
}

function referenceTo(track: Attachment, videos: readonly Attachment[], pool: readonly Attachment[]): Attachment | null {
  const declared = declaration(track);
  const named = typeof declared?.recording === 'string' ? declared.recording : undefined;
  const claimed = pool.filter((video) => (track.id !== undefined && video.captions?.includes(track.id)) || (named !== undefined && video.id === named));
  if (claimed.length > 0) return claimed[0]!;
  return videos.length === 1 ? videos[0]! : null;
}

/** The text tracks of a result, each tied to its video when that can be told, with the retry attempt that holds it. */
export function tracksOf(detail: CheckDetail): TrackRef[] {
  const groups = groupsOf(detail);
  const allVideos = groups.flatMap((group) => group.attachments.filter(isVideoAttachment));
  const out: TrackRef[] = [];
  for (const group of groups) {
    const videos = group.attachments.filter(isVideoAttachment);
    for (const attachment of group.attachments) {
      const kind = textKindOf(attachment);
      if (!kind) continue;
      const declared = declaration(attachment);
      const state = typeof declared?.state === 'string' ? declared.state.toLowerCase() : typeof declared?.indexing === 'string' ? declared.indexing.toLowerCase() : '';
      const reason = typeof declared?.reason === 'string' ? declared.reason : '';
      // Unlinked at its own level, a track of the check may still name a video of an attempt, and the reverse.
      const video = referenceTo(attachment, videos, allVideos) ?? (videos.length === 0 && group.attempt !== null ? referenceTo(attachment, groups[0]!.attachments.filter(isVideoAttachment), allVideos) : null);
      out.push({
        attachment,
        kind,
        generated: declared?.generated === true,
        ...(typeof declared?.generator === 'string' ? { generator: declared.generator } : {}),
        attempt: group.attempt,
        recording: video ? (attachmentIdentity(video) ?? null) : null,
        ...(state === 'failed' || state === 'unsupported'
          ? { declared: { state: state as 'failed' | 'unsupported', reason: reason || (state === 'failed' ? 'The producer reported that indexing this text failed.' : 'The producer reported that this text is not supported.') } }
          : {})
      });
    }
  }
  return out;
}

/** The videos of a result: where each is held, and the scope that says whether it has sound. */
export function videosOf(detail: CheckDetail): { attachment: Attachment; attempt: number | null; scope: EvidenceScope | undefined }[] {
  return groupsOf(detail).flatMap((group) =>
    group.attachments.filter(isVideoAttachment).map((attachment) => ({ attachment, attempt: group.attempt, scope: effectiveScope(attachment.scope, group.scope, detail.check.scope, detail.inheritedScope) }))
  );
}

/** What a track is called in a note: its description, else its file name. */
export function trackLabel(track: TrackRef): string {
  return track.attachment.description ?? track.attachment.name;
}

/** Whether a stored or inline track can be read here: its bytes are in the layer or inline, and its producer did not leave them out. */
export function trackReadable(track: TrackRef): { readable: true } | { readable: false; state: 'failed' | 'unsupported'; reason: string } {
  const attachment = track.attachment;
  if (track.declared) return { readable: false, ...track.declared };
  if (attachment.omitted) return { readable: false, state: 'failed', reason: `The producer left this file out (${attachment.omitted}), so its words are not searched.` };
  if (attachment.text === undefined && !attachment.bundleKey)
    return { readable: false, state: 'unsupported', reason: attachment.uri ? 'The text is kept at an address outside the report, which Atlas does not fetch for search.' : 'The attachment names no text.' };
  return { readable: true };
}

type Format = 'vtt' | 'srt' | 'json' | 'plain';

function formatOf(attachment: Attachment): Format | null {
  const media = type(attachment);
  if (media === 'text/vtt') return 'vtt';
  if (media === 'application/x-subrip' || media === 'text/srt') return 'srt';
  if (media.includes('json')) return 'json';
  if (media === 'text/plain') return 'plain';
  if (media === 'application/octet-stream' || media === '') {
    const extension = /\.([a-z0-9]+)$/i.exec(attachment.name)?.[1]?.toLowerCase();
    if (extension === 'vtt') return 'vtt';
    if (extension === 'srt') return 'srt';
    if (extension === 'json') return 'json';
    if (extension === 'txt') return 'plain';
  }
  return null;
}

/** `00:01:02.500`, `01:02.500` or `00:00:01,5`, in milliseconds; null for anything else. */
export function parseTimestamp(value: string): number | null {
  const match = /^(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/.exec(value.trim());
  if (!match) return null;
  const [hours, minutes, seconds] = [Number(match[1] ?? 0), Number(match[2]), Number(match[3])];
  if (minutes > 59 || seconds > 59) return null;
  const millis = match[4] ? Number(match[4].padEnd(3, '0')) : 0;
  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + millis;
}

function range(start: number | null, end: number | null): { startMs: number | null; endMs: number | null } {
  if (start === null || end === null || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) return { startMs: null, endMs: null };
  return { startMs: Math.round(start), endMs: Math.round(end) };
}

const TAGS = /<[^>]*>/g;

function cues(raw: string): { segments: TextSegment[]; timed: boolean } {
  const segments: TextSegment[] = [];
  let timed = false;
  for (const block of raw.replace(/\r\n?/g, '\n').split(/\n{2,}/)) {
    const lines = block.split('\n');
    const at = lines.findIndex((line) => line.includes('-->'));
    if (at < 0) continue;
    if (/^(NOTE|STYLE|REGION)\b/.test(lines[0]!.trim())) continue;
    timed = true;
    const [from = '', to = ''] = lines[at]!.split('-->');
    const text = lines
      .slice(at + 1)
      .join(' ')
      .replace(TAGS, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!text) continue;
    // Cue settings follow the end time (`align:start`).
    segments.push({ text, ...range(parseTimestamp(from), parseTimestamp(to.trim().split(/\s+/)[0] ?? '')) });
  }
  return { segments, timed };
}

function seconds(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value * 1000 : null;
}

function milliseconds(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function jsonSegments(raw: string): { segments: TextSegment[]; timed: boolean } {
  const parsed: unknown = JSON.parse(raw);
  const record = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  const list = Array.isArray(parsed) ? parsed : (record.segments ?? record.cues ?? record.results ?? record.lines);
  if (!Array.isArray(list)) throw new Error('The JSON holds no list of segments (`segments`, `cues`, `results` or `lines`).');
  const segments: TextSegment[] = [];
  let timed = false;
  for (const item of list) {
    if (item === null || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    const text = typeof entry.text === 'string' ? entry.text.replace(/\s+/g, ' ').trim() : '';
    if (!text) continue;
    const hasTime = ['startMs', 'endMs', 'start', 'end'].some((key) => entry[key] !== undefined);
    if (hasTime) timed = true;
    const start = entry.startMs !== undefined ? milliseconds(entry.startMs) : seconds(entry.start);
    const end = entry.endMs !== undefined ? milliseconds(entry.endMs) : seconds(entry.end);
    const confidence = typeof entry.confidence === 'number' && entry.confidence >= 0 && entry.confidence <= 1 ? entry.confidence : undefined;
    segments.push({ text, ...range(start, end), ...(confidence === undefined ? {} : { confidence }) });
  }
  return { segments, timed };
}

/**
 * Indexes the text of a track. A format Atlas does not read is `unsupported`; text that does not parse is `failed`;
 * otherwise its segments are indexed, with `timing` saying whether their times can be used to seek. Words are
 * kept even when the times are not, so they can still be found; they just cannot be jumped to.
 */
export function indexTrack(track: TrackRef, raw: string): TrackResult {
  const format = formatOf(track.attachment);
  if (!format) return { track, state: 'unsupported', reason: `The text is in a form Atlas does not read (${type(track.attachment)}). WebVTT, SubRip, JSON segments and plain text are read.`, segments: [], timing: 'absent', truncated: false };
  const truncated = raw.length > MAX_TRACK_CHARS;
  const text = truncated ? raw.slice(0, MAX_TRACK_CHARS) : raw;
  let found: { segments: TextSegment[]; timed: boolean };
  try {
    if (format === 'json') found = jsonSegments(text);
    else if (format === 'plain') found = { segments: text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => ({ text: line, startMs: null, endMs: null })), timed: false };
    else found = cues(text);
  } catch (error) {
    return { track, state: 'failed', reason: `The text could not be read: ${error instanceof Error ? error.message : 'it is not valid'}.`, segments: [], timing: 'absent', truncated };
  }
  const segments = found.segments.slice(0, MAX_SEGMENTS);
  if (segments.length === 0) return { track, state: 'failed', reason: 'The file holds no text segments.', segments: [], timing: 'absent', truncated };
  const usable = segments.filter((segment) => segment.startMs !== null).length;
  const timing: TimingState = !found.timed ? 'absent' : usable === segments.length ? 'valid' : usable === 0 ? 'invalid' : 'partial';
  return { track, state: 'indexed', segments, timing, truncated: truncated || found.segments.length > MAX_SEGMENTS };
}

/** The result of a track that could not be read at all (the report refused it, or it was not found). */
export function unreadTrack(track: TrackRef, reason: string): TrackResult {
  return { track, state: 'failed', reason, segments: [], timing: 'absent', truncated: false };
}

/** The sentence that says why a video has no searched text, per state. */
const COVERAGE_REASON: Record<Exclude<CoverageState, 'searched'>, string> = {
  'not-indexed': 'No transcript, captions or screen text were supplied for this recording, so nothing in it can be searched.',
  unsupported: 'This recording cannot be searched by words.',
  failed: 'Text was supplied for this recording and could not be read.'
};

/**
 * What searching inside each video of a result amounts to. A video with at least one readable track is `searched`: if no
 * words match, that is a real "no match". Otherwise it says which of three different things is true, never one blank
 * "nothing found": no text was supplied (`not-indexed`); the recording is silent and no screen text was supplied, or the
 * text is in a form that is not read (`unsupported`); or the text could not be read (`failed`).
 */
export function coverageOf(detail: CheckDetail, results: readonly TrackResult[]): VideoCoverage[] {
  return videosOf(detail).map(({ attachment, attempt, scope }) => {
    const recording = attachmentIdentity(attachment) ?? null;
    const mine = results.filter((result) => result.track.recording === recording && recording !== null && (result.track.attempt === attempt || result.track.attempt === null || attempt === null));
    const base = { name: attachment.description ?? attachment.name, recording, attempt, tracks: mine };
    if (mine.some((result) => result.state === 'indexed')) return { ...base, state: 'searched', reason: '' };
    const failed = mine.find((result) => result.state === 'failed');
    if (failed) return { ...base, state: 'failed', reason: failed.reason ?? COVERAGE_REASON.failed };
    const unsupported = mine.find((result) => result.state === 'unsupported');
    if (unsupported) return { ...base, state: 'unsupported', reason: unsupported.reason ?? COVERAGE_REASON.unsupported };
    if (scope?.audioCaptured === false) return { ...base, state: 'unsupported', reason: 'This recording is silent (no audio was captured) and no screen text was supplied, so there are no spoken words to search.' };
    return { ...base, state: 'not-indexed', reason: COVERAGE_REASON['not-indexed'] };
  });
}

/** One indexed segment with whom it belongs to, ready to be matched and opened. */
export type IndexedSegment = {
  /** The id of its search document. */
  readonly id: string;
  readonly entry: PlaylistEntry;
  readonly segment: TextSegment;
  readonly kind: TextKind;
  readonly generated: boolean;
  readonly generator?: string;
  readonly trackName: string;
  readonly timing: TimingState;
  readonly recording: string | null;
  /** The retry attempt whose evidence holds it; null when the check does. */
  readonly attempt: number | null;
  /** In words: "Attempt 2 of 3 (failed)", or an empty string when the result was not retried. */
  readonly attemptLabel: string;
  readonly videoName: string | null;
};

/** The moment of a recording a search result opens at: the playlist selects this exact attempt's video and seeks only when the time is usable. */
export type RecordingFocus = {
  /** The playlist entry (result) it belongs to. */
  readonly entryId: string;
  /** The identity of the video to select; null when the track names none, so the result's own recording is shown. */
  readonly recording: string | null;
  readonly startMs: number | null;
  readonly endMs: number | null;
  readonly timing: TimingState;
  readonly kind: TextKind;
  /** The indexed words, shown beside the video exactly as indexed. */
  readonly text: string;
  readonly generated: boolean;
  readonly attemptLabel: string;
};

/** The focus a result opens at. */
export function focusOf(item: IndexedSegment): RecordingFocus {
  return {
    entryId: item.entry.id,
    recording: item.recording,
    startMs: item.segment.startMs,
    endMs: item.segment.endMs,
    timing: item.timing,
    kind: item.kind,
    text: item.segment.text,
    generated: item.generated,
    attemptLabel: item.attemptLabel
  };
}

/** The words for a retry attempt: which one of how many, and how it ended. */
export function attemptLabel(detail: CheckDetail, attempt: number | null): string {
  const attempts = detail.check.attempts ?? [];
  if (attempt === null || attempts.length === 0) return '';
  const found = attempts.find((item) => item.index === attempt);
  return `Attempt ${attempt + 1} of ${attempts.length}${found ? ` (${found.status})` : ''}`;
}

/** Every segment of a result's indexed tracks. */
export function segmentsOf(entry: PlaylistEntry, detail: CheckDetail, results: readonly TrackResult[], videos: readonly VideoCoverage[]): IndexedSegment[] {
  const out: IndexedSegment[] = [];
  results.forEach((result, trackIndex) => {
    if (result.state !== 'indexed') return;
    const video = videos.find((item) => item.recording !== null && item.recording === result.track.recording && (item.attempt === result.track.attempt || result.track.attempt === null || item.attempt === null));
    result.segments.forEach((segment, index) => {
      out.push({
        id: `words:${entry.id}:${trackIndex}:${index}`,
        entry,
        segment,
        kind: result.track.kind,
        generated: result.track.generated,
        ...(result.track.generator ? { generator: result.track.generator } : {}),
        trackName: trackLabel(result.track),
        timing: segment.startMs === null ? (result.timing === 'absent' ? 'absent' : 'invalid') : result.timing,
        recording: result.track.recording,
        attempt: result.track.attempt ?? video?.attempt ?? null,
        attemptLabel: attemptLabel(detail, result.track.attempt ?? video?.attempt ?? null),
        videoName: video?.name ?? null
      });
    });
  });
  return out;
}

/**
 * The searchable document of a segment, for the shared matcher. Only the indexed words are matched, so a result can
 * never show more than the track said; the filters (`status:failed`, `env:`, `producer:`, `tag:`, `spec:`) read the
 * result the words belong to.
 */
export function segmentDoc(item: IndexedSegment): FindDoc {
  const { entry } = item;
  return {
    id: item.id,
    group: 'Runs',
    kind: 'run',
    title: item.segment.text,
    subtitle: entry.title,
    fields: [{ name: 'title', text: item.segment.text }],
    status: entry.status === 'passed' ? 'passed' : entry.status === 'failed' ? 'failed' : 'none',
    related: [],
    target: { to: '/', search: { test: entry.key } },
    recording: null,
    facets: {
      status: [entry.status],
      env: entry.environment ? [entry.environment] : ['(none)'],
      producer: [entry.producer],
      domain: [],
      spec: entry.specPath ? [entry.specPath] : [],
      tag: [...entry.tags],
      branch: [],
      video: true
    }
  };
}

/** `m:ss`, or `h:mm:ss` from an hour on. */
export function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const [h, m, s] = [Math.floor(total / 3600), Math.floor((total % 3600) / 60), total % 60];
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

/** The time range of a segment in words, or why it has none. */
export function rangeWord(item: Pick<IndexedSegment, 'segment' | 'timing'>): string {
  const { startMs, endMs } = item.segment;
  if (startMs === null || endMs === null) return item.timing === 'absent' ? 'No time given' : 'Time unusable';
  return startMs === endMs ? clock(startMs) : `${clock(startMs)}–${clock(endMs)}`;
}

/** What says that generated text may be wrong, and how sure its producer was. */
export function uncertaintyWord(item: Pick<IndexedSegment, 'generated' | 'generator' | 'segment'>): string {
  const confidence = item.segment.confidence;
  const by = item.generator ? `Generated by ${item.generator}` : 'Generated text';
  return `${by}${confidence === undefined ? '' : `, confidence ${Math.round(confidence * 100)}%`}. It may contain errors.`;
}

/** Counts of videos by coverage state. */
export function coverageCounts(videos: readonly VideoCoverage[]): Record<CoverageState, number> {
  const counts: Record<CoverageState, number> = { searched: 0, 'not-indexed': 0, unsupported: 0, failed: 0 };
  for (const video of videos) counts[video.state] += 1;
  return counts;
}
