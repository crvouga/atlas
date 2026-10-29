/**
 * @module Run artifacts
 *
 * The files a run carries, without opening a test: for each layer of the run, who recorded it and how many checks it
 * holds (a layer of none is evidence only and is never shown as a pass), then the files it carries as a whole (review
 * movies, archives, summaries) played or shown in place; and the recordings its tests reference, listed once however
 * many tests share the same bytes. Each run-level file has an address of its own (`openRun`, `layer`, `artifact`) that
 * selects that exact file of that immutable layer, whatever runs arrive later. Files are shown exactly as everywhere
 * else: by `ArtifactCard`, so sandboxing, content types and safe downloads are the same.
 */
import { artifactRef } from '@crvouga/atlas/reports/artifact-tags';
import { attachmentIdentity, type EvidenceHolder, type PartEvidence } from '@crvouga/atlas/reports/evidence-detail';
import { environmentLabel } from '@crvouga/atlas/reports/layer-axes';
import type { RunDetail, RunLayer, RunResult } from '@crvouga/atlas/reports/test-catalog';
import type { Attachment } from '@crvouga/atlas/schema';
import { Alert, Anchor, Badge, Box, Button, Group, List, Stack, Text, Title } from '@mantine/core';
import { IconAlertTriangle, IconVideo } from '@tabler/icons-react';
import { useQueries } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useMemo } from 'react';

import { reportJson } from '../evidence/api';
import { ArtifactCard } from '../evidence/artifacts';
import { exactTime, plural } from '../evidence/format';
import { Bounded } from '../evidence/marks';
import { patched, useExplorerSearch } from './navigate';

/** Files shown per group before "more". */
const SHOWN = 12;
/** Tests named in a recording's sentence before "and N more". */
const TESTS_NAMED = 5;

/** What a layer carries as a whole, as `GET /evidence/detail/{backend}/{id}` answers without a check. */
type LayerFiles = { readonly layer: string; readonly run: EvidenceHolder; readonly parts?: readonly PartEvidence[] };

/** A group of files one holder of a layer carries: the layer itself or one of its parts. */
type Holding = { readonly owner: string; readonly attachments: readonly Attachment[] };

function holdings(files: LayerFiles): Holding[] {
  return [
    { owner: 'the layer', attachments: files.run.attachments ?? [] },
    ...(files.parts ?? []).map((part) => ({ owner: `${part.title || part.id} (${part.kind})`, attachments: part.attachments ?? [] }))
  ].filter((holding) => holding.attachments.length > 0);
}

/** The tests that reference each recording, by what identifies its bytes. */
function recordingsOf(results: readonly RunResult[]) {
  const byBytes = new Map<string, { name: string; tests: Map<string, RunResult>; references: number }>();
  let unavailable = 0;
  for (const result of results)
    for (const video of result.videos ?? []) {
      if (!video.available || video.recording === undefined) {
        unavailable += 1;
        continue;
      }
      const held = byBytes.get(video.recording) ?? { name: video.name, tests: new Map<string, RunResult>(), references: 0 };
      held.references += 1;
      held.tests.set(result.key, held.tests.get(result.key) ?? result);
      byBytes.set(video.recording, held);
    }
  return { byBytes, unavailable };
}

/** The tests of a recording as links that open each test pinned to this run's record of it. */
function TestLinks({ tests }: { tests: readonly RunResult[] }) {
  return (
    <>
      {tests.slice(0, TESTS_NAMED).map((result, index) => (
        <Text span inherit key={result.key}>
          {index > 0 && ', '}
          <Anchor renderRoot={(props) => <Link {...props} to="/" search={patched({ tab: undefined, openRun: undefined, artifact: undefined, test: result.key, layer: result.layer })} resetScroll={false} activeOptions={{ exact: true }} />}>
            {result.title}
          </Anchor>
        </Text>
      ))}
      {tests.length > TESTS_NAMED && ` and ${tests.length - TESTS_NAMED} more`}
    </>
  );
}

