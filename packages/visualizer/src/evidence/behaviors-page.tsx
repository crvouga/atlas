/**
 * @module Behaviors across the project
 *
 * `/behaviors`: every behavior of every Gherkin feature in one searchable list, each with its coverage state, and the
 * Read / Watch / Inspect panel of the one selected. A behavior opens into a dedicated read-and-watch workspace that uses
 * the width of the screen: what should happen beside its recording, the scoped outcome, reliability and performance
 * summary below, and the technical record behind a disclosure. The search words, coverage filter and selection are in
 * the address; where the reader had scrolled to, how much of the list was shown and which row had focus are remembered
 * for the session, so leaving the workspace gives the list back as it was, with focus on the behavior that was open.
 */
import { Accordion, ActionIcon, Alert, Anchor, Badge, Box, Button, Card, Divider, Grid, Group, NavLink, ScrollArea, Stack, Text, TextInput, ThemeIcon, Title, Tooltip } from '@mantine/core';
import { IconArrowLeft, IconArrowsMaximize, IconChevronLeft, IconChevronRight, IconBook, IconListSearch, IconMovie, IconPlayerPlay, IconSearch, IconZoomQuestion } from '@tabler/icons-react';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { PageHeader, Panel } from '../components/Page';

import { SearchNotes, TypedFilters } from '../explorer/search-notes';
import { useDocSearch } from '../find/doc-search';
import { passesFilters } from '../find/query';
import type { BehaviorsSearch } from '../app/router';
import { specKind } from '../spec-kind';
import { needsAttention, type ReleaseIdentity } from './applicability';
import { ApplicabilityControls, ApplicabilitySummary, useApplicabilityState, type ApplicabilityState } from './applicability-view';
import { behaviorDoc, indexBehaviors, type IndexedBehavior } from './behavior-index';
import { BehaviorPanel, behaviorSteps, CoverageBadge, Illustrative, NothingToWatch, Player, Provenance, RevisionLine, VideoMark } from './behavior-panel';
import { forgetReturn, recallReturn, rememberReturn, scopeKey } from './behavior-return';
import { COVERAGE, COVERAGE_ORDER, coverageCounts, type CoverageState } from './behavior';
import { CheckDetail, PlainSteps, type SelectCheck } from './check-detail';
import { useEvidence } from './evidence-context';
import { plural } from './format';
import { StateBlock } from './load-state';
import { ScopedSummary } from './scoped-summary-view';
import { useSpecTexts } from './spec-texts';

/** Rows of the list shown before "Show more". */
const PAGE = 40;

/** The domain heading for behaviors whose spec declares none. */
const NO_DOMAIN = 'No domain declared';

/** Reads every feature and files its behaviors; `pending` while features are still being read. */
function useBehaviorIndex(release: ReleaseIdentity) {
  const evidence = useEvidence();
  const gherkin = specKind('gherkin')!;
  const files = useMemo(() => evidence.files.filter(gherkin.accepts), [evidence.files, gherkin]);
  const { texts, pending } = useSpecTexts(files, true, false);
  const index = useMemo(
    () => indexBehaviors({ files, texts, specs: evidence.specs, view: evidence.view, evidence: evidence.evidence, release }),
    [files, texts, evidence.specs, evidence.view, evidence.evidence, release]
  );
  return { index, pending: pending || evidence.filesPending, filesError: evidence.filesError };
}

/** What the search and coverage filter leave of the project's behaviors, best match first when words were typed. */
function useListing(entries: readonly IndexedBehavior[], search: BehaviorsSearch, onlyStale: boolean) {
  const docs = useMemo(() => new Map(entries.map((entry) => [entry.id, behaviorDoc(entry)] as const)), [entries]);
  const list = useMemo(() => [...docs.values()], [docs]);
  const found = useDocSearch(list, useDeferredValue(search.q));
  const scoped = useMemo(() => {
    const kept = entries.filter((entry) => (!found.hits || found.hits.has(entry.id)) && (!onlyStale || needsAttention(entry.assessment)) && passesFilters(docs.get(entry.id)?.facets, found.parsed.filters));
    if (!found.hits) return kept;
    const order = new Map([...found.hits.keys()].map((id, at) => [id, at] as const));
    return [...kept].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  }, [entries, docs, found.hits, found.parsed, onlyStale]);
  const counts = useMemo(() => coverageCounts(scoped.map((entry) => entry.behavior)), [scoped]);
  const shown = useMemo(() => (search.coverage ? scoped.filter((entry) => entry.behavior.state === search.coverage) : scoped), [scoped, search.coverage]);
  return { found, scoped, shown, counts, ranked: found.hits !== null };
}

