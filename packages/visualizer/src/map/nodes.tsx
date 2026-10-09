import { Link } from '@tanstack/react-router';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { memo } from 'react';

import { STATUS_LABEL, type ChartView, type StateView } from '../data/model';
import { ScreenImage } from '../components/Screen';
import { PlusIcon } from '../components/icons';
import { StatusDot } from '../components/Status';
import { useUiStore } from '../state/ui-store';
import styles from './map.module.css';

function Handles() {
  return (
    <>
      <Handle type="target" position={Position.Left} className={styles.handle} isConnectable={false} />
      <Handle type="source" position={Position.Right} className={styles.handle} isConnectable={false} />
    </>
  );
}

export type ScreenNodeData = { state: StateView; chartId: string; selected: boolean; dimmed: boolean; active: boolean; onPath: boolean; compact: boolean };
export type ScreenNodeType = Node<ScreenNodeData, 'screen'>;

export const ScreenNode = memo(function ScreenNode({ data }: NodeProps<ScreenNodeType>) {
  const { state, chartId, selected, dimmed, active, onPath, compact } = data;
  return (
    <Link
      to="/chart/$chartId"
      params={{ chartId }}
      search={(prev) => ({ run: prev.run, screen: state.name, journey: prev.journey, step: prev.step })}
      className={styles.screen}
      data-status={state.status}
      data-selected={selected}
      data-dimmed={dimmed}
      data-active={active}
      data-path={onPath}
      data-compact={compact}
      data-final={state.kind === 'final'}
      aria-label={`${state.name}. Screen, ${STATUS_LABEL[state.status]}.`}
      aria-current={selected ? 'true' : undefined}
    >
      {!compact && <ScreenImage state={state} size="thumb" />}
      {compact && <span className={styles.compactKind}>{state.kind === 'final' ? 'Final state' : 'Screen'}</span>}
      <span className={styles.screenLabel}>
        <StatusDot status={state.status} />
        <span>{state.name}</span>
      </span>
      {state.confidence === 'assumed' && <span className={styles.assumed}>Assumed</span>}
      <Handles />
    </Link>
  );
});

export type GroupNodeData = { state: StateView; chartId: string; variant: 'group' | 'region' | 'parallel'; dimmed: boolean; active: boolean; onPath: boolean };
export type GroupNodeType = Node<GroupNodeData, 'group'>;

export const GroupNode = memo(function GroupNode({ data }: NodeProps<GroupNodeType>) {
  const { state, chartId, variant, dimmed, active, onPath } = data;
  const toggle = useUiStore((s) => s.toggleDetail);
  return (
    <div
      className={styles.group}
      data-variant={variant}
      data-dimmed={dimmed}
      data-active={active}
      data-path={onPath}
      role="group"
      aria-label={`${state.name}${variant === 'parallel' ? ', parts that run side by side' : ''}`}
    >
      <span className={styles.groupLabel}>
        <StatusDot status={state.status} />
        <Link
          to="/chart/$chartId"
          params={{ chartId }}
          search={(prev) => ({ run: prev.run, screen: state.name, journey: prev.journey, step: prev.step })}
          className={styles.groupName}
          title={state.name}
        >
          {state.name}
        </Link>
        {variant === 'parallel' && <span className={styles.groupTag}>Parallel</span>}
        {state.childChartId && <span className={styles.groupTag}>Child machine</span>}
        {state.childChartId && (
          <Link
            to="/chart/$chartId"
            params={{ chartId: state.childChartId }}
            search={(prev) => ({ run: prev.run, journey: prev.journey, step: prev.step })}
            className={styles.chartCta}
          >
            Open chart
          </Link>
        )}
        <button
          type="button"
          className={`${styles.detailToggle} nodrag nopan`}
          onClick={() => toggle(chartId, state.name, Boolean(state.childChartId))}
          aria-expanded="true"
          aria-label={`Hide details of ${state.name}`}
        >
          Hide details
        </button>
      </span>
      <Handles />
    </div>
  );
});

export type ChartLinkNodeData = {
  state: StateView;
  chart: ChartView | null;
  chartId: string;
  dimmed: boolean;
  active: boolean;
  onPath: boolean;
  count: number;
};
export type ChartLinkNodeType = Node<ChartLinkNodeData, 'chartLink'>;

export const ChartLinkNode = memo(function ChartLinkNode({ data }: NodeProps<ChartLinkNodeType>) {
  const { state, chart, chartId, dimmed, active, onPath, count } = data;
  const toggle = useUiStore((s) => s.toggleDetail);
  return (
    <div className={styles.chartLink} data-dimmed={dimmed} data-active={active} data-path={onPath}>
      <span className={styles.chartEyebrow}>
        {state.childChartId ? 'Child machine' : state.kind === 'parallel' ? 'Parallel states' : 'State group'}, {count} {count === 1 ? 'state' : 'states'} inside
      </span>
      <strong className={styles.chartTitle}>
        <StatusDot status={state.status} />
        <Link
          to="/chart/$chartId"
          params={{ chartId }}
          search={(prev) => ({ run: prev.run, screen: state.name, journey: prev.journey, step: prev.step })}
          className={styles.groupName}
        >
          {state.name}
        </Link>
      </strong>
      <span className={styles.chartDescription}>{state.description || chart?.description || 'Expand to explore the states and events inside.'}</span>
      <div className={styles.cardActions}>
        <button
          type="button"
          className={`${styles.expandButton} nodrag nopan`}
          onClick={() => toggle(chartId, state.name, Boolean(state.childChartId))}
          aria-expanded="false"
          aria-label={`Show details of ${state.name}`}
        >
          <PlusIcon size={12} />
          Show details
        </button>
        {chart && (
          <Link
            to="/chart/$chartId"
            params={{ chartId: chart.id }}
            search={(prev) => ({ run: prev.run, journey: prev.journey, step: prev.step })}
            className={styles.chartCta}
          >
            Open chart
          </Link>
        )}
      </div>
      <Handles />
    </div>
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
