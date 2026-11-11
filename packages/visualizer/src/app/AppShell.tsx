import { isStatechartFile } from '@crvouga/atlas/schema';
import { Alert, Box, Burger, Button, Container, Drawer, Flex, Group, Paper, ScrollArea, Stack, Text } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';
import { Outlet, useLocation, useSearch } from '@tanstack/react-router';
import { lazy, Suspense, useEffect, useState } from 'react';
import { UiCatalogProvider } from '../catalog/provider';
import { Header } from '../components/Header';
import { EvidenceProvider, useEvidence } from '../evidence/evidence-context';
import { SourcesPanel } from '../evidence/sources-panel';
import { SpecIndex } from '../evidence/spec-index';
import { Explorer } from '../explorer/Explorer';
import { ProjectIndex } from '../explorer/ExplorerIndex';
import { TestCatalogProvider } from '../explorer/catalog';
import { LiveRunsProvider } from '../live/live-runs';
import { kindOfAddress } from '../spec-kind';
import { GROUND } from '../ui/theme';
import { AtlasProvider, useAtlas } from './atlas-context';
import { Gazetteer } from './gazetteer';
const loadFinder = () => import('../find/Finder').then((m) => ({ default: m.Finder }));
const Finder = lazy(loadFinder);
if (typeof window !== 'undefined') setTimeout(() => void loadFinder(), 0);
function Index() {
  const evidence = useEvidence();
  const { pathname, search } = useLocation();
  const kind = kindOfAddress(pathname);
  if (pathname === '/catalog') return null;
  return pathname === '/critiques' ? (
    <Box component="nav" aria-label="Critiques" />
  ) : kind ? (
    <SpecIndex kind={kind} />
  ) : pathname.startsWith('/specs/') || pathname === '/behaviors' ? (
    <Box component="nav" aria-label="Specs" />
  ) : (pathname === '/' && search.view === 'tests') || (evidence.ready && !evidence.files.some(isStatechartFile)) ? (
    <ProjectIndex />
  ) : (
    <Gazetteer />
  );
}
function Body() {
  const evidence = useEvidence();
  const { view, spec } = useAtlas();
  const { pathname, search } = useLocation();
  if (pathname === '/' && (search.view === 'tests' || (evidence.ready && !evidence.filesPending && !evidence.files.some(isStatechartFile)))) return <Explorer />;
  if (!pathname.startsWith('/specs/') && pathname !== '/catalog' && pathname !== '/critiques' && pathname !== '/behaviors' && !view && spec.error)
    return (
      <Container py="xl">
        <Alert color="red" title="The spec couldn’t be loaded">
          <Stack gap="sm">
            <Text>{spec.error}</Text>
            <Button onClick={spec.retry}>Try again</Button>
          </Stack>
        </Alert>
      </Container>
    );
  return <Outlet />;
}
/** Which index accompanies the page: beside it on wide screens, or behind the Browse action. */
function useIndexPlacement() {
  const evidence = useEvidence();
  const { pathname, search } = useLocation();
  const none = pathname === '/catalog' || pathname === '/behaviors' || pathname === '/critiques';
  const tests = pathname === '/' && (search.view === 'tests' || (evidence.ready && !evidence.files.some(isStatechartFile)));
  return none ? 'none' : tests ? 'drawer' : 'beside';
}
function Layout() {
  const [opened, setOpened] = useState(false);
  const location = useLocation();
  const placement = useIndexPlacement();
  const wide = useMediaQuery('(min-width: 62em)', true, { getInitialValueInEffect: false });
  const beside = placement === 'beside' && wide;
  useEffect(() => setOpened(false), [location.href]);
  return (
    <UiCatalogProvider enabled={location.pathname === '/catalog'}>
      <Box bg={GROUND} mih="100dvh">
        <Container size={1480} px={{ base: 'sm', sm: 'md' }} py={{ base: 'sm', sm: 'md' }}>
          <Stack gap="md">
            <Paper component="header" withBorder shadow="xs" radius="lg" px="md" py="xs">
              <Group gap="sm" wrap="nowrap">
                {placement !== 'none' && !beside && (
                  <Burger
                    aria-expanded={opened}
                    aria-controls="atlas-navigation"
                    opened={opened}
                    onClick={() => setOpened((v) => !v)}
                    size="sm"
                    aria-label="Toggle navigation"
                  />
                )}
                <Header />
              </Group>
            </Paper>
            <Flex gap="md" align="flex-start">
              {beside && (
                <Paper id="atlas-navigation" withBorder shadow="xs" radius="lg" p="xs" w={300} flex="none" pos="sticky" top="var(--mantine-spacing-md)">
                  <ScrollArea.Autosize mah="calc(100dvh - 2 * var(--mantine-spacing-md) - 2 * var(--mantine-spacing-xs))" type="auto">
                    <Index />
                  </ScrollArea.Autosize>
                </Paper>
              )}
              <Box component="main" flex={1} miw={0} tabIndex={-1} id="atlas-main-content">
                <Body />
              </Box>
            </Flex>
          </Stack>
        </Container>
        {placement !== 'none' && !beside && (
          <Drawer id="atlas-navigation" opened={opened} onClose={() => setOpened(false)} position="left" size="sm" title="Browse" keepMounted withinPortal={false} closeButtonProps={{ 'aria-label': 'Close navigation' }}>
            <Index />
          </Drawer>
        )}
        <SourcesPanel />
        <Suspense fallback={null}>
          <Finder />
        </Suspense>
      </Box>
    </UiCatalogProvider>
  );
}
export function AppShell() {
  const { run } = useSearch({ strict: false });
  return (
    <LiveRunsProvider enabled={!run}>
      <AtlasProvider run={run}>
        <EvidenceProvider>
          <TestCatalogProvider>
            <Layout />
          </TestCatalogProvider>
        </EvidenceProvider>
      </AtlasProvider>
    </LiveRunsProvider>
  );
}