type Listing = ReturnType<typeof useListing>;

/** The technical record of a behavior: runs, environments, attempts and files, as on the feature page. */
function Inspect({ entry }: { entry: IndexedBehavior }) {
  const search = useSearch({ from: '/behaviors' });
  const navigate = useNavigate({ from: '/behaviors' });
  const { slot } = entry.behavior;
  const written = <PlainSteps steps={entry.behavior.scenario.steps} examples={entry.behavior.scenario.examples} />;
  if (!slot) {
    return (
      <>
        <Text component="div" c="dimmed">
          No completed test report for this scenario yet.
        </Text>
        {written}
      </>
    );
  }
  const select: SelectCheck = (patch) => {
    // A full recording page belongs to the feature's own page.
    if (patch.view === 'recording') {
      void navigate({ to: '/specs/$kind', params: { kind: 'gherkin' }, search: { spec: entry.file, check: slot.id, layer: patch.layer ?? undefined, view: 'recording' } });
      return;
    }
    if (patch.layer !== undefined) void navigate({ search: (prev) => ({ ...prev, layer: patch.layer ?? undefined }), replace: true, resetScroll: false });
  };
  return <CheckDetail slot={slot} layerId={search.layer} select={select} reads="steps" written={written} />;
}

/** The feature a behavior is written in, with its rule, as a line. */
function whereIs(entry: IndexedBehavior): string {
  return [entry.feature, entry.rule].filter(Boolean).join(' › ');
}

/** The address of a behavior in the index: its selection replaces the previous one and its pinned run and moment are dropped. */
function selecting(id: string, workspace: boolean) {
  return (prev: BehaviorsSearch): BehaviorsSearch => ({
    ...prev,
    behavior: id,
    workspace: workspace ? true : undefined,
    ...(workspace ? {} : { layer: undefined, clip: undefined, clipAt: undefined })
  });
}

/** One behavior in the list: its words, where it is written, whether there is a recording to watch and its coverage state, as a link that selects it. */
function Row({ entry, selected }: { entry: IndexedBehavior; selected: boolean }) {
  return (
    <NavLink
      label={entry.title}
      description={whereIs(entry)}
      active={selected}
      aria-current={selected ? 'true' : undefined}
      data-behavior-row={entry.id}
      data-coverage={entry.behavior.state}
      rightSection={
        <Group gap="xs" wrap="nowrap">
          {entry.behavior.demo && <VideoMark />}
          <CoverageBadge state={entry.behavior.state} />
        </Group>
      }
      renderRoot={(props) => <Link {...props} to="/behaviors" search={selecting(entry.id, false)} resetScroll={false} />}
    />
  );
}

/** What the project's behaviors add up to in this search: one button per coverage state that filters the list to it. */
function CoverageFilter({ listing, coverage }: { listing: Listing; coverage: CoverageState | undefined }) {
  const navigate = useNavigate({ from: '/behaviors' });
  const set = (next: CoverageState | undefined) => void navigate({ search: (prev) => ({ ...prev, coverage: next }), replace: true, resetScroll: false });
  const { counts, scoped } = listing;
  return (
    <Stack gap={6} component="section" aria-label="Coverage">
      <Group role="group" aria-label="Coverage state" gap={4}>
        <Button type="button" size="compact-sm" aria-pressed={!coverage} variant={coverage ? 'subtle' : 'light'} onClick={() => set(undefined)} rightSection={<Text span inherit c="dimmed">{scoped.length}</Text>}>
          All{' '}
        </Button>
        {COVERAGE_ORDER.filter((state) => state === 'demonstrated' || counts[state] > 0 || coverage === state).map((state) => (
          <Button key={state} type="button" size="compact-sm" aria-pressed={coverage === state} variant={coverage === state ? 'light' : 'subtle'} title={COVERAGE[state].meaning} onClick={() => set(coverage === state ? undefined : state)} rightSection={<Text span inherit c="dimmed">{counts[state]}</Text>}>
            {COVERAGE[state].label}{' '}
          </Button>
        ))}
      </Group>
      <Text component="div" size="xs" c="dimmed">
        {counts.demonstrated} of {plural(scoped.length, 'behavior', 'behaviors')} demonstrated with a recording of the current spec.{' '}
        A recording shows one run. It is illustrative evidence and does not mean a behavior is live or ready for production.
      </Text>
    </Stack>
  );
}