/** Where the run's layer is from, for a person: the producer, environment and when it was recorded. */
function provenance(layer: RunLayer): string {
  return [layer.producer, layer.environment ? environmentLabel(layer.environment) : '', `recorded ${exactTime(layer.recordedAtMs)}`].filter(Boolean).join(' · ');
}

function LayerBlock({ runKey, layer, files, selected, shared }: { runKey: string; layer: RunLayer; files: { isPending: boolean; isError: boolean; refetch: () => unknown; data: LayerFiles | undefined }; selected: string | undefined; shared: (attachment: Attachment) => RunResult[] }) {
  const groups = files.data ? holdings(files.data) : [];
  return (
    <Box component="section" aria-label={`Layer ${layer.producer}`} data-layer={layer.id} mb="lg">
      <Title order={4}>{provenance(layer)}</Title>
      <Text c="dimmed" data-layer-checks={layer.checks}>
        {layer.checks > 0
          ? `${plural(layer.checks, 'check', 'checks')} recorded in this layer.`
          : 'No checks in this layer: it carries files only, so it says nothing about whether anything passed.'}{' '}
        {plural(layer.attachments, 'file', 'files')} of its own.
      </Text>
      {files.isPending && (
        <Text role="status" component="div" c="dimmed">
          Reading the files of this layer…
        </Text>
      )}
      {files.isError && (
        <Alert role="alert" color="red" my="sm" title="The files of this layer could not be read">
          <Button variant="light" onClick={() => void files.refetch()}>
            Try again
          </Button>
        </Alert>
      )}
      {groups.map((group) => (
        <Stack key={group.owner} gap="xs" mt="sm">
          {groups.length > 1 || group.owner !== 'the layer' ? <Text c="dimmed">From {group.owner}</Text> : null}
          <List spacing="xs" listStyleType="none">
            <Bounded items={group.attachments} size={SHOWN} more="More files">
              {(attachment, index) => {
                const tests = shared(attachment);
                const ref = artifactRef(attachment);
                return (
                  <ArtifactCard
                    key={`${ref}:${index}`}
                    attachment={attachment}
                    layer={layer.id}
                    selected={selected === `${layer.id}\u0000${ref}`}
                    link={
                      <Anchor
                        aria-label={`Link to ${attachment.name}`}
                        renderRoot={(props) => (
                          <Link {...props} to="/" search={patched({ tab: 'runs', openRun: runKey, layer: layer.id, artifact: ref, test: undefined, video: undefined })} resetScroll={false} activeOptions={{ exact: true }} />
                        )}
                      >
                        Link to this file
                      </Anchor>
                    }
                    note={
                      tests.length > 0 ? (
                        <Text component="div" c="dimmed" data-shared>
                          The same bytes are also referenced by {plural(tests.length, 'test', 'tests')} (<TestLinks tests={tests} />
                          ). That is one recording, not {tests.length + 1}.
                        </Text>
                      ) : undefined
                    }
                  />
                );
              }}
            </Bounded>
          </List>
        </Stack>
      ))}
    </Box>
  );
}

/**
 * The artifacts of one run: every layer's files, then the recordings its tests share. The selected file comes from the
 * address (`layer` and `artifact`); one that cannot be found is said so, never silently replaced by another.
 */
