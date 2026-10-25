import { IconArrowRight } from '@tabler/icons-react';
import { Badge, Card, Group, Stack, Text } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { memo } from 'react';
import { ScreenImage } from '../components/Screen';
import { StatusDot, SummaryBar } from '../components/Status';
import { STATUS_LABEL, type ChartView, type ItemStatus, type StateView } from '../data/model';
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
    <Card
      p="xs"
      w="100%"
      h="100%"
      className={`nopan nodrag ${styles.node}`}
      data-status={state.status}
      data-selected={selected}
      data-dimmed={dimmed}
      aria-label={`${state.name}. Screen, ${STATUS_LABEL[state.status]}.`}
      aria-current={selected ? 'true' : undefined}
      renderRoot={(props) => (
        <Link
          {...props}
          to="/chart/$chartId"
          params={{ chartId }}
          search={(prev) => ({ run: prev.run, screen: state.name, journey: prev.journey })}
        />
      )}
    >
      <Stack gap="xs">
        <ScreenImage state={state} size="thumb" />
        <Group gap="xs" wrap="nowrap">
          <StatusDot status={state.status} />
          <Text size="xs" fw={600} lineClamp={3}>
            {state.name}
          </Text>
        </Group>
        {state.confidence === 'assumed' && (
          <Badge color="gray" size="sm">
            Assumed
          </Badge>
        )}
      </Stack>
      <Handles />
    </Card>
  );
});
export type GroupNodeData = { state: StateView; variant: 'group' | 'region' | 'parallel'; dimmed: boolean };
export type GroupNodeType = Node<GroupNodeData, 'group'>;
export const GroupNode = memo(function GroupNode({ data }: NodeProps<GroupNodeType>) {
  const { state, variant, dimmed } = data;
  return (
    <Card
      w="100%"
      h="100%"
      p="xs"
      bg="gray.0"
      data-dimmed={dimmed}
      role="group"
      aria-label={`${state.name}${variant === 'parallel' ? ', parts that run side by side' : ''}`}
    >
      <Group gap="xs">
        <StatusDot status={state.status} />
        <Text size="xs" fw={600}>
          {state.name}
        </Text>
        {variant === 'parallel' && (
          <Badge color="gray" size="xs">
            Side by side
          </Badge>
        )}
      </Group>
      <Handles />
    </Card>
  );
});
export type ChartLinkNodeData = { state: StateView; chart: ChartView | null; dimmed: boolean };
export type ChartLinkNodeType = Node<ChartLinkNodeData, 'chartLink'>;
export const ChartLinkNode = memo(function ChartLinkNode({ data }: NodeProps<ChartLinkNodeType>) {
  const { state, chart, dimmed } = data;
  const body = (
    <Stack gap="xs">
      <Text fw={600}>{state.name}</Text>
      {chart?.description && (
        <Text size="xs" c="dimmed" lineClamp={2}>
          {chart.description}
        </Text>
      )}
      {chart && <SummaryBar noun="screen" nounPlural="screens" counts={chart.screens} verb="working" />}
      {chart && (
        <Text c="blue" size="xs">
          Open {chart.name} <IconArrowRight size={16} aria-hidden="true" />
        </Text>
      )}
      <Handles />
    </Stack>
  );
  return chart ? (
    <Card
      w="100%"
      h="100%"
      className={`nopan nodrag ${styles.node}`}
      data-dimmed={dimmed}
      aria-label={`${state.name}: open the ${chart.name} chart`}
      renderRoot={(props) => <Link {...props} to="/chart/$chartId" params={{ chartId: chart.id }} search={(prev) => ({ run: prev.run })} />}
    >
      {body}
    </Card>
  ) : (
    <Card w="100%" h="100%">
      {body}
    </Card>
  );
});
export type ContextNodeData = { state: StateView; chart: ChartView | null; dimmed: boolean };
export type ContextNodeType = Node<ContextNodeData, 'context'>;
export const ContextNode = memo(function ContextNode({ data }: NodeProps<ContextNodeType>) {
  const { state, chart, dimmed } = data;
  return (
    <Card
      w="100%"
      h="100%"
      p="sm"
      className={`nopan nodrag ${styles.node}`}
      data-dimmed={dimmed}
      aria-label={`${state.name}, in ${chart?.name ?? 'another chart'}. ${STATUS_LABEL[state.status]}.`}
      renderRoot={(props) => (
        <Link
          {...props}
          to="/chart/$chartId"
          params={{ chartId: state.chartId }}
          search={(prev) => ({ run: prev.run, screen: state.name })}
        />
      )}
    >
      <Stack gap="xs">
        <Group gap="xs">
          <StatusDot status={state.status} />
          <Text size="xs" fw={600}>
            {state.name}
          </Text>
        </Group>
        <Text size="xs" c="dimmed">
          In {chart?.name ?? 'another chart'}
        </Text>
      </Stack>
      <Handles />
    </Card>
  );
});
export type SummaryNodeData = { state: StateView; places: number; status: ItemStatus; dimmed: boolean };
export type SummaryNodeType = Node<SummaryNodeData, 'summary'>;
export const SummaryNode = memo(function SummaryNode({ data }: NodeProps<SummaryNodeType>) {
  const { state, places, status, dimmed } = data;
  const noun = places === 1 ? 'place' : 'places';
  return (
    <Card
      w="100%"
      h="100%"
      p="sm"
      className={`nopan nodrag ${styles.node}`}
      data-status={status}
      data-dimmed={dimmed}
      aria-label={`${state.name}. ${places} ${noun}. ${STATUS_LABEL[status]}.`}
      renderRoot={(props) => (
        <Link
          {...props}
          to="/chart/$chartId"
          params={{ chartId: state.chartId }}
          search={(prev) => ({ run: prev.run, group: state.name, screen: undefined, event: undefined, journey: undefined })}
        />
      )}
    >
      <Group gap="xs">
        <StatusDot status={status} />
        <Text fw={600} size="sm">
          {state.name}
        </Text>
      </Group>
      <Text size="xs" c="dimmed">
        {places} {noun}
      </Text>
      <Handles />
    </Card>
  );
});
export const nodeTypes = { screen: ScreenNode, group: GroupNode, chartLink: ChartLinkNode, context: ContextNode, summary: SummaryNode };
