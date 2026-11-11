import { Box, Card, Skeleton, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import { IconSitemap } from '@tabler/icons-react';
import { Navigate, useLocation, useSearch } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useAtlas } from '../app/atlas-context';
import type { AtlasView } from '../data/model';
function openingPlace(view: AtlasView) {
  const screens = [...view.states.values()].filter((state) => state.kind === 'screen' || state.kind === 'final');
  const withFailedEvent = screens.find((state) => state.outgoing.some((id) => view.transitions.get(id)?.status === 'failed'));
  return withFailedEvent ?? screens.find((state) => state.status === 'failed') ?? screens[0] ?? null;
}
/** A page that has nothing to show: an icon, what happened as the page's heading, one sentence and one way on. */
export function CalmState({ icon, title, children, action }: { icon: ReactNode; title: ReactNode; children?: ReactNode; action?: ReactNode }) {
  return (
    <Card component="article">
      <Stack align="center" gap="sm" py={{ base: 'xl', sm: 64 }} ta="center">
        <ThemeIcon variant="light" color="gray" size={48} radius="xl">
          {icon}
        </ThemeIcon>
        <Title order={1}>{title}</Title>
        {children && (
          <Text component="div" c="dimmed" maw={440}>
            {children}
          </Text>
        )}
        {action && <Box mt="xs">{action}</Box>}
      </Stack>
    </Card>
  );
}
/** The spec is still being read: rows shaped like a page, with the words a screen reader announces. */
export function SpecLoading() {
  return (
    <Card component="article">
      <Stack gap="md">
        <Text role="status" c="dimmed">
          Loading the spec…
        </Text>
        <Skeleton height={20} w="40%" animate={false} />
        <Skeleton height={12} w="70%" animate={false} />
        <Skeleton height={220} animate={false} />
      </Stack>
    </Card>
  );
}
export function ProductPage() {
  const { view } = useAtlas();
  const search = useSearch({ strict: false });
  const location = useLocation();
  const run = typeof search.run === 'string' ? search.run : undefined;
  // The previous outlet can render briefly during navigation; only the actual home may choose a chart.
  if (location.pathname !== '/' || location.search.view === 'tests') return null;
  if (!view) return <SpecLoading />;
  const place = openingPlace(view);
  if (!place) {
    return (
      <CalmState icon={<IconSitemap size={24} aria-hidden="true" />} title={view.title}>
        This spec has no screens yet.
      </CalmState>
    );
  }
  return (
    <Navigate to="/chart/$chartId" params={{ chartId: place.chartId }} search={{ ...(run ? { run } : {}), screen: place.name }} replace />
  );
}
