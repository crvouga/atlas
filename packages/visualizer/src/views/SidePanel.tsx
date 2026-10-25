import { IconCheck, IconX, IconCircle } from '@tabler/icons-react';
import { Accordion, Alert, Anchor, Box, Container, Flex, List, Stack, Text, Title } from '@mantine/core';

import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { IconChevronRight as ChevronIcon } from '@tabler/icons-react';
import { KIND_LABEL } from '../components/labels';
import { ScreenImage } from '../components/Screen';
import { StatusBadge, StatusDot } from '../components/Status';
import { statusNote, type AtlasView, type StateView, type TransitionView } from '../data/model';
import { mapScope } from '../layout/graph';
import { eventLooks, journeyLooks, stateLooks } from '../looks/collect';
import { Stage } from '../looks/Stage';
import type { MapSelection } from '../map/ChartMap';
import { ChartTests } from './ChartTests';
import { ChartSource } from '../evidence/chart-source';
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box component="section" mb="lg">
      <Title order={2} mb="sm">
        {title}
      </Title>
      {children}
    </Box>
  );
}
function EventLink({ t, view, direction }: { t: TransitionView; view: AtlasView; direction: 'in' | 'out' }) {
  const other = direction === 'in' ? t.source : t.target;
  const otherState = other ? view.states.get(other) : undefined;
  return (
    <Anchor
      data-status={t.status}
      underline="never"
      renderRoot={(props) => (
        <Link
          {...props}
          to="/chart/$chartId"
          params={{ chartId: view.states.get(direction === 'in' ? (t.target ?? t.source) : t.source)?.chartId ?? t.chartId }}
          search={(prev) => ({ run: prev.run, event: t.id, journey: prev.journey })}
        />
      )}
    >
      <Text span inherit>
        {t.event}
      </Text>
      {otherState && (
        <Text span inherit>
          {direction === 'in' ? 'from' : 'to'} {otherState.name}
        </Text>
      )}
    </Anchor>
  );
}
function Developer({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <Accordion variant="separated" my="lg">
      <Accordion.Item value="developer">
        <Accordion.Control>
          <ChevronIcon aria-hidden="true" size={12} />
          For developers
        </Accordion.Control>
        <Accordion.Panel>
          <Box component="dl">
            {rows
              .filter(([, v]) => v !== null && v !== undefined && v !== '')
              .map(([k, v]) => (
                <Stack key={k} gap="sm">
                  <Box component="dt">{k}</Box>
                  <Box component="dd" m={0}>
                    {v}
                  </Box>
                </Stack>
              ))}
          </Box>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  );
}
function Questions({ view, ids }: { view: AtlasView; ids: string[] }) {
  if (ids.length === 0) return null;
  return (
    <Section title="Open questions">
      <List spacing="xs" listStyleType="none">
        {ids.map((id) => {
          const q = view.questions.get(id);
          if (!q) return null;
          return (
            <Alert key={id} color={'blue'} my="sm">
              <Text span inherit fw={600}>
                {q.title}
              </Text>{' '}
              {q.body}
              {q.specToday && (
                <Text span inherit c="dimmed">
                  Spec today: {q.specToday}
                </Text>
              )}
            </Alert>
          );
        })}
      </List>
    </Section>
  );
}
function ScreenDetails({ view, state }: { view: AtlasView; state: StateView }) {
  const checks = state.result?.checks.length
    ? state.result.checks
    : state.specChecks.map((check) => ({ check, passed: null as boolean | null, expected: undefined, actual: undefined }));
  const note = statusNote(state.status);
  const events = state.result?.businessEvents;
  const screen = state.kind === 'screen' || state.kind === 'final';
  const incoming = state.incoming.map((id) => view.transitions.get(id)).filter((t): t is TransitionView => Boolean(t) && !t!.carriedBy);
  const outgoing = state.outgoing.map((id) => view.transitions.get(id)).filter((t): t is TransitionView => Boolean(t));
  return (
    <>
      <Flex gap="xs" align="center" wrap="wrap">
        <Title order={1} mb="sm">
          {state.name}
        </Title>
        <StatusBadge status={state.status} />
        {state.confidence === 'assumed' && (
          <Text span inherit>
            Assumed, not confirmed
          </Text>
        )}
      </Flex>
      {state.description && (
        <Text component="div" c="dimmed">
          {state.description}
        </Text>
      )}
      {note && (
        <Text component="div" c="dimmed">
          {note}
        </Text>
      )}
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
      <Stack gap="sm">
        <Title order={2} mb="sm">
          Where they go next
        </Title>
        {outgoing.length > 0 ? (
          <Stack gap="sm" miw={0}>
            {outgoing.map((transition) => (
              <EventLink key={transition.id} t={transition} view={view} direction="out" />
            ))}
          </Stack>
        ) : (
          <Text component="div" c="dimmed">
            {state.deadEnd ? `This is where the journey stops: ${state.deadEnd}` : 'Nothing leaves this screen.'}
          </Text>
        )}
      </Stack>
      {checks.length > 0 && (
        <Section title="What should be on the screen">
          <List spacing="xs" listStyleType="none">
            {checks.map((c) => (
              <List.Item key={c.check} data-passed={c.passed === null ? 'unknown' : c.passed}>
                <Text aria-hidden="true" span inherit>
                  {c.passed === null ? <IconCircle size={16} /> : c.passed ? <IconCheck size={16} /> : <IconX size={16} />}
                </Text>
                <Text span inherit>
                  {c.check}
                  {c.passed === false && (c.expected || c.actual) && (
                    <Text span inherit c="dimmed">
                      Expected {c.expected ?? 'something else'}, saw {c.actual ?? 'nothing'}
                    </Text>
                  )}
                </Text>
              </List.Item>
            ))}
          </List>
        </Section>
      )}
      {(state.specBusinessEvents.length > 0 || events) && (
        <Section title="What happens behind the scenes">
          <List spacing="xs" listStyleType="none">
            {(events?.expected ?? state.specBusinessEvents).map((e) => {
              const missing = events?.missing.includes(e);
              const noSignal = events?.noSignal.includes(e);
              const seen = events?.observed.includes(e);
              return (
                <List.Item key={e} data-passed={missing ? false : seen ? true : 'unknown'}>
                  <Text aria-hidden="true" span inherit>
                    {missing ? <IconX size={16} /> : seen ? <IconCheck size={16} /> : <IconCircle size={16} />}
                  </Text>
                  <Text span inherit>
                    {e}
                    {missing && (
                      <Text span inherit c="dimmed">
                        Didn’t happen in this run
                      </Text>
                    )}
                    {noSignal && (
                      <Text span inherit c="dimmed">
                        Can’t be checked yet
                      </Text>
                    )}
                  </Text>
                </List.Item>
              );
            })}
          </List>
        </Section>
      )}
      {state.knownIssues.length > 0 && (
        <Section title="Known issues">
          <List spacing="xs" listStyleType="none">
            {state.knownIssues.map((n) => (
              <Alert key={n.body} color={'blue'} my="sm">
                {n.body}
              </Alert>
            ))}
          </List>
        </Section>
      )}
      <Questions view={view} ids={state.questionIds} />
      {incoming.length > 0 && (
        <Section title="How users get here">
          <Stack gap="sm" miw={0}>
            {incoming.map((t) => (
              <EventLink key={t.id} t={t} view={view} direction="in" />
            ))}
          </Stack>
        </Section>
      )}

      {state.deadEnd && outgoing.length > 0 && (
        <Alert color={'blue'} my="sm">
          This is where the journey stops: {state.deadEnd}
        </Alert>
      )}
      <Developer
        rows={[
          ['State ID', <code key="id">{state.name}</code>],
          ['Spec file', <code key="f">{state.file}</code>],
          ['Snapshot name', state.snapshot ? <code key="s">{state.snapshot}</code> : null],
          [
            'Sources',
            state.sources.length ? (
              <ul key="src">
                {state.sources.map((s) => (
                  <li key={s}>
                    <code>{s}</code>
                  </li>
                ))}
              </ul>
            ) : null
          ],
          ['Owner', state.owner],
          ['Tier', state.tier],
          [
            'CloudEvents seen',
            events?.events?.length ? (
              <ul key="ce">
                {events.events.map((e) => (
                  <li key={e.id}>
                    <code>{e.type}</code> from <code>{e.source}</code>
                  </li>
                ))}
              </ul>
            ) : null
          ]
        ]}
      />
    </>
  );
}
function EventDetails({ view, t }: { view: AtlasView; t: TransitionView }) {
  const from = view.states.get(t.source);
  const to = t.target ? view.states.get(t.target) : undefined;
  const note = statusNote(t.status, t.result?.reason);
  return (
    <>
      <Flex gap="xs" align="center" wrap="wrap">
        <Title order={1} mb="sm">
          {t.event}
        </Title>
        <StatusBadge status={t.status} />
      </Flex>
      <Text component="div" c="dimmed">
        {KIND_LABEL[t.kind]}
      </Text>
      <Text component="div" c="dimmed">
        From{' '}
        <Text span inherit fw={600}>
          {from?.name ?? t.source}
        </Text>{' '}
        to{' '}
        <Text span inherit fw={600}>
          {to?.name ?? 'a screen not in the spec'}
        </Text>
        .
      </Text>
      {note && (
        <Text component="div" c="dimmed">
          {note}
        </Text>
      )}
      <Stage
        looks={eventLooks(view, t)}
        prefer="film"
        notice={t.result?.clip.state === 'processing' ? 'The video of this event is still processing.' : null}
        empty={<Text c="dimmed">This event has no picture, video, or timeline in this run.</Text>}
      />
      <Questions view={view} ids={t.questionIds} />
      <Developer
        rows={[
          ['Transition ID', <code key="id">{t.id}</code>],
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
  return <Stage looks={looks} prefer="timeline" />;
}
function JourneyDetails({ view, journeyId, chartId }: { view: AtlasView; journeyId: string; chartId: string }) {
  const j = view.journeys.find((x) => x.id === journeyId);
  if (!j)
    return (
      <Text component="div" c="dimmed">
        This journey isn’t in the spec.
      </Text>
    );
  return (
    <>
      <Flex gap="xs" align="center" wrap="wrap">
        <Title order={1} mb="sm">
          {j.name}
        </Title>
        <StatusBadge status={j.status} />
      </Flex>
      {j.description && (
        <Text component="div" c="dimmed">
          {j.description}
        </Text>
      )}
      {!j.replay.ok && (
        <Text component="div" c="red.7">
          The chart can’t follow this journey past “{j.replay.failedAt ?? j.replay.missingEnds.join(', ')}”.
        </Text>
      )}
      <JourneyLooks view={view} journeyId={j.id} />
      <List spacing="xs" listStyleType="none" type="ordered">
        {j.steps.map((step, i) => {
          const t = view.transitions.get(step.transitionIds[0] ?? '');
          if (!t) return null;
          const here =
            view.transitions.get(t.id)?.chartId === chartId ||
            [...view.transitions.values()].some((x) => x.carriedBy === t.id && x.chartId === chartId);
          return (
            <List.Item key={i} data-here={here}>
              <Anchor
                renderRoot={(props) => (
                  <Link
                    {...props}
                    to="/chart/$chartId"
                    params={{ chartId: t.chartId }}
                    search={(prev) => ({ run: prev.run, journey: j.id, event: t.id })}
                  />
                )}
              >
                <Text span inherit>
                  {i + 1}
                </Text>
                <Text data-status={t.status} span inherit>
                  {t.event}
                </Text>
                <StatusDot status={t.status} />
              </Anchor>
            </List.Item>
          );
        })}
      </List>
    </>
  );
}
export function SidePanel({ view, chartId, selection }: { view: AtlasView; chartId: string; selection: MapSelection }) {
  const state = selection.screen ? view.states.get(selection.screen) : undefined;
  const transition = selection.event ? view.transitions.get(selection.event) : undefined;
  let body: ReactNode;
  let label: string;
  if (state) {
    body = <ScreenDetails view={view} state={state} />;
    label = `Screen: ${state.name}`;
  } else if (transition) {
    body = <EventDetails view={view} t={transition} />;
    label = `Event: ${transition.event}`;
  } else if (selection.journey) {
    body = <JourneyDetails view={view} journeyId={selection.journey} chartId={chartId} />;
    label = 'Journey';
  } else {
    body = (
      <Text component="div" c="dimmed">
        This item isn’t in the spec any more. It may have been renamed or removed.
      </Text>
    );
    label = 'Not found';
  }
  const scopeName = state?.name ?? transition?.source;
  const scope = scopeName ? (mapScope(view, chartId, scopeName) ?? undefined) : undefined;
  return (
    <Container aria-label={label} component="article" size="xl" w="100%" py="xl">
      {body}
      <ChartTests view={view} chartId={chartId} />
      {view.charts.get(chartId)?.file && <ChartSource file={view.charts.get(chartId)!.file} />}
      <Anchor
        aria-current={undefined}
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
      </Anchor>
    </Container>
  );
}
