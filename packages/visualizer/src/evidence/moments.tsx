/**
 * @module Recording moments
 *
 * Connects a check's steps to its recordings. Inside a {@link MomentPlayback}, a step offers to show itself in the
 * selected recording (its place comes from the recording's own timing, `media-timing.ts`, never from an assumption that
 * the check and the recording started together), playback marks the step that is playing without moving focus, the
 * failing step can be jumped to, and the current moment can be copied as a link that names the run, the recording and
 * the position. A step that cannot be placed says why and nothing is guessed. One provider serves one holder (a check
 * or one of its retries): a retry's steps are placed in that retry's own recording with that recording's own timing.
 */
import { attachmentIdentity, isVideoAttachment, type EvidenceHolder } from '@crvouga/atlas/reports/evidence-detail';
import { effectiveScope } from '@crvouga/atlas/reports/evidence-scope';
import type { Attachment, Step } from '@crvouga/atlas/schema';
import { Alert, Button, Group, NativeSelect, Stack, Text, TextInput } from '@mantine/core';
import { IconAlertTriangle, IconLink, IconPlayerPlay } from '@tabler/icons-react';
import { useRouter } from '@tanstack/react-router';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type SyntheticEvent } from 'react';

import { useScope } from './evidence-scope';
import { duration } from './format';
import { activeIndex, alignStep, clock, mediaTimingOf, pausedMs, type Alignment, type MediaTiming } from './media-timing';
import { failedStepOf } from './outcome';

/** One recording whose clock the steps can be placed on. */
export type MomentVideo = { readonly id: string; readonly attachment: Attachment; readonly timing: MediaTiming | undefined };

/** One step and where it is in the selected recording. */
export type Moment = { readonly index: number; readonly step: Step; readonly alignment: Alignment };

/** What asking for a moment came to. */
export type MomentOutcome = { readonly seeked: boolean; readonly text: string };

type Notice = { readonly text: string };

type Playback = {
  readonly videos: readonly MomentVideo[];
  readonly selected: MomentVideo | null;
  readonly select: (id: string) => void;
  readonly momentOf: (step: Step) => Moment | undefined;
  /** The index (in the holder's steps) of the step that is playing. */
  readonly active: number | null;
  readonly notice: Notice | null;
  readonly seek: (index: number) => MomentOutcome;
  readonly seekFailure: () => MomentOutcome;
  readonly failed: Step | undefined;
  /** How many steps the holder recorded. */
  readonly stepCount: number;
  readonly currentMs: () => number | undefined;
  readonly linkTo: (atMs: number) => string | null;
  register: (id: string, element: HTMLVideoElement | null) => void;
  loaded: (id: string, element: HTMLVideoElement) => void;
  progress: (id: string, element: HTMLVideoElement) => void;
};

const Around = createContext<Playback | null>(null);

/** The playback of the holder around this point, null outside one. */
export function usePlayback(): Playback | null {
  return useContext(Around);
}

/** The window event by which a part of the page asks the check's player for a moment (see {@link requestFailureMoment}). */
const REQUEST = 'atlas:moment-request';
type Request = { kind: 'failure'; owner: string; handled?: MomentOutcome };

/** Names the one result of a check, so a request reaches the player of that result and not another open beside it. */
export function momentOwner(layer: string, kind: string, check: string): string {
  return `${layer}|${kind}|${check}`;
}

/**
 * Asks the player of the result named by `owner` (see {@link momentOwner}) to jump to the step where it failed. Returns
 * what came of it, or null when no player of that result is on screen (nothing is read or played on its behalf).
 */
export function requestFailureMoment(owner: string): MomentOutcome | null {
  const detail: Request = { kind: 'failure', owner };
  window.dispatchEvent(new CustomEvent(REQUEST, { detail }));
  return detail.handled ?? null;
}

