import { testFrames } from '@crvouga/atlas/reports/frames';
import type { RunReport } from '@crvouga/atlas/reports/report-types';

import type { AtlasView, ImageMedia, StateView, TransitionView } from '../data/model';

/**
 * What a run captured of the product, in the three shapes any runner can fill.
 * A still, a video, and a timeline of moments are peers: a runner may record one of them or all three.
 */
export type PictureLook = {
  readonly id: string;
  readonly label: string;
  readonly alt: string;
  readonly src: string;
  readonly thumb: string | null;
};

export type FilmChapter = { readonly atMs: number; readonly label: string };

export type FilmLook = {
  readonly id: string;
  readonly label: string;
  readonly src: string;
  readonly poster: string | null;
  readonly captions: string | null;
  readonly durationMs: number | null;
  readonly chapters: readonly FilmChapter[];
};

export type MomentLook = {
  readonly id: string;
  readonly label: string;
  readonly caption: string | null;
  readonly status: 'passed' | 'failed' | null;
  readonly thumb: string | null;
  /** A point in the still, in the still's own pixels, such as where someone tapped. */
  readonly point?: { readonly x: number; readonly y: number } | null;
  readonly pauseMs: number | null;
};

export type Looks = {
  readonly pictures: readonly PictureLook[];
  readonly films: readonly FilmLook[];
  readonly moments: readonly MomentLook[];
};

export const EMPTY_LOOKS: Looks = { pictures: [], films: [], moments: [] };

function ready(image: ImageMedia | null | undefined): image is ImageMedia {
  return Boolean(image && image.state === 'available' && (image.full || image.thumb));
}

/** Every still in one capture: the client's own screen, then the other clients at that moment. */
export function picturesOf(image: ImageMedia | null | undefined, id: string, label: string, alt: string): PictureLook[] {
  if (!ready(image)) return [];
  const src = image.full ?? image.thumb!;
  const shots: PictureLook[] = [
    {
      id,
      label: image.client ? `${label} · ${image.client}` : label,
      alt: image.client ? `${alt}, ${image.client}` : alt,
      src,
      thumb: image.thumb
    }
  ];
  image.also.forEach((extra, index) => {
    const extraSrc = extra.full ?? extra.thumb;
    if (!extraSrc) return;
    const who = extra.client ?? `Screen ${index + 2}`;
    shots.push({ id: `${id}:${who}`, label: `${label} · ${who}`, alt: `${alt}, ${who}`, src: extraSrc, thumb: extra.thumb });
  });
  return shots;
}

const MOMENT_KIND: Record<string, string> = {
  tap: 'Tap',
  type: 'Typing',
  system: 'System',
  screen: 'Screen',
  toast: 'Toast',
  note: 'Note',
  time: 'Time',
  notification: 'Notification'
};

/** The full still of a state. Tap points are recorded in that still's pixels, so the timeline uses it rather than a smaller preview. */
function stillOf(state: StateView | undefined): string | null {
  if (!state) return null;
  const shot = picturesOf(state.result?.screenshot, state.key, state.name, state.name)[0];
  return shot?.src ?? shot?.thumb ?? null;
}

function unique(shots: readonly PictureLook[]): PictureLook[] {
  const seen = new Set<string>();
  return shots.filter((shot) => {
    if (seen.has(shot.src)) return false;
    seen.add(shot.src);
    return true;
  });
}

/** Stills of one state: the screen, each client, and each path that captured it differently. */
export function stateLooks(state: StateView): Looks {
  const pictures = unique([
    ...picturesOf(state.result?.screenshot, state.key, state.name, `Screenshot of ${state.name}`),
    ...(state.result?.screenshotsByPath ?? []).flatMap((extra) =>
      picturesOf(extra.image, `${state.key}:${extra.path.id}`, extra.path.name, `Screenshot of ${state.name} along ${extra.path.name}`)
    )
  ]);
  return { pictures, films: [], moments: [] };
}

/** A transition's video, the screens on either side, and the timeline of what the run did. */
export function eventLooks(view: AtlasView, transition: TransitionView): Looks {
  const from = view.states.get(transition.source);
  const to = transition.target ? view.states.get(transition.target) : undefined;
  const side = (state: StateView | undefined, which: 'Before' | 'After') =>
    state ? stateLooks(state).pictures.map((shot) => ({ ...shot, id: `${which.toLowerCase()}:${shot.id}`, label: `${which} · ${shot.label}`, alt: `${which}: ${shot.alt}` })) : [];
  const pictures = unique([...side(from, 'Before'), ...side(to, 'After')]);
  const entries = transition.result?.timeline ?? [];
  const chapters = entries.map((entry) => ({ atMs: entry.atMs, label: entry.label }));
  const clip = transition.result?.clip;
  const films: FilmLook[] =
    clip?.state === 'available' && clip.src
      ? [{ id: transition.id, label: transition.event, src: clip.src, poster: clip.poster, captions: clip.captions, durationMs: clip.durationMs, chapters }]
      : [];
  let shown = stillOf(from);
  const moments: MomentLook[] = entries.map((entry, index) => {
    if (entry.kind === 'screen') shown = stillOf(to) ?? shown;
    const kind = MOMENT_KIND[entry.kind] ?? entry.kind;
    return {
      id: `${transition.id}:${index}`,
      label: entry.label,
      caption: entry.client ? `${kind} · ${entry.client}` : kind,
      status: null,
      thumb: shown,
      point: entry.x !== undefined && entry.y !== undefined ? { x: entry.x, y: entry.y } : null,
      pauseMs: null
    };
  });
  return { pictures, films, moments };
}

