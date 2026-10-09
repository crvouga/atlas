import { Link } from '@tanstack/react-router';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { memo } from 'react';

import { STATUS_LABEL, type ChartView, type StateView } from '../data/model';
import { ScreenImage } from '../components/Screen';
import { StatusDot, SummaryBar } from '../components/Status';
import styles from './map.module.css';

function Handles() {
  return (
    <>
      <Handle type="target" position={Position.Left} className={styles.handle} isConnectable={false} />
      <Handle type="source" position={Position.Right} className={styles.handle} isConnectable={false} />
    </>
  );
}

export type ScreenNodeData = { state: StateView; chartId: string; selected: boolean; dimmed: boolean };
export type ScreenNodeType = Node<ScreenNodeData, 'screen'>;

export const ScreenNode = memo(function ScreenNode({ data }: NodeProps<ScreenNodeType>) {
  const { state, chartId, selected, dimmed } = data;
  return (
    <Link
      to="/chart/$chartId"
      params={{ chartId }}
      search={(prev) => ({ run: prev.run, screen: state.name, journey: prev.journey })}
      className={styles.screen}
      data-status={state.status}
      data-selected={selected}
      data-dimmed={dimmed}
      data-final={state.kind === 'final'}
      aria-label={`${state.name}. Screen, ${STATUS_LABEL[state.status]}.`}
      aria-current={selected ? 'true' : undefined}
    >
      <ScreenImage state={state} size="thumb" />
      <span className={styles.screenLabel}>
        <StatusDot status={state.status} />
        <span>{state.name}</span>
      </span>
      {state.confidence === 'assumed' && <span className={styles.assumed}>Assumed</span>}
      <Handles />
    </Link>
  );
});

export type GroupNodeData = { state: StateView; variant: 'group' | 'region' | 'parallel'; dimmed: boolean };
export type GroupNodeType = Node<GroupNodeData, 'group'>;

export const GroupNode = memo(function GroupNode({ data }: NodeProps<GroupNodeType>) {
  const { state, variant, dimmed } = data;
  return (
    <div className={styles.group} data-variant={variant} data-dimmed={dimmed} role="group" aria-label={`${state.name}${variant === 'parallel' ? ', parts that run side by side' : ''}`}>
      <span className={styles.groupLabel}>
        <StatusDot status={state.status} />
        {state.name}
        {variant === 'parallel' && <span className={styles.groupTag}>Side by side</span>}
      </span>
      <Handles />
    </div>
  );
});

export type ChartLinkNodeData = { state: StateView; chart: ChartView | null; dimmed: boolean };
export type ChartLinkNodeType = Node<ChartLinkNodeData, 'chartLink'>;

export const ChartLinkNode = memo(function ChartLinkNode({ data }: NodeProps<ChartLinkNodeType>) {
  const { state, chart, dimmed } = data;
  const body = (
    <>
      <span className={styles.chartEyebrow}>Part of the journey</span>
      <strong className={styles.chartTitle}>{state.name}</strong>
      {chart?.description && <span className={styles.chartDescription}>{chart.description}</span>}
      {chart && <SummaryBar noun="screen" nounPlural="screens" counts={chart.screens} verb="working" />}
      {chart && <span className={styles.chartCta}>Open {chart.name} →</span>}
      <Handles />
    </>
  );
  if (!chart) {
    return (
      <div className={styles.chartLink} data-dimmed={dimmed}>
        {body}
      </div>
    );
  }
  return (
    <Link to="/chart/$chartId" params={{ chartId: chart.id }} search={(prev) => ({ run: prev.run })} className={styles.chartLink} data-dimmed={dimmed} aria-label={`${state.name}: open the ${chart.name} chart`}>
      {body}
    </Link>
  );
});

export type ContextNodeData = { state: StateView; chart: ChartView | null; dimmed: boolean };
export type ContextNodeType = Node<ContextNodeData, 'context'>;

export const ContextNode = memo(function ContextNode({ data }: NodeProps<ContextNodeType>) {
  const { state, chart, dimmed } = data;
  return (
    <Link
      to="/chart/$chartId"
      params={{ chartId: state.chartId }}
      search={(prev) => ({ run: prev.run, screen: state.name })}
      className={styles.context}
      data-dimmed={dimmed}
      aria-label={`${state.name}, in ${chart?.name ?? 'another chart'}. ${STATUS_LABEL[state.status]}.`}
    >
      <span className={styles.contextEyebrow}>In {chart?.name ?? 'another chart'}</span>
      <span className={styles.contextName}>
        <StatusDot status={state.status} />
        {state.name}
      </span>
      <Handles />
    </Link>
  );
});

export const nodeTypes = { screen: ScreenNode, group: GroupNode, chartLink: ChartLinkNode, context: ContextNode };