/** The moment an address names: the recording (an `attachmentIdentity`), a position in it, and the run's layer. */
export type RequestedMoment = { readonly clip: string | undefined; readonly atMs: number | undefined; readonly layer: string | undefined };

type RouterLike = {
  state: { location: { pathname: string; search: unknown } };
  buildLocation: (options: { to: string; search: unknown }) => { href: string };
  history: { createHref: (href: string) => string };
};

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : typeof value === 'number' ? String(value) : undefined;
}

/** The moment the address names, read when it is called; all undefined when the address names none or there is no router. */
export function useRequestedMoment(): RequestedMoment {
  const router = useRouter({ warn: false }) as unknown as RouterLike | undefined;
  const search = (router?.state.location.search ?? {}) as Record<string, unknown>;
  const at = Number(search.clipAt);
  return { clip: text(search.clip), atMs: search.clipAt !== undefined && Number.isFinite(at) && at >= 0 ? at : undefined, layer: text(search.layer) };
}

/** The recordings among `attachments` that name bytes, each once, with the timing they declare. */
function momentVideos(attachments: readonly Attachment[]): MomentVideo[] {
  const seen = new Set<string>();
  return attachments.flatMap((attachment) => {
    const id = isVideoAttachment(attachment) ? attachmentIdentity(attachment) : undefined;
    if (id === undefined || seen.has(id)) return [];
    seen.add(id);
    return [{ id, attachment, timing: mediaTimingOf(attachment) }];
  });
}

const NONE: readonly Step[] = [];

/**
 * The steps that belong to the recording with this identity in a check's evidence: those of the check when it (or one of
 * its steps) carries the recording, else those of the retry that does. A retry's recording is never read with another
 * try's steps.
 */
export function stepsOfRecording(check: EvidenceHolder, identity: string | undefined): readonly Step[] {
  const carries = (attachments: readonly Attachment[] | undefined, steps: readonly Step[] | undefined) =>
    identity !== undefined &&
    [...(attachments ?? []), ...(steps ?? []).flatMap((step) => step.attachments ?? [])].some((item) => attachmentIdentity(item) === identity);
  if (carries(check.attachments, check.steps)) return check.steps ?? NONE;
  const attempt = (check.attempts ?? []).find((each) => carries(each.attachments, each.steps));
  return (attempt ? attempt.steps : check.steps) ?? NONE;
}

/**
 * Places the steps of one holder in its recordings. `attachments` are the holder's own files (the videos among them are
 * the recordings); `steps` are its timeline. `primary` marks the check itself, which answers
 * {@link requestFailureMoment}. `linkSearch` is merged into the current address to make a link to a moment (by default
 * the exact `layer`). When the address names one of the recordings (`clip`, `clipAt`), that recording is selected and the
 * player goes to the position once it can.
 */
