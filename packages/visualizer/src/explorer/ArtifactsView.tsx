/**
 * @module Artifacts view
 *
 * Every recorded result that carries evidence (recordings, screenshots, traces) across the project's history, newest first,
 * found by artifact tag, media type, label, feature, environment, branch, outcome and time. A result is listed with the
 * run, commit and status it was recorded with, so a recording tagged `demo` is found even when a later attempt is
 * untagged. Each row opens that exact result in the test detail. An empty answer for a filter says nothing matches and
 * offers to clear it; it never says the project has nothing recorded.
 */
import { IconLock, IconPlayerPlay, IconVideo } from '@tabler/icons-react';
import { Alert, Anchor, Box, Button, Code, Group, Stack, Table, Text } from '@mantine/core';
import { videoCounts } from '@crvouga/atlas/reports/evidence-detail';
import { environmentLabel } from '@crvouga/atlas/reports/layer-axes';
import { Link } from '@tanstack/react-router';
import { useMemo, useState } from 'react';

import { staticEvidence } from '../evidence/api';
import { ago, exactTime, plural, shortSha, statusWord, useNow } from '../evidence/format';
import { StatusMark } from '../evidence/marks';
import { useArtifactList } from './catalog';
import { FreezeCollection } from './collections';
import { FilterBar } from './filters';
import { patched, useExplorerNavigate, useExplorerSearch } from './navigate';
import { runName } from './parts';
import { entriesFromArtifacts } from './playlist-entries';
import { WatchPlaylist } from './playlist';
import { filtered, filterOf, NO_FILTERS } from './search';
import { filterParams } from '@crvouga/atlas/reports/artifact-query';

const ARTIFACT_ROWS = 50;

/** The Artifacts tab: recorded results that carry evidence, filtered by the address. */
export function ArtifactsView() {
  const search = useExplorerSearch();
  const go = useExplorerNavigate();
  const filter = useMemo(() => filterOf(search), [search]);
  const narrow = filtered(search);
  const answer = useArtifactList(filter);
  const now = useNow();
  const [shown, setShown] = useState(ARTIFACT_ROWS);
  const [watching, setWatching] = useState(false);
  const [freezing, setFreezing] = useState(false);
  const entries = useMemo(() => (answer.data && !answer.data.unsupported ? entriesFromArtifacts(answer.data.list.results) : []), [answer.data]);
  if (answer.isPending)
    return (
      <Text role="status" component="div" c="dimmed">
        Reading the artifacts…
      </Text>
    );
  if (answer.isError)
    return (
      <Alert role="alert" color="red" my="sm">
        The artifacts could not be read. {answer.error.message}
      </Alert>
    );
  if (answer.data.unsupported)
    return (
      <Alert role="status" color="blue" my="sm" data-unsupported>
        This server cannot search artifacts, so nothing is shown here rather than a list that looks narrowed. Update the server to find recordings by tag, type and label; the Tests tab still filters by artifact tag.
      </Alert>
    );
  const { list } = answer.data;
  return (
    <Box aria-label="Artifacts" component="section" mb="lg">
      {(narrow || list.results.length > 0) && <FilterBar facets={list.facets} search={search} tab="artifacts" />}
      {!list.results.length && !narrow && (
        <Text component="div" c="dimmed">
          No recorded result carries evidence yet. Recordings, screenshots and traces published with a result are listed here.
        </Text>
      )}
      {list.results.length > 0 && (
        <Text role="status" component="div">
          {list.total > list.results.length
            ? `The newest ${list.results.length} of ${plural(list.total, 'result', 'results')}${narrow ? ' matching' : ''}`
            : `${plural(list.results.length, 'result', 'results')}${narrow ? ' matching' : ''}`}
        </Text>
      )}
      {!list.results.length && narrow && (
        <Stack gap="xs" align="flex-start" role="status" data-no-match>
          <Text component="div" c="dimmed">
            Nothing matches these filters.
          </Text>
          <Button type="button" variant="light" onClick={() => go(NO_FILTERS)}>
            Clear filters
          </Button>
        </Stack>
      )}
      {list.results.length > 0 && (
        <Group my="sm" gap="sm">
          <Button type="button" variant="filled" leftSection={<IconPlayerPlay size={16} aria-hidden="true" />} onClick={() => setWatching(true)}>
            Watch these {plural(list.results.length, 'result', 'results')}
          </Button>
          {!staticEvidence && (
            <Button type="button" leftSection={<IconLock size={16} aria-hidden="true" />} onClick={() => setFreezing(true)}>
              Freeze as review collection
            </Button>
          )}
        </Group>
      )}
      {watching && <WatchPlaylist entries={entries} total={list.total} onClose={() => setWatching(false)} />}
      {freezing && <FreezeCollection results={list.results} total={list.total} filterQuery={filterParams(filter).toString()} onClose={() => setFreezing(false)} />}
      {list.results.length > 0 && (
        <Table.ScrollContainer minWidth={700}>
          <Table data-artifacts>
            <Table.Thead>
              <Table.Tr>
                <Table.Th scope="col">Recorded</Table.Th>
                <Table.Th scope="col">Test</Table.Th>
                <Table.Th scope="col">Outcome</Table.Th>
                <Table.Th scope="col">Environment</Table.Th>
                <Table.Th scope="col">Branch</Table.Th>
                <Table.Th scope="col">Commit</Table.Th>
                <Table.Th scope="col">Run</Table.Th>
                <Table.Th scope="col">Evidence</Table.Th>
                <Table.Th scope="col">Tags</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {list.results.slice(0, shown).map((result) => {
                const videos = videoCounts(result.videos);
                return (
                  <Table.Tr key={`${result.layer}|${result.key}|${result.kind}|${result.producer}|${result.environment}`} data-status={result.status}>
                    <Table.Td title={exactTime(result.at)}>{ago(result.at, now)}</Table.Td>
                    <Table.Td>
                      <Anchor
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
                    </Table.Td>
                    <Table.Td>
                      <StatusMark status={result.status} size={14} /> {statusWord(result.status)}
                    </Table.Td>
                    <Table.Td>{environmentLabel(result.environment)}</Table.Td>
                    <Table.Td c="dimmed">{result.branch ?? '—'}</Table.Td>
                    <Table.Td>
                      <Code>{shortSha(result.sha) ?? '—'}</Code>
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
                    <Table.Td>
                      {result.types.join(', ') || '—'}
                      {videos && videos.recordings > 0 && (
                        <Text component="div" size="xs" c="dimmed" data-video="available">
                          <IconVideo size={16} aria-hidden="true" /> {plural(videos.recordings, 'video', 'videos')}
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td data-tags>{result.artifactTags.map((tag) => `#${tag}`).join(' ') || '—'}</Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
      {list.results.length > shown && (
        <Button type="button" onClick={() => setShown(shown + ARTIFACT_ROWS)} variant="subtle">
          Show more ({list.results.length - shown} more)
        </Button>
      )}
    </Box>
  );
}