/** What could not be put in the list: features still being read, and features that could not be read. */
function Disclosure({ unread, features, unreadable, pending, error }: { unread: number; features: number; unreadable: readonly string[]; pending: boolean; error: boolean }) {
  return (
    <>
      {error && (
        <Alert role="alert" color="red">
          The list of features could not be loaded, so this list may be missing behaviors.
        </Alert>
      )}
      {pending && unread > 0 && (
        <Text role="status" component="div" c="dimmed">
          Reading features: {features - unread} of {features} read. Behaviors from the rest are not listed yet, so an empty answer is not final.
        </Text>
      )}
      {unreadable.length > 0 && (
        <Alert role="status" color="orange" title={`${plural(unreadable.length, 'feature', 'features')} could not be read`}>
          Their behaviors are not in this list: {unreadable.join(', ')}.
        </Alert>
      )}
    </>
  );
}

/** The list of behaviors, grouped by declared domain, or ranked best match first when words were typed. */
function BehaviorList({ listing, selected, limit, onMore }: { listing: Listing; selected: string | undefined; limit: number; onMore: () => void }) {
  const { shown, ranked } = listing;
  const visible = shown.slice(0, limit);
  const groups = useMemo(() => {
    if (ranked) return [['', visible] as const];
    const byDomain = new Map<string, IndexedBehavior[]>();
    for (const entry of visible) byDomain.set(entry.domain || NO_DOMAIN, [...(byDomain.get(entry.domain || NO_DOMAIN) ?? []), entry]);
    return [...byDomain];
  }, [visible, ranked]);
  return (
    <Stack gap={0} component="section" aria-label="Behavior list">
      {groups.map(([domain, entries]) => (
        <Box key={domain || 'ranked'} component="section" aria-label={domain || undefined}>
          {domain && (
            <Group justify="space-between" gap="xs" px="md" py={6} bg="var(--mantine-color-default-hover)">
              <Title order={2} size="xs" fw={600} c="dimmed">
                {domain}
              </Title>
              <Text span size="xs" c="dimmed" aria-hidden="true">
                {entries.length}
              </Text>
            </Group>
          )}
          <Stack gap={2} p="xs">
            {entries.map((entry) => (
              <Row key={entry.id} entry={entry} selected={selected === entry.id} />
            ))}
          </Stack>
        </Box>
      ))}
      {shown.length > limit && (
        <Box p="xs" pt={0}>
          <Button type="button" variant="subtle" fullWidth onClick={onMore}>
            Show more behaviors ({shown.length - limit} more)
          </Button>
        </Box>
      )}
    </Stack>
  );
}

/** One of the three things a selected behavior offers, with its icon. */
function Offer({ icon, title, children }: { icon: ReactNode; title: string; children: string }) {
  return (
    <Group wrap="nowrap" align="flex-start" gap="sm">
      <ThemeIcon variant="light" color="gray" size={36} radius="md" aria-hidden="true">
        {icon}
      </ThemeIcon>
      <Box>
        <Text fw={600}>{title}</Text>
        <Text c="dimmed">{children}</Text>
      </Box>
    </Group>
  );
}

