/**
 * @module UI catalog failure groups
 *
 * The failed cells of the catalog as the person sees it (its definition scope and filters), grouped by the fingerprint the
 * producer supplied, else by exact normalized message (`uiCatalogFailureGroups`): count, phase and attempts when known, first
 * and last occurrence, one redacted sample and a link to every affected state in its profile. A message group says it is
 * inferred from text and does not show a shared cause. When something could not be read, or results are still arriving, the
 * totals say they are incomplete, so the visible groups are never taken for every failure.
 */
import type { UiCatalog } from '@crvouga/atlas/reports/ui-catalog';
import { uiCatalogFailureGroups } from '@crvouga/atlas/reports/ui-catalog-failures';
import { Accordion, Alert, Anchor, Badge, Button, Group, List, Stack, Text } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import { useMemo, useState } from 'react';

import { useEvidence } from '../evidence/evidence-context';
import { exactTime, plural } from '../evidence/format';

/** How many affected cells a group lists before "Show more". */
const CELLS = 20;

/** The failure groups of `catalog`; `onSelect` is called when a drilldown link is followed. */
export function FailureGroups({ catalog, onSelect }: { catalog: UiCatalog; onSelect: () => void }) {
  const evidence = useEvidence();
  const failures = useMemo(() => uiCatalogFailureGroups(catalog), [catalog]);
  const [shown, setShown] = useState<Record<string, number>>({});
  const incomplete = [...failures.incomplete, ...(!evidence.ready || evidence.pending > 0 ? ['Results are still arriving, so more failures may appear.'] : [])];
  const { total } = failures;
  return (
    <Stack gap="md" aria-label="Failure groups">
      <Text role="status" fz="sm">
        {plural(total.failed, 'failed cell', 'failed cells')} in {plural(total.groups, 'group', 'groups')}: {total.fingerprinted} grouped by the producer&rsquo;s fingerprint, {total.inferred} by message only.
      </Text>
      {incomplete.length > 0 && (
        <Alert role="status" color="orange" title="These totals may be incomplete">
          <List size="sm">{incomplete.map(reason => <List.Item key={reason}>{reason}</List.Item>)}</List>
        </Alert>
      )}
      {total.failed === 0 && <Text c="dimmed">No failed captures in this scope{incomplete.length ? ' among the results read so far' : ''}.</Text>}
      {failures.groups.length > 0 && (
        <Accordion multiple>
          {failures.groups.map(group => {
            const limit = shown[group.key] ?? CELLS;
            return (
              <Accordion.Item key={group.key} value={group.key} data-failure-group={group.key}>
                <Accordion.Control>
                  <Group gap="xs" wrap="wrap">
                    <Badge color="red" variant="light">{group.count}</Badge>
                    {group.basis === 'fingerprint'
                      ? <Text span fw={600}>Fingerprint {group.fingerprint}</Text>
                      : <Text span fw={600}>Same message <Text span c="dimmed" inherit>(inferred grouping, not a shared cause)</Text></Text>}
                    <Text span c="dimmed" fz="sm" lineClamp={1}>{group.sample || 'No message'}</Text>
                  </Group>
                </Accordion.Control>
                <Accordion.Panel>
                  <Stack gap="xs">
                    <Text fz="sm" c="dimmed">
                      {plural(group.states, 'state', 'states')} in {plural(group.profiles, 'profile', 'profiles')}, from {group.producers.join(', ')}.
                      {' '}Phase: {group.phases.length ? group.phases.join(', ') : 'not reported'}.
                      {' '}Attempts: {group.attempts ? (group.attempts.min === group.attempts.max ? group.attempts.min : `${group.attempts.min}–${group.attempts.max}`) : 'not reported'}.
                      {' '}First <time dateTime={new Date(group.firstRecordedAtMs).toISOString()}>{exactTime(group.firstRecordedAtMs)}</time>, last <time dateTime={new Date(group.lastRecordedAtMs).toISOString()}>{exactTime(group.lastRecordedAtMs)}</time>.
                    </Text>
                    {group.inferred && <Text fz="sm" c="dimmed">These failures only read the same after redaction; the producer gave no fingerprint, so they may have different causes.</Text>}
                    <Text fz="sm">Sample (redacted): <Text span ff="monospace" inherit>{group.sample || 'No message'}</Text></Text>
                    <List size="sm" aria-label={`Affected states of ${group.basis === 'fingerprint' ? `fingerprint ${group.fingerprint}` : 'this message'}`}>
                      {group.cells.slice(0, limit).map(cell => (
                        <List.Item key={`${cell.state}|${cell.profile}`}>
                          <Anchor onClick={onSelect} renderRoot={props => <Link {...props} to="/catalog" search={((prev: Record<string, unknown>) => ({ ...prev, state: cell.state, image: cell.profile })) as never} resetScroll={false} />}>
                            {cell.title}
                          </Anchor>
                          {' '}<Text span c="dimmed" fz="xs">{cell.state} · {cell.profileLabel}</Text>
                        </List.Item>
                      ))}
                    </List>
                    {group.cells.length > limit && <Button type="button" variant="subtle" onClick={() => setShown({ ...shown, [group.key]: limit + CELLS })}>Show more ({group.cells.length - limit} more)</Button>}
                    {group.count > group.cells.length && <Text fz="xs" c="dimmed">{group.count - group.cells.length} more affected cells are not listed; filter the catalog to see them.</Text>}
                  </Stack>
                </Accordion.Panel>
              </Accordion.Item>
            );
          })}
        </Accordion>
      )}
    </Stack>
  );
}
