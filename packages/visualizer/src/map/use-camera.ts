import { useReactFlow, type Viewport } from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import { useReducedMotion } from '../state/use-reduced-motion';

const SLIDE_MS = 450;
export type CameraController = {
  moveTo: (viewport: Viewport, animate?: boolean) => void;
  cancel: () => void;
  isMoving: () => boolean;
};

/** One cancellable RAF, no React state per frame and no dependency on measuring offscreen nodes. */
export function useCamera(onSettled?: (viewport: Viewport) => void): CameraController {
  const flow = useReactFlow();
  const reduced = useReducedMotion();
  const settings = useRef({ flow, reduced, onSettled });
  settings.current = { flow, reduced, onSettled };
  const animation = useRef<{ frame: number; target: Viewport } | null>(null);
  const generation = useRef(0);
  const isMoving = useCallback(() => animation.current !== null, []);
  const cancel = useCallback(() => {
    if (animation.current) cancelAnimationFrame(animation.current.frame);
    animation.current = null;
    generation.current++;
  }, []);
  const settle = useCallback((target: Viewport) => {
    const id = generation.current;
    void settings.current.flow.setViewport(target, { duration: 0 }).then(() => {
      if (generation.current === id) settings.current.onSettled?.(settings.current.flow.getViewport());
    });
  }, []);
  const finish = useCallback(() => {
    const target = animation.current?.target;
    cancel();
    if (target) settle(target);
  }, [cancel, settle]);
  const moveTo = useCallback(
    (target: Viewport, animate = true) => {
      cancel();
      const { flow: api, reduced: prefersReduced } = settings.current;
      if (!animate || prefersReduced || document.hidden) {
        settle(target);
        return;
      }
      const from = api.getViewport();
      if (Math.abs(from.x - target.x) + Math.abs(from.y - target.y) < 1 && Math.abs(from.zoom - target.zoom) < 0.001) return;
      const started = performance.now();
      const id = generation.current;
      const tick = (now: number) => {
        if (!animation.current || generation.current !== id) return;
        const progress = Math.min(1, Math.max(0, (now - started) / SLIDE_MS));
        if (progress === 1) {
          animation.current = null;
          settle(target);
          return;
        }
        const t = progress * progress * (3 - 2 * progress);
        void settings.current.flow.setViewport(
          {
            x: from.x + (target.x - from.x) * t,
            y: from.y + (target.y - from.y) * t,
            zoom: from.zoom + (target.zoom - from.zoom) * t
          },
          { duration: 0 }
        );
        if (animation.current && generation.current === id) animation.current.frame = requestAnimationFrame(tick);
      };
      animation.current = { frame: requestAnimationFrame(tick), target };
    },
    [cancel, settle]
  );
  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden) finish();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      cancel();
    };
  }, [cancel, finish]);
  useEffect(() => {
    if (reduced) finish();
  }, [reduced, finish]);
  return useMemo(() => ({ moveTo, cancel, isMoving }), [moveTo, cancel, isMoving]);
}
