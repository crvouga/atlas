/**
 * @module Artifacts view
 *
 * Every recorded result that carries evidence (recordings, screenshots, traces) across the project's history, newest first,
 * found by artifact tag, media type, label, feature, environment, branch, outcome and time. A result is listed with the
 * run, commit and status it was recorded with, so a recording tagged `demo` is found even when a later attempt is
 * untagged. Each row opens that exact result in the test detail. An empty answer for a filter says nothing matches and
 * offers to clear it; it never says the project has nothing recorded.
 */
import { IconFileText, IconFilterOff, IconLock, IconPhoto, IconPlayerPlay, IconVideo } from '@tabler/icons-react';
import { Alert, Anchor, Badge, Button, Center, Code, Group, Stack, Table, Text } from '@mantine/core';
import { videoCounts } from '@crvouga/atlas/reports/evidence-detail';
import { environmentLabel } from '@crvouga/atlas/reports/layer-axes';
import { Link } from '@tanstack/react-router';
import { useMemo, useState } from 'react';

import { Panel } from '../components/Page';
import { staticEvidence } from '../evidence/api';
import { ago, exactTime, plural, shortSha, statusWord, useNow } from '../evidence/format';
import { StatusMark } from '../evidence/marks';
import { useArtifactList } from './catalog';
import { FreezeCollection } from './collections';
import { FilterBar } from './filters';
import { patched, useExplorerNavigate, useExplorerSearch, useWatchAddress } from './navigate';
import { runName } from './parts';
import { entriesFromArtifacts } from './playlist-entries';
import { ClipThumb, WatchPlaylist } from './playlist';
import { RecordingTextSearch } from './RecordingTextSearch';
import { EmptyState, Reading } from './RunsView';
import { filtered, filterOf, NO_FILTERS } from './search';
import { filterParams, forArtifacts } from '@crvouga/atlas/reports/artifact-query';

const ARTIFACT_ROWS = 50;
const TITLE = 'Recordings and artifacts';

/** What stands in the picture of a result that has evidence to look at but no recording to play. */
function otherEvidence(types: readonly string[]) {
  if (types.some((type) => /image|screenshot|picture/.test(type))) return <IconPhoto size={22} stroke={1.5} aria-hidden="true" />;
  return types.length > 0 ? <IconFileText size={22} stroke={1.5} aria-hidden="true" /> : undefined;
}

