import type { Meta, StoryObj } from '@storybook/react-vite';
import { Accordion, Alert, Anchor, Badge, Button, Card, Divider, Group, Loader, Progress, SimpleGrid, Skeleton, Stack, Table, Tabs, Text, ThemeIcon, Title } from '@mantine/core';
import { IconAlertTriangle, IconInfoCircle, IconMovieOff, IconVideo } from '@tabler/icons-react';
import { Panel } from '../src/components/Page';
import { statusColor } from '../src/ui/theme';
import { Sheet } from './foundations';
const meta = { title: 'Foundations/Data display', component: Sheet } satisfies Meta<typeof Sheet>;
export default meta;
type Story = StoryObj<typeof meta>;
const ROWS = [
  ['Opens the menu', 'passed', 'Desktop web', 'c0ffee1', '3.6 s'],
  ['Adds a drink', 'flaky', 'Desktop web', 'c0ffee1', '4.3 s'],
  ['Pays at the counter', 'failed', 'Desktop web', 'c0ffee1', '5.0 s'],
  ['Shares a receipt', 'running', 'Mobile web', 'c0ffee1', '—'],
  ['Refunds an order', 'not-run', 'Desktop web', 'a11ce00', '—']
] as const;
export const Badges: Story = { args: { title: 'Badges', description: 'Light by default, sentence case. A count is quiet; an outcome takes its color from statusColor and always carries its word.', children: (
  <Stack gap="md">
    <Panel title="Outcomes"><Group>{['passed', 'failed', 'flaky', 'running', 'not-run'].map((status) => <Badge key={status} color={statusColor(status)}>{status}</Badge>)}</Group></Panel>
    <Panel title="Variants and sizes">
      <Group>{(['light', 'filled', 'outline', 'default', 'dot'] as const).map((variant) => <Badge key={variant} variant={variant}>{variant}</Badge>)}</Group>
      <Group align="center">{(['xs', 'sm', 'md', 'lg'] as const).map((size) => <Badge key={size} size={size} color="gray">{size} · 12 layers</Badge>)}</Group>
      <Group><Badge color="gray" leftSection={<IconVideo size={12} aria-hidden="true" />}>4 recordings</Badge><Badge color="orange">2 off</Badge><Badge color="blue" role="status">Running review · 2 results</Badge><Badge color="green">Live</Badge></Group>
    </Panel>
  </Stack>
) } };
export const Cards: Story = { args: { title: 'Cards', description: 'A card is bordered with a large radius and a faint shadow. Selection is a fill, never a second border color alone.', children: (
  <SimpleGrid cols={{ base: 1, sm: 3 }}>
    <Card><Stack gap="xs"><Title order={3}>Default card</Title><Text c="dimmed">Padding lg, radius lg, shadow xs.</Text></Stack></Card>
    <Card bg="var(--mantine-color-primary-light)"><Stack gap="xs"><Title order={3}>Selected card</Title><Text c="dimmed">Filled with the primary light surface.</Text></Stack></Card>
    <Card padding="sm" shadow="none"><Stack gap="xs"><Title order={3}>Compact card</Title><Text c="dimmed">Padding sm, for a tile in a grid.</Text></Stack></Card>
  </SimpleGrid>
) } };
export const Tables: Story = { args: { title: 'Tables', description: 'Quiet small headers, tabular numbers, a hover fill, and a scroll container so a narrow screen scrolls the table instead of the page.', children: (
  <Panel title="Results" description="Five results of one run" flush>
    <Table.ScrollContainer minWidth={560}>
      <Table>
        <Table.Thead><Table.Tr><Table.Th>Test</Table.Th><Table.Th>Outcome</Table.Th><Table.Th>Environment</Table.Th><Table.Th>Commit</Table.Th><Table.Th ta="right">Duration</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {ROWS.map(([name, status, environment, commit, duration], index) => (
            <Table.Tr key={name} bg={index === 2 ? 'var(--mantine-color-primary-light)' : undefined} aria-selected={index === 2}>
              <Table.Td><Text fw={500}>{name}</Text></Table.Td>
              <Table.Td><Badge color={statusColor(status)}>{status}</Badge></Table.Td>
              <Table.Td>{environment}</Table.Td>
              <Table.Td><Text ff="monospace" size="xs">{commit}</Text></Table.Td>
              <Table.Td ta="right">{duration}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  </Panel>
) } };
export const TabsAndAccordion: Story = { args: { title: 'Tabs and accordion', description: 'Tabs switch between views of one thing. An accordion discloses detail that most readers skip.', children: (
  <Stack gap="md">
    <Panel title="Tabs">
      <Tabs defaultValue="read">
        <Tabs.List aria-label="How to review"><Tabs.Tab value="read">Read</Tabs.Tab><Tabs.Tab value="watch" leftSection={<IconVideo size={16} aria-hidden="true" />}>Watch</Tabs.Tab><Tabs.Tab value="inspect">Inspect</Tabs.Tab><Tabs.Tab value="off" disabled>Unavailable</Tabs.Tab></Tabs.List>
        <Tabs.Panel value="read" pt="md"><Text>The scenario as it was written.</Text></Tabs.Panel>
        <Tabs.Panel value="watch" pt="md"><Text>The recording of the newest run.</Text></Tabs.Panel>
        <Tabs.Panel value="inspect" pt="md"><Text>Every result that was recorded.</Text></Tabs.Panel>
      </Tabs>
      <Tabs defaultValue="promise" variant="pills">
        <Tabs.List aria-label="What to compare"><Tabs.Tab value="promise">Promise</Tabs.Tab><Tabs.Tab value="outcome">Outcomes</Tabs.Tab><Tabs.Tab value="recording">Recordings</Tabs.Tab></Tabs.List>
      </Tabs>
    </Panel>
    <Panel title="Accordion">
      <Accordion defaultValue="scope">
        <Accordion.Item value="scope"><Accordion.Control>What this recording shows</Accordion.Control><Accordion.Panel><Text c="dimmed">A desktop browser with scripted dependencies and synthetic data. Silent.</Text></Accordion.Panel></Accordion.Item>
        <Accordion.Item value="json"><Accordion.Control>Edit configuration as JSON</Accordion.Control><Accordion.Panel><Text c="dimmed">Closed until someone needs it.</Text></Accordion.Panel></Accordion.Item>
        <Accordion.Item value="off"><Accordion.Control disabled>Earlier runs</Accordion.Control><Accordion.Panel>None.</Accordion.Panel></Accordion.Item>
      </Accordion>
    </Panel>
  </Stack>
) } };
export const Alerts: Story = { args: { title: 'Alerts', description: 'An alert says what happened, what it means and what to do. Red is for a failure, orange for evidence that may be out of date.', children: (
  <Stack gap="md">
    <Alert color="red" title="The page couldn’t be loaded" icon={<IconAlertTriangle size={18} aria-hidden="true" />}><Stack gap="sm" align="flex-start"><Text>The reports store is unavailable. Configure a reports storage adapter or read credential.</Text><Button>Try again</Button></Stack></Alert>
    <Alert color="orange" title="Collection status may be out of date">The last refresh failed. <Anchor component="button" type="button">Try again</Anchor></Alert>
    <Alert color="blue" title="Preview finished" icon={<IconInfoCircle size={18} aria-hidden="true" />}>Nothing was deleted.</Alert>
    <Alert color="green" title="Saved">Restart Atlas to apply.</Alert>
    <Alert color="gray" role="status">The same commit is on both sides.</Alert>
  </Stack>
) } };
export const EmptyAndLoading: Story = { args: { title: 'Empty and loading', description: 'An empty state is centered in its panel: an icon, a short title, one sentence, one action. Loading keeps the shape of what is coming.', children: (
  <SimpleGrid cols={{ base: 1, md: 2 }}>
    <Panel title="Recordings">
      <Stack align="center" gap="xs" py="xl">
        <ThemeIcon variant="light" color="gray" size={44} radius="xl"><IconMovieOff size={24} aria-hidden="true" /></ThemeIcon>
        <Title order={3}>No recordings yet</Title>
        <Text c="dimmed" ta="center" maw={320}>Publish a run with videos and they appear here.</Text>
        <Button>How to publish</Button>
      </Stack>
    </Panel>
    <Panel title="Results">
      <Stack gap="sm" role="status" aria-label="Loading results">
        {[92, 84, 88, 70].map((width) => <Group key={width} wrap="nowrap"><Skeleton h={16} w={16} circle /><Skeleton h={14} w={`${width}%`} /></Group>)}
        <Divider />
        <Group gap="xs"><Loader size="sm" /><Text c="dimmed">Loading results…</Text></Group>
        <Progress.Root size="sm" aria-label="2 of 4 results"><Progress.Section value={50} color="blue" /></Progress.Root>
      </Stack>
    </Panel>
  </SimpleGrid>
) } };