export function MomentPlayback({
  steps = NONE,
  attachments,
  layer,
  primary = false,
  owner,
  linkSearch,
  children
}: {
  steps?: readonly Step[];
  attachments: readonly Attachment[];
  layer: string;
  primary?: boolean;
  owner?: string;
  linkSearch?: Record<string, unknown>;
  children: ReactNode;
}) {
  const router = useRouter({ warn: false }) as unknown as RouterLike | undefined;
  const requested = useRequestedMoment();
  const videos = useMemo(() => momentVideos(attachments), [attachments]);
  const [chosen, setChosen] = useState<string | null>(() =>
    requested.clip !== undefined && videos.some((video) => video.id === requested.clip)
      ? requested.clip
      : ((videos.find((video) => video.timing && !video.timing.problem) ?? videos[0])?.id ?? null)
  );
  const selected = videos.find((video) => video.id === chosen) ?? videos[0] ?? null;
  const elements = useRef(new Map<string, HTMLVideoElement>());
  const pending = useRef<{ id: string; atMs: number } | null>(
    requested.clip !== undefined && requested.atMs !== undefined && videos.some((video) => video.id === requested.clip)
      ? { id: requested.clip, atMs: requested.atMs }
      : null
  );
  const [lengths, setLengths] = useState<Readonly<Record<string, number>>>({});
  const [active, setActive] = useState<number | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const lengthMs = selected ? (lengths[selected.id] ?? selected.attachment.durationMs) : undefined;
  const moments = useMemo<Moment[]>(
    () => steps.map((step, index) => ({ index, step, alignment: alignStep(step, selected?.timing, lengthMs) })),
    [steps, selected, lengthMs]
  );
  const byStep = useMemo(() => new Map(moments.map((moment) => [moment.step, moment])), [moments]);
  const placed = useMemo(
    () => moments.flatMap((moment) => (moment.alignment.state === 'aligned' ? [[moment.index, moment.alignment.mediaMs] as const] : [])),
    [moments]
  );

  const goTo = useCallback(
    (element: HTMLVideoElement | undefined, atMs: number): MomentOutcome => {
      if (!element) return { seeked: false, text: 'The recording is not loaded, so it cannot be moved.' };
      const length = Number.isFinite(element.duration) && element.duration > 0 ? element.duration * 1000 : undefined;
      if (length !== undefined && atMs > length + 1) {
        const text = `${clock(atMs)} is after the end of the recording, which is ${clock(length)} long. Nothing was moved.`;
        setNotice({ text });
        return { seeked: false, text };
      }
      element.currentTime = atMs / 1000;
      setActive(activeIndex(placed, atMs));
      setNotice(null);
      // The page scrolls to the player; focus stays where it is.
      element.scrollIntoView?.({ block: 'nearest' });
      return { seeked: true, text: `Moved the recording to ${clock(atMs)}.` };
    },
    [placed]
  );

  const seek = useCallback(
    (index: number): MomentOutcome => {
      const moment = moments[index];
      if (!moment || !selected) return { seeked: false, text: 'This result has no recording to place the step in.' };
      if (moment.alignment.state === 'unavailable') {
        const text = `“${moment.step.name}” cannot be shown in the recording. ${moment.alignment.reason}`;
        setNotice({ text });
        return { seeked: false, text };
      }
      return goTo(elements.current.get(selected.id), moment.alignment.mediaMs);
    },
    [moments, selected, goTo]
  );

  const failed = useMemo(() => failedStepOf(steps), [steps]);
  const seekFailure = useCallback((): MomentOutcome => {
    if (!failed) return { seeked: false, text: 'No failed step was recorded, so there is no failing moment to show.' };
    return seek(steps.indexOf(failed));
  }, [failed, steps, seek]);

  useEffect(() => {
    if (!primary || owner === undefined) return;
    const answer = (event: Event) => {
      const request = (event as CustomEvent<Request>).detail;
      if (request?.kind === 'failure' && request.owner === owner && request.handled === undefined) request.handled = seekFailure();
    };
    window.addEventListener(REQUEST, answer);
    return () => window.removeEventListener(REQUEST, answer);
  }, [primary, owner, seekFailure]);

  const progress = useCallback(
    (id: string, element: HTMLVideoElement) => {
      if (id === selected?.id) setActive(activeIndex(placed, element.currentTime * 1000));
    },
    [selected, placed]
  );
  const register = useCallback((id: string, element: HTMLVideoElement | null) => {
    if (element) elements.current.set(id, element);
    else elements.current.delete(id);
  }, []);
  const loaded = useCallback(
    (id: string, element: HTMLVideoElement) => {
      if (Number.isFinite(element.duration) && element.duration > 0) setLengths((held) => ({ ...held, [id]: element.duration * 1000 }));
      const wanted = pending.current;
      if (wanted && wanted.id === id) {
        pending.current = null;
        goTo(element, wanted.atMs);
      }
    },
    [goTo]
  );

  const linkTo = useCallback(
    (atMs: number): string | null => {
      if (!router || !selected) return null;
      try {
        const built = router.buildLocation({
          to: router.state.location.pathname,
          search: (prev: Record<string, unknown>) => ({ ...prev, ...(linkSearch ?? { layer }), clip: selected.id, clipAt: Math.round(atMs) })
        });
        return new URL(router.history.createHref(built.href), window.location.href).href;
      } catch {
        return null;
      }
    },
    [router, selected, linkSearch, layer]
  );

  const value = useMemo<Playback>(
    () => ({
      videos,
      selected,
      select: (id) => {
        setChosen(id);
        setActive(null);
        setNotice(null);
      },
      momentOf: (step) => byStep.get(step),
      active,
      notice,
      seek,
      seekFailure,
      failed,
      stepCount: steps.length,
      currentMs: () => {
        const element = selected ? elements.current.get(selected.id) : undefined;
        return element ? element.currentTime * 1000 : undefined;
      },
      linkTo,
      register,
      loaded,
      progress
    }),
    [videos, selected, byStep, active, notice, seek, seekFailure, failed, steps, linkTo, register, loaded, progress]
  );
  return <Around.Provider value={value}>{children}</Around.Provider>;
}

