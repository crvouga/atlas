import { Anchor, Container, Flex, Stack, Text, Title } from '@mantine/core';
import { Link, useParams, useSearch } from '@tanstack/react-router';
import { useAtlas } from '../app/atlas-context';
import { mapFrame } from '../layout/graph';
import { ChartMap } from '../map/ChartMap';
import { ChartTests } from './ChartTests';
import { ChartSource } from '../evidence/chart-source';
import { SidePanel } from './SidePanel';
export function ChartPage() {
  const { chartId } = useParams({ from: '/chart/$chartId' });
  const search = useSearch({ from: '/chart/$chartId' });
  const { view } = useAtlas();
  if (!view)
    return (
      <Container role="status" component="article" size="xl" w="100%" py="xl">
        Loading the spec…
      </Container>
    );
  if (!view.charts.has(chartId)) {
    return (
      <Container component="article" size="xl" w="100%" py="xl">
        <Title order={1} mb="sm">
          This chart isn’t in the spec
        </Title>
        <Text component="div" c="dimmed">
          It may have been renamed or removed since this link was shared.
        </Text>
        <Anchor renderRoot={(props) => <Link {...props} to="/" search={(prev) => ({ run: prev.run })} />}>Back to the product map</Anchor>
      </Container>
    );
  }
  const selection = { screen: search.screen, event: search.event, journey: search.journey };
  const open = Boolean(search.screen || search.event || search.journey);
  if (open) return <SidePanel view={view} chartId={chartId} selection={selection} />;
  const chart = view.charts.get(chartId)!;
  const frame = mapFrame(view, chartId, search.group ?? null);
  const homeFocus = mapFrame(view, chartId, null).focus;
  return (
    <Stack gap="sm" p="md">
      <Flex gap="xs" align="center" wrap="wrap">
        <Title order={1} mb="sm">
          {chart.name}
        </Title>
        {chart.description && <Text component="div">{chart.description}</Text>}
        {frame.focus && (
          <Text component="div">
            <Text span inherit>
              {frame.focus}
            </Text>
            {frame.wider && (
              <Anchor
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
              </Anchor>
            )}
          </Text>
        )}
      </Flex>
      <ChartSource file={chart.file} />
      <Stack gap="sm">
        <ChartMap key={`${chartId}:${search.group ?? ''}`} view={view} chartId={chartId} selection={selection} group={search.group} />
      </Stack>
      <ChartTests view={view} chartId={chartId} />
    </Stack>
  );
}
