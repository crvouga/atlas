/**
 * @module UI catalog comparison
 *
 * The catalog set against itself: two commits (what the same states looked like when each commit was recorded) or two profiles
 * (desktop against mobile, light against dark). Both sides are in the address (`compare`, `from`, `to`), so a link reproduces the
 * comparison. Pictures are compared by their stored bytes, and the page says so: "changed" is not a measure of pixels. A state only
 * one side has is not called a regression (the other side may not have captured it), a capture that did not pass is a change of
 * coverage and never compared by picture, a layer that could not be read is named and never taken to be unchanged, and a picture
 * with no content hash is "cannot tell".
 */
import { filterUiCatalog, type UiCatalog, type UiCatalogQuery } from '@crvouga/atlas/reports/ui-catalog';
import { UI_CELL_CHANGES, changedUiEntries, diffUiCatalogs, diffUiProfiles, uiCatalogCommits, type UiCatalogDiff, type UiCellChange, type UiDiffEntry } from '@crvouga/atlas/reports/ui-catalog-diff';
import { Alert, Anchor, Badge, Button, Card, Code, Group, NativeSelect, SegmentedControl, SimpleGrid, Stack, Switch, Text, Title } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import { useMemo, useState } from 'react';

import { useEvidence } from '../evidence/evidence-context';
import { ago, plural, shortSha, useNow } from '../evidence/format';
import { Picture } from './Picture';
import { useCommitCatalog, useLayerHeaders } from './history';
import { useCatalogNavigate, useCatalogSearch } from './search';
import { coverageWord } from './words';

const ENTRIES = 24;

const CHANGE: Readonly<Record<UiCellChange, { label: string; color: string; meaning: string }>> = {
  coverage: { label: 'Coverage changed', color: 'orange', meaning: 'It stands differently on the two sides, such as captured on one and failed on the other.' },
  picture: { label: 'Picture changed', color: 'blue', meaning: 'Captured on both sides, and the stored picture is not the same file. This says the bytes differ, not how many pixels.' },
  unverified: { label: 'Cannot tell', color: 'gray', meaning: 'Captured on both sides, but a picture has no content hash (it is given only by address), so whether it changed is unknown.' },
  added: { label: 'Only after', color: 'green', meaning: 'Only the after side has it. It may be new, or the before side may not have captured it.' },
  removed: { label: 'Only before', color: 'gray', meaning: 'Only the before side has it. It is not a regression: the after side may not have captured it, or it may have been renamed.' },
  unchanged: { label: 'Unchanged', color: 'gray', meaning: 'The same coverage and, when captured, the same stored picture.' }
};

/**
 * The query a comparison narrows by: the catalog's filters except coverage, because the comparison is about coverage changing, and
 * (when profiles are what is compared) except the profile, because the two sides are the profiles.
 */
function narrowedBy(query: UiCatalogQuery, mode: 'commit' | 'profile'): UiCatalogQuery {
  const { coverage: _coverage, profile: _profile, ...rest } = query;
  return mode === 'profile' ? rest : { ...rest, ...(query.profile ? { profile: query.profile } : {}) };
}

function Entry({ entry, before, after }: { entry: UiDiffEntry; before: string; after: string }) {
  const change = CHANGE[entry.change];
  return (
    <Card withBorder role="listitem" data-state={entry.id} data-change={entry.change}>
      <Stack gap="sm">
        <Group justify="space-between" align="flex-start" wrap="nowrap">
          <Stack gap={2}>
            <Anchor fw={700} aria-label={`Open ${entry.title}`} renderRoot={(props) => <Link {...props} to="/catalog" search={((prev: Record<string, unknown>) => ({ ...prev, state: entry.id })) as never} resetScroll={false} />}>
              {entry.title}
            </Anchor>
            <Text c="dimmed" fz="xs">
              {entry.id}
              {entry.profile ? ` · ${entry.profile.label}` : ''}
            </Text>
          </Stack>
          <Badge variant="light" color={change.color} title={change.meaning}>
            {entry.change === 'coverage' && entry.before && entry.after ? `${coverageWord(entry.before.coverage)} → ${coverageWord(entry.after.coverage)}` : change.label}
          </Badge>
        </Group>
        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
          {([['Before', before, entry.before], ['After', after, entry.after]] as const).map(([side, name, cell]) => (
            <Stack key={side} gap="xs" component="section" aria-label={`${side}: ${name}`}>
              <Text fw={600} fz="sm">
                {side}: {name}
              </Text>
              {cell ? (
                <>
                  <Picture cell={cell} title={entry.title} label={`${side.toLowerCase()}, ${name}`} height={180} />
                  <Text c="dimmed" fz="xs">
                    {coverageWord(cell.coverage)}
                    {cell.capture ? ` · layer ${cell.capture.origin.layer.slice(0, 12)} in ${cell.capture.origin.backend}` : ''}
                  </Text>
                </>
              ) : (
                <Text c="dimmed" fz="sm">
                  Not on this side
                </Text>
              )}
            </Stack>
          ))}
        </SimpleGrid>
      </Stack>
    </Card>
  );
}