/** The index: search, coverage filter, the list, and beside it the Read / Watch / Inspect panel of the selected behavior. */
function Index({ listing, search, index, pending, filesError, applicability }: { listing: Listing; search: BehaviorsSearch; index: ReturnType<typeof useBehaviorIndex>['index']; pending: boolean; filesError: boolean; applicability: ApplicabilityState }) {
  const navigate = useNavigate({ from: '/behaviors' });
  const scope = scopeKey(search);
  const [draft, setDraft] = useState(search.q ?? '');
  // What the workspace remembered for this scope; it is kept until it has been given back.
  const [point] = useState(() => recallReturn(scope));
  const [limit, setLimit] = useState(Math.max(PAGE, point?.shown ?? 0));
  const selected = search.behavior ? (index.entries.find((entry) => entry.id === search.behavior) ?? null) : null;
  // The selected behavior is always in the list that is shown, however far down it is.
  const at = selected ? listing.shown.findIndex((entry) => entry.id === selected.id) : -1;
  const shownCount = Math.max(limit, at + 1);
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || pending || index.entries.length === 0) return;
    restored.current = true;
    const row = (id: string | null | undefined) =>
      id ? [...document.querySelectorAll<HTMLElement>('[data-behavior-row]')].find((element) => element.getAttribute('data-behavior-row') === id) : undefined;
    if (point) {
      window.scrollTo(0, point.scrollY);
      row(point.focus)?.focus({ preventScroll: true });
      forgetReturn();
    } else row(search.behavior)?.scrollIntoView?.({ block: 'nearest' });
  }, [pending, index.entries.length, point, search.behavior]);
  const setQuery = (q: string) => void navigate({ search: (prev) => ({ ...prev, q: q || undefined }), replace: true, resetScroll: false });
  const none = index.entries.length === 0 && !pending && index.unreadable.length === 0 && !filesError;
  const remember = (id: string) => () => rememberReturn({ scope, scrollY: window.scrollY, shown: shownCount, focus: id });
  return (
    <Stack component="article" gap="md" aria-label="Behaviors">
      <Box component="header">
        <PageHeader
          title="Behaviors"
          description="Everything the project's features say should happen, found by its words. Read what should happen, watch a recording of it, and inspect the record behind it."
          actions={
            <Group component="nav" aria-label="Where the evidence is" gap="xs">
              <Button variant="subtle" leftSection={<IconListSearch size={16} aria-hidden="true" />} renderRoot={(props) => <Link {...props} to="/" search={{ view: 'tests', tab: 'runs' } as never} />}>
                Runs
              </Button>
              <Button variant="subtle" leftSection={<IconMovie size={16} aria-hidden="true" />} renderRoot={(props) => <Link {...props} to="/" search={{ view: 'tests', tab: 'artifacts' } as never} />}>
                Videos and artifacts
              </Button>
            </Group>
          }
        >
          {!none && <CoverageFilter listing={listing} coverage={search.coverage} />}
        </PageHeader>
      </Box>
      <Disclosure unread={index.unread} features={index.features} unreadable={index.unreadable} pending={pending} error={filesError} />
      {none ? (
        <Card>
          <StateBlock icon={<IconBook size={22} />} title="No behaviors">
            No behaviors: this project has no Gherkin features.
          </StateBlock>
        </Card>
      ) : (
        <Grid gap="md" align="flex-start">
          <Grid.Col span={{ base: 12, lg: 5 }}>
            <Card padding={0}>
              <Stack gap="sm" p="md">
                <TextInput
                  type="search"
                  aria-label="Search behaviors"
                  placeholder='Search behaviors, steps, tags… or filter: status:failed has:video domain: "exact phrase"'
                  leftSection={<IconSearch size={16} aria-hidden="true" />}
                  value={draft}
                  onChange={(event) => {
                    setDraft(event.currentTarget.value);
                    setQuery(event.currentTarget.value.trim());
                  }}
                />
                {listing.found.parsed.tokens.length > 0 && (
                  <Group gap="xs">
                    <TypedFilters
                      parsed={listing.found.parsed}
                      query={search.q ?? ''}
                      onChange={(next) => {
                        setDraft(next);
                        setQuery(next.trim());
                      }}
                    />
                  </Group>
                )}
                <SearchNotes issues={listing.found.parsed.issues} semantic={listing.found.status} />
                <ApplicabilityControls compact state={applicability} stale={index.entries.filter((entry) => needsAttention(entry.assessment)).length} total={index.entries.length} />
                {selected && (
                  <Group gap="sm" wrap="nowrap" justify="space-between" role="group" aria-label="Selected behavior" bg="var(--mantine-color-primary-light)" bdrs="md" pl="sm" pr={6} py={6}>
                    <Text span truncate miw={0}>
                      <Text span inherit c="dimmed">
                        Selected:{' '}
                      </Text>
                      <Text span inherit fw={600}>
                        {selected.title}
                      </Text>
                    </Text>
                    <Button size="compact-sm" variant="filled" flex="none" leftSection={<IconArrowsMaximize size={14} aria-hidden="true" />} renderRoot={(props) => <Link {...props} to="/behaviors" search={selecting(selected.id, true)} resetScroll={false} onClick={remember(selected.id)} />}>
                      Read and watch
                    </Button>
                  </Group>
                )}
              </Stack>
              <Divider />
              {listing.shown.length === 0 && !pending ? (
                <StateBlock role="status" icon={<IconZoomQuestion size={22} />}>
                  {search.q || search.coverage ? 'No behavior matches this search.' : 'No behaviors yet.'}
                </StateBlock>
              ) : (
                <BehaviorList listing={listing} selected={selected?.id} limit={shownCount} onMore={() => setLimit(shownCount + PAGE)} />
              )}
            </Card>
          </Grid.Col>
          <Grid.Col span={{ base: 12, lg: 7 }} pos={{ base: 'static', lg: 'sticky' }} top="var(--mantine-spacing-md)">
            {selected ? (
              <Card component="section" aria-label={`Behavior: ${selected.title}`} padding={0}>
                <ScrollArea.Autosize mah={{ lg: 'calc(100dvh - 2 * var(--mantine-spacing-md) - 2px)' }} type="auto">
                  <Stack gap="md" miw={0} p="lg">
                    <Group justify="space-between" align="flex-start" wrap="nowrap" gap="sm">
                      <Stack gap={2} miw={0}>
                        <Title order={2}>{selected.title}</Title>
                        <Text component="div" c="dimmed">
                          {whereIs(selected)}
                          {' · '}
                          <Anchor underline="always" renderRoot={(props) => <Link {...props} to="/specs/$kind" params={{ kind: 'gherkin' }} search={{ spec: selected.file, check: selected.behavior.slot?.id }} />}>Open the feature</Anchor>
                        </Text>
                      </Stack>
                      <Tooltip label="Read and watch on a full page">
                        <ActionIcon variant="default" aria-label={`Expand ${selected.title} to read and watch`} renderRoot={(props) => <Link {...props} to="/behaviors" search={selecting(selected.id, true)} resetScroll={false} onClick={remember(selected.id)} />}>
                          <IconArrowsMaximize size={18} aria-hidden="true" />
                        </ActionIcon>
                      </Tooltip>
                    </Group>
                    <BehaviorPanel key={selected.id} behavior={selected.behavior} applicability={selected.assessment} release={applicability.release} inspect={<Inspect entry={selected} />} />
                  </Stack>
                </ScrollArea.Autosize>
              </Card>
            ) : search.behavior ? (
              <Alert role="status" color="blue">
                {pending ? 'Reading features to find that behavior…' : 'That behavior is not in the project now. It may have been renamed or removed from its feature.'}
              </Alert>
            ) : (
              <Panel component="section" aria-label="Choose a behavior" title="Explore a behavior" description="Select a behavior to read it and watch its recording.">
                <Stack gap="md">
                  <Offer icon={<IconBook size={20} />} title="Read the promise">
                    Follow the steps that describe what should happen.
                  </Offer>
                  <Offer icon={<IconPlayerPlay size={20} />} title="Watch the evidence">
                    Play a recorded run when one is available. Missing recordings stay explicit.
                  </Offer>
                  <Offer icon={<IconSearch size={20} />} title="Inspect the record">
                    Check outcomes, environments and the sources behind them.
                  </Offer>
                </Stack>
              </Panel>
            )}
          </Grid.Col>
        </Grid>
      )}
    </Stack>
  );
}

