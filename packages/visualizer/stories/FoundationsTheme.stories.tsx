import type { Meta, StoryObj } from '@storybook/react-vite';
import { Box, Card, Code, ColorSwatch, Divider, Group, Kbd, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { GROUND, statusColor } from '../src/ui/theme';
import { Sheet } from './foundations';
const meta = { title: 'Foundations/Theme', component: Sheet } satisfies Meta<typeof Sheet>;
export default meta;
type Story = StoryObj<typeof meta>;
const SURFACES = [
  ['Page ground', GROUND, 'Behind every card'],
  ['Body', 'var(--mantine-color-body)', 'Cards, menus, dialogs'],
  ['Hover', 'var(--mantine-color-default-hover)', 'A row or control under the pointer'],
  ['Selected', 'var(--mantine-color-primary-light)', 'The selected row or chip'],
  ['Border', 'var(--mantine-color-default-border)', 'Rules and card edges'],
  ['Primary', 'var(--mantine-color-primary-filled)', 'The one primary action']
] as const;
const TEXTS = [['Text', 'var(--mantine-color-text)'], ['Dimmed', 'var(--mantine-color-dimmed)'], ['Link', 'var(--mantine-color-anchor)'], ['Error', 'var(--mantine-color-error)']] as const;
const OUTCOMES = ['passed', 'failed', 'flaky', 'running', 'not-run', 'none', 'unknown'];
const SCALES = ['gray', 'dark', 'green', 'red', 'orange', 'blue', 'yellow'];
export const Surfaces: Story = { args: { title: 'Surfaces', description: 'The neutral surfaces of both color schemes. Switch the scheme in the toolbar.', children: (
  <Stack gap="lg">
    <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }}>
      {SURFACES.map(([name, value, use]) => (
        <Card key={name} padding="sm">
          <Group wrap="nowrap">
            <Box w={56} h={56} bg={value} bd="1px solid var(--mantine-color-default-border)" bdrs="md" flex="none" />
            <Stack gap={2}><Text fw={600}>{name}</Text><Text c="dimmed" size="xs">{use}</Text><Code>{value}</Code></Stack>
          </Group>
        </Card>
      ))}
    </SimpleGrid>
    <Group gap="xl">{TEXTS.map(([name, value]) => <Text key={name} c={value} fw={500}>{name} <Code>{value}</Code></Text>)}</Group>
  </Stack>
) } };
export const OutcomeColors: Story = { args: { title: 'Outcome colors', description: 'Color is reserved for outcomes and comes from statusColor alone. An unknown outcome stays gray; it is never shown as passed.', children: (
  <SimpleGrid cols={{ base: 2, sm: 4, lg: 7 }}>
    {OUTCOMES.map((status) => (
      <Card key={status} padding="sm">
        <Stack gap="xs" align="flex-start">
          <Group gap="xs">
            <ColorSwatch color={`var(--mantine-color-${statusColor(status)}-filled)`} size={20} />
            <ColorSwatch color={`var(--mantine-color-${statusColor(status)}-light)`} size={20} />
          </Group>
          <Text fw={600}>{status}</Text>
          <Code>{statusColor(status)}</Code>
        </Stack>
      </Card>
    ))}
  </SimpleGrid>
) } };
export const ColorScales: Story = { args: { title: 'Color scales', description: 'The ten shades of each family the theme defines or adjusts for contrast.', children: (
  <Stack gap="sm">
    {SCALES.map((name) => (
      <Group key={name} gap="xs" wrap="nowrap">
        <Text w={64} fw={500}>{name}</Text>
        {Array.from({ length: 10 }, (_, shade) => <Box key={shade} flex={1} h={36} bg={`${name}.${shade}`} bdrs="sm" title={`${name}.${shade}`} />)}
      </Group>
    ))}
  </Stack>
) } };
export const Typography: Story = { args: { title: 'Typography', description: 'One page title, one title per panel, small text everywhere else. Monospace only for paths, commits and code.', children: (
  <Stack gap="md">
    <Title order={1}>Page title, order 1</Title>
    <Title order={2}>Panel title, order 2</Title>
    <Title order={3}>Section title, order 3</Title>
    <Divider />
    {(['xl', 'lg', 'md', 'sm', 'xs'] as const).map((size) => <Text key={size} size={size}>Text {size}: a customer pays by card and the barista starts the drink.</Text>)}
    <Text c="dimmed">Dimmed text explains; it never carries the outcome.</Text>
    <Text fw={600}>Semibold text names a thing.</Text>
    <Group gap="xs"><Code>specs/coffee/ordering/ordering.feature</Code><Code>c0ffee1</Code><Kbd>⌘K</Kbd></Group>
  </Stack>
) } };
export const SpacingAndRadius: Story = { args: { title: 'Spacing and radius', description: 'The spacing steps between elements and the corner radii of controls and cards.', children: (
  <Stack gap="lg">
    <Group align="flex-end">{(['xs', 'sm', 'md', 'lg', 'xl'] as const).map((size) => <Stack key={size} gap={4} align="center"><Box w={`var(--mantine-spacing-${size})`} h={`var(--mantine-spacing-${size})`} bg="var(--mantine-color-primary-filled)" /><Text size="xs">{size}</Text></Stack>)}</Group>
    <Group>{(['xs', 'sm', 'md', 'lg', 'xl'] as const).map((size) => <Stack key={size} gap={4} align="center"><Box w={64} h={48} bd="1px solid var(--mantine-color-default-border)" bg="var(--mantine-color-body)" bdrs={size} /><Text size="xs">{size}</Text></Stack>)}</Group>
    <Group>{(['xs', 'sm'] as const).map((shadow) => <Card key={shadow} shadow={shadow} w={160}><Text>Shadow {shadow}</Text></Card>)}</Group>
  </Stack>
) } };