/** The journey as a sequence of landing screens, plus a video for each step that recorded one. */
export function journeyLooks(view: AtlasView, journeyId: string): Looks {
  const journey = view.journeys.find((item) => item.id === journeyId);
  if (!journey) return EMPTY_LOOKS;
  const pictures: PictureLook[] = [];
  const films: FilmLook[] = [];
  const moments: MomentLook[] = [];
  const seen = new Set<string>();
  journey.steps.forEach((step, index) => {
    const transition = view.transitions.get(step.transitionIds[0] ?? '');
    if (!transition) return;
    const landing = transition.target ? view.states.get(transition.target) : undefined;
    const origin = view.states.get(transition.source);
    const landingShot = landing ? picturesOf(landing.result?.screenshot, landing.key, landing.name, `Screenshot of ${landing.name}`)[0] : undefined;
    const originShot = origin ? picturesOf(origin.result?.screenshot, origin.key, origin.name, `Screenshot of ${origin.name}`)[0] : undefined;
    // The screen they arrived on. When that screen was not captured, the screen they left is still what the step looked like.
    const shot = landingShot ?? originShot;
    if (shot && !seen.has(shot.src)) {
      seen.add(shot.src);
      pictures.push(shot);
    }
    const film = eventLooks(view, transition).films[0];
    if (film) films.push({ ...film, id: `${transition.id}:film`, label: transition.event });
    moments.push({
      id: `${journeyId}:${index}`,
      label: transition.event,
      caption: (landingShot ? landing?.name : origin?.name) ?? null,
      status: transition.status === 'failed' ? 'failed' : transition.status === 'passed' ? 'passed' : null,
      thumb: shot?.src ?? shot?.thumb ?? null,
      point: null,
      pauseMs: film?.durationMs ?? null
    });
  });
  return { pictures, films, moments };
}

function chaptersOf(report: RunReport): FilmChapter[] {
  const chapters: FilmChapter[] = [];
  const visit = (steps: RunReport['steps']) => {
    for (const step of steps) {
      if (step.title) chapters.push({ atMs: Math.max(0, step.startedAtMs - report.meta.startedAtMs), label: step.title });
      visit(step.steps);
    }
  };
  visit(report.steps);
  return chapters.some((chapter) => chapter.atMs > 0) ? chapters : [];
}

/** Stills, videos, and the frame timeline published by any runner's report. */
export function reportLooks(report: RunReport, fileUrl: (file: string) => string): Looks {
  const frames = testFrames({ report, blobs: {} });
  const pictures: PictureLook[] = [];
  const films: FilmLook[] = [];
  const seen = new Set<string>();
  const visit = (steps: RunReport['steps']) => {
    for (const step of steps) {
      for (const frame of step.frames) {
        for (const blob of frame.snapshots) {
          if (seen.has(blob.file)) continue;
          if (blob.media !== 'png' && blob.media !== 'video') continue;
          seen.add(blob.file);
          const url = fileUrl(blob.file);
          const who = blob.nodeId ?? blob.name;
          if (blob.media === 'png') pictures.push({ id: blob.file, label: `${step.title} · ${who}`, alt: `Recorded ${who}`, src: url, thumb: url });
          else films.push({ id: blob.file, label: who || step.title, src: url, poster: null, captions: null, durationMs: null, chapters: [] });
        }
      }
      visit(step.steps);
    }
  };
  visit(report.steps);
  const chapters = chaptersOf(report);
  for (const artifact of report.artifacts ?? []) {
    if (seen.has(artifact.file)) continue;
    if (artifact.media !== 'png' && artifact.media !== 'video') continue;
    seen.add(artifact.file);
    const url = fileUrl(artifact.file);
    if (artifact.media === 'png') pictures.push({ id: artifact.file, label: artifact.name, alt: artifact.name, src: url, thumb: url });
    else films.push({
      id: artifact.file,
      label: artifact.name,
      src: url,
      poster: artifact.poster ? fileUrl(artifact.poster) : null,
      captions: artifact.captions ? fileUrl(artifact.captions) : null,
      durationMs: null,
      chapters
    });
  }
  const moments: MomentLook[] = frames.map((frame) => {
    const png = frame.frame.snapshots.find((blob) => blob.media === 'png');
    return {
      id: `frame:${frame.index}`,
      label: frame.step.title,
      caption: frame.step.kind,
      status: frame.step.status,
      thumb: png ? fileUrl(png.file) : null,
      point: null,
      pauseMs: frame.frame.durationMs ?? null
    };
  });
  return { pictures, films, moments };
}
