import * as Dialog from '@radix-ui/react-dialog';
import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';

import { ArrowLeftIcon, ArrowRightIcon, CloseIcon, PauseIcon, PlayIcon } from '../components/icons';
import { StatusBadge, StatusDot } from '../components/Status';
import type { AtlasView, JourneyView } from '../data/model';
import type { MapSelection } from '../map/ChartMap';
import { journeyChart } from '../map/navigation';
import styles from './views.module.css';
import { JourneySlideshow } from './JourneySlideshow';

export function JourneyNavigator({ view, chartId, journey, selection }: { view: AtlasView; chartId: string; journey: JourneyView; selection: MapSelection }) {
  const navigate = useNavigate();
  const [playing, setPlaying] = useState(false);
  const [watching, setWatching] = useState(false);
  const activeRow = useRef<HTMLLIElement>(null);
  const watchButton = useRef<HTMLButtonElement>(null);
  const index = selection.step;
  const step = index === undefined ? undefined : journey.steps[index];
  const last = journey.steps.length - 1;
  const related = view.journeys.filter((j) => j.chartIds.some((id) => journey.chartIds.includes(id)));
  const go = (next: number | undefined) =>
    navigate({
      to: '/chart/$chartId',
      params: { chartId: journeyChart(view, chartId, journey, next) },
      search: (prev) => ({ run: prev.run, journey: journey.id, step: next }),
      replace: playing || watching
    });

  const togglePlayback = async () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    if (index === undefined || index === last) await go(0);
    setPlaying(true);
  };

  // Scroll the step list alone; scrollIntoView would also move the panel and the page around it.
  useEffect(() => {
    const row = activeRow.current;
    const list = row?.parentElement;
    if (!row || !list || list.scrollHeight <= list.clientHeight) return;
    const top = row.offsetTop;
    if (top < list.scrollTop) list.scrollTop = top;
    else if (top + row.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top + row.offsetHeight - list.clientHeight;
  }, [index]);
  useEffect(() => {
    setPlaying(false);
  }, [journey.id, selection.screen, selection.event]);
  useEffect(() => {
    if (!playing) return;
    if (index !== undefined && index >= last) {
      setPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => go(index === undefined ? 0 : index + 1), 2200);
    return () => window.clearTimeout(timer);
  }, [playing, index, last, journey.id, chartId]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (watching) return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.defaultPrevented) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('input, textarea, select, button, a, [contenteditable="true"]')) return;
      if (event.key === 'ArrowRight' && (index === undefined || index < last)) {
        event.preventDefault();
        setPlaying(false);
        go(index === undefined ? 0 : index + 1);
      }
      if (event.key === 'ArrowLeft' && index !== undefined) {
        event.preventDefault();
        setPlaying(false);
        go(index === 0 ? undefined : index - 1);
      }
      if (event.key === 'Escape') {
        setPlaying(false);
        go(undefined);
      }
      if (event.code === 'Space' && last >= 0) {
        event.preventDefault();
        void togglePlayback();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, last, chartId, journey.id, playing, watching]);

  return (
    <aside className={styles.journeyNavigator} aria-label="Journey navigator">
      <div className={styles.journeyHead}>
        <span className={styles.journeyKicker}>Following a journey</span>
        <Link to="/chart/$chartId" params={{ chartId }} search={(prev) => ({ run: prev.run })} className={styles.journeyClose} aria-label="Exit journey">
          <CloseIcon size={16} />
        </Link>
        <h2>{journey.name}</h2>
        <StatusBadge status={journey.status} />
        {journey.description && <p>{journey.description}</p>}
        <label className={styles.journeyPicker}>
          <span className={styles.pickerLabel}>Switch journey</span>
          <select
            value={journey.id}
            onChange={(event) => {
              setPlaying(false);
              void navigate({ to: '/chart/$chartId', params: { chartId }, search: (prev) => ({ run: prev.run, journey: event.target.value }) });
            }}
          >
            {related.map((j) => (
              <option key={j.id} value={j.id}>
                {j.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className={styles.journeyControls}>
        <div className={styles.playback} role="group" aria-label="Journey playback">
          <button
            type="button"
            onClick={() => {
              setPlaying(false);
              go(index === 0 ? undefined : (index ?? 0) - 1);
            }}
            disabled={index === undefined}
            aria-label="Previous journey step"
            title="Previous step (←)"
          >
            <ArrowLeftIcon size={15} />
          </button>
          <button
            type="button"
            className={styles.playButton}
            disabled={last < 0}
            onClick={() => {
              void togglePlayback();
            }}
            aria-label={playing ? 'Pause journey' : 'Play journey'}
          >
            {playing ? (
              <>
                <PauseIcon size={12} /> Pause
              </>
            ) : (
              <>
                <PlayIcon size={12} /> Play
              </>
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              setPlaying(false);
              go(index === undefined ? 0 : index + 1);
            }}
            disabled={last < 0 || index === last}
            aria-label="Next journey step"
            title="Next step (→)"
          >
            <ArrowRightIcon size={15} />
          </button>
        </div>
        <div className={styles.progressLabel} role="status" aria-live="polite">
          {step ? `Step ${index! + 1} of ${journey.steps.length}` : `${journey.steps.length} ${journey.steps.length === 1 ? 'step' : 'steps'}`}
        </div>
        <button
          ref={watchButton}
          type="button"
          className={styles.watchButton}
          disabled={last < 0}
          onClick={async () => {
            setPlaying(false);
            await go(0);
            setWatching(true);
          }}
        >
          Watch as a slideshow
        </button>
        <progress value={index === undefined ? 0 : index + 1} max={Math.max(1, journey.steps.length)} aria-label="Journey progress" />
        <button
          type="button"
          className={styles.overviewButton}
          onClick={() => {
            setPlaying(false);
            go(undefined);
          }}
          disabled={index === undefined}
        >
          Show the whole journey
        </button>
      </div>
      <ol className={styles.journeyTimeline} aria-label="Journey steps">
        {journey.steps.map((s, i) => {
          const transition = view.transitions.get(s.transitionIds[0] ?? '');
          return (
            <li key={i} ref={i === index ? activeRow : undefined} data-current={i === index} data-complete={index !== undefined && i < index}>
              <button
                type="button"
                onClick={() => {
                  setPlaying(false);
                  go(i);
                }}
                aria-current={i === index ? 'step' : undefined}
              >
                <span className={styles.timelineNumber}>{i + 1}</span>
                <span className={styles.timelineCopy}>
                  <strong>{s.event}</strong>
                  <small>
                    {s.handOff ? 'Hand-off to ' : ''}
                    {s.to.filter((name) => view.states.get(name)?.kind === 'screen' || view.states.get(name)?.kind === 'final').join(', ') || s.to.join(', ')}
                  </small>
                </span>
                {transition && <StatusDot status={transition.status} />}
              </button>
              {i === index && transition && (
                <Link
                  to="/chart/$chartId"
                  params={{ chartId }}
                  search={(prev) => ({ run: prev.run, journey: journey.id, step: i, event: transition.id })}
                  className={styles.inspectStep}
                >
                  Inspect this event
                </Link>
              )}
            </li>
          );
        })}
      </ol>
      {!journey.steps.length && <p className={styles.journeyEmpty}>No steps could be traced. Check the journey’s events against the spec.</p>}
      {!journey.replay.ok && (
        <p className={styles.journeyWarning}>
          The spec stops at {journey.replay.failedAt ? `“${journey.replay.failedAt}”` : `an unexpected ending: ${journey.replay.missingEnds.join(', ')}`}.
        </p>
      )}
      {journey.runPaths.some((path) => path.error) && <p className={styles.journeyWarning}>{journey.runPaths.find((path) => path.error)?.error}</p>}
      <Dialog.Root open={watching} onOpenChange={setWatching}>
        {watching && (
          <JourneySlideshow
            key={`${journey.id}:${view.run?.id ?? 'spec'}`}
            view={view}
            journey={journey}
            onStep={(step) => {
              if (step !== index) void go(step);
            }}
            onClose={() => setWatching(false)}
            restoreFocus={() => watchButton.current?.focus()}
          />
        )}
      </Dialog.Root>
      <div className={styles.journeyFooter}>
        <span>
          <kbd>←</kbd> <kbd>→</kbd> move through steps
        </span>
        <span>
          <kbd>Space</kbd> play
        </span>
      </div>
    </aside>
  );
}
