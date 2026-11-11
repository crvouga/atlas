/**
 * @module Page compositions
 *
 * The three shapes every screen is built from, so pages read alike: a page heading with its actions, a titled
 * panel (a card with a heading row and its controls), and a figure tile. They hold no behavior.
 */
import { Box, Card, Group, Stack, Text, Title } from '@mantine/core';
import type { ReactNode } from 'react';

/** The heading of a page: an optional line above the title (a path, a way back), the title, one sentence, and actions on the right. */
export function PageHeader({ title, description, eyebrow, mark, actions, children }: {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  /** A status mark or notation logo beside the title. */
  mark?: ReactNode;
  actions?: ReactNode;
  /** Shown under the description: metadata, a meter, tabs. */
  children?: ReactNode;
}) {
  return (
    <Stack gap="sm">
      <Group justify="space-between" align="flex-start" gap="md">
        <Stack gap={4} flex={1} miw={{ base: '100%', sm: 280 }}>
          {eyebrow}
          <Group gap="xs" wrap="nowrap" align="center">
            {mark}
            <Title order={1}>{title}</Title>
          </Group>
          {description && (typeof description === 'string' ? <Text c="dimmed" maw={720}>{description}</Text> : description)}
        </Stack>
        {actions && <Group gap="xs">{actions}</Group>}
      </Group>
      {children}
    </Stack>
  );
}

/** A card with a heading row. `flush` removes the body padding for a table or a list that meets the card's edges. */
export function Panel({ title, description, actions, order = 2, flush, children, ...rest }: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  order?: 2 | 3;
  flush?: boolean;
  children?: ReactNode;
  id?: string;
  'aria-label'?: string;
  component?: 'section' | 'div';
}) {
  const head = (title || actions) && (
    <Group justify="space-between" align="flex-start" gap="sm">
      <Stack gap={2} flex={1} miw={200}>
        {title && <Title order={order}>{title}</Title>}
        {description && (typeof description === 'string' ? <Text c="dimmed">{description}</Text> : description)}
      </Stack>
      {actions && <Group gap="xs">{actions}</Group>}
    </Group>
  );
  if (flush)
    return (
      <Card padding={0} {...rest}>
        {head && <Box p="lg" pb="sm">{head}</Box>}
        {children}
      </Card>
    );
  return (
    <Card {...rest}>
      <Stack gap="md">
        {head}
        {children}
      </Stack>
    </Card>
  );
}

/** One figure with its label above and what qualifies it below. A figure is never shown without its label. */
export function Metric({ label, value, detail, children }: { label: ReactNode; value: ReactNode; detail?: ReactNode; children?: ReactNode }) {
  return (
    <Card padding="md">
      <Stack gap={4}>
        <Text size="xs" c="dimmed" fw={500}>{label}</Text>
        <Text size="xl" fw={600} lh={1.2}>{value}</Text>
        {detail && (typeof detail === 'string' ? <Text size="xs" c="dimmed">{detail}</Text> : detail)}
        {children}
      </Stack>
    </Card>
  );
}
