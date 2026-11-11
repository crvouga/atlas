import type { Meta, StoryObj } from '@storybook/react-vite';
import { Anchor, Badge, Button, Divider, Group, SimpleGrid, Stack, Table, Text } from '@mantine/core';
import { IconPlayerPlay } from '@tabler/icons-react';
import { Metric, PageHeader, Panel } from '../src/components/Page';
import { StatusBadge, StatusDot } from '../src/components/Status';
import { StatusMark } from '../src/evidence/marks';
import { Sheet } from './foundations';
const meta = { title: 'Foundations/Compositions', component: Sheet } satisfies Meta<typeof Sheet>;
export default meta;
type Story = StoryObj<typeof meta>;
const MARKS = ['passed', 'failed', 'running', 'not-run', 'none'] as const;
const ITEMS = ['passed', 'flaky', 'failed', 'not-reached', 'not-yet-run', 'spec-only'] as const;
export const PageHeaders: Story = { args: { title: 'PageHeader', description: 'The heading of a page: an optional line above, the title with its mark, one sentence, actions on the right and metadata below.', children: (
  <Stack gap="md">
    <Panel title="Title only"><PageHeader title="Runs" /></Panel>
    <Panel title="With a description and actions"><PageHeader title="Tests" description="Every test of the project with its newest result in each environment." actions={<><Button>Filters</Button><Button variant="filled" leftSection={<IconPlayerPlay size={16} aria-hidden="true" />}>Watch 4 recordings</Button></>} /></Panel>
    <Panel title="A detail page">
      <PageHeader
        eyebrow={<Anchor component="button" type="button">Back to tests</Anchor>}
        mark={<StatusMark status="failed" size={20} />}
        title="Pays at the counter"
        description="The confirmation never appeared on the screen."
        actions={<Button>Share</Button>}
      >
        <Group gap="sm">
          <Text c="dimmed">Desktop web</Text><Divider orientation="vertical" /><Text c="dimmed">main</Text><Divider orientation="vertical" /><Text c="dimmed" ff="monospace">c0ffee1</Text><Divider orientation="vertical" /><Text c="dimmed">Oct 14, 9:04 AM</Text>
        </Group>
      </PageHeader>
    </Panel>
  </Stack>
) } };
export const Panels: Story = { args: { title: 'Panel', description: 'A card with a heading row. Flush removes the body padding so a table or list meets the card edge.', children: (
  <Stack gap="md">
    <Panel title="Recording" description="The newest run of this test" actions={<Button variant="subtle">Open full-screen</Button>}><Text c="dimmed">The body is a stack with medium gaps.</Text></Panel>
    <Panel title="Results" description="Flush: the table meets the edge" actions={<Badge color="gray">3 results</Badge>} flush>
      <Table><Table.Thead><Table.Tr><Table.Th>Run</Table.Th><Table.Th>Outcome</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>{['Nightly review, 14 October', 'Nightly review, 13 October', 'Nightly review, 12 October'].map((run, index) => <Table.Tr key={run}><Table.Td>{run}</Table.Td><Table.Td><Group gap="xs"><StatusMark status={index === 0 ? 'failed' : 'passed'} /><Text>{index === 0 ? 'Failed' : 'Passed'}</Text></Group></Table.Td></Table.Tr>)}</Table.Tbody>
      </Table>
    </Panel>
    <SimpleGrid cols={{ base: 1, sm: 2 }}>
      <Panel title="A nested heading" order={3}><Text c="dimmed">Order 3 inside another section.</Text></Panel>
      <Panel><Text c="dimmed">A panel without a heading is a plain card.</Text></Panel>
    </SimpleGrid>
  </Stack>
) } };
export const Metrics: Story = { args: { title: 'Metric', description: 'One figure with its label above and what qualifies it below. A figure is never shown without its label.', children: (
  <SimpleGrid cols={{ base: 2, md: 4 }}>
    <Metric label="Tests" value="26" detail="in 9 specs" />
    <Metric label="Failing" value="7" detail="2 new since the last run" />
    <Metric label="Reliability" value="83%" detail="5 of 6 independent executions" />
    <Metric label="Screen ready" value="590 ms" detail="budget 800 ms"><Badge color="green">Within budget</Badge></Metric>
  </SimpleGrid>
) } };
export const StatusMarks: Story = { args: { title: 'Status marks', description: 'An outcome is a mark and a word, never color alone. Unknown and missing stay gray.', children: (
  <Stack gap="md">
    <Panel title="StatusMark" description="Recorded outcomes of a check or spec">
      <Group gap="xl">{MARKS.map((status) => <Group key={status} gap="xs"><StatusMark status={status} /><Text>{status}</Text></Group>)}</Group>
      <Group gap="xl" align="center">{[12, 16, 20, 28].map((size) => <Group key={size} gap="xs"><StatusMark status="passed" size={size} /><StatusMark status="failed" size={size} /><Text c="dimmed">{size}px</Text></Group>)}</Group>
    </Panel>
    <Panel title="StatusBadge and StatusDot" description="Statechart items">
      <Group>{ITEMS.map((status) => <StatusBadge key={status} status={status} />)}</Group>
      <Group gap="xl">{ITEMS.map((status) => <Group key={status} gap={6}><StatusDot status={status} /><Text>{status}</Text></Group>)}</Group>
    </Panel>
  </Stack>
) } };