function Results({ diff, before, after }: { diff: UiCatalogDiff; before: string; after: string }) {
  const { search } = useCatalogSearch();
  const go = useCatalogNavigate();
  const [shown, setShown] = useState(ENTRIES);
  const all = search.all === '1';
  const entries = all ? diff.entries : changedUiEntries(diff);
  return (
    <Stack gap="md">
      <Group gap="xs" role="status" aria-label="Comparison summary">
        {UI_CELL_CHANGES.map((name) =>
          diff.summary[name] > 0 ? (
            <Badge key={name} variant="light" color={CHANGE[name].color} title={CHANGE[name].meaning}>
              {diff.summary[name]} {CHANGE[name].label.toLowerCase()}
            </Badge>
          ) : null
        )}
        {diff.summary.total === 0 && <Text c="dimmed">There is nothing to compare.</Text>}
      </Group>
      <Switch label="Show unchanged" checked={all} onChange={(event) => go({ all: event.currentTarget.checked ? '1' : undefined })} />
      {diff.summary.total > 0 && entries.length === 0 && (
        <Text role="status" data-no-change>
          Nothing differs between the two sides.
        </Text>
      )}
      {entries.length > 0 && (
        <SimpleGrid role="list" aria-label="Differences" cols={1} spacing="md">
          {entries.slice(0, shown).map((entry) => (
            <Entry key={`${entry.id}|${entry.profile?.key ?? ''}|${entry.before?.profile.key ?? ''}`} entry={entry} before={before} after={after} />
          ))}
        </SimpleGrid>
      )}
      {entries.length > shown && (
        <Button type="button" variant="subtle" onClick={() => setShown(shown + ENTRIES)}>
          Show more ({entries.length - shown} more)
        </Button>
      )}
    </Stack>
  );
}

function CommitComparison({ whole, query }: { whole: UiCatalog; query: UiCatalogQuery }) {
  const { search } = useCatalogSearch();
  const go = useCatalogNavigate();
  const now = useNow();
  const evidence = useEvidence();
  const history = useLayerHeaders(true);
  const incomplete = evidence.notices.length > 0 || evidence.backends.some((backend) => !backend.available);
  const producers = useMemo(() => new Set(whole.states.flatMap((state) => state.producers)), [whole]);
  const headers = useMemo(() => history.headers.filter((layer) => producers.has(layer.producer)), [history.headers, producers]);
  const commits = useMemo(() => uiCatalogCommits(headers), [headers]);
  const from = useCommitCatalog(headers, search.from);
  const to = useCommitCatalog(headers, search.to);
  const diff = useMemo(() => (from.catalog && to.catalog ? diffUiCatalogs(filterUiCatalog(from.catalog, query), filterUiCatalog(to.catalog, query)) : null), [from.catalog, to.catalog, query]);
  const unreadable = [...from.failed, ...to.failed];
  const pending = from.pending + to.pending;
  const options = (value: string | undefined) => (
    <>
      <option value="">Choose a commit</option>
      {value && !commits.some((commit) => commit.sha === value) && <option value={value}>{shortSha(value)} (no layers of this catalog&rsquo;s producers)</option>}
      {commits.map((commit) => (
        <option key={commit.sha} value={commit.sha}>
          {[shortSha(commit.sha), commit.branch, plural(commit.layers, 'layer', 'layers'), ago(commit.recordedAtMs, now)].filter(Boolean).join(' · ')}
        </option>
      ))}
    </>
  );
  return (
    <Stack gap="md">
      <Text c="dimmed">
        The states each commit recorded, set side by side. A layer recorded from a checkout with uncommitted changes is not a commit&rsquo;s own result and is left out.
      </Text>
      {history.error && (
        <Alert role="alert" color="red" title="The recorded layers cannot be read">
          <Group gap="sm">
            <Text span inherit>{history.error}</Text>
            <Button type="button" variant="subtle" onClick={history.retry}>Try again</Button>
          </Group>
        </Alert>
      )}
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
        <NativeSelect label="Before" value={search.from ?? ''} onChange={(event) => go({ from: event.currentTarget.value || undefined })} data-compare-picker="before">
          {options(search.from)}
        </NativeSelect>
        <NativeSelect label="After" value={search.to ?? ''} onChange={(event) => go({ to: event.currentTarget.value || undefined })} data-compare-picker="after">
          {options(search.to)}
        </NativeSelect>
      </SimpleGrid>
      {!search.from && !search.to && commits.length >= 2 && (
        <Group>
          <Button type="button" variant="light" onClick={() => go({ from: commits[1]!.sha, to: commits[0]!.sha })}>
            Compare the two newest commits
          </Button>
        </Group>
      )}
      {!history.loading && commits.length < 2 && (
        <Text c="dimmed" role="status" data-no-commits>
          {commits.length === 0 ? 'No layer of this catalog records the commit it was captured at, so there is nothing to compare by commit.' : 'Only one commit has recorded layers, so there is nothing to compare it with.'}
        </Text>
      )}
      {search.from && search.from === search.to && <Alert color="gray" role="status">The same commit is on both sides.</Alert>}
      {unreadable.length > 0 && (
        <Alert role="status" color="orange" title="Some layers could not be read">
          {plural(unreadable.length, 'layer', 'layers')} at these commits could not be read ({unreadable.map((layer) => layer.id.slice(0, 12)).join(', ')}). What they hold is unknown here, not unchanged, so this comparison may be incomplete.
        </Alert>
      )}
      {incomplete && (
        <Alert role="status" color="orange" title="This comparison may be incomplete">
          Some results or backends could not be read (named above). A state missing from a side may be one that could not be read, so it is unknown there, not absent.
        </Alert>
      )}
      {pending > 0 && (
        <Text role="status" c="dimmed">
          Reading {plural(pending, 'more layer', 'more layers')}; the comparison fills in as they arrive.
        </Text>
      )}
      {diff && search.from !== search.to && <Results diff={diff} before={`commit ${shortSha(search.from ?? null)}`} after={`commit ${shortSha(search.to ?? null)}`} />}
      {search.from && search.to && !diff && !history.loading && pending === 0 && <Text c="dimmed">There is nothing recorded at those commits.</Text>}
    </Stack>
  );
}

