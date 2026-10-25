import { Badge, Box, Divider, NavLink, Stack, Text, Title } from '@mantine/core';
import { Link, useParams, useSearch } from '@tanstack/react-router';
import { STATUS_LABEL, type AtlasView, type StateView } from '../data/model';
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
export function Gazetteer() {
  const { view } = useAtlas();
  const params = useParams({ strict: false });
  const search = useSearch({ strict: false });
  const screen = typeof search.screen === 'string' ? search.screen : undefined;
  const journeyId = typeof search.journey === 'string' ? search.journey : undefined;
  const group = typeof search.group === 'string' ? search.group : undefined;
  const journeys = (view?.journeys ?? []).filter((journey) => journey.chartIds.length > 0);
  return (
    <Box component="nav" aria-label="Places" p="md">
      <Stack gap="lg">
        <Title order={2}>Places</Title>
        {!view && <Text c="dimmed">Loading the spec…</Text>}
        {view?.contexts.map((context) => (
          <Stack key={context.id} gap="xs">
            <Text size="xs" fw={600} c="dimmed">
              {context.name}
            </Text>
            {context.chartIds.map((chartId) => {
              const chart = view.charts.get(chartId);
              if (!chart) return null;
              return (
                <Box key={chartId}>
                  <NavLink
                    label={chart.name}
                    fw={600}
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
                      active={params.chartId === chartId && screen === state.name}
                      aria-current={params.chartId === chartId && screen === state.name ? 'page' : undefined}
                      rightSection={
                        <Badge color={statusColor(state.status)} size="xs">
                          {STATUS_LABEL[state.status]}
                        </Badge>
                      }
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
                </Box>
              );
            })}
          </Stack>
        ))}
        {journeys.length > 0 && (
          <Stack gap="xs">
            <Divider />
            <Title order={3}>Journeys</Title>
            {journeys.map((journey) => {
              const chartId = journey.chartIds[0]!;
              const start = view && openingScreen(view, journey.steps);
              return (
                <NavLink
                  key={journey.id}
                  label={journey.name}
                  active={journeyId === journey.id}
                  rightSection={
                    <Badge size="xs" color={statusColor(journey.status)}>
                      {STATUS_LABEL[journey.status]}
                    </Badge>
                  }
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
          <Stack gap="xs">
            <Title order={3}>Not in the spec yet</Title>
            {view.excluded.map((item) => (
              <Text key={item} c="dimmed">
                {item}
              </Text>
            ))}
          </Stack>
        )}
      </Stack>
    </Box>
  );
}
