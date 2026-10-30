import { SpecLogo } from './SpecLogo';
import { IconDots, IconLayoutGrid, IconListSearch, IconSparkles } from '@tabler/icons-react';
import { isUiKind } from '@crvouga/atlas/reports/ui-state';
import { isStatechartFile } from '@crvouga/atlas/schema';
import { ActionIcon, Anchor, Badge, Box, Button, Group, Menu, NativeSelect, Popover, Stack, Tooltip } from '@mantine/core';
import { Link, useLocation, useNavigate, useSearch } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useAtlas } from '../app/atlas-context';
import type { AtlasView } from '../data/model';
import { LATEST } from '../data/queries';
import { useEvidence } from '../evidence/evidence-context';
import { plural } from '../evidence/format';
import { excludedCount } from '../evidence/sources-panel';
import { setFinderOpen } from '../find/open';
import { useLiveStatus } from '../live/live-stream';
import { currentProject, runtimeConfig } from '../runtime';
import { kindOfAddress, outlinePath, SPEC_KINDS } from '../spec-kind';
import { useUiStore } from '../state/ui-store';
import { ActivityIndicator } from './ActivityIndicator';
import { DataIssues } from './DataIssues';
import { IconChevronDown as ChevronDownIcon, IconSearch as SearchIcon } from '@tabler/icons-react';
import { ProjectNotice, ProjectPicker } from './ProjectPicker';
const dateTime = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
export function formatRunTime(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'Unknown time' : dateTime.format(d);
}
/** The product's own name, without the subtitle a spec title may carry. */
export function productName(title: string | undefined) {
  return title?.split(/\s+[—–|-]\s+|:\s+/)[0]?.trim() || 'Atlas';
}
function RunPicker({ view }: { view: AtlasView }) {
  const search = useSearch({ strict: false });
  const navigate = useNavigate();
  const { latestRunId } = useAtlas();
  if (!view.runs.length) return null;
  const latest = view.runs.find((run) => run.id === latestRunId);
  return (
    <NativeSelect
      label="Run"
      value={search.run ?? LATEST}
      onChange={(event) =>
        void navigate({ to: '.', search: (prev) => ({ ...prev, run: event.target.value === LATEST ? undefined : event.target.value }) })
      }
    >
      <option value={LATEST}>Latest{latest ? ` · ${formatRunTime(latest.startedAt)}` : ''}</option>
      {view.runs.map((run) => (
        <option key={run.id} value={run.id} disabled={run.progress === 'running'}>
          {formatRunTime(run.startedAt)} ·{' '}
          {run.progress === 'running' ? 'still running' : run.mode === 'showcase' ? 'with videos' : 'quick check'}
        </option>
      ))}
    </NativeSelect>
  );
}
function runOnly(prev: { run?: unknown }) {
  return typeof prev.run === 'string' ? { run: prev.run } : {};
}
function LiveRuns() {
  const { active } = useEvidence();
  if (!active.length) return null;
  return (
    <Badge color="blue" variant="light" role="status">
      Running {active.length === 1 ? active[0]!.packageDir.split('/').at(-1) : plural(active.length, 'suite', 'suites')} ·{' '}
      {plural(
        active.reduce((n, run) => n + run.completed, 0),
        'result',
        'results'
      )}
    </Badge>
  );
}
function ServerConnection() {
  const status = useLiveStatus();
  if (status === 'off') return null;
  const label =
    status === 'live'
      ? 'Live updates connected'
      : status === 'connecting'
        ? 'Connecting to live updates'
        : 'Live updates disconnected; reconnecting';
  return (
    <Tooltip label={label}>
      <Badge size="sm" color={status === 'live' ? 'green' : 'gray'} role="status" aria-label={label}>
        {status === 'live' ? 'Live' : 'Connecting'}
      </Badge>
    </Tooltip>
  );
}
function SourcesButton({ onOpen }: { onOpen: () => void }) {
  const { layers, ready, unavailable, excluded } = useEvidence();
  const setOpen = useUiStore((s) => s.setSourcesOpen);
  if (!ready && !unavailable) return null;
  const off = excludedCount(excluded);
  return (
    <Button
      onClick={() => {
        onOpen();
        setOpen(true);
      }}
      rightSection={
        <Badge color={off ? 'orange' : 'gray'}>
          {unavailable ? 'unavailable' : off ? `${off} off` : plural(layers.length, 'layer', 'layers')}
        </Badge>
      }
    >
      Sources
    </Button>
  );
}
export function Header() {
  const { view } = useAtlas();
  const evidence = useEvidence();
  const { pathname, search } = useLocation();
  const testsOpen = pathname === '/' && search.view === 'tests';
  const kind = kindOfAddress(pathname);
  const product = productName(view?.title);
  const hasCharts = evidence.files.some(isStatechartFile);
  const sourcesOpen = useUiStore((s) => s.sourcesOpen);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const optionsTarget = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (sourcesOpen) setOptionsOpen(false);
  }, [sourcesOpen]);
  useEffect(() => {
    document.title = product;
  }, [product]);
  const tabs = useMemo(
    () =>
      SPEC_KINDS.map((entry) => {
        const files = evidence.files.filter(entry.accepts);
        return {
          kind: entry,
          files: files.length,
          running: files.some((file) => (evidence.view.specs.get(outlinePath(file))?.summary.counts.running ?? 0) > 0),
          failing: files.filter((file) => (evidence.view.specs.get(outlinePath(file))?.summary.counts.failed ?? 0) > 0).length
        };
      }).filter((tab) => tab.files > 0 || tab.kind === kind),
    [evidence.files, evidence.view, kind]
  );
  const project = currentProject();
  const catalogOpen = pathname === '/catalog';
  const critiquesOpen = pathname === '/critiques';
  const behaviorsOpen = pathname === '/behaviors';
  const hasFeatures = evidence.files.some(SPEC_KINDS[0]!.accepts);
  // The catalog is offered once the report holds a state or a plan for one.
  const hasCatalog = useMemo(() => evidence.evidence.some((layer) => layer.rows.some((row) => isUiKind(row.kind))), [evidence.evidence]);
  // Needs polish is offered once a critic has recorded an opinion.
  const hasCritiques = useMemo(() => evidence.evidence.some((layer) => layer.rows.some((row) => row.critique !== undefined)), [evidence.evidence]);
  return (
    <Group flex={1} miw={0} justify="space-between" wrap="nowrap" gap="xs">
      <Group gap="xs" wrap="nowrap" miw={0}>
        <Anchor fw={800} size="lg" underline="never" renderRoot={(props) => <Link {...props} to="/" search={(prev) => runOnly(prev)} />}>
          Atlas
        </Anchor>
        <Menu keepMounted position="bottom-start">
          <Menu.Target>
            <Button
              variant="subtle"
              aria-label="Spec type"
              leftSection={kind ? <SpecLogo kind={kind} /> : undefined}
              rightSection={<ChevronDownIcon aria-hidden="true" size={12} />}
            >
              {testsOpen ? 'Tests' : catalogOpen ? 'UI catalog' : critiquesOpen ? 'Needs polish' : behaviorsOpen ? 'Behaviors' : (kind?.label ?? (hasCharts ? 'Statecharts' : evidence.ready && !tabs.length ? 'Tests' : 'Specs'))}
            </Button>
          </Menu.Target>
          <Menu.Dropdown>
            <Box component="nav" aria-label="Spec type">
              <Menu.Item
                aria-current={pathname.startsWith('/specs/') || (testsOpen && hasCharts) || catalogOpen || behaviorsOpen || critiquesOpen ? undefined : 'page'}
                renderRoot={(props) => <Link {...props} to="/" search={(prev) => runOnly(prev)} />}
              >
                {hasCharts || !evidence.ready ? 'Statecharts' : 'Tests'}
              </Menu.Item>
              {hasCharts && (
                <Menu.Item
                  aria-current={testsOpen ? 'page' : undefined}
                  renderRoot={(props) => <Link {...props} to="/" search={{ view: 'tests' }} />}
                >
                  Tests
                </Menu.Item>
              )}
              {tabs.map((tab) => (
                <Menu.Item
                  key={tab.kind.id}
                  leftSection={<SpecLogo kind={tab.kind} />}
                  aria-current={tab.kind === kind ? 'page' : undefined}
                  rightSection={
                    tab.failing ? (
                      <Badge color="red">{tab.failing}</Badge>
                    ) : tab.running ? (
                      <ActivityIndicator label={`${tab.kind.label} tests running`} />
                    ) : undefined
                  }
                  renderRoot={(props) => <Link {...props} to="/specs/$kind" params={{ kind: tab.kind.id }} search={{}} />}
                >
                  {tab.kind.label}
                </Menu.Item>
              ))}
              {(hasFeatures || behaviorsOpen) && (
                <Menu.Item
                  leftSection={<IconListSearch size={16} aria-hidden="true" />}
                  aria-current={behaviorsOpen ? 'page' : undefined}
                  renderRoot={(props) => <Link {...props} to="/behaviors" search={{}} />}
                >
                  Behaviors
                </Menu.Item>
              )}
              {(hasCatalog || catalogOpen) && (
                <Menu.Item
                  leftSection={<IconLayoutGrid size={16} aria-hidden="true" />}
                  aria-current={catalogOpen ? 'page' : undefined}
                  renderRoot={(props) => <Link {...props} to="/catalog" search={{}} />}
                >
                  UI catalog
                </Menu.Item>
              )}
              {(hasCritiques || critiquesOpen) && (
                <Menu.Item
                  leftSection={<IconSparkles size={16} aria-hidden="true" />}
                  aria-current={critiquesOpen ? 'page' : undefined}
                  renderRoot={(props) => <Link {...props} to="/critiques" search={{}} />}
                >
                  Needs polish
                </Menu.Item>
              )}
            </Box>
          </Menu.Dropdown>
        </Menu>
        <Box visibleFrom="sm" miw={0}>
          <SpecBreadcrumb />
        </Box>
      </Group>
      <Group gap="xs" wrap="nowrap">
        <Box visibleFrom="sm">
          <ServerConnection />
        </Box>
        <Tooltip label="Search (⌘K / Ctrl+K)">
          <ActionIcon aria-label="Find a flow" aria-keyshortcuts="Meta+K Control+K" onClick={() => setFinderOpen(true)}>
            <SearchIcon aria-hidden="true" size={18} />
          </ActionIcon>
        </Tooltip>
        <Popover
          opened={optionsOpen && !sourcesOpen}
          onChange={setOptionsOpen}
          disabled={sourcesOpen}
          keepMounted
          position="bottom-end"
          width={320}
          trapFocus
        >
          <Popover.Target>
            <ActionIcon ref={optionsTarget} aria-label="View options" onClick={() => setOptionsOpen((open) => !open)}>
              <IconDots size={20} aria-hidden="true" />
            </ActionIcon>
          </Popover.Target>
          <Popover.Dropdown>
            <Stack gap="sm">
              {!kind && !testsOpen && view && <RunPicker view={view} />}
              <LiveRuns />
              <SourcesButton
                onOpen={() => {
                  setOptionsOpen(false);
                  // The drawer returns focus to this persistent trigger, not its disappearing Sources button.
                  optionsTarget.current?.focus();
                }}
              />
              {!kind && !testsOpen && view && <DataIssues issues={view.issues} />}
              {runtimeConfig()?.api && <Anchor href={`/admin${project ? `?project=${encodeURIComponent(project)}` : ''}`}>Settings</Anchor>}
              <ProjectNotice />
            </Stack>
          </Popover.Dropdown>
        </Popover>
        <ProjectPicker />
      </Group>
    </Group>
  );
}
function SpecBreadcrumb() {
  const evidence = useEvidence();
  const { view } = useAtlas();
  const { pathname, search: locationSearch } = useLocation();
  const search = useSearch({ strict: false });
  const navigate = useNavigate();
  const kind = kindOfAddress(pathname);
  const chart = pathname.startsWith('/chart/') ? decodeURIComponent(pathname.split('/')[2] ?? '') : null;
  const options = kind
    ? evidence.files.filter(kind.accepts).map((file) => ({
        id: file,
        name: evidence.titleOf(file),
        running: (evidence.view.specs.get(outlinePath(file))?.summary.counts.running ?? 0) > 0
      }))
    : [...(view?.charts.values() ?? [])].map((item) => ({
        id: item.id,
        name: item.name,
        running: (evidence.view.specs.get(outlinePath(item.file))?.summary.counts.running ?? 0) > 0
      }));
  if (!options.length || (pathname === '/' && locationSearch.view === 'tests') || pathname === '/catalog' || pathname === '/behaviors' || pathname === '/critiques') return null;
  return (
    <NativeSelect
      data-running={options.some((option) => option.running) || undefined}
      leftSection={options.some((option) => option.running) ? <ActivityIndicator label="Specs running" /> : undefined}
      aria-label="Spec"
      maw="20rem"
      value={kind ? (search.spec ?? '') : (chart ?? '')}
      onChange={(event) => {
        const value = event.target.value;
        if (kind) void navigate({ to: '/specs/$kind', params: { kind: kind.id }, search: value ? { spec: value } : {} });
        else if (value) void navigate({ to: '/chart/$chartId', params: { chartId: value }, search: {} });
        else void navigate({ to: '/', search: {} });
      }}
    >
      <option value="">All specs</option>
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.name}
          {option.running ? ' · Running' : ''}
        </option>
      ))}
    </NativeSelect>
  );
}
