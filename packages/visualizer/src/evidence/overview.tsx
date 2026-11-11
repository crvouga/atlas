import { SpecLogo } from '../components/SpecLogo';
import { addSummaries, NO_EVIDENCE, type SpecSummary } from '@crvouga/atlas/reports/evidence-view';
import { Alert, Button, Card, Divider, Group, List, NavLink, Stack, Text } from '@mantine/core';
import { IconClipboardOff } from '@tabler/icons-react';
import { Link } from '@tanstack/react-router';
import { useMemo } from 'react';
import { PageHeader, Panel } from '../components/Page';
import { folderOf, outlinePath, type SpecKind } from '../spec-kind';
import { useUiStore } from '../state/ui-store';
import { useEvidence } from './evidence-context';
import { ago, plural, useNow } from './format';
import { EvidenceIncomplete, EvidenceWaiting, StateBlock } from './load-state';
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
    <NavLink
      label={evidence.titleOf(row.file)}
      description={folderOf(row.file) || undefined}
      title={row.file}
      leftSection={<StatusMark status={row.summary.status} />}
      rightSection={
        <Group gap="sm" wrap="nowrap">
          <Tally summary={row.summary} />
          {row.summary.latestAtMs !== null && (
            <Text span size="xs" c="dimmed" textWrap="nowrap" visibleFrom="xs">
              {ago(row.summary.latestAtMs, now)}
            </Text>
          )}
        </Group>
      }
      renderRoot={(props) => <Link {...props} to="/specs/$kind" params={{ kind: kind.id }} search={{ spec: row.file }} />}
    />
    </List.Item>
  );
  return (
    <Stack component="article" gap="md">
      <Card component="header">
        <PageHeader mark={<SpecLogo kind={kind} />} title={kind.label}>
          <Stack gap="xs" miw={0}>
            <Meter counts={total.counts} />
            <Group gap="sm" align="center" wrap="wrap">
              <Text span fw={500}>
                {plural(files.length, kind.one, kind.many)}
              </Text>
              {evidence.ready && (
                <>
                  <Divider orientation="vertical" />
                  <Text span c="dimmed">
                    {withResults.length} with results
                  </Text>
                </>
              )}
              {evidence.ready && empty > 0 && (
                <>
                  <Divider orientation="vertical" />
                  <Text span c="dimmed">
                    {empty} without
                  </Text>
                </>
              )}
              {total.status !== 'none' && (
                <>
                  <Divider orientation="vertical" />
                  <CountLine summary={total} noun={kind.check} nouns={`${kind.check}s`} />
                </>
              )}
            </Group>
          </Stack>
        </PageHeader>
      </Card>

      {evidence.unavailable && (
        <Alert role="alert" color={'red'}>
          <Group gap="sm" justify="space-between">
            <Text span>Recorded results are unavailable. {evidence.unavailable} </Text>
            <Button type="button" size="compact-sm" onClick={evidence.retry}>
              Try again
            </Button>
          </Group>
        </Alert>
      )}
      {evidence.notices.map((notice) => (
        <Alert key={notice} role="status" color={'blue'}>
          <Group gap="sm" justify="space-between">
            <Text span>{notice} </Text>
            <Button type="button" size="compact-sm" onClick={evidence.retry}>
              Try again
            </Button>
          </Group>
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
        <Panel component="section" title="Running now">
          <Stack gap="xs">
            {evidence.active.map((run) => (
              <Group key={run.source} gap="sm" align="center">
                <StatusMark status="running" />
                <Text span fw={500} ff="monospace">
                  {run.packageDir}
                </Text>
                <Text data-status={run.failed ? 'failed' : 'running'} span>
                  {plural(run.completed, 'result', 'results')} so far{run.failed ? `, ${run.failed} failed` : ''}
                </Text>
                <Text span size="xs" c="dimmed">
                  started {ago(run.startedAtMs, now)}
                </Text>
              </Group>
            ))}
          </Stack>
        </Panel>
      )}

      {failing.length > 0 && (
        <Panel
          component="section"
          flush
          title={
            <>
              Failing{' '}
              <Text span inherit c="dimmed" fw={400}>
                {plural(failing.length, kind.one, kind.many)}
              </Text>
            </>
          }
        >
          <List spacing={2} listStyleType="none" p="xs" pt={0}>
            <Bounded items={failing} size={12} more="More failing">
              {specRow}
            </Bounded>
          </List>
        </Panel>
      )}

      {recent.length > 0 && (
        <Panel component="section" flush title="Latest results">
          <List spacing={2} listStyleType="none" p="xs" pt={0}>
            {recent.map(specRow)}
          </List>
        </Panel>
      )}

      {evidence.ready && evidence.pending === 0 && evidence.failed.length === 0 && withResults.length === 0 && !evidence.unavailable && (
        <Card>
          <StateBlock icon={<IconClipboardOff size={22} />}>
            {evidence.layers.length === 0
              ? `Nothing has been recorded yet. Results appear here as a spec run finishes each test.`
              : `None of the ${plural(evidence.layers.length, 'layer', 'layers')} in the combined report checked a ${kind.one}.`}
          </StateBlock>
        </Card>
      )}

      {evidence.ready && (
        <Group gap="xs" align="center" wrap="wrap">
          <Text component="div" size="xs" c="dimmed">
            {plural(evidence.layers.length, 'layer', 'layers')} from{' '}
            {evidence.backends
              .filter((backend) => backend.available)
              .map((backend) => backendLabel(evidence.backends, backend.id))
              .join(' and ') || 'no report store'}
            .
          </Text>
          <Button type="button" size="compact-xs" onClick={() => setSourcesOpen(true)} variant="subtle">
            Choose sources
          </Button>
          {empty > 0 && (
            <Button type="button" size="compact-xs" onClick={() => setFilter('none')} variant="subtle">
              Show the {empty} without results
            </Button>
          )}
        </Group>
      )}
    </Stack>
  );
}
