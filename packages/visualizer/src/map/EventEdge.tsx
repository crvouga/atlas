import { Badge, Text } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import { EdgeLabelRenderer, type Edge, type EdgeProps } from '@xyflow/react';
import { memo } from 'react';
import { KIND_LABEL, KindIcon } from '../components/labels';
import { STATUS_LABEL, type ItemStatus, type TransitionView } from '../data/model';
import type { LayoutBundle } from '../layout/graph';
import type { PlacedEdge } from '../layout/layout';
import styles from './map.module.css';
import { roundedPath } from './path';
export type EventEdgeData = {
  placed: PlacedEdge;
  transition: TransitionView | null;
  bundle: LayoutBundle | null;
  chartId: string;
  selected: boolean;
  step: number | null;
  dimmed: boolean;
};
export type EventEdgeType = Edge<EventEdgeData, 'event'>;
const UNCHECKED = new Set(['not-reached', 'not-yet-run', 'spec-only']);
function markerFor(status: ItemStatus, selected: boolean, step: number | null, kind: string) {
  if (selected || step !== null) return 'active';
  if (UNCHECKED.has(status)) return 'muted';
  return kind;
}
export const EventEdge = memo(function EventEdge({ data, id }: EdgeProps<EventEdgeType>) {
  if (!data) return null;
  const { placed, transition: t, bundle, chartId, selected, step, dimmed } = data;
  if (bundle && bundle.count > 1) {
    const unchecked = UNCHECKED.has(bundle.status);
    const d = roundedPath(placed.points);
    return (
      <>
        <path
          id={id}
          d={d}
          className={styles.edge}
          data-status={bundle.status}
          data-unchecked={unchecked}
          data-dimmed={dimmed}
          markerEnd={`url(#atlas-arrow-${unchecked ? 'muted' : 'user'})`}
        />
        <EdgeLabelRenderer>
          <Badge
            renderRoot={(props) => (
              <Link
                {...props}
                to="/chart/$chartId"
                params={{ chartId }}
                search={(prev) => ({
                  run: prev.run,
                  journey: prev.journey,
                  event: undefined,
                  screen: bundle.screen ?? undefined,
                  group: bundle.group ?? undefined
                })}
              />
            )}
            className={`${styles.chip} nodrag nopan`}
            variant="default"
            data-status={bundle.status}
            data-unchecked={unchecked}
            data-dimmed={dimmed}
            style={{ transform: `translate(${placed.label.x}px, ${placed.label.y}px)`, width: placed.label.width }}
            aria-label={`${bundle.label}. ${STATUS_LABEL[bundle.status]}.`}
            title={bundle.label}
          >
            <Text span inherit truncate>
              {bundle.label}
            </Text>
          </Badge>
        </EdgeLabelRenderer>
      </>
    );
  }
  if (!t) return null;
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
        data-dimmed={dimmed}
        markerEnd={`url(#atlas-arrow-${markerFor(t.status, selected, step, t.kind)})`}
      />
      <EdgeLabelRenderer>
        <Badge
          renderRoot={(props) => (
            <Link
              {...props}
              to="/chart/$chartId"
              params={{ chartId }}
              search={(prev) => ({ run: prev.run, event: t.id, journey: prev.journey })}
            />
          )}
          className={`${styles.chip} nodrag nopan`}
          variant="default"
          data-kind={t.kind}
          data-status={t.status}
          data-unchecked={unchecked}
          data-selected={selected}
          data-highlight={step !== null}
          data-dimmed={dimmed}
          style={{ transform: `translate(${placed.label.x}px, ${placed.label.y}px)`, width: placed.label.width }}
          aria-label={`${KIND_LABEL[t.kind]}: ${t.event}. ${STATUS_LABEL[t.status]}.${step !== null ? ` Step ${step} of the journey.` : ''}`}
          title={t.event}
        >
          {step !== null && (
            <Text span inherit fw={700}>
              {step}
            </Text>
          )}
          <Text span inherit>
            <KindIcon kind={t.kind} size={11} />
          </Text>
          <Text span inherit truncate>
            {t.event}
          </Text>
        </Badge>
      </EdgeLabelRenderer>
    </>
  );
});
export const edgeTypes = { event: EventEdge };
export function EdgeMarkers() {
  const marker = (id: string, color: string) => (
    <marker
      key={id}
      id={`atlas-arrow-${id}`}
      viewBox="0 0 10 10"
      refX="8.5"
      refY="5"
      markerWidth="7"
      markerHeight="7"
      orient="auto-start-reverse"
    >
      <path d="M0,0.5 L9.5,5 L0,9.5 z" fill={color} />
    </marker>
  );
  return (
    <svg className={styles.markers} aria-hidden="true">
      <defs>
        {marker('user', 'var(--mantine-color-blue-7)')}
        {marker('system', 'var(--mantine-color-gray-6)')}
        {marker('time', 'var(--mantine-color-gray-6)')}
        {marker('hand-off', 'var(--mantine-color-dark-5)')}
        {marker('muted', 'var(--mantine-color-gray-4)')}
        {marker('active', 'var(--mantine-color-blue-7)')}
      </defs>
    </svg>
  );
}
