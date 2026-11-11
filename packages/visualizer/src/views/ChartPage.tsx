import { Button, Card, Group, Stack, Text, Title } from '@mantine/core';
import { IconArrowLeft, IconArrowsMaximize, IconMapOff } from '@tabler/icons-react';
import { Link, useParams, useSearch } from '@tanstack/react-router';
import { useAtlas } from '../app/atlas-context';
import { PageHeader } from '../components/Page';
import { mapFrame } from '../layout/graph';
import { ChartMap } from '../map/ChartMap';
import { ChartTests } from './ChartTests';
import { ChartSource } from '../evidence/chart-source';
import { CalmState, SpecLoading } from './ProductPage';
import { SidePanel } from './SidePanel';
export function ChartPage() {
  const { chartId } = useParams({ from: '/chart/$chartId' });
  const search = useSearch({ from: '/chart/$chartId' });
  const { view } = useAtlas();
  if (!view) return <SpecLoading />;
  if (!view.charts.has(chartId)) {
    return (
      <CalmState
        icon={<IconMapOff size={24} aria-hidden="true" />}
        title="This chart isn’t in the spec"
        action={
          <Button
            leftSection={<IconArrowLeft size={16} aria-hidden="true" />}
            renderRoot={(props) => <Link {...props} to="/" search={(prev) => ({ run: prev.run })} />}
          >
            Back to the product map
          </Button>
        }
      >
        It may have been renamed or removed since this link was shared.
      </CalmState>
    );
  }
  const selection = { screen: search.screen, event: search.event, journey: search.journey };
  const open = Boolean(search.screen || search.event || search.journey);
  if (open) return <SidePanel view={view} chartId={chartId} selection={selection} />;
  const chart = view.charts.get(chartId)!;
  const frame = mapFrame(view, chartId, search.group ?? null);
  const homeFocus = mapFrame(view, chartId, null).focus;
  return (
    <Stack gap="md">
      <PageHeader
        title={chart.name}
        description={chart.description || undefined}
        eyebrow={
          <Text size="xs" c="dimmed" fw={500}>
            Statechart
          </Text>
        }
      />
      {/* The map meets the card's edges. `p={0}` also clears the padding Paper's theme default gives a Card. */}
      <Card p={0} component="section" aria-label="Map">
        <Group justify="space-between" align="flex-start" gap="sm" p="lg" pb="md">
          <Stack gap={2} flex={1} miw={200}>
            <Title order={2}>Map</Title>
            <Text c="dimmed">
              {frame.focus && (
                <>
                  Showing{' '}
                  <Text span inherit fw={600} c="var(--mantine-color-text)">
                    {frame.focus}
                  </Text>
                  .{' '}
                </>
              )}
              Choose a screen or an event to open it.
            </Text>
          </Stack>
          {frame.focus && frame.wider && (
            <Button
              size="xs"
              leftSection={<IconArrowsMaximize size={14} aria-hidden="true" />}
              renderRoot={(props) => (
                <Link
                  {...props}
                  to="/chart/$chartId"
                  params={{ chartId }}
                  search={(prev) => ({ run: prev.run, group: frame.wider && frame.wider !== homeFocus ? frame.wider : undefined })}
                />
              )}
            >
              Wider map
            </Button>
          )}
        </Group>
        <ChartMap key={`${chartId}:${search.group ?? ''}`} view={view} chartId={chartId} selection={selection} group={search.group} />
      </Card>
      <ChartTests view={view} chartId={chartId} />
      <ChartSource file={chart.file} />
    </Stack>
  );
}
