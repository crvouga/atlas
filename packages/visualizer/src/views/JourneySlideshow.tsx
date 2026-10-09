import * as Dialog from '@radix-ui/react-dialog';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { CloseIcon } from '../components/icons';
import { ScreenPlaceholder, placeholderReason } from '../components/Screen';
import type { AtlasView, JourneyView } from '../data/model';
import { journeySlides, type JourneySlide } from './journey-media';
import styles from './JourneySlideshow.module.css';

function ScreenFrame({ frame }: { frame: Extract<JourneySlide, { kind: 'screens' }>['frames'][number] }) {
  const [failed, setFailed] = useState(false);
  const src = frame.image?.state === 'available' ? (frame.image.full ?? frame.image.thumb) : null;
  return (
    <figure className={styles.frame}>
      {src && !failed ? (
        <img src={src} alt={`Screenshot of ${frame.state.name}`} decoding="async" onError={() => setFailed(true)} />
      ) : (
        <ScreenPlaceholder state={frame.state} reason={placeholderReason(frame.state.status, frame.image)} size="full" />
      )}
      <figcaption>
        {frame.state.name}
        {failed && ' · Screenshot unavailable'}
      </figcaption>
    </figure>
  );
}

/** The current clip alone owns a decoder; screenshots use a dwell timer, videos advance on ended. */
export function JourneySlideshow({
  view,
  journey,
  onStep,
  onClose,
  restoreFocus
}: {
  view: AtlasView;
  journey: JourneyView;
  onStep: (step: number) => void;
  onClose: () => void;
  restoreFocus?: () => void;
}) {
  const slides = useMemo(() => journeySlides(view, journey), [view, journey]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [muted, setMuted] = useState(true);
  const [dwell, setDwell] = useState(2500);
  const [loop, setLoop] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [buffering, setBuffering] = useState(true);
  const [blocked, setBlocked] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const playButton = useRef<HTMLButtonElement>(null);
  const stepCallback = useRef(onStep);
  stepCallback.current = onStep;
  const slide = slides[Math.min(index, slides.length - 1)];
  const advance = useCallback(() => {
    if (index < slides.length - 1) setIndex(index + 1);
    else if (loop) setIndex(0);
    else {
      setPlaying(false);
      setCompleted(true);
    }
  }, [index, slides.length, loop]);

  useEffect(() => {
    if (slide) stepCallback.current(slide.step);
  }, [slide?.step]);
  useEffect(() => {
    setBlocked(false);
    setBuffering(true);
    setCompleted(false);
    setFailed(null);
  }, [slide?.id]);
  useEffect(() => {
    const video = videoRef.current;
    if (!video || slide?.kind !== 'video' || failed === slide.id) return;
    let cancelled = false;
    if (playing) {
      void video.play()?.catch(() => {
        if (!cancelled) {
          setBlocked(true);
          setPlaying(false);
        }
      });
    } else video.pause();
    return () => {
      cancelled = true;
    };
  }, [playing, slide?.id, failed]);
  useEffect(() => {
    const video = videoRef.current;
    return () => {
      video?.pause();
    };
  }, [slide?.id]);
  useEffect(() => {
    if (!playing || !slide || (slide.kind === 'video' && failed !== slide.id)) return;
    const timer = window.setTimeout(advance, dwell);
    return () => window.clearTimeout(timer);
  }, [playing, slide?.id, failed, dwell, advance]);
  useEffect(() => {
    if (!playing || !buffering || slide?.kind !== 'video' || failed === slide.id) return;
    const timer = window.setTimeout(() => setFailed(slide.id), 15000);
    return () => window.clearTimeout(timer);
  }, [playing, buffering, slide?.id, failed]);
  // Preload only the next screenshot frame. No hidden videos or whole-journey downloads.
  useEffect(() => {
    const next = slides[index + 1];
    if (next?.kind !== 'screens') return;
    const images = next.frames.flatMap((frame) => {
      const src = frame.image?.state === 'available' ? (frame.image.full ?? frame.image.thumb) : null;
      if (!src) return [];
      const image = new Image();
      image.src = src;
      return [image];
    });
    return () =>
      images.forEach((image) => {
        image.removeAttribute('src');
      });
  }, [slides, index]);
  const seek = (next: number) => {
    setCompleted(false);
    setIndex(Math.max(0, Math.min(slides.length - 1, next)));
  };
  const toggle = () => {
    if (completed) {
      setIndex(0);
      setCompleted(false);
    }
    setPlaying(!playing);
  };

  return (
    <Dialog.Portal>
      <Dialog.Overlay className={styles.overlay} />
      <Dialog.Content
        className={styles.player}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          playButton.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          if (restoreFocus) {
            event.preventDefault();
            restoreFocus();
          }
        }}
        onKeyDown={(event) => {
          if ((event.target as Element).closest('input, select, textarea, video')) return;
          if (event.key === 'ArrowRight') {
            event.preventDefault();
            seek(index + 1);
          }
          if (event.key === 'ArrowLeft') {
            event.preventDefault();
            seek(index - 1);
          }
          if (event.code === 'Space' && !(event.target as Element).closest('button')) {
            event.preventDefault();
            toggle();
          }
        }}
      >
        <header className={styles.head}>
          <div>
            <Dialog.Title className={styles.title}>{journey.name}</Dialog.Title>
            <Dialog.Description className={styles.description}>
              Screenshots and recordings from the selected run · {view.run ? 'Available media' : 'Spec preview'}
            </Dialog.Description>
          </div>
          <button type="button" onClick={onClose} className={styles.close} aria-label="Close journey slideshow">
            <CloseIcon size={18} />
          </button>
        </header>
        <div className={styles.stage} data-kind={slide?.kind}>
          {slide?.kind === 'video' && failed !== slide.id ? (
            <video
              key={slide.id}
              ref={videoRef}
              src={slide.clip.src!}
              poster={slide.clip.poster ?? undefined}
              controls
              playsInline
              muted={muted}
              preload="metadata"
              aria-label={`Recording: ${slide.label}`}
              onEnded={advance}
              onError={() => setFailed(slide.id)}
              onWaiting={() => setBuffering(true)}
              onPlaying={() => {
                setBuffering(false);
                setBlocked(false);
              }}
              onPlay={() => setPlaying(true)}
              onPause={(event) => {
                if (event.currentTarget === videoRef.current && !event.currentTarget.ended) setPlaying(false);
              }}
            >
              {slide.clip.captions && <track kind="captions" src={slide.clip.captions} srcLang="en" label="Steps" default />}
            </video>
          ) : slide?.kind === 'screens' ? (
            <div key={slide.id} className={styles.frames}>
              {slide.frames.length ? (
                slide.frames.map((frame) => <ScreenFrame key={frame.state.name} frame={frame} />)
              ) : (
                <p className={styles.unavailable}>No screen is captured at this point in the journey.</p>
              )}
            </div>
          ) : (
            <p className={styles.unavailable}>
              {slide ? 'This recording could not be played. Continuing to the next screenshot…' : 'This journey has no traced steps yet.'}
            </p>
          )}
        </div>
        <div className={styles.caption} aria-live="polite">
          <strong>{completed ? 'Journey complete' : slide?.label}</strong>
          <span>
            {slide &&
              `Step ${slide.step + 1} of ${journey.steps.length} · ${slide.id === 'start' ? 'Starting screens' : slide.kind === 'video' ? 'Event recording' : 'Resulting screens'}`}
          </span>
          {blocked && <span>Playback paused by the browser. Use the video’s Play control to continue.</span>}
        </div>
        <footer className={styles.controls}>
          <div className={styles.transport}>
            <button type="button" onClick={() => seek(index - 1)} disabled={index <= 0} aria-label="Previous slide">
              ←
            </button>
            <button ref={playButton} type="button" onClick={toggle} disabled={!slide} aria-label={playing ? 'Pause slideshow' : 'Play slideshow'}>
              {playing ? 'Ⅱ Pause' : completed ? '↺ Replay' : '▶ Play'}
            </button>
            <button type="button" onClick={() => seek(index + 1)} disabled={index >= slides.length - 1} aria-label="Next slide">
              →
            </button>
          </div>
          <label>
            Jump to step
            <select
              aria-label="Slideshow step"
              value={slide?.step ?? 0}
              onChange={(event) => seek(slides.findIndex((s) => s.step === Number(event.target.value) && s.id !== 'start'))}
            >
              {journey.steps.map((step, i) => (
                <option key={i} value={i}>
                  {i + 1}. {step.event}
                </option>
              ))}
            </select>
          </label>
          <label>
            Screen duration
            <select aria-label="Screenshot duration" value={dwell} onChange={(event) => setDwell(Number(event.target.value))}>
              <option value={1500}>1.5 seconds</option>
              <option value={2500}>2.5 seconds</option>
              <option value={4000}>4 seconds</option>
            </select>
          </label>
          <button type="button" aria-pressed={!muted} onClick={() => setMuted(!muted)}>
            {muted ? 'Sound off' : 'Sound on'}
          </button>
          <button type="button" aria-pressed={loop} onClick={() => setLoop(!loop)}>
            Loop
          </button>
          <span className={styles.counter}>
            {index + 1} / {slides.length}
          </span>
        </footer>
      </Dialog.Content>
    </Dialog.Portal>
  );
}
