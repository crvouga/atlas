import { addSummaries, NO_EVIDENCE, type SpecSummary } from '@crvouga/atlas/reports/evidence-view';
import { Box, Button, Group, NavLink, SegmentedControl, Stack, Text, TextInput, Title } from '@mantine/core';
import { Link, useSearch } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
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
const NO_DOMAIN = 'No domain declared';
/** Every spec of one kind, grouped by folder, each with what the combined report holds for it. */
export function SpecIndex({ kind }: { kind: SpecKind }) {
  const evidence = useEvidence();
  const search = useSearch({ strict: false });
  const filter = useUiStore((s) => s.resultFilter);
  const setFilter = useUiStore((s) => s.setResultFilter);
  const [query, setQuery] = useState('');
  const [grouping, setGrouping] = useState<'folder' | 'domain'>('folder');
  const open = typeof search.spec === 'string' ? specFile(search.spec) : '';
  // The domain a spec declares in its metadata is used as given; a spec that declares none is not given one.
  const domains = useMemo(() => new Map(evidence.specs.map((spec) => [spec.path, spec.domain])), [evidence.specs]);
  const rows = useMemo(
    () =>
      evidence.files.filter(kind.accepts).map((file) => ({
        file,
        title: evidence.titleOf(file),
        domain: domains.get(outlinePath(file)) || '',
        summary: evidence.view.specs.get(outlinePath(file))?.summary ?? NO_EVIDENCE
      })),
    // `titleOf` reads the outline the view was built from.
    [evidence.files, evidence.view, kind, domains]
  );
  const keeps = FILTERS.find((entry) => entry.id === filter)!.keeps;
  const needle = query.trim().toLowerCase();
  const visible = rows.filter(
    (row) => keeps(row.summary) && (!needle || `${row.title} ${row.file} ${row.domain}`.toLowerCase().includes(needle))
  );
  const groups = useMemo(() => {
    const byGroup = new Map<string, typeof visible>();
    for (const row of visible) {
      const group = grouping === 'domain' ? row.domain || NO_DOMAIN : folderOf(row.file);
      byGroup.set(group, [...(byGroup.get(group) ?? []), row]);
    }
    return [...byGroup];
  }, [visible, grouping]);
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
            rightSection={<Text span inherit>{rows.filter((row) => entry.keeps(row.summary)).length}</Text>}
          >
            {entry.label}{' '}
          </Button>
        ))}
      </Group>
      <Group gap="md" align="end" mb="md">
        <TextInput
          label={`Search ${kind.many}`}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          flex={1}
          miw="12rem"
        />
        <SegmentedControl
          aria-label="Group by"
          value={grouping}
          onChange={(value) => setGrouping(value === 'domain' ? 'domain' : 'folder')}
          data={[
            { label: 'Folder', value: 'folder' },
            { label: 'Domain', value: 'domain' }
          ]}
        />
      </Group>
      {evidence.filesPending && <Text component="div">Loading…</Text>}
      {evidence.filesError && <Text component="div">The file list could not be loaded.</Text>}
      {!evidence.filesPending && !evidence.filesError && visible.length === 0 && (
        <Text component="div">
          {rows.length === 0
            ? `No ${kind.many} in this spec set.`
            : needle
              ? `No ${kind.many} match "${query.trim()}".`
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