/** The dedicated workspace: what should happen beside its recording, the scoped summary, and the record behind a disclosure. */
function Workspace({ entry, listing, release }: { entry: IndexedBehavior; listing: Listing; release: ReleaseIdentity }) {
  const heading = useRef<HTMLHeadingElement>(null);
  const [inspecting, setInspecting] = useState<string | null>(null);
  const { behavior } = entry;
  const { steps, named } = useMemo(() => behaviorSteps(behavior), [behavior]);
  const at = listing.shown.findIndex((candidate) => candidate.id === entry.id);
  const previous = at > 0 ? listing.shown[at - 1] : undefined;
  const next = at >= 0 ? listing.shown[at + 1] : undefined;
  // A reader who arrives, or moves to the next behavior, lands on its heading: the page reads from the top and keyboard focus is there.
  useEffect(() => heading.current?.focus({ preventScroll: true }), [entry.id]);
  return (
    <Stack component="article" gap="md" aria-label={`Read and watch: ${entry.title}`}>
      <Card component="header">
        <Stack gap="sm">
          <Group justify="space-between" wrap="wrap" gap="xs">
            <Button
              variant="subtle"
              size="compact-sm"
              leftSection={<IconArrowLeft size={16} aria-hidden="true" />}
              renderRoot={(props) => <Link {...props} to="/behaviors" search={(prev) => ({ ...prev, workspace: undefined })} resetScroll={false} />}
            >
              Back to behaviors
            </Button>
            <Group gap="xs" role="group" aria-label="Move through the behaviors of this search">
              {at >= 0 && (
                <Text span size="xs" c="dimmed">
                  {at + 1} of {listing.shown.length}
                </Text>
              )}
              {previous && (
                <Button size="compact-sm" leftSection={<IconChevronLeft size={16} aria-hidden="true" />} renderRoot={(props) => <Link {...props} to="/behaviors" search={selecting(previous.id, true)} resetScroll={false} />}>
                  Previous behavior
                </Button>
              )}
              {next && (
                <Button size="compact-sm" rightSection={<IconChevronRight size={16} aria-hidden="true" />} renderRoot={(props) => <Link {...props} to="/behaviors" search={selecting(next.id, true)} resetScroll={false} />}>
                  Next behavior
                </Button>
              )}
            </Group>
          </Group>
          <Stack gap={6}>
            <Title order={1} tabIndex={-1} ref={heading} w="fit-content" maw="100%">
              {entry.title}
            </Title>
            <Group gap="xs" wrap="wrap">
              <CoverageBadge state={behavior.state} />
              {behavior.representative && <Badge variant="outline">Representative demo</Badge>}
              <Text span c="dimmed">
                {whereIs(entry)}
                {entry.domain ? ` · ${entry.domain}` : ''}
              </Text>
            </Group>
          </Stack>
        </Stack>
      </Card>
      <Grid gap="md" align="flex-start">
        <Grid.Col span={{ base: 12, md: 5 }}>
          <Panel component="section" aria-label="What should happen" title="What should happen">
            {behavior.example !== null && (
              <Text component="div" c="dimmed">
                Example: {behavior.example}
              </Text>
            )}
            <Box fz="sm">
              <PlainSteps steps={steps} examples={behavior.example === null ? behavior.scenario.examples : []} />
            </Box>
            {named && (
              <Text component="div" c="dimmed">
                The recorded example name does not match one row of the examples, so the values are not filled in.
              </Text>
            )}
          </Panel>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 7 }}>
          <Panel component="section" aria-label="Recording" title="Recording" actions={behavior.subject && <Provenance subject={behavior.subject} />}>
            {behavior.demo ? (
              <Stack gap="xs" miw={0}>
                <Player result={behavior.demo} />
                <Illustrative />
              </Stack>
            ) : (
              <NothingToWatch state={behavior.state} />
            )}
            <RevisionLine revision={behavior.revision} />
            <ApplicabilitySummary assessment={entry.assessment} release={release} />
          </Panel>
        </Grid.Col>
      </Grid>
      <Card>
        <ScopedSummary behavior={behavior} />
      </Card>
      <Accordion value={inspecting} onChange={setInspecting}>
        <Accordion.Item value="inspect">
          <Accordion.Control>Inspect: runs, environments, attempts and files</Accordion.Control>
          <Accordion.Panel>{inspecting === 'inspect' && <Inspect entry={entry} />}</Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </Stack>
  );
}

