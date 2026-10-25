import { addSummaries, NO_EVIDENCE, type SpecSummary } from '@crvouga/atlas/reports/evidence-view';
import { Box, Button, Group, NavLink, Stack, Text, Title } from '@mantine/core';
import { Link, useSearch } from '@tanstack/react-router';
import { useMemo } from 'react';
import { folderOf, outlinePath, specFile, type SpecKind } from '../spec-kind';
import { useUiStore, type ResultFilter } from '../state/ui-store';
import { useEvidence } from './evidence-context';
import { StatusMark, Tally } from './marks';
const FILTERS: readonly {
  readonly id: ResultFilter;
  readonly label: string;
  readonly keeps: (summary: SpecSummary) => boolean;
}[] = [
  { id: 'all', label: 'All', keeps: () => true },
  { id: 'results', label: 'Results', keeps: (summary) => summary.status !== 'none' },
  { id: 'running', label: 'Running', keeps: (summary) => summary.counts.running > 0 },
  { id: 'failed', label: 'Failing', keeps: (summary) => summary.counts.failed > 0 },
  { id: 'none', label: 'None', keeps: (summary) => summary.status === 'none' }
];
/** Every spec of one kind, grouped by folder, each with what the combined report holds for it. */
export function SpecIndex({ kind }: { kind: SpecKind }) {
  const evidence = useEvidence();
  const search = useSearch({ strict: false });
  const filter = useUiStore((s) => s.resultFilter);
  const setFilter = useUiStore((s) => s.setResultFilter);
  const open = typeof search.spec === 'string' ? specFile(search.spec) : '';
  const rows = useMemo(
    () =>
      evidence.files.filter(kind.accepts).map((file) => ({
        file,
        title: evidence.titleOf(file),
        summary: evidence.view.specs.get(outlinePath(file))?.summary ?? NO_EVIDENCE
      })),
    // `titleOf` reads the outline the view was built from.
    [evidence.files, evidence.view, kind]
  );
  const keeps = FILTERS.find((entry) => entry.id === filter)!.keeps;
  const visible = rows.filter((row) => keeps(row.summary));
  const groups = useMemo(() => {
    const byFolder = new Map<string, typeof visible>();
    for (const row of visible) byFolder.set(folderOf(row.file), [...(byFolder.get(folderOf(row.file)) ?? []), row]);
    return [...byFolder];
  }, [visible]);
  return (
    <Box aria-label={`${kind.label} ${kind.many}`} component="nav" p="md">
      <Group role="group" aria-label="Show" gap="xs" mb="md">
        {FILTERS.map((entry) => (
          <Button
            key={entry.id}
            type="button"
            aria-pressed={filter === entry.id}
            onClick={() => setFilter(entry.id)}
            variant={filter === entry.id ? 'light' : 'subtle'}
          >
            {entry.label}{' '}
            <Text span inherit>
              {rows.filter((row) => entry.keeps(row.summary)).length}
            </Text>
          </Button>
        ))}
      </Group>
      {evidence.filesPending && <Text component="div">Loading…</Text>}
      {evidence.filesError && <Text component="div">The file list could not be loaded.</Text>}
      {!evidence.filesPending && !evidence.filesError && visible.length === 0 && (
        <Text component="div">
          {rows.length === 0
            ? `No ${kind.many} in this spec set.`
            : filter === 'running'
              ? `No running ${kind.many}.`
              : filter === 'failed'
                ? `No failing ${kind.many}.`
                : filter === 'results'
                  ? `No ${kind.many} with results yet.`
                  : `Every ${kind.one} has results.`}
        </Text>
      )}
      {groups.map(([folder, entries]) => (
        <Box key={folder || kind.id} component="section" mb="lg">
          <Title order={3} mb="sm">
            <Text span inherit>
              {folder || kind.label}
            </Text>
            <Tally summary={addSummaries(entries.map((row) => row.summary))} />
          </Title>
          <Stack gap="xs">
            {entries.map((row) => (
              <NavLink
                key={row.file}
                label={row.title}
                title={row.file}
                active={open === row.file}
                leftSection={<StatusMark status={row.summary.status} size={14} />}
                rightSection={row.summary.status !== 'none' ? <Tally summary={row.summary} /> : undefined}
                data-result={row.summary.status}
                aria-current={open === row.file ? 'page' : undefined}
                renderRoot={(props) => <Link {...props} to="/specs/$kind" params={{ kind: kind.id }} search={{ spec: row.file }} />}
              />
            ))}
          </Stack>
        </Box>
      ))}
    </Box>
  );
}
