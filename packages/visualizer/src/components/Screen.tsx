import { useRef, useState, type ReactNode } from 'react';

import type { ImageMedia, ItemStatus, StateView } from '../data/model';
import styles from './Screen.module.css';

export type PlaceholderReason = 'not-captured' | 'not-reached' | 'processing' | 'not-run' | 'spec-only';

const REASON_LABEL: Record<PlaceholderReason, string> = {
  'not-captured': 'Not captured yet',
  'not-reached': 'Not reached in this run',
  processing: 'Still processing',
  'not-run': 'Not in this run',
  'spec-only': 'Not captured yet'
};

export function placeholderReason(status: ItemStatus, media: ImageMedia | null): PlaceholderReason {
  if (media?.state === 'processing') return 'processing';
  if (status === 'not-reached') return 'not-reached';
  if (status === 'not-yet-run') return 'not-run';
  if (status === 'spec-only') return 'spec-only';
  return 'not-captured';
}

/**
 * What a screen should look like, sketched from the spec: its name, description, and the checks
 * or hints that say what it shows. Clearly not a screenshot.
 */
export function ScreenPlaceholder({ state, reason, size }: { state: StateView; reason: PlaceholderReason; size: 'thumb' | 'full' }) {
  const sketch = (state.hints.length ? state.hints : state.specChecks).slice(0, size === 'thumb' ? 3 : 8);
  if (state.design) {
    return (
      <div className={styles.phone} data-size={size} data-variant="design">
        <img className={styles.design} src={state.design.image} alt={`Design for ${state.name}`} loading="lazy" />
        <span className={styles.designTag}>Design, not a screenshot</span>
      </div>
    );
  }
  return (
    <div className={styles.phone} data-size={size} data-variant="sketch" role="img" aria-label={`${state.name}: ${REASON_LABEL[reason]}`}>
      <div className={styles.notch} aria-hidden="true" />
      <div className={styles.sketch} aria-hidden="true">
        <span className={styles.reason} data-reason={reason}>
          {REASON_LABEL[reason]}
        </span>
        <span className={styles.title}>{state.name}</span>
        {state.description && <span className={styles.description}>{state.description}</span>}
        {sketch.length > 0 && (
          <span className={styles.lines}>
            {sketch.map((line) => (
              <span key={line} className={styles.line}>
                <span className={styles.tick} />
                <span>{line}</span>
              </span>
            ))}
          </span>
        )}
        <span className={styles.bars}>
          <span className={styles.card} />
          <span className={styles.barWide} />
          <span className={styles.barNarrow} />
          <span className={styles.barWide} />
          <span className={styles.button} />
        </span>
      </div>
    </div>
  );
}

/** A screenshot that fades in over a same-sized skeleton, with a quiet retry if it fails. */
export function Screenshot({ src, alt, size, underlay }: { src: string; alt: string; size: 'thumb' | 'full'; underlay?: ReactNode }) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<'loading' | 'loaded' | 'failed'>('loading');
  const url = attempt ? `${src}${src.includes('?') ? '&' : '?'}retry=${attempt}` : src;
  return (
    <div className={styles.phone} data-size={size} data-variant="shot" data-state={state}>
      {state !== 'loaded' && (underlay ? <div className={styles.underlay}>{underlay}</div> : <div className={styles.skeleton} aria-hidden="true" />)}
      {state === 'failed' ? (
        <div className={styles.failed} role="status">
          <span>Couldn’t load the screenshot.</span>
          <button
            type="button"
            className={styles.retry}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setState('loading');
              setAttempt((n) => n + 1);
            }}
          >
            Try again
          </button>
        </div>
      ) : (
        <img
          key={url}
          className={styles.img}
          src={url}
          alt={alt}
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={() => setState('loaded')}
          onError={() => setState('failed')}
        />
      )}
    </div>
  );
}

/** The real screenshot when there is one, the placeholder otherwise. */
export function ScreenImage({ state, size }: { state: StateView; size: 'thumb' | 'full' }) {
  const media = state.result?.screenshot ?? null;
  const src = media?.state === 'available' ? (size === 'thumb' ? media.thumb ?? media.full : media.full ?? media.thumb) : null;
  const startedAsPlaceholder = useRef(src === null);
  const placeholder = <ScreenPlaceholder state={state} reason={placeholderReason(state.status, media)} size={size} />;
  if (src) return <Screenshot src={src} alt={`Screenshot of ${state.name}`} size={size} underlay={startedAsPlaceholder.current ? placeholder : undefined} />;
  return placeholder;
}