function ProfileComparison({ whole, query }: { whole: UiCatalog; query: UiCatalogQuery }) {
  const { search } = useCatalogSearch();
  const go = useCatalogNavigate();
  const known = (key: string | undefined) => whole.profiles.some((profile) => profile.key === key);
  const diff = useMemo(
    () => (search.from && search.to && search.from !== search.to && whole.profiles.some((p) => p.key === search.from) && whole.profiles.some((p) => p.key === search.to) ? diffUiProfiles(filterUiCatalog(whole, query), search.from, search.to) : null),
    [whole, query, search.from, search.to]
  );
  const label = (key: string | undefined) => whole.profiles.find((profile) => profile.key === key)?.label ?? 'a profile';
  const options = (value: string | undefined) => (
    <>
      <option value="">Choose a profile</option>
      {value && !known(value) && <option value={value}>Not a profile of this catalog</option>}
      {whole.profiles.map((profile) => (
        <option key={profile.key} value={profile.key}>
          {profile.label}
        </option>
      ))}
    </>
  );
  return (
    <Stack gap="md">
      <Text c="dimmed">Each state in one profile set beside the same state in another: desktop against mobile, light against dark.</Text>
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">
        <NativeSelect label="Before" value={search.from ?? ''} onChange={(event) => go({ from: event.currentTarget.value || undefined })} data-compare-picker="before">
          {options(search.from)}
        </NativeSelect>
        <NativeSelect label="After" value={search.to ?? ''} onChange={(event) => go({ to: event.currentTarget.value || undefined })} data-compare-picker="after">
          {options(search.to)}
        </NativeSelect>
      </SimpleGrid>
      {whole.profiles.length < 2 && (
        <Text c="dimmed" role="status" data-no-profiles>
          This catalog has {whole.profiles.length === 1 ? 'one profile' : 'no profiles'}, so there is nothing to compare it with.
        </Text>
      )}
      {search.from && search.from === search.to && <Alert color="gray" role="status">The same profile is on both sides.</Alert>}
      {diff && <Results diff={diff} before={label(search.from)} after={label(search.to)} />}
    </Stack>
  );
}

/** The comparison of the catalog with itself: its mode (commits or profiles) and both sides are the address. */
export function UiCatalogCompare({ whole }: { whole: UiCatalog }) {
  const { search, query } = useCatalogSearch();
  const go = useCatalogNavigate();
  const mode = search.compare === 'profile' ? 'profile' : 'commit';
  const narrowed = useMemo(() => narrowedBy(query, mode), [query, mode]);
  return (
    <Stack gap="md" component="section" aria-label="Compare">
      <Group justify="space-between" align="flex-end">
        <Title order={2}>Compare</Title>
        <Group gap="sm">
          <SegmentedControl
            aria-label="What to compare"
            value={mode}
            onChange={(value) => go({ compare: value, from: undefined, to: undefined })}
            data={[
              { value: 'commit', label: 'Two commits' },
              { value: 'profile', label: 'Two profiles' }
            ]}
          />
          <Button type="button" variant="subtle" onClick={() => go({ compare: undefined, from: undefined, to: undefined, all: undefined })}>
            Back to the catalog
          </Button>
        </Group>
      </Group>
      {query.coverage?.length || (mode === 'profile' && query.profile?.length) ? (
        <Text c="dimmed" fz="sm">
          {mode === 'profile' ? 'The coverage and profile filters do not apply here: coverage is what is compared, and the profiles are chosen below.' : 'The coverage filter does not apply to a comparison, which is about coverage changing.'} The other filters do.
        </Text>
      ) : null}
      {mode === 'commit' ? <CommitComparison whole={whole} query={narrowed} /> : <ProfileComparison whole={whole} query={narrowed} />}
      <Text c="dimmed" fz="xs">
        Pictures are compared by their stored bytes: <Code>Picture changed</Code> means the file is not the same, not how many pixels differ.
      </Text>
    </Stack>
  );
}
