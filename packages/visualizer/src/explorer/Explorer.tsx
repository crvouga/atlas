import { SpecLogo } from '../components/SpecLogo';
import { IconX } from '@tabler/icons-react';
import {
  Accordion,
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Container,
  Drawer,
  Flex,
  Group,
  List,
  MultiSelect,
  NativeSelect,
  Paper,
  SimpleGrid,
  Stack,
  Tabs,
  Text,
  TextInput,
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
  TEST_SORTS,
  testCatalog,
  type CatalogModel,
  type TestQuery,
  type TestSort,
  type TestSummary
} from '@crvouga/atlas/reports/test-catalog';
import { Link } from '@tanstack/react-router';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useEvidence } from '../evidence/evidence-context';
import { ago, plural, useNow } from '../evidence/format';
import { Meter, StatusMark } from '../evidence/marks';
import { SPEC_KINDS } from '../spec-kind';
import { useRunDetail, useTestCatalog } from './catalog';
import { groupTests, tally, type TestGroupView } from './groups';
import { patched, useExplorerNavigate, useExplorerSearch } from './navigate';
import { Badges, EnvironmentChips, projectTitle, runName } from './parts';
import { ArtifactsView } from './ArtifactsView';
import { RunsView } from './RunsView';
import { joined, narrowed, queryOf, TEST_GROUPS, toggled, values, type ExplorerSearch, type TestGroup } from './search';
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
const SORT_LABEL: Record<TestSort, string> = {
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
/** What the explorer lists for an address: the tests shown, and the scope the insight strip and filter counts describe. */
function useListing(model: CatalogModel | null, search: ExplorerSearch, q: string | undefined) {
  const run = useRunDetail(search.inRun);
  const inRun = useMemo(
    () => (search.inRun ? new Set(run.data?.results.map((result) => result.key) ?? []) : null),
    [search.inRun, run.data]
  );
  return useMemo(() => {
    if (!model) return null;
    const query: TestQuery = { ...queryOf(search), ...(q ? { q } : { q: undefined }) };
    const shown = testCatalog(model, { ...query, limit: 20000 }).tests.filter((test) => !inRun || inRun.has(test.key));
    // The strip and the status and environment counts describe what the other filters leave.
    const scope = model.tests.filter((test) => matchesQuery(model, test, { ...query, status: [], environment: [] }, inRun));
    const byEnvironment = scope.filter((test) => matchesQuery(model, test, { environment: query.environment }));
    const byStatus = scope.filter((test) => matchesQuery(model, test, { status: query.status }));
    return {
      shown,
      scope,
      byEnvironment,
      byStatus,
      runPending: !!search.inRun && run.isPending,
      runMissing: !!search.inRun && run.isSuccess && run.data === null
    };
  }, [model, search, q, inRun, run.isPending, run.isSuccess, run.data]);
}
/** The project home: the published spec kinds, the insight strip, the toolbar, the grouped list and the open test. */
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
  const split = !!search.test && search.tab !== 'runs' && search.tab !== 'artifacts';
  return (
    <Container size="xl" py="xl">
      <Box aria-label="Test explorer" component="article" miw={0}>
        <Box component="header" mb="lg">
          <Title order={1} mb="sm">
            {projectTitle()}
          </Title>
          {model && model.tests.length > 0 && (
            <Tabs
              value={search.tab ?? 'tests'}
              onChange={(value) => go({ tab: value === 'runs' || value === 'artifacts' ? value : undefined, test: undefined, openRun: undefined, layer: undefined })}
            >
              <Tabs.List aria-label="Explorer view">
                <Tabs.Tab
                  value="tests"
                  rightSection={
                    <Text span c="dimmed">
                      {model.tests.length}
                    </Text>
                  }
                >
                  Tests
                </Tabs.Tab>
                <Tabs.Tab
                  value="runs"
                  rightSection={
                    <Text span c="dimmed">
                      {model.summary.runs}
                    </Text>
                  }
                >
                  Runs
                </Tabs.Tab>
                <Tabs.Tab value="artifacts">Artifacts</Tabs.Tab>
              </Tabs.List>
            </Tabs>
          )}
        </Box>
        {evidence.unavailable && (
          <Alert role="alert" color={'red'} my="sm">
            {evidence.unavailable}
          </Alert>
        )}
        {catalog.notice && (
          <Alert role="status" color={'blue'} my="sm">
            The server’s test history could not be read ({catalog.notice}). Showing what this page holds.
          </Alert>
        )}
        {kinds.length > 0 && (
          <Box aria-label="Published specs" component="section" mb="lg">
            <Title order={2} mb="sm" c="dimmed">
              Specs
            </Title>
            <List spacing="xs" listStyleType="none">
              {kinds.map(({ kind, files }) => (
                <List.Item key={kind.id}>
                  <Anchor renderRoot={(props) => <Link {...props} to="/specs/$kind" params={{ kind: kind.id }} search={{}} />}>
                    <Group component="span" display="inline-flex" gap="xs">
                      <SpecLogo kind={kind} />
                      <Text span inherit fw={600}>
                        {kind.label}
                      </Text>
                      <Text span inherit>
                        {files.length} {files.length === 1 ? kind.one : kind.many}
                      </Text>
                    </Group>
                  </Anchor>
                </List.Item>
              ))}
            </List>
          </Box>
        )}
        {!model && !evidence.unavailable && (
          <Text role="status" component="div" c="dimmed">
            Loading tests…
          </Text>
        )}
        {empty && !kinds.length && (
          <Text component="div" c="dimmed">
            No reports yet. Publish tests and specs to this project to populate its report.
          </Text>
        )}
        {empty && kinds.length > 0 && (
          <Text component="div" c="dimmed">
            No test results recorded yet.
          </Text>
        )}
        {model &&
          !empty &&
          listing &&
          (search.tab === 'runs' ? (
            <RunsView />
          ) : search.tab === 'artifacts' ? (
            <ArtifactsView />
          ) : (
            <>
              <InsightStrip model={model} scope={listing.scope} search={search} />
              <Toolbar
                model={model}
                search={search}
                listing={listing}
                onSearch={(value) => go({ q: value || undefined }, { replace: true })}
              />
              {listing.runPending && (
                <Text role="status" component="div" c="dimmed">
                  Reading the tests of this run…
                </Text>
              )}
              {listing.runMissing && (
                <Alert role="status" color={'blue'} my="sm">
                  That run is not in the report any more.
                </Alert>
              )}
              <TestList tests={listing.shown} search={search} total={model.tests.length} />
            </>
          ))}
      </Box>
      <Drawer opened={split} onClose={() => go({ test: undefined, layer: undefined })} title="Test detail" size="xl">
        <Box aria-label="Test detail" component="aside">
          {selected ? (
            <TestDetail test={selected} slot={slots.get(selected.key)} />
          ) : model ? (
            <Stack gap="sm">
              <Alert color={'blue'} my="sm">
                This test is not in the report any more. A source may be switched off, or its results were removed.
              </Alert>
              <Anchor
                renderRoot={(props) => (
                  <Link {...props} to="/" search={patched({ test: undefined, layer: undefined })} resetScroll={false} activeOptions={{ exact: true }} />
                )}
              >
                Close
              </Anchor>
            </Stack>
          ) : (
            <Text role="status" component="div" c="dimmed">
              Loading the test…
            </Text>
          )}
        </Box>
      </Drawer>
    </Container>
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
  const last = scope.reduce((latest, test) => Math.max(latest, test.lastRecordedAtMs), 0);
  const status = (id: string) => go({ status: statuses.length === 1 && statuses[0] === id ? undefined : id });
  return (
    <Box component="section" aria-label="Insights" mb="lg">
      <SimpleGrid cols={{ base: 1, sm: 2, xl: 4 }} spacing="md">
        <Paper withBorder>
          <Stack gap="xs">
            <Text c="dimmed">Tests</Text>
            <Title order={2}>{scope.length.toLocaleString()}</Title>
            <Meter counts={counts} />
            <Group gap="xs">
              <Button
                color="red"
                variant={statuses.includes('failed') ? 'light' : 'subtle'}
                aria-pressed={statuses.includes('failed')}
                disabled={!counts.failed}
                onClick={() => status('failed')}
              >
                {counts.failed} failed
              </Button>
              <Button
                color="green"
                variant={statuses.includes('passed') ? 'light' : 'subtle'}
                aria-pressed={statuses.includes('passed')}
                onClick={() => status('passed')}
              >
                {counts.passed} passed
              </Button>
              {counts['not-run'] > 0 && (
                <Button aria-pressed={statuses.includes('not-run')} onClick={() => status('not-run')}>
                  {counts['not-run']} not run
                </Button>
              )}
              {counts.running > 0 && (
                <Button aria-pressed={statuses.includes('running')} onClick={() => status('running')}>
                  {counts.running} running
                </Button>
              )}
            </Group>
          </Stack>
        </Paper>
        <Paper withBorder>
          <Stack gap="xs">
            <Text c="dimmed">Flaky</Text>
            <Title order={2}>{flaky}</Title>
            <Text size="xs" c="dimmed">
              {flaky ? 'Passed and failed on one commit, or needed a retry' : 'None recorded'}
            </Text>
            <Button
              color="orange"
              variant={statuses.includes('flaky') ? 'light' : 'subtle'}
              aria-pressed={statuses.includes('flaky')}
              aria-label={`${flaky} flaky tests`}
              onClick={() => status('flaky')}
            >
              View flaky tests
            </Button>
          </Stack>
        </Paper>
        <Paper withBorder>
          <Stack gap="xs">
            <Text c="dimmed">Duration</Text>
            <Title order={2}>{durations ? formatMs(durations.avgMs) : '—'}</Title>
            <Text size="xs" c="dimmed">
              {durations
                ? `average · p95 ${formatMs(durations.p95Ms)} · ${averages.length.toLocaleString()} measured`
                : 'No durations recorded. Producers can send durationMs with each check.'}
            </Text>
            <Anchor
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
              {last ? `Last recorded ${ago(last, now)}` : 'Nothing recorded yet'}
            </Text>
          </Stack>
        </Paper>
        <Paper withBorder>
          <Stack gap="xs">
            <Text c="dimmed">Environments</Text>
            {environments.map((group) => (
              <Button
                key={group.key}
                variant={envs.includes(group.key) ? 'light' : 'subtle'}
                fullWidth
                h="auto"
                py="xs"
                justify="flex-start"
                aria-pressed={envs.includes(group.key)}
                onClick={() => go({ env: toggled(search.env, group.key) })}
                title={`Show only ${group.label}`}
              >
                <Stack align="flex-start" gap="xs">
                  <Text fw={500}>{group.label}</Text>
                  <Text size="xs" c="dimmed">
                    {plural(group.tests.length, 'test', 'tests')} · {group.counts.failed} failed · {group.counts.passed} passed
                    {group.counts['not-run'] ? ` · ${group.counts['not-run']} not run` : ''}
                    {group.avgMs !== null ? ` · avg ${formatMs(group.avgMs)}` : ''}
                  </Text>
                </Stack>
              </Button>
            ))}
          </Stack>
        </Paper>
      </SimpleGrid>
      <Box mt="md">
        <MoreInsights scope={scope} />
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
      <Stack gap="sm">
        <Title order={3} mb="sm" c="dimmed">
          {title}
        </Title>
        <List spacing="xs" listStyleType="none" type="ordered">
          {tests.map((test) => (
            <List.Item key={test.key}>
              <Anchor
                renderRoot={(props) => (
                  <Link {...props} to="/" search={patched({ test: test.key, layer: undefined })} resetScroll={false} activeOptions={{ exact: true }} />
                )}
              >
                <StatusMark status={test.status} size={12} />
                <Flex component="span" direction="column" gap="xs" miw={0}>
                  {test.title}
                </Flex>
                <Text span inherit>
                  {value(test)}
                </Text>
              </Anchor>
            </List.Item>
          ))}
        </List>
      </Stack>
    );
  return (
    <Accordion variant="separated" my="sm">
      <Accordion.Item value="content">
        <Accordion.Control>Slowest, flakiest and failing tests</Accordion.Control>
        <Accordion.Panel>
          <SimpleGrid cols={{ base: 1, md: 3 }}>
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
function Toolbar({
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
  return (
    <Box aria-label="Find tests" component="section" mb="xl">
      <Flex gap="sm" align="flex-end" wrap="wrap" mb="md">
        <TextInput
          flex={1}
          miw={{ base: '100%', sm: '15rem' }}
          type="search"
          aria-label="Search tests"
          placeholder="Search titles, specs, domains, tags, environments…"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            onSearch(event.target.value.trim());
          }}
        />
        <Box component="label">
          <Text span inherit>
            Group by
          </Text>
          <NativeSelect
            aria-label="Group by"
            value={search.group ?? 'spec'}
            onChange={(event) => go({ group: event.target.value === 'spec' ? undefined : (event.target.value as TestGroup) })}
          >
            {TEST_GROUPS.map((group) => (
              <option key={group} value={group}>
                {GROUP_LABEL[group]}
              </option>
            ))}
          </NativeSelect>
        </Box>
        <Box component="label">
          <Text span inherit>
            Sort
          </Text>
          <NativeSelect
            aria-label="Sort"
            value={search.sort ?? 'spec'}
            onChange={(event) => go({ sort: event.target.value === 'spec' ? undefined : (event.target.value as TestSort) })}
          >
            {TEST_SORTS.map((sort) => (
              <option key={sort} value={sort}>
                {SORT_LABEL[sort]}
              </option>
            ))}
          </NativeSelect>
        </Box>
      </Flex>
      <Flex role="group" aria-label="Test status" gap="xs" align="center" wrap="wrap" mb="sm">
        {STATUS_FILTERS.map((filter) => {
          const count = statusCount(filter.id);
          if (filter.id === 'running' && count === 0 && !statuses.includes('running')) return null;
          const pressed = filter.id === '' ? statuses.length === 0 : statuses.length === 1 && statuses[0] === filter.id;
          return (
            <Button
              key={filter.id || 'all'}
              type="button"
              aria-pressed={pressed}
              data-status={(count > 0 && filter.id) || undefined}
              onClick={() => go({ status: filter.id || undefined })}
              variant={pressed ? 'light' : 'subtle'}
            >
              {filter.label}{' '}
              <Text span inherit>
                {count.toLocaleString()}
              </Text>
            </Button>
          );
        })}
      </Flex>
      <Flex gap="xs" align="center" wrap="wrap">
        {model.facets.environments.length > 0 && (
          <Flex role="group" aria-label="Environments" gap="xs" align="center" wrap="wrap">
            {model.facets.environments.map(({ value }) => (
              <Button
                key={value}
                type="button"
                aria-pressed={envs.includes(value)}
                onClick={() => go({ env: toggled(search.env, value) })}
                variant={envs.includes(value) ? 'light' : 'subtle'}
              >
                {environmentLabel(value)}{' '}
                <Text span inherit>
                  {(envCounts.get(value) ?? 0).toLocaleString()}
                </Text>
              </Button>
            ))}
          </Flex>
        )}
        {model.facets.producers.length > 1 && (
          <Box component="label">
            <VisuallyHidden>Producer</VisuallyHidden>
            <NativeSelect
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
          </Box>
        )}
        {((model.facets.artifactTags?.length ?? 0) > 0 || values(search.artifactTag).length > 0) && (
          <MultiSelect
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
        {model.facets.domains.length > 1 && (
          <Box component="label">
            <VisuallyHidden>Domain</VisuallyHidden>
            <NativeSelect
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
          </Box>
        )}
        {(model.facets.scopes?.length ?? 0) > 0 && (
          <Box component="label">
            <VisuallyHidden>Recording scope</VisuallyHidden>
            <NativeSelect
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
          </Box>
        )}
      </Flex>
      <Flex role="status" gap="xs" align="center" wrap="wrap">
        <Text span inherit>
          {listing.shown.length === model.tests.length
            ? plural(model.tests.length, 'test', 'tests')
            : `${listing.shown.length.toLocaleString()} of ${plural(model.tests.length, 'test', 'tests')}`}
        </Text>
        {chips.map((chip) => (
          <Button key={chip.label} type="button" onClick={() => go(chip.clear)} aria-label={`Remove ${chip.label}`} variant="light">
            {chip.label}{' '}
            <Text aria-hidden="true" span inherit>
              <IconX size={16} aria-hidden="true" />
            </Text>
          </Button>
        ))}
        {narrowed(search) && (
          <Button
            type="button"
            onClick={() => {
              setDraft('');
              go({
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
                inRun: undefined
              });
            }}
            variant="subtle"
          >
            Clear filters
          </Button>
        )}
      </Flex>
    </Box>
  );
}
function TestList({ tests, search, total }: { tests: readonly TestSummary[]; search: ExplorerSearch; total: number }) {
  const by = search.group ?? 'spec';
  const groups = useMemo(() => groupTests(tests, by, (search.sort ?? 'spec') === 'spec'), [tests, by, search.sort]);
  const [overrides, setOverrides] = useState<ReadonlyMap<string, boolean>>(new Map());
  const defaultOpen = groups.length <= OPEN_GROUPS || tests.length <= OPEN_TESTS;
  const isOpen = (group: TestGroupView) => by === 'none' || (overrides.get(`${by}|${group.key}`) ?? defaultOpen);
  const setAll = (open: boolean) => setOverrides(new Map(groups.map((group) => [`${by}|${group.key}`, open])));
  if (!tests.length)
    return (
      <Text role="status" component="div" c="dimmed">
        {total ? 'No test matches these filters.' : 'No tests recorded yet.'}
      </Text>
    );
  let parent: string | null = null;
  return (
    <Box aria-label="Tests" component="section" mb="lg">
      <Flex gap="xs" align="center" wrap="wrap">
        <Text span inherit>
          {by === 'none'
            ? ''
            : `${plural(groups.length, GROUP_LABEL[by].toLowerCase(), by === 'status' ? 'statuses' : `${GROUP_LABEL[by].toLowerCase()}s`)}`}
        </Text>
        {by !== 'none' && (
          <Flex component="span" display="inline-flex" gap="xs" align="center" wrap="wrap">
            <Button type="button" onClick={() => setAll(true)} variant="subtle">
              Expand all
            </Button>
            <Button type="button" onClick={() => setAll(false)} variant="subtle">
              Collapse all
            </Button>
          </Flex>
        )}
        <Group aria-hidden="true" gap="md" ml="auto" visibleFrom="sm">
          <Text span inherit>
            Avg
          </Text>
          <Text span inherit>
            Pass
          </Text>
          <Text span inherit>
            Runs
          </Text>
          <Text span inherit>
            Last
          </Text>
        </Group>
      </Flex>
      {groups.map((group) => {
        const heading = by === 'spec' && group.parent !== parent ? group.parent : null;
        parent = group.parent;
        return (
          <Stack key={group.key} gap="sm">
            {heading && (
              <Title order={3} mb="sm">
                {heading === '(no spec)' ? 'No spec' : heading}
              </Title>
            )}
            <TestGroupSection
              group={group}
              by={by}
              open={isOpen(group)}
              selected={search.test}
              onToggle={() => setOverrides(new Map(overrides).set(`${by}|${group.key}`, !isOpen(group)))}
            />
          </Stack>
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
  onToggle
}: {
  group: TestGroupView;
  by: TestGroup;
  open: boolean;
  selected: string | undefined;
  onToggle: () => void;
}) {
  const [shown, setShown] = useState(by === 'none' ? 100 : GROUP_ROWS);
  const now = useNow();
  const rows = (
    <List spacing="xs" listStyleType="none">
      {group.tests.slice(0, shown).map((test) => (
        <TestRow key={test.key} test={test} selected={selected === test.key} now={now} />
      ))}
      {group.tests.length > shown && (
        <List.Item>
          <Button variant="subtle" onClick={() => setShown(shown + (by === 'none' ? 100 : GROUP_ROWS))}>
            Show more ({group.tests.length - shown} more)
          </Button>
        </List.Item>
      )}
    </List>
  );
  return (
    <Box component="section" aria-label={group.label} mb="md">
      {by === 'none' ? (
        rows
      ) : (
        <Accordion variant="separated" value={open ? 'tests' : null} onChange={onToggle}>
          <Accordion.Item value="tests">
            <Accordion.Control>
              <Group gap="md" justify="space-between">
                <Stack gap="xs" miw={0}>
                  <Text fw={600}>{group.label}</Text>
                  {group.detail && (
                    <Text ff="monospace" size="xs" c="dimmed">
                      {group.detail}
                    </Text>
                  )}
                </Stack>
                <Group gap="xs">
                  {group.counts.failed > 0 && <Badge color="red">{group.counts.failed} failed</Badge>}
                  {group.counts['not-run'] > 0 && <Badge color="gray">{group.counts['not-run']} not run</Badge>}
                  <Text size="xs" c="dimmed">
                    {plural(group.tests.length, 'test', 'tests')}
                    {group.avgMs !== null ? ` · avg ${formatMs(group.avgMs)}` : ''}
                  </Text>
                </Group>
              </Group>
            </Accordion.Control>
            <Accordion.Panel>{open && rows}</Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      )}
    </Box>
  );
}
function TestRow({ test, selected, now }: { test: TestSummary; selected: boolean; now: number }) {
  const failure = test.status === 'failed' ? test.outcomes.find((outcome) => outcome.status === 'failed')?.detail.split('\n')[0] : '';
  return (
    <List.Item data-status={test.status}>
      <Anchor
        underline="never"
        aria-current={selected ? 'true' : undefined}
        display="block"
        bg={selected ? 'blue.0' : undefined}
        p="sm"
        c="text"
        renderRoot={(props) => (
          <Link
            {...props}
            to="/"
            search={patched({ test: selected ? undefined : test.key, layer: undefined })}
            resetScroll={false}
            activeOptions={{ exact: true }}
          />
        )}
      >
        <Group gap="sm" wrap="nowrap" align="flex-start">
          <StatusMark status={test.status} size={16} />
          <Stack gap="xs" flex={1} miw={0}>
            <Text fw={500}>{test.title}</Text>
            <Group gap="xs">
              <EnvironmentChips test={test} />
              <Badges test={test} />
            </Group>
            {failure && (
              <Text size="xs" c="red.7" lineClamp={2}>
                {failure}
              </Text>
            )}
          </Stack>
          <Group gap="md" visibleFrom="sm">
            <Text title="Average duration" size="xs" c="dimmed">
              {formatMs(test.stats.durations?.avgMs)}
            </Text>
            <Text title="Pass rate" size="xs" c="dimmed">
              {percent(test.stats.passRate)}
            </Text>
            <Text title="Runs" size="xs" c="dimmed">
              {test.stats.runs || '—'}
            </Text>
            <Text title="Last recorded" size="xs" c="dimmed">
              {test.live ? 'now' : test.lastRecordedAtMs ? ago(test.lastRecordedAtMs, now).replace(' ago', '') : '—'}
            </Text>
          </Group>
        </Group>
      </Anchor>
    </List.Item>
  );
}