/** The props that join a `<video>` of `attachment` to the playback around it; undefined when it is not one of its recordings. */
export function useMomentVideo(attachment: Attachment):
  | {
      ref: (element: HTMLVideoElement | null) => void;
      onLoadedMetadata: (event: SyntheticEvent<HTMLVideoElement>) => void;
      onTimeUpdate: (event: SyntheticEvent<HTMLVideoElement>) => void;
      onSeeked: (event: SyntheticEvent<HTMLVideoElement>) => void;
    }
  | undefined {
  const playback = usePlayback();
  const id = isVideoAttachment(attachment) ? attachmentIdentity(attachment) : undefined;
  const member = playback !== null && id !== undefined && playback.videos.some((video) => video.id === id);
  const register = playback?.register;
  const ref = useCallback(
    (element: HTMLVideoElement | null) => {
      if (id !== undefined) register?.(id, element);
    },
    [register, id]
  );
  if (!playback || !member || id === undefined) return undefined;
  return {
    ref,
    onLoadedMetadata: (event) => playback.loaded(id, event.currentTarget),
    onTimeUpdate: (event) => playback.progress(id, event.currentTarget),
    onSeeked: (event) => playback.progress(id, event.currentTarget)
  };
}

const label = (attachment: Attachment) => attachment.description ?? attachment.name;

/**
 * A step's control in a timeline: shows the step in the selected recording at its recorded moment, or says that it
 * cannot be placed. Renders nothing outside a playback with a recording.
 */
export function SeekStep({ step }: { step: Step }) {
  const playback = usePlayback();
  const moment = playback?.momentOf(step);
  if (!playback || !moment || !playback.selected) return null;
  const aligned = moment.alignment.state === 'aligned';
  const at = moment.alignment.state === 'aligned' ? clock(moment.alignment.mediaMs) : '';
  return (
    <Button
      type="button"
      size="compact-xs"
      variant="subtle"
      data-seek={aligned ? 'aligned' : 'unavailable'}
      leftSection={<IconPlayerPlay size={14} aria-hidden="true" />}
      aria-label={aligned ? `Show “${step.name}” in the recording at ${at}` : `Show “${step.name}” in the recording (alignment unavailable)`}
      onClick={() => playback.seek(moment.index)}
    >
      {aligned ? `Recording ${at}` : 'Not aligned'}
    </Button>
  );
}

/** Whether the step is the one playing, so its row can say so. */
export function useIsPlaying(step: Step): boolean {
  const playback = usePlayback();
  const moment = playback?.momentOf(step);
  return moment !== undefined && playback?.active === moment.index;
}

/**
 * What the playback says above a timeline: which recording the steps are placed in and how, the pacing of a paced
 * recording (never application latency), the jump to the failing moment, the link to the current moment, and why a
 * step could not be shown. Renders nothing outside a playback with a recording.
 */
