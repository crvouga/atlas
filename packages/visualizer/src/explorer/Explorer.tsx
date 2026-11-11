import { SpecLogo } from '../components/SpecLogo';
import {
  IconAdjustmentsHorizontal,
  IconAlertTriangle,
  IconArrowRight,
  IconChevronDown,
  IconChevronRight,
  IconFilterOff,
  IconFlask,
  IconInbox,
  IconSearch,
  IconVideo,
  IconX
} from '@tabler/icons-react';
import {
  Accordion,
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Card,
  Divider,
  Drawer,
  Flex,
  Group,
  List,
  MultiSelect,
  NativeSelect,
  NavLink,
  SimpleGrid,
  Skeleton,
  Stack,
  Tabs,
  Text,
  TextInput,
  ThemeIcon,
  Title,
  VisuallyHidden
} from '@mantine/core';
/**
 * @module Test explorer
 *
 * The home of a project without statecharts: every test the report holds, found by searching and filtering, grouped
 * by spec (or domain, environment, status, producer), with what was recorded about each at a glance: where it ran and
 * how it went there, how long it takes, how often it passes, how many runs it was in. Above the list, the report in
 * numbers; beside it, the open test; in a second tab, the CI runs that produced the results.
 */
import type { CheckSlot } from '@crvouga/atlas/reports/evidence-view';
import { environmentLabel } from '@crvouga/atlas/reports/layer-axes';
import {
  durationStats,
  formatMs,
  matchesQuery,
  testCatalog,
  type CatalogModel,
  type TestQuery,
  type TestSummary
} from '@crvouga/atlas/reports/test-catalog';
import { Link } from '@tanstack/react-router';
import { useDeferredValue, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { Metric, PageHeader, Panel } from '../components/Page';
import { attentionRank, hasRelease, needsAttention, type Assessment, type ReleaseIdentity } from '../evidence/applicability';
import { ApplicabilityControls, VerdictBadge } from '../evidence/applicability-view';
import { staticEvidence } from '../evidence/api';
import { useEvidence } from '../evidence/evidence-context';
import { ago, plural, useNow } from '../evidence/format';
import { Meter, StatusMark } from '../evidence/marks';
import { SPEC_KINDS } from '../spec-kind';
import { behaviorDocs, behaviorId, describeHit, testHasVideo } from '../find/behaviors';
import { useDocSearch } from '../find/doc-search';
import { hasFilters, passesFilters, withoutToken, type FilterKey } from '../find/query';
import type { FindDoc, Ranked } from '../find/rank';
import { assessTests, releaseOf, useExplorerApplicability } from './applicability';
import { useRunDetail, useTestCatalog } from './catalog';
import { groupTests, tally, type TestGroupView } from './groups';
import { patched, useExplorerNavigate, useExplorerSearch } from './navigate';
import { Badges, EnvironmentChips, projectTitle, runName } from './parts';
import { ArtifactsView } from './ArtifactsView';
import { CompareView } from './CompareView';
import { HealthView } from './HealthView';
import { CollectionsView } from './collections';
import { RunsView } from './RunsView';
import { SearchNotes, TypedFilters } from './search-notes';
import { EXPLORER_SORTS, joined, narrowed, queryOf, sortOf, TEST_GROUPS, toggled, values, type ExplorerSearch, type ExplorerSort, type TestGroup } from './search';
import { TestDetail } from './TestDetail';
/** Groups start closed when there are more of them than this, unless the list is short. */
const OPEN_GROUPS = 40;
const OPEN_TESTS = 300;
/** Rows a group shows before "Show more". */
const GROUP_ROWS = 50;
const GROUP_LABEL: Record<TestGroup, string> = {
  spec: 'Spec',
  domain: 'Domain',
  environment: 'Environment',
  status: 'Status',
  producer: 'Producer',
  none: 'None'
};
const SORT_LABEL: Record<ExplorerSort, string> = {
  relevance: 'Best match',
  evidence: 'Stale evidence first',
  spec: 'Spec',
  title: 'Title',
  recent: 'Most recent',
  slowest: 'Slowest',
  failures: 'Most failures',
  flaky: 'Flakiest',
  runs: 'Most runs'
};
const STATUS_FILTERS = [
  { id: '', label: 'All' },
  { id: 'failed', label: 'Failed' },
  { id: 'flaky', label: 'Flaky' },
  { id: 'passed', label: 'Passed' },
  { id: 'not-run', label: 'Not run' },
  { id: 'running', label: 'Running' }
] as const;
function percent(rate: number | null): string {
  return rate === null ? '—' : `${Math.round(rate * 100)}%`;
}
const NO_STRUCTURE: ReadonlySet<FilterKey> = new Set();
const WITHOUT_STATUS_AND_ENVIRONMENT: ReadonlySet<FilterKey> = new Set<FilterKey>(['status', 'env']);
const WITHOUT_STATUS: ReadonlySet<FilterKey> = new Set<FilterKey>(['status']);
const WITHOUT_ENVIRONMENT: ReadonlySet<FilterKey> = new Set<FilterKey>(['env']);
const WITHOUT_VIDEO: ReadonlySet<FilterKey> = new Set<FilterKey>(['video']);
/**
 * What the explorer lists for an address: the tests shown, and the scope the insight strip and filter counts describe.
 * The words, quoted phrases and filters typed in the search box are read by the shared search (`find/`), over every
 * test, before anything is counted or ordered; nothing is cut to a page here.
 */
function useListing(model: CatalogModel | null, search: ExplorerSearch, q: string | undefined) {
  const run = useRunDetail(search.inRun);
  const inRun = useMemo(
    () => (search.inRun ? new Set(run.data?.results.map((result) => result.key) ?? []) : null),
    [search.inRun, run.data]
  );
  const docs = useMemo(() => ((q || search.video) && model ? behaviorDocs(model.tests) : new Map<string, FindDoc>()), [q, search.video, model?.tests]);
  const list = useMemo(() => [...docs.values()], [docs]);
  const found = useDocSearch(list, q);
  const sort = sortOf(search);
  const { release: releaseBuild, releaseSha, releasePlatform } = search;
  const release = useMemo(() => releaseOf({ release: releaseBuild, releaseSha, releasePlatform }), [releaseBuild, releaseSha, releasePlatform]);
  // Every test's evidence read against its promise and the named release: a reading, never a status.
  const assessments = useMemo(() => (model ? assessTests(model.tests, release) : null), [model?.tests, release]);
  const listing = useMemo(() => {
    if (!model || !assessments) return null;
    const query: TestQuery = { ...queryOf(search), q: undefined };
    // `has:video` typed in the box and the Has video button are the same filter.
    const operator = { ...found.parsed.filters, video: found.parsed.filters.video || search.video === true };
    const structured = hasFilters(operator);
    const hits = found.hits;
    const passes = (test: TestSummary, omit: ReadonlySet<FilterKey>) =>
      (!hits || hits.has(behaviorId(test.key))) && (!structured || passesFilters(docs.get(test.key)?.facets, operator, omit));
    let shown = testCatalog(model, { ...query, limit: 20000 }).tests.filter((test) => (!inRun || inRun.has(test.key)) && passes(test, NO_STRUCTURE));
    const attention = (test: TestSummary) => needsAttention(assessments.get(test.key)!);
    if (search.evidence === 'stale') shown = shown.filter(attention);
    if (sort === 'relevance' && hits) {
      const order = new Map([...hits.keys()].map((id, at) => [id, at] as const));
      shown = [...shown].sort((a, b) => (order.get(behaviorId(a.key)) ?? 0) - (order.get(behaviorId(b.key)) ?? 0));
    }
    // Stale evidence first; the order of the spec list is kept among equals.
    if (sort === 'evidence') shown = [...shown].sort((a, b) => attentionRank(assessments.get(a.key)!) - attentionRank(assessments.get(b.key)!));
    // The strip and the status and environment counts describe what the other filters leave.
    const scope = model.tests.filter((test) => matchesQuery(model, test, { ...query, status: [], environment: [] }, inRun) && passes(test, WITHOUT_STATUS_AND_ENVIRONMENT));
    const byEnvironment = scope.filter((test) => matchesQuery(model, test, { environment: query.environment }) && passes(test, WITHOUT_STATUS));
    const byStatus = scope.filter((test) => matchesQuery(model, test, { status: query.status }) && passes(test, WITHOUT_ENVIRONMENT));
    const videoScope = model.tests.filter((test) => matchesQuery(model, test, query, inRun) && passes(test, WITHOUT_VIDEO));
    const evidenceScope = model.tests.filter((test) => matchesQuery(model, test, query, inRun) && passes(test, NO_STRUCTURE));
    return {
      shown,
      assessments,
      release,
      stale: evidenceScope.filter(attention).length,
      withVideo: videoScope.filter((test) => docs.get(test.key)?.facets?.video ?? testHasVideo(test)).length,
      scope,
      byEnvironment,
      byStatus,
      hits: hits as ReadonlyMap<string, Ranked> | null,
      parsed: found.parsed,
      semantic: found.status,
      runPending: !!search.inRun && run.isPending,
      runMissing: !!search.inRun && run.isSuccess && run.data === null
    };
  }, [model, search, found, docs, sort, inRun, assessments, release, run.isPending, run.isSuccess, run.data]);
  return listing;
}
/** Every filter the explorer can narrow by, cleared. */
const NO_NARROWING = {
  q: undefined,
  status: undefined,
  env: undefined,
  producer: undefined,
  domain: undefined,
  spec: undefined,
  tag: undefined,
  scope: undefined,
  artifactTag: undefined,
  inherited: undefined,
  inRun: undefined,
  video: undefined,
  evidence: undefined
} as const;
/** The width of one figure column of the list, so the column headings sit over their figures. */
const COLUMN = 64;
/** A calm, centered message for a list with nothing to show: an icon, what is so, and one way on. */
function Blank({ icon, title, children, action, role }: { icon: ReactNode; title?: string; children: ReactNode; action?: ReactNode; role?: 'status' }) {
  return (
    <Stack align="center" gap="xs" py={48} px="lg" role={role}>
      <ThemeIcon size={44} radius="xl" variant="light" color="gray" mb={4}>
        {icon}
      </ThemeIcon>
      {title && (
        <Title order={3} ta="center">
          {title}
        </Title>
      )}
      <Text component="div" c="dimmed" ta="center" maw={460}>
        {children}
      </Text>
      {action && <Box mt="xs">{action}</Box>}
    </Stack>
  );
}
/** The project home: the report in numbers, the tests found by searching and filtering, the open test, and the published spec kinds. */
export function Explorer() {
  const evidence = useEvidence();
  const catalog = useTestCatalog();
  const search = useExplorerSearch();
  const go = useExplorerNavigate();
  const q = useDeferredValue(search.q);
  const listing = useListing(catalog.model, search, q);
  const kinds = SPEC_KINDS.map((kind) => ({ kind, files: evidence.files.filter(kind.accepts) })).filter((entry) => entry.files.length);
  const slots = useMemo(() => {
    const map = new Map<string, CheckSlot>();
    for (const entry of evidence.view.specs.values()) for (const slot of entry.slots) map.set(slot.key, slot);
    for (const slot of evidence.view.unassigned) map.set(slot.key, slot);
    return map;
  }, [evidence.view]);
  const model = catalog.model;
  const selected = search.test ? (model?.byKey.get(search.test) ?? null) : null;
  const empty = model !== null && model.tests.length === 0;
  const split = !!search.test && search.tab !== 'runs' && search.tab !== 'artifacts' && search.tab !== 'collections' && search.tab !== 'compare' && search.tab !== 'health';
  return (
    <>
      <Stack aria-label="Test explorer" component="article" miw={0} gap="md">
        <PageHeader title={projectTitle()} description="Explore test outcomes, review recordings, and trace the evidence behind each result.">
          {model && (model.tests.length > 0 || model.summary.runs > 0) && (
            <Tabs
              value={search.tab ?? 'tests'}
              onChange={(value) => go({ tab: value === 'runs' || value === 'artifacts' || value === 'collections' || value === 'compare' || value === 'health' ? value : undefined, test: undefined, openRun: undefined, layer: undefined, artifact: undefined, collection: undefined, rev: undefined, pair: undefined, watch: undefined, watchClip: undefined })}
            >
              <Tabs.List aria-label="Explorer view">
                <Tabs.Tab
                  value="tests"
                  rightSection={
                    <Text span size="xs" c="dimmed">
                      {model.tests.length}
                    </Text>
                  }
                >
                  Tests
                </Tabs.Tab>
                <Tabs.Tab
                  value="runs"
                  rightSection={
                    <Text span size="xs" c="dimmed">
                      {model.summary.runs}
                    </Text>
                  }
                >
                  Runs
                </Tabs.Tab>
                <Tabs.Tab value="artifacts">Artifacts</Tabs.Tab>
                <Tabs.Tab value="compare">Compare</Tabs.Tab>
                <Tabs.Tab value="health">Catalog health</Tabs.Tab>
                {!staticEvidence && <Tabs.Tab value="collections">Collections</Tabs.Tab>}
              </Tabs.List>
            </Tabs>
          )}
        </PageHeader>
        {evidence.unavailable && (
          <Alert role="alert" color="red" icon={<IconAlertTriangle size={18} aria-hidden="true" />}>
            {evidence.unavailable}
          </Alert>
        )}
        {catalog.notice && (
          <Alert role="status" color="blue">
            The server’s test history could not be read ({catalog.notice}). Showing what this page holds.
          </Alert>
        )}
        {!model && !evidence.unavailable && <Loading />}
        {empty && model && model.summary.runs > 0 && search.tab !== 'runs' && (
          <Card p={0}>
            <Blank
              icon={<IconFlask size={22} aria-hidden="true" />}
              action={
                <Button renderRoot={(props) => <Link {...props} to="/" search={patched({ tab: 'runs', test: undefined, layer: undefined })} resetScroll={false} activeOptions={{ exact: true }} />}>
                  Open runs
                </Button>
              }
            >
              No test results recorded, but {model.summary.runs === 1 ? '1 run carries' : `${model.summary.runs} runs carry`} files. Open the Runs tab to see them.
            </Blank>
          </Card>
        )}
        {empty && !kinds.length && !(model && model.summary.runs > 0) && (
          <Card p={0}>
            <Blank icon={<IconInbox size={22} aria-hidden="true" />}>
              <Text span inherit fw={600} c="var(--mantine-color-text)">
                No reports yet.
              </Text>{' '}
              Publish tests and specs to this project to populate its report.
            </Blank>
          </Card>
        )}
        {empty && kinds.length > 0 && (
          <Card p={0}>
            <Blank icon={<IconFlask size={22} aria-hidden="true" />}>No test results recorded yet.</Blank>
          </Card>
        )}
        {model &&
          listing &&
          (search.tab === 'runs' ? (
            <RunsView />
          ) : search.tab === 'artifacts' ? (
            <ArtifactsView />
          ) : search.tab === 'compare' ? (
            <CompareView />
          ) : search.tab === 'health' ? (
            <HealthView />
          ) : search.tab === 'collections' ? (
            <CollectionsView />
          ) : empty ? null : (
            <>
              <InsightStrip model={model} scope={listing.scope} search={search} />
              <TestsPanel model={model} search={search} listing={listing} onSearch={(value) => go({ q: value || undefined }, { replace: true })} />
              <MoreInsights scope={listing.scope} />
            </>
          ))}
        {kinds.length > 0 && !search.tab && (
          <Accordion variant="contained" radius="lg" role="region" aria-label="Published specs">
            <Accordion.Item value="specs" bg="var(--mantine-color-body)">
              <Accordion.Control>
                <Text span fw={500}>
                  Published specs
                </Text>
                <Text span c="dimmed">
                  {' '}
                  · {kinds.reduce((count, entry) => count + entry.files.length, 0)} files
                </Text>
              </Accordion.Control>
              <Accordion.Panel>
                <Stack gap="sm">
                  <Group gap="xs">
                    {kinds.map(({ kind, files }) => (
                      <Button key={kind.id} leftSection={<SpecLogo kind={kind} />}
                        rightSection={<Text span size="xs" c="dimmed">{files.length}</Text>}
                        renderRoot={(props) => <Link {...props} to="/specs/$kind" params={{ kind: kind.id }} search={{}} />}>
                        {kind.label}
                      </Button>
                    ))}
                  </Group>
                  <Group gap="lg">
                    {kinds.some(({ kind }) => kind.id === 'gherkin') && (
                      <Anchor renderRoot={(props) => <Link {...props} to="/behaviors" search={{}} />}>
                        <Group component="span" display="inline-flex" gap={4}>
                          Behaviors: read what the project promises, then watch it
                          <IconArrowRight size={14} aria-hidden="true" />
                        </Group>
                      </Anchor>
                    )}
                    <Anchor c="dimmed" renderRoot={(props) => <Link {...props} to="/" search={patched({ tab: 'health', test: undefined })} resetScroll={false} activeOptions={{ exact: true }} />}>
                      Why do these counts differ from the Tests?
                    </Anchor>
                  </Group>
                </Stack>
              </Accordion.Panel>
            </Accordion.Item>
          </Accordion>
        )}
      </Stack>
      <Drawer opened={split} onClose={() => go({ test: undefined, layer: undefined })} title="Test detail" size="64rem">
        <Box aria-label="Test detail" component="aside">
          {selected ? (
            <TestDetail test={selected} slot={slots.get(selected.key)} />
          ) : model ? (
            <Stack gap="sm">
              <Alert color="blue">This test is not in the report any more. A source may be switched off, or its results were removed.</Alert>
              <Anchor
                renderRoot={(props) => (
                  <Link {...props} to="/" search={patched({ test: undefined, layer: undefined })} resetScroll={false} activeOptions={{ exact: true }} />
                )}
              >
                Close
              </Anchor>
            </Stack>
          ) : (
            <Stack gap="md">
              <Text role="status" component="div" c="dimmed">
                Loading the test…
              </Text>
              <Skeleton h={28} w="60%" />
              <Skeleton h={320} />
              <Skeleton h={120} />
            </Stack>
          )}
        </Box>
      </Drawer>
    </>
  );
}
/** The page while the report is being read: the shape of the figures and the list, and the words that say so. */
function Loading() {
  return (
    <>
      <SimpleGrid cols={{ base: 2, lg: 4 }} spacing="md" aria-hidden="true">
        {[0, 1, 2, 3].map((tile) => (
          <Card key={tile} padding="md">
            <Stack gap="xs">
              <Skeleton h={10} w={72} />
              <Skeleton h={22} w={56} />
              <Skeleton h={8} />
            </Stack>
          </Card>
        ))}
      </SimpleGrid>
      <Card padding="lg">
        <Stack gap="md">
          <Text role="status" component="div" c="dimmed">
            Loading tests…
          </Text>
          {[72, 56, 64, 48, 60].map((width, row) => (
            <Group key={row} gap="sm" wrap="nowrap" aria-hidden="true">
              <Skeleton circle h={16} w={16} />
              <Skeleton h={12} w={`${width}%`} />
              <Skeleton h={12} w={48} ml="auto" />
            </Group>
          ))}
        </Stack>
      </Card>
    </>
  );
}
function InsightStrip({ model, scope, search }: { model: CatalogModel; scope: readonly TestSummary[]; search: ExplorerSearch }) {
  const now = useNow();
  const go = useExplorerNavigate();
  const { counts } = tally(scope);
  const flaky = scope.filter((test) => test.stats.flaky).length;
  const averages = scope.flatMap((test) => (test.stats.durations ? [test.stats.durations.avgMs] : []));
  const durations = durationStats(averages);
  const environments = useMemo(() => groupTests(scope, 'environment', false).sort((a, b) => b.tests.length - a.tests.length), [scope]);
  const statuses = values(search.status);
  const envs = values(search.env);
  const [allEnvironments, setAllEnvironments] = useState(false);
  const [mobileInsights, setMobileInsights] = useState(false);
  const visibleEnvironments = environments.filter((group, index) => index < 1 || envs.includes(group.key));
  const last = scope.reduce((latest, test) => Math.max(latest, test.lastRecordedAtMs), 0);
  const status = (id: string) => go({ status: statuses.length === 1 && statuses[0] === id ? undefined : id });
  const outcome = (id: 'failed' | 'passed' | 'not-run' | 'running', word: string, color: string, always: boolean) =>
    (always || counts[id] > 0) && (
      <Button
        size="compact-xs"
        color={color}
        variant={statuses.includes(id) ? 'light' : 'subtle'}
        aria-pressed={statuses.includes(id)}
        disabled={id === 'failed' && !counts.failed}
        onClick={() => status(id)}
      >
        {counts[id]} {word}
      </Button>
    );
  return (
    <Box component="section" aria-label="Insights">
      <Card hiddenFrom="sm" padding="md">
        <Group justify="space-between" gap="xs" wrap="nowrap">
          <Stack gap={2} miw={0} flex={1}>
            <Text fw={600}>{plural(scope.length, 'test', 'tests')}</Text>
            <Text size="xs" c="dimmed">{counts.failed} failed · {counts.passed} passed{counts.running ? ` · ${counts.running} running` : ''}{counts['not-run'] ? ` · ${counts['not-run']} not run` : ''}</Text>
          </Stack>
          <Button variant="subtle" size="compact-sm" flex="none" aria-expanded={mobileInsights} onClick={() => setMobileInsights((open) => !open)}>
            {mobileInsights ? 'Hide insights' : 'View insights'}
          </Button>
        </Group>
      </Card>
      <Box display={{ base: mobileInsights ? 'block' : 'none', sm: 'block' }} mt={{ base: 'md', sm: 0 }}>
        <SimpleGrid cols={{ base: 1, xs: 2, lg: 4 }} spacing="md">
          <Metric label="Tests" value={scope.length.toLocaleString()}>
            <Box py={4}>
              <Meter counts={counts} />
            </Box>
            <Group gap={4} ml={-6}>
              {outcome('failed', 'failed', 'red', true)}
              {outcome('passed', 'passed', 'green', true)}
              {outcome('not-run', 'not run', 'gray', false)}
              {outcome('running', 'running', 'blue', false)}
            </Group>
          </Metric>
          <Metric label="Flaky" value={flaky} detail={flaky ? 'Passed and failed on one commit, or needed a retry' : 'None recorded'}>
            <Group gap={4} ml={-6} mt="auto">
              <Button
                size="compact-xs"
                color="orange"
                variant={statuses.includes('flaky') ? 'light' : 'subtle'}
                aria-pressed={statuses.includes('flaky')}
                aria-label={`View flaky tests: ${flaky}`}
                onClick={() => status('flaky')}
              >
                View flaky tests
              </Button>
            </Group>
          </Metric>
          <Metric
            label="Duration"
            value={durations ? formatMs(durations.avgMs) : '—'}
            detail={
              durations
                ? `average · p95 ${formatMs(durations.p95Ms)} · ${averages.length.toLocaleString()} measured`
                : 'No durations recorded. Producers can send durationMs with each check.'
            }
          >
            <Group gap={6}>
              <Anchor
                size="xs"
                aria-label={`${model.summary.runs} runs`}
                renderRoot={(props) => (
                  <Link
                    {...props}
                    to="/"
                    search={patched({ tab: 'runs', test: undefined, layer: undefined })}
                    resetScroll={false}
                    activeOptions={{ exact: true }}
                  />
                )}
              >
                {model.summary.runs.toLocaleString()} runs
              </Anchor>
              <Text size="xs" c="dimmed">
                · {last ? `Last recorded ${ago(last, now)}` : 'Nothing recorded yet'}
              </Text>
            </Group>
          </Metric>
          <Metric label="Environments" value={environments.length}>
            <Group gap={4} ml={-6}>
              {visibleEnvironments.map((group) => (
                <Button key={group.key} size="compact-xs" variant={envs.includes(group.key) ? 'light' : 'subtle'}
                  maw="100%" aria-pressed={envs.includes(group.key)}
                  onClick={() => go({ env: toggled(search.env, group.key) })}
                  title={`${group.label}: ${plural(group.tests.length, 'test', 'tests')} · ${group.counts.failed} failed · ${group.counts.passed} passed`}>
                  <Text span inherit truncate>{group.label}</Text>
                </Button>
              ))}
              {environments.length > 1 && (
                <Button size="compact-xs" variant="subtle" c="dimmed" aria-expanded={allEnvironments} onClick={() => setAllEnvironments((open) => !open)}>
                  {allEnvironments ? 'Show fewer' : `Show all (${environments.length})`}
                </Button>
              )}
            </Group>
          </Metric>
        </SimpleGrid>
        {allEnvironments && (
          <Box mt="md">
            <Panel title="All environments" order={3} component="section" aria-label="All environment insights">
              <SimpleGrid cols={{ base: 1, xs: 2, md: 3, lg: 5 }} spacing="xs">
                {environments.map((group) => (
                  <Button key={group.key} variant={envs.includes(group.key) ? 'light' : 'default'}
                    h="auto" py="xs" justify="flex-start" aria-pressed={envs.includes(group.key)}
                    onClick={() => go({ env: toggled(search.env, group.key) })}>
                    <Stack align="flex-start" gap={2}>
                      <Text fw={500}>{group.label}</Text>
                      <Text size="xs" c="dimmed">{plural(group.tests.length, 'test', 'tests')} · {group.counts.failed} failed · {group.counts.passed} passed</Text>
                    </Stack>
                  </Button>
                ))}
              </SimpleGrid>
            </Panel>
          </Box>
        )}
      </Box>
    </Box>
  );
}
/** The slowest, flakiest and failing tests of the scope, each one click from its detail. */
function MoreInsights({ scope }: { scope: readonly TestSummary[] }) {
  const slowest = useMemo(
    () =>
      scope
        .filter((test) => test.stats.durations)
        .sort((a, b) => b.stats.durations!.avgMs - a.stats.durations!.avgMs)
        .slice(0, 5),
    [scope]
  );
  const flakiest = useMemo(
    () =>
      scope
        .filter((test) => test.stats.flaky)
        .sort((a, b) => b.stats.flips - a.stats.flips)
        .slice(0, 5),
    [scope]
  );
  const failing = useMemo(
    () =>
      scope
        .filter((test) => test.status === 'failed')
        .sort((a, b) => b.lastRecordedAtMs - a.lastRecordedAtMs)
        .slice(0, 5),
    [scope]
  );
  if (!slowest.length && !flakiest.length && !failing.length) return null;
  const list = (title: string, tests: readonly TestSummary[], value: (test: TestSummary) => string) =>
    tests.length > 0 && (
      <Stack gap={4}>
        <Title order={3} size="xs" c="dimmed" fw={500} px="sm">
          {title}
        </Title>
        <List spacing={0} listStyleType="none" type="ordered">
          {tests.map((test) => (
            <List.Item key={test.key}>
              <NavLink
                py={6}
                leftSection={<StatusMark status={test.status} size={14} />}
                label={test.title}
                rightSection={
                  <Text span size="xs" c="dimmed">
                    {value(test)}
                  </Text>
                }
                renderRoot={(props) => (
                  <Link {...props} to="/" search={patched({ test: test.key, layer: undefined })} resetScroll={false} activeOptions={{ exact: true }} />
                )}
              />
            </List.Item>
          ))}
        </List>
      </Stack>
    );
  return (
    <Accordion variant="contained" radius="lg">
      <Accordion.Item value="content" bg="var(--mantine-color-body)">
        <Accordion.Control>
          <Text span fw={500}>
            Slowest, flakiest and failing tests
          </Text>
        </Accordion.Control>
        <Accordion.Panel>
          <SimpleGrid cols={{ base: 1, md: 3 }} spacing="md">
            {list('Failing', failing, (test) => plural(test.stats.failed, 'failure', 'failures'))}
            {list('Flakiest', flakiest, (test) => (test.stats.flips ? plural(test.stats.flips, 'flip', 'flips') : 'flaky'))}
            {list('Slowest', slowest, (test) => formatMs(test.stats.durations?.avgMs))}
          </SimpleGrid>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  );
}
type Listing = NonNullable<ReturnType<typeof useListing>>;
/** The one panel of the home: find tests (search, grouping, order, filters), then the tests found. */
function TestsPanel({
  model,
  search,
  listing,
  onSearch
}: {
  model: CatalogModel;
  search: ExplorerSearch;
  listing: Listing;
  onSearch: (value: string) => void;
}) {
  const go = useExplorerNavigate();
  const searchId = useId();
  // Best match is the order of a search with words; without words the list is in spec order.
  const defaultSort: ExplorerSort = listing.hits ? 'relevance' : 'spec';
  const sort: ExplorerSort = search.sort ?? defaultSort;
  const [draft, setDraft] = useState(search.q ?? '');
  // The address may change from elsewhere (a link, the index, back): follow it.
  useEffect(() => setDraft((current) => (current.trim() === (search.q ?? '').trim() ? current : (search.q ?? ''))), [search.q]);
  const statuses = values(search.status);
  const envs = values(search.env);
  const statusCount = (id: string) =>
    id === ''
      ? listing.byEnvironment.length
      : listing.byEnvironment.filter((test) => (id === 'flaky' ? test.stats.flaky : test.status === id)).length;
  const envCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const test of listing.byStatus)
      for (const env of test.environments.length ? test.environments : ['(none)']) counts.set(env, (counts.get(env) ?? 0) + 1);
    return counts;
  }, [listing.byStatus]);
  const specTitle = (path: string) => model.facets.specs.find((spec) => spec.path === path)?.title ?? path;
  const chips = [
    ...values(search.spec).map((path) => ({ label: `Spec: ${specTitle(path)}`, clear: { spec: toggled(search.spec, path) } })),
    ...values(search.tag).map((tag) => ({ label: `Tag: ${tag}`, clear: { tag: toggled(search.tag, tag) } })),
    ...values(search.scope).map((token) => ({ label: `Scope: ${token}`, clear: { scope: toggled(search.scope, token) } })),
    ...values(search.artifactTag).map((tag) => ({ label: `Artifact tag: #${tag}`, clear: { artifactTag: toggled(search.artifactTag, tag) } })),
    ...(search.inRun ? [{ label: `Run: ${runName(search.inRun)}`, clear: { inRun: undefined } }] : [])
  ];
  const hasVideo = search.video === true || listing.parsed.filters.video;
  const released = !!(search.release || search.releaseSha || search.releasePlatform);
  // What the Filters control holds that is narrowing the list now.
  const more = envs.length + values(search.producer).length + values(search.domain).length + values(search.scope).length + values(search.artifactTag).length + (released ? 1 : 0);
  const [filters, setFilters] = useState(more > 0);
  const filtersId = useId();
  const clear = () => {
    setDraft('');
    go(NO_NARROWING);
  };
  return (
    <Card p={0} aria-label="Find tests" component="section">
      <Stack gap="sm" p="lg" pb="md">
        <Flex gap="sm" align="center" justify="space-between" wrap="wrap">
          <Stack gap={0} miw={120}>
            <Title order={2}>Tests</Title>
            <Group gap={6} wrap="nowrap">
              <Text role="status" c="dimmed">
                {listing.shown.length === model.tests.length
                  ? plural(model.tests.length, 'test', 'tests')
                  : `${listing.shown.length.toLocaleString()} of ${plural(model.tests.length, 'test', 'tests')}`}
              </Text>
              {narrowed(search) && (
                <Button type="button" size="compact-xs" onClick={clear} variant="subtle" leftSection={<IconX size={12} aria-hidden="true" />}>
                  Clear filters
                </Button>
              )}
            </Group>
          </Stack>
          <Flex gap="xs" align="center" wrap="wrap" flex={{ base: '1 1 100%', md: '0 1 auto' }}>
            <Box flex={{ base: '1 1 100%', sm: '1 1 18rem' }} miw={0} w={{ md: '22rem' }}>
              <Box component="label" htmlFor={searchId}>
                <VisuallyHidden>Search tests</VisuallyHidden>
              </Box>
              <TextInput
                id={searchId}
                type="search"
                leftSection={<IconSearch size={16} aria-hidden="true" />}
                aria-label="Search tests"
                placeholder="Search tests, or filter: status:failed has:video"
                title='Search titles, specs, tags… or filter: status:failed has:video "exact phrase"'
                value={draft}
                onChange={(event) => {
                  setDraft(event.target.value);
                  onSearch(event.target.value.trim());
                }}
              />
            </Box>
            <NativeSelect
              flex={{ base: 1, sm: 'none' }}
              aria-label="Group by"
              leftSection={<Text span size="xs" c="dimmed">Group</Text>}
              leftSectionWidth={56}
              leftSectionPointerEvents="none"
              value={search.group ?? 'spec'}
              onChange={(event) => go({ group: event.target.value === 'spec' ? undefined : (event.target.value as TestGroup) })}
            >
              {TEST_GROUPS.map((group) => (
                <option key={group} value={group}>
                  {GROUP_LABEL[group]}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              flex={{ base: 1, sm: 'none' }}
              aria-label="Sort"
              leftSection={<Text span size="xs" c="dimmed">Sort</Text>}
              leftSectionWidth={48}
              leftSectionPointerEvents="none"
              value={sort}
              onChange={(event) => go({ sort: event.target.value === defaultSort ? undefined : (event.target.value as ExplorerSort) })}
            >
              {EXPLORER_SORTS.filter((option) => option !== 'relevance' || listing.hits !== null || sort === 'relevance').map((option) => (
                <option key={option} value={option}>
                  {SORT_LABEL[option]}
                </option>
              ))}
            </NativeSelect>
            <Button
              variant={filters ? 'light' : 'default'}
              aria-expanded={filters}
              aria-controls={filtersId}
              leftSection={<IconAdjustmentsHorizontal size={16} aria-hidden="true" />}
              rightSection={more > 0 ? <Badge size="sm" circle variant="filled">{more}</Badge> : undefined}
              onClick={() => setFilters((open) => !open)}
            >
              Filters
            </Button>
          </Flex>
        </Flex>
        <Flex gap={{ base: 4, sm: 'xs' }} align="center" wrap="wrap" justify={{ base: 'flex-start', sm: 'space-between' }}>
          <Flex role="group" aria-label="Test status" gap={4} align="center" wrap="wrap" display={{ base: 'contents', sm: 'flex' }}>
            {STATUS_FILTERS.map((filter) => {
              const count = statusCount(filter.id);
              if (filter.id === 'running' && count === 0 && !statuses.includes('running')) return null;
              const pressed = filter.id === '' ? statuses.length === 0 : statuses.length === 1 && statuses[0] === filter.id;
              return (
                <Button
                  key={filter.id || 'all'}
                  type="button"
                  size="compact-sm"
                  aria-pressed={pressed}
                  data-status={(count > 0 && filter.id) || undefined}
                  onClick={() => go({ status: filter.id || undefined })}
                  variant={pressed ? 'light' : 'subtle'}
                  rightSection={<Text span size="xs" c="dimmed">{count.toLocaleString()}</Text>}
                >
                  {filter.label}{' '}
                </Button>
              );
            })}
          </Flex>
          <Flex gap={4} align="center" wrap="wrap" display={{ base: 'contents', sm: 'flex' }}>
            <Button
              type="button"
              size="compact-sm"
              aria-pressed={hasVideo}
              aria-label={`Has video ${plural(listing.withVideo, 'test', 'tests')}`}
              onClick={() => {
                if (listing.parsed.filters.video) {
                  const token = listing.parsed.tokens.find((item) => item.key === 'video')!;
                  const next = withoutToken(draft, token);
                  setDraft(next);
                  onSearch(next);
                } else go({ video: search.video ? undefined : true });
              }}
              variant={hasVideo ? 'light' : 'subtle'}
              leftSection={<IconVideo size={14} aria-hidden="true" />}
              rightSection={<Text span size="xs" c="dimmed">{listing.withVideo.toLocaleString()}</Text>}
            >
              Has video{' '}
            </Button>
            <Button
              type="button"
              size="compact-sm"
              aria-pressed={search.evidence === 'stale'}
              aria-label={`Stale or unverified ${plural(listing.stale, 'test', 'tests')}`}
              onClick={() => go({ evidence: search.evidence ? undefined : 'stale' })}
              variant={search.evidence === 'stale' ? 'light' : 'subtle'}
              leftSection={<IconAlertTriangle size={14} aria-hidden="true" />}
              rightSection={<Text span size="xs" c="dimmed">{listing.stale.toLocaleString()}</Text>}
            >
              Stale or unverified{' '}
            </Button>
          </Flex>
        </Flex>
        <Box id={filtersId} display={filters ? undefined : 'none'}>
          <Stack gap="sm" p="md" bg="var(--mantine-color-default-hover)" bdrs="md">
            {model.facets.environments.length > 0 && (
              <Stack gap={4}>
                <Text size="xs" c="dimmed" fw={500}>
                  Environment
                </Text>
                <Flex role="group" aria-label="Environments" gap={4} align="center" wrap="wrap" ml={-6}>
                  {model.facets.environments.map(({ value }) => (
                    <Button
                      key={value}
                      type="button"
                      size="compact-sm"
                      aria-pressed={envs.includes(value)}
                      onClick={() => go({ env: toggled(search.env, value) })}
                      variant={envs.includes(value) ? 'filled' : 'subtle'}
                      rightSection={<Text span size="xs" inherit opacity={0.65}>{(envCounts.get(value) ?? 0).toLocaleString()}</Text>}
                    >
                      {environmentLabel(value)}{' '}
                    </Button>
                  ))}
                </Flex>
              </Stack>
            )}
            <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }} spacing="sm">
              {model.facets.producers.length > 1 && (
                <NativeSelect
                  label="Producer"
                  aria-label="Producer"
                  value={values(search.producer)[0] ?? ''}
                  onChange={(event) => go({ producer: event.target.value || undefined })}
                >
                  <option value="">All producers</option>
                  {model.facets.producers.map(({ value, count }) => (
                    <option key={value} value={value}>
                      {value} ({count})
                    </option>
                  ))}
                </NativeSelect>
              )}
              {model.facets.domains.length > 1 && (
                <NativeSelect
                  label="Domain"
                  aria-label="Domain"
                  value={values(search.domain)[0] ?? ''}
                  onChange={(event) => go({ domain: event.target.value || undefined, spec: undefined })}
                >
                  <option value="">All domains</option>
                  {model.facets.domains.map(({ value, count }) => (
                    <option key={value} value={value}>
                      {value === '(no spec)' ? 'No spec' : value} ({count})
                    </option>
                  ))}
                </NativeSelect>
              )}
              {(model.facets.scopes?.length ?? 0) > 0 && (
                <NativeSelect
                  label="Recording scope"
                  aria-label="Recording scope"
                  value=""
                  onChange={(event) => event.target.value && go({ scope: toggled(search.scope, event.target.value) })}
                >
                  <option value="">Any recording scope</option>
                  {model.facets.scopes!.filter(({ value }) => !values(search.scope).includes(value)).map(({ value, count }) => (
                    <option key={value} value={value}>
                      {value === 'unknown' ? 'Scope unknown' : value} ({count})
                    </option>
                  ))}
                </NativeSelect>
              )}
              {((model.facets.artifactTags?.length ?? 0) > 0 || values(search.artifactTag).length > 0) && (
                <MultiSelect
                  label="Artifact tag"
                  aria-label="Artifact tag"
                  placeholder={values(search.artifactTag).length ? undefined : 'Any artifact tag'}
                  data={[
                    ...(model.facets.artifactTags ?? []).map(({ value, count }) => ({ value, label: `#${value} (${count})` })),
                    ...values(search.artifactTag)
                      .filter((tag) => !model.facets.artifactTags?.some((facet) => facet.value === tag))
                      .map((tag) => ({ value: tag, label: `#${tag} (0)` }))
                  ]}
                  value={values(search.artifactTag)}
                  searchable
                  clearable
                  nothingFoundMessage="Nothing found"
                  onChange={(next) => go({ artifactTag: joined(next) })}
                />
              )}
            </SimpleGrid>
            <ReleaseReading />
          </Stack>
        </Box>
        {(listing.parsed.tokens.length > 0 || chips.length > 0) && (
          <Flex gap={6} align="center" wrap="wrap" aria-label="Active filters">
            <TypedFilters
              parsed={listing.parsed}
              query={draft}
              onChange={(next) => {
                setDraft(next);
                onSearch(next);
              }}
            />
            {chips.map((chip) => (
              <Button key={chip.label} type="button" size="compact-sm" onClick={() => go(chip.clear)} aria-label={`Remove ${chip.label}`} variant="light" rightSection={<IconX size={14} aria-hidden="true" />}>
                {chip.label}{' '}
              </Button>
            ))}
          </Flex>
        )}
        <SearchNotes issues={listing.parsed.issues} semantic={listing.semantic} />
        {listing.runPending && (
          <Text role="status" component="div" c="dimmed">
            Reading the tests of this run…
          </Text>
        )}
        {listing.runMissing && (
          <Alert role="status" color="blue">
            That run is not in the report any more.
          </Alert>
        )}
      </Stack>
      <Divider />
      <TestList tests={listing.shown} search={search} total={model.tests.length} hits={listing.hits} sort={search.sort ?? (listing.hits ? 'relevance' : 'spec')} assessments={listing.assessments} release={listing.release} onClear={clear} />
    </Card>
  );
}
/**
 * Names the release the evidence of the tests is read against (build, commit and platform). Folded away until a release is
 * named, because most readers only ask whether evidence is stale.
 */
