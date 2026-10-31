import { isStatechartFile } from '@crvouga/atlas/schema';
import { Alert, Box, Burger, Button, Container, Group, AppShell as MantineAppShell, ScrollArea, Stack, Text } from '@mantine/core';
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
function Layout() {
  const [opened, setOpened] = useState(false);
  const location = useLocation();
  const catalog = location.pathname === '/catalog';
  useEffect(() => setOpened(false), [location.href]);
  return (
    <UiCatalogProvider enabled={location.pathname === '/catalog'}>
      <MantineAppShell header={{ height: 64 }} navbar={{ width: 288, breakpoint: 'md', collapsed: { mobile: catalog || !opened, desktop: catalog } }} padding={0}>
        <MantineAppShell.Header>
          <Group h="100%" px="md" gap="sm" wrap="nowrap">
            {!catalog && (
              <Burger
                aria-expanded={opened}
                aria-controls="atlas-navigation"
                opened={opened}
                onClick={() => setOpened((v) => !v)}
                hiddenFrom="md"
                size="sm"
                aria-label="Toggle navigation"
              />
            )}
            <Header />
          </Group>
        </MantineAppShell.Header>
        <MantineAppShell.Navbar id="atlas-navigation" component="div">
          <ScrollArea h="100%">
            <Index />
          </ScrollArea>
        </MantineAppShell.Navbar>
        <MantineAppShell.Main tabIndex={-1} id="atlas-main-content">
          <Body />
        </MantineAppShell.Main>
        <SourcesPanel />
        <Suspense fallback={null}>
          <Finder />
        </Suspense>
      </MantineAppShell>
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
