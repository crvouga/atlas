import { SpecLogo } from '../components/SpecLogo';
import { addSummaries, NO_EVIDENCE, type SpecSummary } from '@crvouga/atlas/reports/evidence-view';
import { Alert, Anchor, Box, Button, Container, Flex, Group, List, Stack, Text, Title } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import { useMemo } from 'react';
import { folderOf, outlinePath, type SpecKind } from '../spec-kind';
import { useUiStore } from '../state/ui-store';
import { useEvidence } from './evidence-context';
import { ago, plural, useNow } from './format';
import { EvidenceIncomplete, EvidenceWaiting } from './load-state';
import { backendLabel, Bounded, CountLine, Meter, StatusMark, Tally } from './marks';
/** A kind's specs at a glance: how many have results, which are failing, and what just ran. */
export function Overview({ kind }: { kind: SpecKind }) {
  const evidence = useEvidence();
  const now = useNow();
  const setFilter = useUiStore((s) => s.setResultFilter);
  const setSourcesOpen = useUiStore((s) => s.setSourcesOpen);
  const files = useMemo(() => evidence.files.filter(kind.accepts), [evidence.files, kind]);
  const rows = useMemo(
    () => files.map((file) => ({ file, summary: evidence.view.specs.get(outlinePath(file))?.summary ?? NO_EVIDENCE })),
    [files, evidence.view]
  );
  const total = useMemo(() => addSummaries(rows.map((row) => row.summary)), [rows]);
  const withResults = rows.filter((row) => row.summary.status !== 'none');
  const failing = rows.filter((row) => row.summary.counts.failed > 0).sort((a, b) => b.summary.counts.failed - a.summary.counts.failed);
  const recent = [...withResults].sort((a, b) => (b.summary.latestAtMs ?? 0) - (a.summary.latestAtMs ?? 0)).slice(0, 8);
  const empty = rows.length - withResults.length;
  const specRow = (row: { file: string; summary: SpecSummary }) => (
    <List.Item key={row.file}>
      <Anchor
        display="block"
        p="sm"
        underline="never"
        renderRoot={(props) => <Link {...props} to="/specs/$kind" params={{ kind: kind.id }} search={{ spec: row.file }} />}
      >
        <Group gap="md" align="center" wrap="nowrap">
          <StatusMark status={row.summary.status} />
          <Stack gap={0} flex={1} miw={0}>
            <Text span inherit fw={500} truncate title={evidence.titleOf(row.file)}>
              {evidence.titleOf(row.file)}
            </Text>
            {folderOf(row.file) && (
              <Text span inherit c="dimmed" truncate title={folderOf(row.file)}>
                {folderOf(row.file)}
              </Text>
            )}
          </Stack>
          <Flex direction={{ base: 'column', sm: 'row' }} align={{ base: 'flex-end', sm: 'center' }} gap={{ base: 'xs', sm: 'md' }}>
            <Tally summary={row.summary} />
            {row.summary.latestAtMs !== null && (
              <Text span inherit c="dimmed" textWrap="nowrap">
                {ago(row.summary.latestAtMs, now)}
              </Text>
            )}
          </Flex>
        </Group>
      </Anchor>
    </List.Item>
  );
  return (
    <Container component="article" size="xl" w="100%" py="xl">
      <Box component="header" mb="lg">
        <Flex gap="sm" align="center" mb="sm">
          <SpecLogo kind={kind} />
          <Title order={1}>{kind.label}</Title>
        </Flex>
        <Stack gap="sm" miw={0}>
          <Meter counts={total.counts} />
          <Flex gap="xs" align="center" wrap="wrap">
            <Text span inherit>
              {plural(files.length, kind.one, kind.many)}
            </Text>
            {evidence.ready && (
              <Text span inherit>
                {withResults.length} with results
              </Text>
            )}
            {evidence.ready && empty > 0 && (
              <Text span inherit>
                {empty} without
              </Text>
            )}
          </Flex>
          {total.status !== 'none' && (
            <Flex gap="xs" align="center" wrap="wrap">
              <CountLine summary={total} noun={kind.check} nouns={`${kind.check}s`} />
            </Flex>
          )}
        </Stack>
      </Box>

      {evidence.unavailable && (
        <Alert role="alert" color={'red'} my="sm">
          Recorded results are unavailable. {evidence.unavailable}{' '}
          <Button type="button" onClick={evidence.retry} variant="subtle">
            Try again
          </Button>
        </Alert>
      )}
      {evidence.notices.map((notice) => (
        <Alert key={notice} role="status" color={'blue'} my="sm">
          {notice}{' '}
          <Button type="button" onClick={evidence.retry} variant="subtle">
            Try again
          </Button>
        </Alert>
      ))}
      {!evidence.ready && !evidence.unavailable && <EvidenceWaiting usable={`The list of ${kind.many} is readable.`} />}
      {evidence.ready && <EvidenceIncomplete />}
      {evidence.ready && evidence.pending > 0 && (
        <Text role="status" component="div" c="dimmed">
          Reading {plural(evidence.pending, 'more layer', 'more layers')}…
        </Text>
      )}

      {evidence.active.length > 0 && (
        <Box component="section" mb="lg">
          <Title order={2} mb="sm">
            Running now
          </Title>
          <List spacing="xs" listStyleType="none">
            {evidence.active.map((run) => (
              <List.Item key={run.source}>
                <Group gap="md" align="center">
                  <StatusMark status="running" />
                  <Text span inherit>
                    {run.packageDir}
                  </Text>
                  <Text data-status={run.failed ? 'failed' : 'running'} span inherit>
                    {plural(run.completed, 'result', 'results')} so far{run.failed ? `, ${run.failed} failed` : ''}
                  </Text>
                  <Text span inherit c="dimmed">
                    started {ago(run.startedAtMs, now)}
                  </Text>
                </Group>
              </List.Item>
            ))}
          </List>
        </Box>
      )}

      {failing.length > 0 && (
        <Box component="section" mb="lg">
          <Title order={2} mb="sm">
            Failing{' '}
            <Text span inherit c="dimmed">
              {plural(failing.length, kind.one, kind.many)}
            </Text>
          </Title>
          <List spacing="xs" listStyleType="none">
            <Bounded items={failing} size={12} more="More failing">
              {specRow}
            </Bounded>
          </List>
        </Box>
      )}

      {recent.length > 0 && (
        <Box component="section" mb="lg">
          <Title order={2} mb="sm">
            Latest results
          </Title>
          <List spacing="xs" listStyleType="none">
            {recent.map(specRow)}
          </List>
        </Box>
      )}

      {evidence.ready && evidence.pending === 0 && evidence.failed.length === 0 && withResults.length === 0 && !evidence.unavailable && (
        <Text component="div" c="dimmed">
          {evidence.layers.length === 0
            ? `Nothing has been recorded yet. Results appear here as a spec run finishes each test.`
            : `None of the ${plural(evidence.layers.length, 'layer', 'layers')} in the combined report checked a ${kind.one}.`}
        </Text>
      )}

      {evidence.ready && (
        <Text component="div" c="dimmed">
          {plural(evidence.layers.length, 'layer', 'layers')} from{' '}
          {evidence.backends
            .filter((backend) => backend.available)
            .map((backend) => backendLabel(evidence.backends, backend.id))
            .join(' and ') || 'no report store'}
          .{' '}
          <Button type="button" onClick={() => setSourcesOpen(true)} variant="subtle">
            Choose sources
          </Button>
          {empty > 0 && (
            <>
              {' · '}
              <Button type="button" onClick={() => setFilter('none')} variant="subtle">
                Show the {empty} without results
              </Button>
            </>
          )}
        </Text>
      )}
    </Container>
  );
}