/** What the workspace shows while its behavior is not there: still being looked for, or gone. */
function WorkspaceMissing({ pending }: { pending: boolean }) {
  return (
    <Stack component="article" gap="md">
      <Card>
        <StateBlock
          icon={<IconZoomQuestion size={22} />}
          title={<Title order={1}>Read and watch</Title>}
          actions={
            <Button leftSection={<IconArrowLeft size={16} aria-hidden="true" />} renderRoot={(props) => <Link {...props} to="/behaviors" search={(prev) => ({ ...prev, workspace: undefined, behavior: undefined })} />}>
              Back to behaviors
            </Button>
          }
        >
          <Text role="status" component="div" c="dimmed">
            {pending ? 'Reading features to find that behavior…' : 'That behavior is not in the project now. It may have been renamed or removed from its feature.'}
          </Text>
        </StateBlock>
      </Card>
    </Stack>
  );
}

/** The behaviors route: the project-wide index, or the workspace when one behavior is expanded. */
export function BehaviorsPage() {
  const search = useSearch({ from: '/behaviors' });
  const applicability = useApplicabilityState();
  const { index, pending, filesError } = useBehaviorIndex(applicability.release);
  const listing = useListing(index.entries, search, applicability.onlyStale);
  if (search.workspace) {
    const entry = index.entries.find((candidate) => candidate.id === search.behavior);
    return entry ? <Workspace entry={entry} listing={listing} release={applicability.release} /> : <WorkspaceMissing pending={pending} />;
  }
  return <Index listing={listing} search={search} index={index} pending={pending} filesError={filesError} applicability={applicability} />;
}
