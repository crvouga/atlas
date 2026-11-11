import { Accordion, Alert, Badge, Box, Button, Code, Group, List, NavLink, SimpleGrid, Stack, Text, ThemeIcon } from '@mantine/core';
import { IconArrowLeft, IconArrowRight, IconCheck, IconCircleDashed, IconCode, IconMap2, IconX } from '@tabler/icons-react';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { KIND_LABEL, KindIcon } from '../components/labels';
import { PageHeader, Panel } from '../components/Page';
import { ScreenImage } from '../components/Screen';
import { StatusBadge, StatusDot } from '../components/Status';
import { statusNote, type AtlasView, type StateView, type TransitionView } from '../data/model';
import { mapScope } from '../layout/graph';
import { eventLooks, journeyLooks, stateLooks } from '../looks/collect';
import { Stage } from '../looks/Stage';
import type { MapSelection } from '../map/ChartMap';
import { ChartTests } from './ChartTests';
import { ChartSource } from '../evidence/chart-source';
function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <Text size="xs" c="dimmed" fw={500}>
      {children}
    </Text>
  );
}
/** One event as a row: its name, where it leads (or comes from) and an arrow, all one link. */
function EventLink({ t, view, direction }: { t: TransitionView; view: AtlasView; direction: 'in' | 'out' }) {
  const other = direction === 'in' ? t.source : t.target;
  const otherState = other ? view.states.get(other) : undefined;
  return (
    <NavLink
      data-status={t.status}
      py={6}
      leftSection={<StatusDot status={t.status} />}
      label={
        <Text span inherit fw={500}>
          {t.event}
        </Text>
      }
      description={
        otherState && (
          <Text span inherit>
            {direction === 'in' ? 'from' : 'to'} {otherState.name}
          </Text>
        )
      }
      rightSection={direction === 'in' ? <IconArrowLeft size={16} aria-hidden="true" /> : <IconArrowRight size={16} aria-hidden="true" />}
      renderRoot={(props) => (
        <Link
          {...props}
          to="/chart/$chartId"
          params={{ chartId: view.states.get(direction === 'in' ? (t.target ?? t.source) : t.source)?.chartId ?? t.chartId }}
          search={(prev) => ({ run: prev.run, event: t.id, journey: prev.journey })}
        />
      )}
    />
  );
}
/** Identifiers and provenance a developer needs, closed until asked for. */
function Developer({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <Accordion>
      <Accordion.Item value="developer">
        <Accordion.Control icon={<IconCode size={16} aria-hidden="true" />}>
          <Text fw={500}>For developers</Text>
        </Accordion.Control>
        <Accordion.Panel>
          <Stack component="dl" gap="xs" m={0}>
            {rows
              .filter(([, v]) => v !== null && v !== undefined && v !== '')
              .map(([k, v]) => (
                <Group key={k} gap="md" align="flex-start" wrap="nowrap">
                  <Text component="dt" size="xs" c="dimmed" w={{ base: 110, sm: 160 }} flex="none" pt={2}>
                    {k}
                  </Text>
                  <Box component="dd" m={0} miw={0} flex={1} fz="sm">
                    {v}
                  </Box>
                </Group>
              ))}
          </Stack>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  );
}
function Questions({ view, ids }: { view: AtlasView; ids: string[] }) {
  if (ids.length === 0) return null;
  return (
    <Panel title="Open questions">
      <Stack gap="sm">
        {ids.map((id) => {
          const q = view.questions.get(id);
          if (!q) return null;
          return (
            <Alert key={id} color="blue" title={q.title}>
              {q.body}
              {q.specToday && (
                <Text component="span" display="block" size="xs" c="dimmed" mt={4}>
                  Spec today: {q.specToday}
                </Text>
              )}
            </Alert>
          );
        })}
      </Stack>
    </Panel>
  );
}
/** A checked, failed or not-yet-known line, never by color alone: the icon differs too. */
function Check({ passed, children, note }: { passed: boolean | 'unknown'; children: ReactNode; note?: ReactNode }) {
  return (
    <List.Item
      data-passed={passed}
      icon={
        <ThemeIcon variant="light" size={22} radius="xl" color={passed === true ? 'green' : passed === false ? 'red' : 'gray'} aria-hidden="true">
          {passed === true ? <IconCheck size={14} /> : passed === false ? <IconX size={14} /> : <IconCircleDashed size={14} />}
        </ThemeIcon>
      }
    >
      <Text span inherit>
        {children}
        {note && (
          <Text span inherit display="block" size="xs" c="dimmed">
            {note}
          </Text>
        )}
      </Text>
    </List.Item>
  );
}
function ScreenDetails({ view, state, actions }: { view: AtlasView; state: StateView; actions: ReactNode }) {
  const checks = state.result?.checks.length
    ? state.result.checks
    : state.specChecks.map((check) => ({ check, passed: null as boolean | null, expected: undefined, actual: undefined }));
  const note = statusNote(state.status);
  const events = state.result?.businessEvents;
  const screen = state.kind === 'screen' || state.kind === 'final';
  const incoming = state.incoming.map((id) => view.transitions.get(id)).filter((t): t is TransitionView => Boolean(t) && !t!.carriedBy);
  const outgoing = state.outgoing.map((id) => view.transitions.get(id)).filter((t): t is TransitionView => Boolean(t));
  const behind = state.specBusinessEvents.length > 0 || Boolean(events);
  return (
    <>
      <PageHeader
        eyebrow={<Eyebrow>{screen ? 'Screen' : 'Part of the chart'}</Eyebrow>}
        title={state.name}
        description={state.description || undefined}
        actions={actions}
      >
        <Group gap="sm">
          <StatusBadge status={state.status} />
          {state.confidence === 'assumed' && (
            <Badge color="gray" variant="outline">
              Assumed, not confirmed
            </Badge>
          )}
          {note && (
            <Text component="div" c="dimmed">
              {note}
            </Text>
          )}
        </Group>
      </PageHeader>
      <Panel title="What it looks like">
        <Stage
          looks={stateLooks(state)}
          prefer="pictures"
          empty={
            screen ? (
              <Stack>
                <ScreenImage key={state.name} state={state} size="full" description={false} lines={state.hints.length > 0} />
              </Stack>
            ) : (
              <Text c="dimmed">This part of the chart has no screen of its own.</Text>
            )
          }
        />
      </Panel>
      <SimpleGrid cols={{ base: 1, md: incoming.length > 0 ? 2 : 1 }} spacing="md">
        <Panel title="Where they go next">
          {outgoing.length > 0 ? (
            <Stack gap={2} miw={0}>
              {outgoing.map((transition) => (
                <EventLink key={transition.id} t={transition} view={view} direction="out" />
              ))}
            </Stack>
          ) : (
            <Text component="div" c="dimmed">
              {state.deadEnd ? `This is where the journey stops: ${state.deadEnd}` : 'Nothing leaves this screen.'}
            </Text>
          )}
        </Panel>
        {incoming.length > 0 && (
          <Panel title="How users get here">
            <Stack gap={2} miw={0}>
              {incoming.map((t) => (
                <EventLink key={t.id} t={t} view={view} direction="in" />
              ))}
            </Stack>
          </Panel>
        )}
      </SimpleGrid>
      {(checks.length > 0 || behind) && (
        <SimpleGrid cols={{ base: 1, md: checks.length > 0 && behind ? 2 : 1 }} spacing="md">
          {checks.length > 0 && (
            <Panel title="What should be on the screen">
              <List spacing="xs" center>
                {checks.map((c) => (
                  <Check
                    key={c.check}
                    passed={c.passed === null ? 'unknown' : c.passed}
                    note={c.passed === false && (c.expected || c.actual) ? `Expected ${c.expected ?? 'something else'}, saw ${c.actual ?? 'nothing'}` : null}
                  >
                    {c.check}
                  </Check>
                ))}
              </List>
            </Panel>
          )}
          {behind && (
            <Panel title="What happens behind the scenes">
              <List spacing="xs" center>
                {(events?.expected ?? state.specBusinessEvents).map((e) => {
                  const missing = events?.missing.includes(e);
                  const noSignal = events?.noSignal.includes(e);
                  const seen = events?.observed.includes(e);
                  return (
                    <Check
                      key={e}
                      passed={missing ? false : seen ? true : 'unknown'}
                      note={missing ? 'Didn’t happen in this run' : noSignal ? 'Can’t be checked yet' : null}
                    >
                      {e}
                    </Check>
                  );
                })}
              </List>
            </Panel>
          )}
        </SimpleGrid>
      )}
      {state.knownIssues.length > 0 && (
        <Panel title="Known issues">
          <Stack gap="sm">
            {state.knownIssues.map((n) => (
              <Alert key={n.body} color="blue">
                {n.body}
              </Alert>
            ))}
          </Stack>
        </Panel>
      )}
      <Questions view={view} ids={state.questionIds} />
      {state.deadEnd && outgoing.length > 0 && <Alert color="blue">This is where the journey stops: {state.deadEnd}</Alert>}
      <Developer
        rows={[
          ['State ID', <Code key="id">{state.name}</Code>],
          ['Spec file', <Code key="f">{state.file}</Code>],
          ['Snapshot name', state.snapshot ? <Code key="s">{state.snapshot}</Code> : null],
          [
            'Sources',
            state.sources.length ? (
              <List key="src" size="sm" spacing={4}>
                {state.sources.map((s) => (
                  <List.Item key={s}>
                    <Code>{s}</Code>
                  </List.Item>
                ))}
              </List>
            ) : null
          ],
          ['Owner', state.owner],
          ['Tier', state.tier],
          [
            'CloudEvents seen',
            events?.events?.length ? (
              <List key="ce" size="sm" spacing={4}>
                {events.events.map((e) => (
                  <List.Item key={e.id}>
                    <Code>{e.type}</Code> from <Code>{e.source}</Code>
                  </List.Item>
                ))}
              </List>
            ) : null
          ]
        ]}
      />
    </>
  );
}
function EventDetails({ view, t, actions }: { view: AtlasView; t: TransitionView; actions: ReactNode }) {
  const from = view.states.get(t.source);
  const to = t.target ? view.states.get(t.target) : undefined;
  const note = statusNote(t.status, t.result?.reason);
  return (
    <>
      <PageHeader
        eyebrow={<Eyebrow>Event</Eyebrow>}
        title={t.event}
        actions={actions}
        description={
          <Text component="div" c="dimmed">
            From{' '}
            <Text span inherit fw={600} c="var(--mantine-color-text)">
              {from?.name ?? t.source}
            </Text>{' '}
            to{' '}
            <Text span inherit fw={600} c="var(--mantine-color-text)">
              {to?.name ?? 'a screen not in the spec'}
            </Text>
            .
          </Text>
        }
      >
        <Group gap="sm">
          <StatusBadge status={t.status} />
          <Badge color="gray" variant="outline" leftSection={<KindIcon kind={t.kind} size={12} />}>
            {KIND_LABEL[t.kind]}
          </Badge>
          {note && (
            <Text component="div" c="dimmed">
              {note}
            </Text>
          )}
        </Group>
      </PageHeader>
      <Panel title="What it looked like">
        <Stage
          looks={eventLooks(view, t)}
          prefer="film"
          notice={t.result?.clip.state === 'processing' ? 'The video of this event is still processing.' : null}
          empty={<Text c="dimmed">This event has no picture, video, or timeline in this run.</Text>}
        />
      </Panel>
      <Questions view={view} ids={t.questionIds} />
      <Developer
        rows={[
          ['Transition ID', <Code key="id">{t.id}</Code>],
          ['Who sends it', `${KIND_LABEL[t.kind]} (${t.kindSource === 'guess' ? 'guessed from the wording' : `from the ${t.kindSource}`})`],
          ['How the run drives it', t.result?.how ?? null]
        ]}
      />
    </>
  );
}
function JourneyLooks({ view, journeyId }: { view: AtlasView; journeyId: string }) {
  const looks = journeyLooks(view, journeyId);
  if (looks.pictures.length === 0 && looks.films.length === 0 && !looks.moments.some((moment) => moment.thumb)) return null;
  return (
    <Panel title="What it looked like">
      <Stage looks={looks} prefer="timeline" />
    </Panel>
  );
}
function JourneyDetails({ view, journeyId, chartId, actions }: { view: AtlasView; journeyId: string; chartId: string; actions: ReactNode }) {
  const j = view.journeys.find((x) => x.id === journeyId);
  if (!j) return <Missing actions={actions}>This journey isn’t in the spec.</Missing>;
  return (
    <>
      <PageHeader eyebrow={<Eyebrow>Journey</Eyebrow>} title={j.name} description={j.description || undefined} actions={actions}>
        <Group gap="sm">
          <StatusBadge status={j.status} />
        </Group>
      </PageHeader>
      {!j.replay.ok && (
        <Alert color="red">The chart can’t follow this journey past “{j.replay.failedAt ?? j.replay.missingEnds.join(', ')}”.</Alert>
      )}
      <JourneyLooks view={view} journeyId={j.id} />
      <Panel title="Steps">
        <List spacing={2} listStyleType="none" type="ordered">
          {j.steps.map((step, i) => {
            const t = view.transitions.get(step.transitionIds[0] ?? '');
            if (!t) return null;
            const here =
              view.transitions.get(t.id)?.chartId === chartId ||
              [...view.transitions.values()].some((x) => x.carriedBy === t.id && x.chartId === chartId);
            return (
              <List.Item key={i} data-here={here}>
                <NavLink
                  py={6}
                  leftSection={
                    <Badge circle color="gray" size="md">
                      {i + 1}
                    </Badge>
                  }
                  label={
                    <Text data-status={t.status} span inherit fw={500}>
                      {t.event}
                    </Text>
                  }
                  rightSection={<StatusDot status={t.status} />}
                  renderRoot={(props) => (
                    <Link
                      {...props}
                      to="/chart/$chartId"
                      params={{ chartId: t.chartId }}
                      search={(prev) => ({ run: prev.run, journey: j.id, event: t.id })}
                    />
                  )}
                />
              </List.Item>
            );
          })}
        </List>
      </Panel>
    </>
  );
}
/** What a link to a renamed or removed item shows: the sentence, and the way back to the map. */
function Missing({ children, actions }: { children: ReactNode; actions: ReactNode }) {
  return (
    <Panel>
      <Stack align="center" gap="sm" py="xl" ta="center">
        <ThemeIcon variant="light" color="gray" size={48} radius="xl">
          <IconMap2 size={24} aria-hidden="true" />
        </ThemeIcon>
        <Text component="div" c="dimmed" maw={440}>
          {children}
        </Text>
        {actions}
      </Stack>
    </Panel>
  );
}
export function SidePanel({ view, chartId, selection }: { view: AtlasView; chartId: string; selection: MapSelection }) {
  const state = selection.screen ? view.states.get(selection.screen) : undefined;
  const transition = selection.event ? view.transitions.get(selection.event) : undefined;
  const scopeName = state?.name ?? transition?.source;
  const scope = scopeName ? (mapScope(view, chartId, scopeName) ?? undefined) : undefined;
  const actions = (
    <Button
      aria-current={undefined}
      leftSection={<IconMap2 size={16} aria-hidden="true" />}
      renderRoot={(props) => (
        <Link
          {...props}
          to="/chart/$chartId"
          params={{ chartId }}
          search={(prev) => ({ run: prev.run, screen: undefined, event: undefined, journey: undefined, group: scope })}
          activeOptions={{ includeSearch: true, explicitUndefined: true }}
        />
      )}
    >
      Show the map
    </Button>
  );
  let body: ReactNode;
  let label: string;
  if (state) {
    body = <ScreenDetails view={view} state={state} actions={actions} />;
    label = `Screen: ${state.name}`;
  } else if (transition) {
    body = <EventDetails view={view} t={transition} actions={actions} />;
    label = `Event: ${transition.event}`;
  } else if (selection.journey) {
    body = <JourneyDetails view={view} journeyId={selection.journey} chartId={chartId} actions={actions} />;
    label = 'Journey';
  } else {
    body = <Missing actions={actions}>This item isn’t in the spec any more. It may have been renamed or removed.</Missing>;
    label = 'Not found';
  }
  return (
    <Stack aria-label={label} component="article" gap="md">
      {body}
      <ChartTests view={view} chartId={chartId} />
      {view.charts.get(chartId)?.file && <ChartSource file={view.charts.get(chartId)!.file} />}
    </Stack>
  );
}
