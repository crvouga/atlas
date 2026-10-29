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
import { Accordion, Alert, Anchor, Badge, Box, Button, Container, Grid, Group, NavLink, Paper, SimpleGrid, Stack, Text, TextInput, Title } from '@mantine/core';
import { IconArrowLeft, IconArrowsMaximize, IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import { Link, useNavigate, useSearch } from '@tanstack/react-router';
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';

import { SearchNotes, TypedFilters } from '../explorer/search-notes';
import { useDocSearch } from '../find/doc-search';
import { passesFilters } from '../find/query';
import type { BehaviorsSearch } from '../app/router';
import { specKind } from '../spec-kind';
import { needsAttention, type ReleaseIdentity } from './applicability';
import { ApplicabilityControls, ApplicabilitySummary, useApplicabilityState, type ApplicabilityState } from './applicability-view';
import { behaviorDoc, indexBehaviors, type IndexedBehavior } from './behavior-index';
import { BehaviorPanel, behaviorSteps, CoverageBadge, Player, Provenance, RevisionLine } from './behavior-panel';
import { forgetReturn, recallReturn, rememberReturn, scopeKey } from './behavior-return';
import { COVERAGE, COVERAGE_ORDER, coverageCounts, type CoverageState } from './behavior';
import { CheckDetail, PlainSteps, type SelectCheck } from './check-detail';
import { useEvidence } from './evidence-context';
import { plural } from './format';
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

/** One behavior in the list: its words, where it is written and its coverage state, as a link that selects it. */
function Row({ entry, selected }: { entry: IndexedBehavior; selected: boolean }) {
  return (
    <NavLink
      label={entry.title}
      description={whereIs(entry)}
      active={selected}
      aria-current={selected ? 'true' : undefined}
      data-behavior-row={entry.id}
      data-coverage={entry.behavior.state}
      rightSection={<CoverageBadge state={entry.behavior.state} />}
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
    <Stack gap="xs" component="section" aria-label="Coverage">
      <Text component="div">
        {counts.demonstrated} of {plural(scoped.length, 'behavior', 'behaviors')} demonstrated with a recording of the current spec.
      </Text>
      <Group role="group" aria-label="Coverage state" gap="xs">
        <Button type="button" aria-pressed={!coverage} variant={coverage ? 'subtle' : 'light'} onClick={() => set(undefined)}>
          All{' '}
          <Text span inherit>
            {scoped.length}
          </Text>
        </Button>
        {COVERAGE_ORDER.filter((state) => state === 'demonstrated' || counts[state] > 0 || coverage === state).map((state) => (
          <Button key={state} type="button" aria-pressed={coverage === state} variant={coverage === state ? 'light' : 'subtle'} title={COVERAGE[state].meaning} onClick={() => set(coverage === state ? undefined : state)}>
            {COVERAGE[state].label}{' '}
            <Text span inherit>
              {counts[state]}
            </Text>
          </Button>
        ))}
      </Group>
      <Text component="div" c="dimmed">
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
        <Alert role="alert" color="red" my="sm">
          The list of features could not be loaded, so this list may be missing behaviors.
        </Alert>
      )}
      {pending && unread > 0 && (
        <Text role="status" component="div" c="dimmed" my="sm">
          Reading features: {features - unread} of {features} read. Behaviors from the rest are not listed yet, so an empty answer is not final.
        </Text>
      )}
      {unreadable.length > 0 && (
        <Alert role="status" color="orange" my="sm" title={`${plural(unreadable.length, 'feature', 'features')} could not be read`}>
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
    <Stack gap="md" component="section" aria-label="Behavior list">
      {groups.map(([domain, entries]) => (
        <Box key={domain || 'ranked'} component="section" aria-label={domain || undefined}>
          {domain && (
            <Title order={2} mb="xs">
              {domain}
            </Title>
          )}
          <Stack gap="xs">
            {entries.map((entry) => (
              <Row key={entry.id} entry={entry} selected={selected === entry.id} />
            ))}
          </Stack>
        </Box>
      ))}
      {shown.length > limit && (
        <Button type="button" variant="subtle" onClick={onMore}>
          Show more behaviors ({shown.length - limit} more)
        </Button>
      )}
    </Stack>
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
  return (
    <Container component="article" size="xl" w="100%" py="xl" aria-label="Behaviors">
      <Stack gap="md">
        <Box component="header">
          <Title order={1} mb="xs">
            Behaviors
          </Title>
          <Text component="div" c="dimmed">
            Everything the project's features say should happen, found by its words. Read what should happen, watch a recording of it, and inspect the record behind it.
          </Text>
          <Group component="nav" aria-label="Where the evidence is" gap="md" mt="xs">
            <Anchor renderRoot={(props) => <Link {...props} to="/" search={{ tab: 'runs' } as never} />}>Runs</Anchor>
            <Anchor renderRoot={(props) => <Link {...props} to="/" search={{ tab: 'artifacts' } as never} />}>Videos and artifacts</Anchor>
          </Group>
        </Box>
        <TextInput
          type="search"
          aria-label="Search behaviors"
          placeholder='Search behaviors, steps, tags… or filter: status:failed has:video domain: "exact phrase"'
          value={draft}
          onChange={(event) => {
            setDraft(event.currentTarget.value);
            setQuery(event.currentTarget.value.trim());
          }}
        />
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
        <SearchNotes issues={listing.found.parsed.issues} semantic={listing.found.status} />
        <CoverageFilter listing={listing} coverage={search.coverage} />
        <ApplicabilityControls state={applicability} stale={index.entries.filter((entry) => needsAttention(entry.assessment)).length} total={index.entries.length} />
        <Disclosure unread={index.unread} features={index.features} unreadable={index.unreadable} pending={pending} error={filesError} />
        {selected && (
          <Group gap="sm" wrap="wrap" role="group" aria-label="Selected behavior">
            <Text span fw={600}>
              Selected: {selected.title}
            </Text>
            <Button
              leftSection={<IconArrowsMaximize size={16} aria-hidden="true" />}
              renderRoot={(props) => (
                <Link
                  {...props}
                  to="/behaviors"
                  search={selecting(selected.id, true)}
                  resetScroll={false}
                  onClick={() => rememberReturn({ scope, scrollY: window.scrollY, shown: shownCount, focus: selected.id })}
                />
              )}
            >
              Read and watch
            </Button>
          </Group>
        )}
        {index.entries.length === 0 && !pending && index.unreadable.length === 0 && !filesError ? (
          <Text component="div">No behaviors: this project has no Gherkin features.</Text>
        ) : listing.shown.length === 0 && !pending ? (
          <Text role="status" component="div">
            {search.q || search.coverage ? 'No behavior matches this search.' : 'No behaviors yet.'}
          </Text>
        ) : (
          <Grid gap="lg">
            <Grid.Col span={{ base: 12, lg: 5 }}>
              <BehaviorList listing={listing} selected={selected?.id} limit={shownCount} onMore={() => setLimit(shownCount + PAGE)} />
            </Grid.Col>
            <Grid.Col span={{ base: 12, lg: 7 }}>
              {selected ? (
                <Paper component="section" aria-label={`Behavior: ${selected.title}`} withBorder p="md">
                  <Stack gap="sm" miw={0}>
                    <Title order={2}>{selected.title}</Title>
                    <Text component="div" c="dimmed">
                      {whereIs(selected)}
                      {' · '}
                      <Anchor renderRoot={(props) => <Link {...props} to="/specs/$kind" params={{ kind: 'gherkin' }} search={{ spec: selected.file, check: selected.behavior.slot?.id }} />}>Open the feature</Anchor>
                    </Text>
                    <BehaviorPanel key={selected.id} behavior={selected.behavior} applicability={selected.assessment} release={applicability.release} inspect={<Inspect entry={selected} />} />
                  </Stack>
                </Paper>
              ) : search.behavior ? (
                <Alert role="status" color="blue">
                  {pending ? 'Reading features to find that behavior…' : 'That behavior is not in the project now. It may have been renamed or removed from its feature.'}
                </Alert>
              ) : (
                <Text component="div" c="dimmed">
                  Select a behavior to read it and watch its recording.
                </Text>
              )}
            </Grid.Col>
          </Grid>
        )}
      </Stack>
    </Container>
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
    <Container component="article" size="xl" w="100%" py="xl" aria-label={`Read and watch: ${entry.title}`}>
      <Stack gap="md">
        <Group justify="space-between" wrap="wrap">
          <Button
            variant="subtle"
            leftSection={<IconArrowLeft size={16} aria-hidden="true" />}
            renderRoot={(props) => <Link {...props} to="/behaviors" search={(prev) => ({ ...prev, workspace: undefined })} resetScroll={false} />}
          >
            Back to behaviors
          </Button>
          <Group gap="xs" role="group" aria-label="Move through the behaviors of this search">
            {at >= 0 && (
              <Text span c="dimmed">
                {at + 1} of {listing.shown.length}
              </Text>
            )}
            {previous && (
              <Button variant="default" leftSection={<IconChevronLeft size={16} aria-hidden="true" />} renderRoot={(props) => <Link {...props} to="/behaviors" search={selecting(previous.id, true)} resetScroll={false} />}>
                Previous behavior
              </Button>
            )}
            {next && (
              <Button variant="default" rightSection={<IconChevronRight size={16} aria-hidden="true" />} renderRoot={(props) => <Link {...props} to="/behaviors" search={selecting(next.id, true)} resetScroll={false} />}>
                Next behavior
              </Button>
            )}
          </Group>
        </Group>
        <Box component="header">
          <Title order={1} tabIndex={-1} ref={heading} mb="xs">
            {entry.title}
          </Title>
          <Group gap="sm" wrap="wrap">
            <CoverageBadge state={behavior.state} />
            {behavior.representative && <Badge variant="outline">Representative demo</Badge>}
            <Text span c="dimmed">
              {whereIs(entry)}
              {entry.domain ? ` · ${entry.domain}` : ''}
            </Text>
          </Group>
        </Box>
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
          <Stack gap="sm" miw={0} component="section" aria-label="What should happen">
            <Title order={2}>What should happen</Title>
            {behavior.example !== null && (
              <Text component="div" c="dimmed">
                Example: {behavior.example}
              </Text>
            )}
            <PlainSteps steps={steps} examples={behavior.example === null ? behavior.scenario.examples : []} />
            {named && (
              <Text component="div" c="dimmed">
                The recorded example name does not match one row of the examples, so the values are not filled in.
              </Text>
            )}
          </Stack>
          <Stack gap="sm" miw={0} component="section" aria-label="Recording">
            <Title order={2}>Recording</Title>
            {behavior.demo ? (
              <>
                <Player result={behavior.demo} />
                <Text component="div" c="dimmed">
                  Illustrative recording of one run. It shows what happened in that run and does not approve the behavior for production.
                </Text>
              </>
            ) : (
              <Text component="div" c="dimmed">
                Nothing to watch. {COVERAGE[behavior.state].meaning}
              </Text>
            )}
            {behavior.subject && <Provenance subject={behavior.subject} />}
            <RevisionLine revision={behavior.revision} />
            <ApplicabilitySummary assessment={entry.assessment} release={release} />
          </Stack>
        </SimpleGrid>
        <ScopedSummary behavior={behavior} />
        <Accordion variant="separated" value={inspecting} onChange={setInspecting}>
          <Accordion.Item value="inspect">
            <Accordion.Control>Inspect: runs, environments, attempts and files</Accordion.Control>
            <Accordion.Panel>{inspecting === 'inspect' && <Inspect entry={entry} />}</Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      </Stack>
    </Container>
  );
}

/** What the workspace shows while its behavior is not there: still being looked for, or gone. */
function WorkspaceMissing({ pending }: { pending: boolean }) {
  return (
    <Container component="article" size="xl" w="100%" py="xl">
      <Stack gap="md">
        <Title order={1}>Read and watch</Title>
        <Alert role="status" color="blue">
          {pending ? 'Reading features to find that behavior…' : 'That behavior is not in the project now. It may have been renamed or removed from its feature.'}
        </Alert>
        <Button variant="subtle" renderRoot={(props) => <Link {...props} to="/behaviors" search={(prev) => ({ ...prev, workspace: undefined, behavior: undefined })} />}>
          Back to behaviors
        </Button>
      </Stack>
    </Container>
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