function ReleaseReading() {
  const applicability = useExplorerApplicability();
  const named = hasRelease(applicability.release) || !!applicability.release.platform;
  return (
    <Accordion variant="contained" defaultValue={named ? 'release' : null}>
      <Accordion.Item value="release" bg="var(--mantine-color-body)">
        <Accordion.Control>
          <Text span fw={500}>
            Release the evidence is read against
          </Text>
        </Accordion.Control>
        <Accordion.Panel>
          <ApplicabilityControls state={applicability} filter={false} />
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  );
}
function TestList({
  tests,
  search,
  total,
  hits,
  sort,
  assessments,
  release,
  onClear
}: {
  tests: readonly TestSummary[];
  search: ExplorerSearch;
  total: number;
  hits: ReadonlyMap<string, Ranked> | null;
  sort: ExplorerSort;
  assessments: ReadonlyMap<string, Assessment>;
  release: ReleaseIdentity;
  onClear: () => void;
}) {
  // A reading is shown on every row only when the reader asked about evidence; otherwise only evidence known to be stale.
  const asked = search.evidence === 'stale' || sort === 'evidence' || hasRelease(release);
  const by = search.group ?? 'spec';
  const groups = useMemo(() => groupTests(tests, by, sort === 'spec'), [tests, by, sort]);
  const [overrides, setOverrides] = useState<ReadonlyMap<string, boolean>>(new Map());
  const defaultOpen = groups.length <= OPEN_GROUPS || tests.length <= OPEN_TESTS;
  const isOpen = (group: TestGroupView) => by === 'none' || (overrides.get(`${by}|${group.key}`) ?? defaultOpen);
  const setAll = (open: boolean) => setOverrides(new Map(groups.map((group) => [`${by}|${group.key}`, open])));
  if (!tests.length)
    return (
      <Blank
        role="status"
        icon={total ? <IconFilterOff size={22} aria-hidden="true" /> : <IconFlask size={22} aria-hidden="true" />}
        title={total ? 'No test matches these filters.' : 'No tests recorded yet.'}
        action={total ? <Button onClick={onClear}>Clear filters</Button> : undefined}
      >
        {total ? 'Try a broader search or clear the filters above to return to the full test list.' : 'Published test results will appear here with their outcomes and recorded evidence.'}
      </Blank>
    );
  let parent: string | null = null;
  return (
    <Box aria-label="Tests" component="section" pb="xs">
      <Flex gap="xs" align="center" px="lg" py={6} mih={36}>
        <Text span size="xs" c="dimmed">
          {by === 'none'
            ? ''
            : `${plural(groups.length, GROUP_LABEL[by].toLowerCase(), by === 'status' ? 'statuses' : `${GROUP_LABEL[by].toLowerCase()}s`)}`}
        </Text>
        {by !== 'none' && (
          <Flex component="span" display="inline-flex" gap={0} align="center" wrap="wrap">
            <Button type="button" size="compact-xs" onClick={() => setAll(true)} variant="subtle" c="dimmed">
              Expand all
            </Button>
            <Button type="button" size="compact-xs" onClick={() => setAll(false)} variant="subtle" c="dimmed">
              Collapse all
            </Button>
          </Flex>
        )}
        <Group aria-hidden="true" gap={0} ml="auto" visibleFrom="sm" wrap="nowrap">
          {['Avg', 'Pass', 'Runs', 'Last'].map((column) => (
            <Text key={column} span size="xs" c="dimmed" fw={500} w={COLUMN} ta="right">
              {column}
            </Text>
          ))}
        </Group>
      </Flex>
      {groups.map((group) => {
        const heading = by === 'spec' && group.parent !== parent ? group.parent : null;
        parent = group.parent;
        return (
          <Box key={group.key}>
            {heading && (
              <>
                <Divider />
                <Title order={3} size="xs" c="dimmed" fw={500} px="lg" pt="sm" pb={4}>
                  {heading === '(no spec)' ? 'No spec' : heading}
                </Title>
              </>
            )}
            {!heading && by !== 'none' && by !== 'spec' && <Divider />}
            <TestGroupSection
              group={group}
              by={by}
              open={isOpen(group)}
              selected={search.test}
              hits={hits}
              assessments={assessments}
              asked={asked}
              onToggle={() => setOverrides(new Map(overrides).set(`${by}|${group.key}`, !isOpen(group)))}
            />
          </Box>
        );
      })}
    </Box>
  );
}
function TestGroupSection({
  group,
  by,
  open,
  selected,
  hits,
  assessments,
  asked,
  onToggle
}: {
  group: TestGroupView;
  by: TestGroup;
  open: boolean;
  selected: string | undefined;
  hits: ReadonlyMap<string, Ranked> | null;
  assessments: ReadonlyMap<string, Assessment>;
  asked: boolean;
  onToggle: () => void;
}) {
  const [shown, setShown] = useState(by === 'none' ? 100 : GROUP_ROWS);
  const now = useNow();
  const rows = (
    <List spacing={0} listStyleType="none">
      {group.tests.slice(0, shown).map((test) => (
        <TestRow key={test.key} test={test} selected={selected === test.key} now={now} hit={hits?.get(behaviorId(test.key))} assessment={assessments.get(test.key)} asked={asked} nested={by !== 'none'} />
      ))}
      {group.tests.length > shown && (
        <List.Item>
          <Button variant="subtle" size="compact-sm" c="dimmed" ml={by === 'none' ? 'sm' : 36} my={4} onClick={() => setShown(shown + (by === 'none' ? 100 : GROUP_ROWS))}>
            Show more ({group.tests.length - shown} more)
          </Button>
        </List.Item>
      )}
    </List>
  );
  return (
    <Box component="section" aria-label={group.label} px={8} py={2}>
      {by === 'none' ? (
        rows
      ) : (
        <>
          <NavLink
            component="button"
            type="button"
            aria-expanded={open}
            onClick={onToggle}
            py={8}
            leftSection={open ? <IconChevronDown size={16} aria-hidden="true" /> : <IconChevronRight size={16} aria-hidden="true" />}
            label={
              <Group gap="xs" wrap="wrap" align="baseline">
                <Text span fw={600}>
                  {group.label}
                </Text>
                {group.detail && (
                  <Text span ff="monospace" size="xs" c="dimmed" truncate visibleFrom="sm">
                    {group.detail}
                  </Text>
                )}
              </Group>
            }
            rightSection={
              <Group gap="sm" wrap="nowrap">
                {group.counts.failed > 0 && <Badge size="sm" color="red">{group.counts.failed} failed</Badge>}
                {group.counts['not-run'] > 0 && <Badge size="sm" color="gray">{group.counts['not-run']} not run</Badge>}
                <Text span size="xs" c="dimmed" visibleFrom="xs">
                  {plural(group.tests.length, 'test', 'tests')}
                  {group.avgMs !== null ? ` · avg ${formatMs(group.avgMs)}` : ''}
                </Text>
                <Box w={72} visibleFrom="sm">
                  <Meter counts={group.counts} />
                </Box>
              </Group>
            }
          />
          {open && rows}
        </>
      )}
    </Box>
  );
}
function TestRow({
  test,
  selected,
  now,
  hit,
  assessment,
  asked,
  nested
}: {
  test: TestSummary;
  selected: boolean;
  now: number;
  hit: Ranked | undefined;
  assessment: Assessment | undefined;
  asked: boolean;
  /** Under a group heading, where rows sit in from its chevron. */
  nested: boolean;
}) {
  const why = hit ? describeHit(hit) : '';
  const failure = test.status === 'failed' ? test.outcomes.find((outcome) => outcome.status === 'failed')?.detail.split('\n')[0] : '';
  const figure = (title: string, value: ReactNode) => (
    <Text span title={title} size="xs" c="dimmed" w={COLUMN} ta="right">
      {value}
    </Text>
  );
  return (
    <List.Item data-status={test.status}>
      <NavLink
        active={selected}
        variant="light"
        aria-current={selected ? 'true' : undefined}
        py={8}
        pl={nested ? 36 : 'sm'}
        bg={selected ? 'var(--mantine-color-primary-light)' : undefined}
        c="var(--mantine-color-text)"
        leftSection={<StatusMark status={test.status} size={16} />}
        label={
          <Group gap="xs" wrap="wrap" align="center">
            <Text span fw={500}>
              {test.title}
            </Text>
            <EnvironmentChips test={test} />
            <Badges test={test} />
            {assessment && (assessment.verdict === 'stale' || (asked && assessment.verdict !== 'applies')) && <VerdictBadge verdict={assessment.verdict} />}
          </Group>
        }
        description={
          failure || why ? (
            <Stack component="span" gap={2} mt={2}>
              {failure && (
                <Text span size="xs" c="red" lineClamp={2}>
                  {failure}
                </Text>
              )}
              {why && (
                <Text span size="xs" c="dimmed" data-why>
                  {hit?.exact && (
                    <Badge component="span" size="xs" color="blue" mr={6}>
                      Exact
                    </Badge>
                  )}
                  {why}
                </Text>
              )}
            </Stack>
          ) : undefined
        }
        rightSection={
          <Group gap={0} visibleFrom="sm" wrap="nowrap">
            {figure('Average duration', formatMs(test.stats.durations?.avgMs))}
            {figure('Pass rate', percent(test.stats.passRate))}
            {figure('Runs', test.stats.runs || '—')}
            {figure('Last recorded', test.live ? 'now' : test.lastRecordedAtMs ? ago(test.lastRecordedAtMs, now).replace(' ago', '') : '—')}
          </Group>
        }
        renderRoot={(props) => (
          <Link
            {...props}
            to="/"
            search={patched({ test: selected ? undefined : test.key, layer: undefined })}
            resetScroll={false}
            activeOptions={{ exact: true }}
          />
        )}
      />
    </List.Item>
  );
}
