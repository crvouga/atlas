import { Badge, Box, NavLink, Stack, Text, Title, VisuallyHidden } from '@mantine/core';
import { IconRoute } from '@tabler/icons-react';
import { Link, useParams, useSearch } from '@tanstack/react-router';
import { StatusDot } from '../components/Status';
import { STATUS_LABEL, type AtlasView, type ItemStatus, type StateView } from '../data/model';
import { statusColor } from '../ui/theme';
import { useAtlas } from './atlas-context';
function openingScreen(view: AtlasView, steps: readonly { transitionIds: readonly string[] }[]) {
  for (const step of steps) {
    const transition = view.transitions.get(step.transitionIds[0] ?? '');
    const landing = transition?.target ? view.states.get(transition.target) : undefined;
    if (landing && (landing.kind === 'screen' || landing.kind === 'final')) return landing;
  }
  return undefined;
}
function screensOf(view: AtlasView, chartId: string) {
  return (view.charts.get(chartId)?.states ?? [])
    .map((key) => view.states.get(key))
    .filter((state): state is StateView => !!state && (state.kind === 'screen' || state.kind === 'final'));
}
/** The status of a row in words: a badge when a run has said something, and screen-reader text for the quiet default. */
function RowStatus({ status }: { status: ItemStatus }) {
  if (status === 'spec-only') return <VisuallyHidden>{STATUS_LABEL[status]}</VisuallyHidden>;
  return (
    <Badge color={statusColor(status)} size="sm">
      {STATUS_LABEL[status]}
    </Badge>
  );
}
function GroupLabel({ children }: { children: string }) {
  return (
    <Text size="xs" fw={500} c="dimmed" px="sm">
      {children}
    </Text>
  );
}
export function Gazetteer() {
  const { view } = useAtlas();
  const params = useParams({ strict: false });
  const search = useSearch({ strict: false });
  const screen = typeof search.screen === 'string' ? search.screen : undefined;
  const journeyId = typeof search.journey === 'string' ? search.journey : undefined;
  const group = typeof search.group === 'string' ? search.group : undefined;
  const journeys = (view?.journeys ?? []).filter((journey) => journey.chartIds.length > 0);
  return (
    <Box component="nav" aria-label="Places">
      <Stack gap="md">
        <Title order={2} px="sm" pt="xs">
          Places
        </Title>
        {!view && (
          <Text c="dimmed" px="sm" pb="xs">
            Loading the spec…
          </Text>
        )}
        {view?.contexts.map((context) => (
          <Stack key={context.id} gap={4}>
            <GroupLabel>{context.name}</GroupLabel>
            {context.chartIds.map((chartId) => {
              const chart = view.charts.get(chartId);
              if (!chart) return null;
              return (
                <Stack key={chartId} gap={2} mb="xs">
                  <NavLink
                    label={chart.name}
                    fw={600}
                    py={6}
                    active={params.chartId === chartId && !screen && !journeyId && !group}
                    renderRoot={(props) => (
                      <Link
                        {...props}
                        to="/chart/$chartId"
                        params={{ chartId }}
                        search={(prev) => ({ run: prev.run, screen: undefined, journey: undefined, group: undefined })}
                      />
                    )}
                  />
                  {screensOf(view, chartId).map((state) => (
                    <NavLink
                      key={state.key}
                      label={state.name}
                      py={6}
                      active={params.chartId === chartId && screen === state.name}
                      aria-current={params.chartId === chartId && screen === state.name ? 'page' : undefined}
                      leftSection={<StatusDot status={state.status} />}
                      rightSection={<RowStatus status={state.status} />}
                      renderRoot={(props) => (
                        <Link
                          {...props}
                          to="/chart/$chartId"
                          params={{ chartId }}
                          search={(prev) => ({ run: prev.run, screen: state.name, journey: prev.journey })}
                        />
                      )}
                    />
                  ))}
                </Stack>
              );
            })}
          </Stack>
        ))}
        {journeys.length > 0 && (
          <Stack gap={4}>
            <Title order={3} px="sm" fz="xs" fw={500} c="dimmed">
              Journeys
            </Title>
            {journeys.map((journey) => {
              const chartId = journey.chartIds[0]!;
              const start = view && openingScreen(view, journey.steps);
              return (
                <NavLink
                  key={journey.id}
                  label={journey.name}
                  py={6}
                  active={journeyId === journey.id}
                  leftSection={<IconRoute size={16} aria-hidden="true" />}
                  rightSection={<RowStatus status={journey.status} />}
                  renderRoot={(props) => (
                    <Link
                      {...props}
                      to="/chart/$chartId"
                      params={{ chartId }}
                      search={(prev) => ({ run: prev.run, journey: journey.id, screen: start?.name })}
                    />
                  )}
                />
              );
            })}
          </Stack>
        )}
        {!!view?.excluded.length && (
          <Stack gap={4} pb="xs">
            <Title order={3} px="sm" fz="xs" fw={500} c="dimmed">
              Not in the spec yet
            </Title>
            {view.excluded.map((item) => (
              <Text key={item} c="dimmed" px="sm">
                {item}
              </Text>
            ))}
          </Stack>
        )}
      </Stack>
    </Box>
  );
}
