import { Container, Text, Title } from '@mantine/core';
import { Navigate, useLocation, useSearch } from '@tanstack/react-router';
import { useAtlas } from '../app/atlas-context';
import type { AtlasView } from '../data/model';
function openingPlace(view: AtlasView) {
  const screens = [...view.states.values()].filter((state) => state.kind === 'screen' || state.kind === 'final');
  const withFailedEvent = screens.find((state) => state.outgoing.some((id) => view.transitions.get(id)?.status === 'failed'));
  return withFailedEvent ?? screens.find((state) => state.status === 'failed') ?? screens[0] ?? null;
}
export function ProductPage() {
  const { view } = useAtlas();
  const search = useSearch({ strict: false });
  const location = useLocation();
  const run = typeof search.run === 'string' ? search.run : undefined;
  // The previous outlet can render briefly during navigation; only the actual home may choose a chart.
  if (location.pathname !== '/' || location.search.view === 'tests') return null;
  if (!view)
    return (
      <Container role="status" component="article" size="xl" w="100%" py="xl">
        Loading the spec…
      </Container>
    );
  const place = openingPlace(view);
  if (!place) {
    return (
      <Container component="article" size="xl" w="100%" py="xl">
        <Title order={1} mb="sm">
          {view.title}
        </Title>
        <Text component="div" c="dimmed">
          This spec has no screens yet.
        </Text>
      </Container>
    );
  }
  return (
    <Navigate to="/chart/$chartId" params={{ chartId: place.chartId }} search={{ ...(run ? { run } : {}), screen: place.name }} replace />
  );
}
