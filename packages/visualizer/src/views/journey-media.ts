import type { AtlasView, ImageMedia, JourneyView, StateView, TransitionView, VideoMedia } from '../data/model';
import { ancestors } from '../map/navigation';

export type JourneyFrame = { state: StateView; image: ImageMedia | null };
export type JourneySlide =
  | { id: string; step: number; kind: 'screens'; label: string; frames: JourneyFrame[] }
  | { id: string; step: number; kind: 'video'; label: string; transition: TransitionView; clip: VideoMedia };

/** References only: never fetch or decode a journey's whole media library up front. */
export function journeySlides(view: AtlasView, journey: JourneyView): JourneySlide[] {
  const path = journey.runPaths.find((p) => p.status === 'passed') ?? journey.runPaths[0];
  const frames = (names: string[]) =>
    names
      .filter((name) => !names.some((other) => name !== other && ancestors(view, other).includes(name)))
      .flatMap((name): JourneyFrame[] => {
        const state = view.states.get(name);
        if (!state) return [];
        const specific = state.result?.screenshotsByPath.find((shot) => shot.path.id === path?.id)?.image;
        return [{ state, image: specific?.state === 'available' ? specific : (state.result?.screenshot ?? null) }];
      });
  const slides: JourneySlide[] = [];
  const first = journey.steps[0];
  if (first) slides.push({ id: 'start', step: 0, kind: 'screens', label: 'Before the journey', frames: frames(first.from) });
  journey.steps.forEach((step, index) => {
    for (const id of new Set(step.transitionIds)) {
      const transition = view.transitions.get(id);
      const clip = transition?.result?.clip;
      if (transition && clip?.state === 'available' && clip.src)
        slides.push({ id: `${index}:video:${id}`, step: index, kind: 'video', label: step.event, transition, clip });
    }
    slides.push({ id: `${index}:screens`, step: index, kind: 'screens', label: step.event, frames: frames(step.to) });
  });
  return slides;
}