export function RunArtifacts({ detail }: { detail: RunDetail }) {
  const search = useExplorerSearch();
  const { run, results } = detail;
  const layers = detail.layers ?? [];
  const carrying = layers.filter((layer) => layer.attachments > 0);
  const queries = useQueries({
    queries: carrying.map((layer) => ({
      queryKey: ['run-files', layer.backend, layer.id],
      queryFn: ({ signal }: { signal: AbortSignal }) => reportJson<LayerFiles>(`/evidence/detail/${encodeURIComponent(layer.backend)}/${encodeURIComponent(layer.id)}`, signal),
      enabled: /^[0-9a-f]{64}$/.test(layer.id),
      staleTime: Number.POSITIVE_INFINITY,
      retry: false
    }))
  });
  const { byBytes, unavailable } = useMemo(() => recordingsOf(results), [results]);
  const loaded = queries.map((query) => query.data);
  // What identifies the bytes of each run-level file, so a recording a test also references is one thing.
  const runLevel = new Set<string>();
  for (const files of loaded)
    for (const group of files ? holdings(files) : [])
      for (const attachment of group.attachments) {
        const identity = attachmentIdentity(attachment);
        if (identity) runLevel.add(identity);
      }
  const sharedWith = (attachment: Attachment): RunResult[] => {
    const identity = attachmentIdentity(attachment);
    return identity ? [...(byBytes.get(identity)?.tests.values() ?? [])] : [];
  };
  const inTests = [...byBytes.entries()].filter(([identity]) => !runLevel.has(identity));
  const wanted = search.layer && search.artifact ? `${search.layer}\u0000${search.artifact}` : undefined;
  const everyRead = queries.every((query) => !query.isPending);
  const found = wanted
    ? loaded.some((files, index) => files && carrying[index]!.id === search.layer && holdings(files).some((group) => group.attachments.some((attachment) => artifactRef(attachment) === search.artifact)))
    : true;
  const wantedLayer = layers.find((layer) => layer.id === search.layer);
  const nothing = !carrying.length && !inTests.length && !unavailable;
  return (
    <Box aria-label="Run artifacts" component="section" mb="lg" data-run-artifacts>
      <Title order={3} mb="sm">
        Artifacts
      </Title>
      {wanted && everyRead && !found && (
        <Alert role="alert" color="orange" my="sm" icon={<IconAlertTriangle size={16} aria-hidden="true" />} title="That file is not in this run">
          {wantedLayer
            ? 'The layer the link names is in this run, but it no longer lists that file. It is not shown as another file.'
            : 'The link names a layer that is not part of this run (it may belong to another project or have been removed). It is not shown as another file.'}
        </Alert>
      )}
      {nothing && (
        <Text component="div" c="dimmed">
          This run carries no files of its own and none of its tests references a recording.
        </Text>
      )}
      {carrying.map((layer, index) => (
        <LayerBlock key={layer.id} runKey={run.key} layer={layer} files={queries[index]!} selected={wanted} shared={sharedWith} />
      ))}
      {(inTests.length > 0 || unavailable > 0) && (
        <Box aria-label="Recordings in tests" component="section" data-test-recordings>
          <Title order={4}>Recordings in tests</Title>
          <Text c="dimmed">
            A recording that several tests reference is listed once. Open a test to watch it.
          </Text>
          <List spacing="xs" listStyleType="none">
            <Bounded items={inTests} size={SHOWN} more="More recordings">
              {([identity, held]) => (
                <List.Item key={identity} data-recording>
                  <Group gap="xs">
                    <IconVideo size={16} aria-hidden="true" />
                    <Text span inherit fw={600}>
                      {held.name}
                    </Text>
                    {held.tests.size > 1 && <Badge variant="light">shared by {held.tests.size} tests</Badge>}
                  </Group>
                  <Text component="div" c="dimmed">
                    {held.references > 1 ? `${plural(held.references, 'reference', 'references')} to the same recording, in ` : 'In '}
                    <TestLinks tests={[...held.tests.values()]} />
                  </Text>
                </List.Item>
              )}
            </Bounded>
          </List>
          {unavailable > 0 && (
            <Text component="div" c="dimmed" data-video-unavailable>
              <IconAlertTriangle size={16} aria-hidden="true" /> {plural(unavailable, 'video reference', 'video references')} name no stored file, so they cannot be played.
            </Text>
          )}
        </Box>
      )}
    </Box>
  );
}