export function MomentBar() {
  const playback = usePlayback();
  const scope = useScope();
  const [copied, setCopied] = useState<'copied' | string | null>(null);
  const [jump, setJump] = useState<string | null>(null);
  if (!playback || !playback.selected) return null;
  const { selected, videos, notice, failed } = playback;
  const scoped = effectiveScope(selected.attachment.scope, scope);
  const timing = selected.timing;
  const paused = pausedMs(timing);
  const reasons = [...new Set((timing?.pauses ?? []).flatMap((pause) => (pause.reason ? [pause.reason] : [])))];
  const paced = scoped?.pacing === 'paced' || (timing?.pauses.length ?? 0) > 0;
  const copy = async () => {
    const at = playback.currentMs() ?? 0;
    const link = playback.linkTo(at);
    if (!link) {
      setCopied('A link to this moment could not be made from here.');
      return;
    }
    try {
      await navigator.clipboard.writeText(link);
      setCopied('copied');
    } catch {
      setCopied(link);
    }
  };
  return (
    <Stack gap="xs" component="section" aria-label="Recording moments" data-moments>
      {videos.length > 1 && (
        <NativeSelect
          label="Recording the steps are shown in"
          value={selected.id}
          onChange={(event) => playback.select(event.currentTarget.value)}
          data={videos.map((video) => ({ value: video.id, label: label(video.attachment) }))}
        />
      )}
      {playback.stepCount > 0 && (
        <Text component="div" c="dimmed" data-alignment={timing && !timing.problem ? 'recorded' : 'unavailable'}>
          {timing && !timing.problem
            ? timing.checkStartMs !== undefined
              ? `Steps are placed in ${label(selected.attachment)} from its recorded timing: the check starts ${clock(timing.checkStartMs)} into the recording.`
              : `Steps are placed in ${label(selected.attachment)} only where its producer recorded the moment.`
            : `Steps cannot be placed in ${label(selected.attachment)}: ${timing?.problem ?? 'it carries no timing metadata.'} Atlas does not guess where a step is.`}
        </Text>
      )}
      {paced && playback.stepCount > 0 && (
        <Text component="div" c="dimmed" data-pacing>
          Paced recording
          {timing && timing.pauses.length > 0
            ? `: ${timing.pauses.length === 1 ? 'a pause' : `${timing.pauses.length} pauses`} totalling ${duration(paused)} ${timing.pauses.length === 1 ? 'was' : 'were'} put into the recording${reasons.length ? ` (${reasons.join(', ')})` : ''}. `
            : ': it was slowed for a viewer. '}
          The time between steps includes deliberate pauses; it is pacing, not application latency.
        </Text>
      )}
      <Group gap="xs" wrap="wrap">
        {failed && (
          <Button
            type="button"
            variant="light"
            color="red"
            leftSection={<IconAlertTriangle size={16} aria-hidden="true" />}
            onClick={() => setJump(playback.seekFailure().text)}
          >
            Jump to the failing moment
          </Button>
        )}
        <Button type="button" variant="default" leftSection={<IconLink size={16} aria-hidden="true" />} onClick={() => void copy()}>
          Copy link to this moment
        </Button>
      </Group>
      {copied === 'copied' && (
        <Text component="div" role="status" c="dimmed">
          Link copied. It names this run, this recording and this position, and opens that run even when a newer one exists.
        </Text>
      )}
      {copied !== null && copied !== 'copied' && (
        <TextInput label="Link to this moment" description="Copy it from here." readOnly value={copied} onFocus={(event) => event.currentTarget.select()} />
      )}
      {jump && !notice && (
        <Text component="div" role="status" c="dimmed">
          {jump}
        </Text>
      )}
      {notice && (
        <Alert color="orange" role="status" data-moment-notice>
          {notice.text}
        </Alert>
      )}
    </Stack>
  );
}