/** The Artifacts tab: recorded results that carry evidence, filtered by the address. */
export function ArtifactsView() {
  const search = useExplorerSearch();
  const go = useExplorerNavigate();
  // Recording completeness belongs to a run, not to a recorded result: the Artifacts tab never asks for it.
  const filter = useMemo(() => forArtifacts(filterOf(search)), [search]);
  const narrow = filtered(search);
  const answer = useArtifactList(filter);
  const now = useNow();
  const [shown, setShown] = useState(ARTIFACT_ROWS);
  const watch = useWatchAddress();
  const [freezing, setFreezing] = useState(false);
  const entries = useMemo(() => (answer.data && !answer.data.unsupported ? entriesFromArtifacts(answer.data.list.results) : []), [answer.data]);
  if (answer.isPending)
    return (
      <Panel title={TITLE}>
        <Reading>Reading the artifacts…</Reading>
      </Panel>
    );
  if (answer.isError)
    return (
      <Panel title={TITLE}>
        <Alert role="alert" color="red">
          The artifacts could not be read. {answer.error.message}
        </Alert>
      </Panel>
    );
  if (answer.data.unsupported)
    return (
      <Panel title={TITLE}>
        <Alert role="status" color="blue" data-unsupported>
          This server cannot search artifacts, so nothing is shown here rather than a list that looks narrowed. Update the server to find recordings by tag, type and label; the Tests tab still filters by artifact tag.
        </Alert>
      </Panel>
    );
  const { list } = answer.data;
  const some = list.results.length > 0;
  return (
    <Stack aria-label="Artifacts" component="section" gap="md">
      <Panel
        flush
        title={TITLE}
        description={
          some ? (
            <Text role="status" component="div" size="sm" c="dimmed">
              {list.total > list.results.length
                ? `The newest ${list.results.length} of ${plural(list.total, 'result', 'results')}${narrow ? ' matching' : ''}`
                : `${plural(list.results.length, 'result', 'results')}${narrow ? ' matching' : ''}`}
            </Text>
          ) : undefined
        }
        actions={
          some ? (
            <>
              {!staticEvidence && (
                <Button type="button" leftSection={<IconLock size={16} aria-hidden="true" />} onClick={() => setFreezing(true)}>
                  Freeze as review collection
                </Button>
              )}
              <Button type="button" variant="filled" leftSection={<IconPlayerPlay size={16} aria-hidden="true" />} onClick={() => watch.open()}>
                Watch these {plural(list.results.length, 'result', 'results')}
              </Button>
            </>
          ) : undefined
        }
      >
        {(narrow || some) && (
          <Stack px="lg" pb="md" pt={4}>
            <FilterBar facets={list.facets} search={search} tab="artifacts" />
          </Stack>
        )}
        {!some && !narrow && (
          <EmptyState icon={<IconVideo size={28} stroke={1.5} aria-hidden="true" />}>No recorded result carries evidence yet. Recordings, screenshots and traces published with a result are listed here.</EmptyState>
        )}
        {!some && narrow && (
          <EmptyState
            role="status"
            data-no-match
            icon={<IconFilterOff size={28} stroke={1.5} aria-hidden="true" />}
            action={
              <Button type="button" variant="light" onClick={() => go(NO_FILTERS)}>
                Clear filters
              </Button>
            }
          >
            Nothing matches these filters.
          </EmptyState>
        )}
        {some && (
          <Table.ScrollContainer minWidth={860}>
            <Table data-artifacts verticalSpacing="sm" highlightOnHover>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th scope="col" pl="lg">
                    Recording
                  </Table.Th>
                  <Table.Th scope="col">Outcome</Table.Th>
                  <Table.Th scope="col">Environment</Table.Th>
                  <Table.Th scope="col">Branch and commit</Table.Th>
                  <Table.Th scope="col">Run</Table.Th>
                  <Table.Th scope="col">Recorded</Table.Th>
                  <Table.Th scope="col" pr="lg">
                    Tags
                  </Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {list.results.slice(0, shown).map((result, at) => {
                  const videos = videoCounts(result.videos);
                  return (
                    <Table.Tr key={`${result.layer}|${result.key}|${result.kind}|${result.producer}|${result.environment}`} data-status={result.status}>
                      <Table.Td pl="lg">
                        <Group gap="sm" wrap="nowrap" align="center">
                          <ClipThumb entry={entries[at]!} w={128} fallback={otherEvidence(result.types)} />
                          <Stack gap={2} miw={0}>
                            <Anchor
                              fw={500}
                              aria-label={`Open ${result.title} as recorded in run ${runName(result.run)}`}
                              renderRoot={(props) => (
                                <Link
                                  {...props}
                                  to="/"
                                  search={patched({ tab: undefined, openRun: undefined, test: result.key, layer: result.layer })}
                                  resetScroll={false}
                                  activeOptions={{ exact: true }}
                                />
                              )}
                            >
                              {result.title}
                            </Anchor>
                            <Text c="dimmed" fz="xs">
                              {result.producer}
                            </Text>
                            <Group gap={6} wrap="wrap">
                              <Text span size="xs" c="dimmed">
                                {result.types.join(', ') || '—'}
                              </Text>
                              {videos && videos.recordings > 0 && (
                                <Badge component="span" size="sm" variant="default" leftSection={<IconVideo size={12} aria-hidden="true" />} data-video="available">
                                  {plural(videos.recordings, 'video', 'videos')}
                                </Badge>
                              )}
                            </Group>
                          </Stack>
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        <Group gap={6} wrap="nowrap">
                          <StatusMark status={result.status} size={14} /> {statusWord(result.status)}
                        </Group>
                      </Table.Td>
                      <Table.Td>{environmentLabel(result.environment)}</Table.Td>
                      <Table.Td>
                        <Group gap={6} wrap="nowrap">
                          <Text span size="sm" c="dimmed">
                            {result.branch ?? '—'}
                          </Text>
                          <Code>{shortSha(result.sha) ?? '—'}</Code>
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        <Anchor
                          aria-label={`Open run ${runName(result.run)}`}
                          renderRoot={(props) => (
                            <Link {...props} to="/" search={patched({ tab: 'runs', openRun: result.run, test: undefined, layer: undefined, video: undefined })} resetScroll={false} activeOptions={{ exact: true }} />
                          )}
                        >
                          {runName(result.run)}
                        </Anchor>
                      </Table.Td>
                      <Table.Td title={exactTime(result.at)} c="dimmed">
                        {ago(result.at, now)}
                      </Table.Td>
                      <Table.Td data-tags pr="lg" miw={110}>
                        {result.artifactTags.length > 0 ? (
                          <Group gap={4} wrap="wrap">
                            {result.artifactTags.map((tag) => (
                              <Badge key={tag} component="span" size="sm" variant="light" tt="none">
                                #{tag}
                              </Badge>
                            ))}
                          </Group>
                        ) : (
                          <Text span c="dimmed">
                            —
                          </Text>
                        )}
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
        {list.results.length > shown && (
          <Center p="sm">
            <Button type="button" onClick={() => setShown(shown + ARTIFACT_ROWS)} variant="subtle">
              Show more ({list.results.length - shown} more)
            </Button>
          </Center>
        )}
      </Panel>
      {watch.watching && <WatchPlaylist entries={entries} total={list.total} initial={watch.clip} onSelect={watch.select} onClose={watch.close} />}
      {freezing && <FreezeCollection results={list.results} total={list.total} filterQuery={filterParams(filter).toString()} onClose={() => setFreezing(false)} />}
      {some && <RecordingTextSearch entries={entries} total={list.total} />}
    </Stack>
  );
}
