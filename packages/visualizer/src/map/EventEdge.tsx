import { Link } from '@tanstack/react-router';
import { EdgeLabelRenderer, type Edge, type EdgeProps } from '@xyflow/react';
import { memo } from 'react';

import { STATUS_LABEL, type TransitionView } from '../data/model';
import { KIND_LABEL, KindIcon } from '../components/labels';
import type { PlacedEdge } from '../layout/layout';
import styles from './map.module.css';
import { roundedPath } from './path';

export type EventEdgeData = {
  placed: PlacedEdge;
  transition: TransitionView;
  chartId: string;
  selected: boolean;
  step: number | null;
  dimmed: boolean;
  active: boolean;
};

export type EventEdgeType = Edge<EventEdgeData, 'event'>;

const UNCHECKED = new Set(['not-reached', 'not-yet-run', 'spec-only']);

export const EventEdge = memo(function EventEdge({ data, id }: EdgeProps<EventEdgeType>) {
  if (!data) return null;
  const { placed, transition: t, chartId, selected, step, dimmed, active } = data;
  const unchecked = UNCHECKED.has(t.status);
  const d = roundedPath(placed.points);
  return (
    <>
      <path
        id={id}
        d={d}
        className={styles.edge}
        data-kind={t.kind}
        data-status={t.status}
        data-unchecked={unchecked}
        data-selected={selected}
        data-highlight={step !== null}
        data-active={active}
        data-dimmed={dimmed}
        markerEnd={`url(#atlas-arrow-${selected || step !== null ? 'active' : unchecked ? 'muted' : t.kind})`}
      />
      <EdgeLabelRenderer>
        <Link
          to="/chart/$chartId"
          params={{ chartId }}
          search={(prev) => ({ run: prev.run, event: t.id, journey: prev.journey, step: step === null ? prev.step : step - 1 })}
          className={`${styles.chip} nodrag nopan`}
          data-kind={t.kind}
          data-status={t.status}
          data-unchecked={unchecked}
          data-selected={selected}
          data-highlight={step !== null}
          data-active={active}
          data-dimmed={dimmed}
          style={{ transform: `translate(${placed.label.x}px, ${placed.label.y}px)`, width: placed.label.width }}
          aria-label={`${KIND_LABEL[t.kind]}: ${t.event}. ${STATUS_LABEL[t.status]}.${step !== null ? ` Step ${step} of the journey.` : ''}`}
          title={t.event}
        >
          {step !== null && <span className={styles.stepNo}>{step}</span>}
          <span className={styles.chipIcon}>
            <KindIcon kind={t.kind} size={11} />
          </span>
          <span className={styles.chipText}>{t.event}</span>
        </Link>
      </EdgeLabelRenderer>
    </>
  );
});

export const edgeTypes = { event: EventEdge };

export function EdgeMarkers() {
  const marker = (id: string, color: string) => (
    <marker key={id} id={`atlas-arrow-${id}`} viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0,0.5 L9.5,5 L0,9.5 z" fill={color} />
    </marker>
  );
  return (
    <svg className={styles.markers} aria-hidden="true">
      <defs>
        {marker('user', '#a78bfa')}
        {marker('system', '#f59e0b')}
        {marker('time', '#38bdf8')}
        {marker('hand-off', '#2dd4bf')}
        {marker('muted', '#94a3b8')}
        {marker('active', '#7c3aed')}
      </defs>
    </svg>
  );
}
