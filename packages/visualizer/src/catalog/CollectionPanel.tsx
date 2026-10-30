/**
 * @module UI catalog collection panel
 *
 * What the server's collection queue says while shards collect the catalog (`GET /api/ui-catalog/queue`): what is left by
 * tier, who holds which claim and for how long, which shards are active, idle or lost, failures re-queued and units that hit
 * the retry limit, unknown units and why, and throughput. It is shown only when the viewer is served by an Atlas server and a
 * catalog definition has been published there; a static site or a project that does not use the queue shows nothing. It is
 * read again when the report changes, because results are what move the queue.
 */
import type { UiQueueSummary } from '@crvouga/atlas/schema';
import { Accordion, Alert, Badge, Button, Group, Stack, Table, Text } from '@mantine/core';
import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { useEvidence } from '../evidence/evidence-context';
import { ago, duration, exactTime, plural, useNow } from '../evidence/format';
import { runtimeConfig, runtimeUrl } from '../runtime';

const TIERS = [
  { tier: 'failed', label: 'failed', color: 'red' },
  { tier: 'empty', label: 'not collected yet', color: 'gray' },
  { tier: 'unknown', label: 'unknown', color: 'orange' },
  { tier: 'stale', label: 'stale', color: 'yellow' },
  { tier: 'fresh', label: 'up to date', color: 'green' }
] as const;

const SHARD_COLOR = { active: 'blue', idle: 'gray', lost: 'red' } as const;

/** The queue for the latest published definition, or null when there is no server or no definition. */
function useQueue() {
  const api = runtimeUrl(runtimeConfig()?.api);
  const { version } = useEvidence();
  const url = api ? `${api.replace(/\/$/, '')}/ui-catalog/queue` : undefined;
  return useQuery({
    queryKey: ['ui-catalog-queue', url, version],
    enabled: !!url,
    retry: false,
    placeholderData: keepPreviousData,
    refetchInterval: 5000,
    queryFn: async ({ signal }): Promise<UiQueueSummary | null> => {
      const response = await fetch(url!, { signal, cache: 'no-store' });
      // A server from before the queue answers 404 or 405: there is nothing to show.
      if (response.status === 404 || response.status === 405) return null;
      if (!response.ok) throw new Error(`The collection queue could not be read (${response.status}).`);
      return (await response.json()) as UiQueueSummary;
    }
  });
}

/** The Collection panel of `/catalog`: nothing at all unless a queue is in use. */
export function CollectionPanel() {
  const queue = useQueue();
  const now = useNow(5000);
  if (queue.isError && !queue.data) {
    return (
      <Alert role="status" color="orange" title="The collection queue could not be read">
        <Group gap="sm">
          <Text span inherit>{queue.error.message}</Text>
          <Button type="button" variant="subtle" onClick={() => void queue.refetch()}>Try again</Button>
        </Group>
      </Alert>
    );
  }
  const summary = queue.data;
  if (!summary?.definition) return null;
  const due = summary.tiers.failed + summary.tiers.empty + summary.tiers.unknown + summary.tiers.stale;
  const active = summary.shards.filter(shard => shard.status === 'active').length;
  return (
    <Accordion variant="contained" defaultValue="collection">
      <Accordion.Item value="collection">
        <Accordion.Control>
          Collection of {summary.definition.name}: {due === 0 && summary.held === 0 ? 'nothing left to collect' : `${plural(due, 'unit', 'units')} to collect, ${summary.held} being collected`}, {plural(active, 'active shard', 'active shards')}
        </Accordion.Control>
        <Accordion.Panel>
          <Stack gap="md" aria-label="Collection">
            <Group gap="xs" role="status" aria-label="Queue by tier">
              {TIERS.map(({ tier, label, color }) => (
                <Badge key={tier} variant="light" color={color}>{summary.tiers[tier]} {label}</Badge>
              ))}
              <Badge variant="light" color="blue">{summary.held} being collected</Badge>
            </Group>
            <Text fz="sm">
              {summary.definition.states} states in {plural(summary.definition.profiles, 'profile', 'profiles')}: {plural(summary.definition.items, 'item', 'items')} in {plural(summary.definition.units, 'work unit', 'work units')}.{' '}
              {summary.throughput.unitsPerMinute > 0
                ? `${summary.throughput.unitsPerMinute.toFixed(1)} units a minute over the last ten minutes${summary.throughput.etaMs !== null ? `; about ${duration(summary.throughput.etaMs)} to empty the queue` : ''}.`
                : 'Nothing finished in the last ten minutes.'}
              {summary.requeued > 0 ? ` ${plural(summary.requeued, 'failed unit is', 'failed units are')} back in the queue.` : ''}
            </Text>
            {summary.unknown.count > 0 && (
              <Alert role="status" color="orange" title={`${plural(summary.unknown.count, 'unit is', 'units are')} unknown, not empty`}>
                Something could not be read, so these may already hold a result: {summary.unknown.units.slice(0, 10).join(', ')}{summary.unknown.count > 10 ? ` and ${summary.unknown.count - 10} more` : ''}.
                {summary.unknown.notices.length > 0 ? ` ${summary.unknown.notices.join(' ')}` : ''}
              </Alert>
            )}
            {summary.claims.length > 0 && (
              <Table.ScrollContainer minWidth={420}>
                <Table aria-label="Being collected now">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th scope="col">Shard</Table.Th>
                      <Table.Th scope="col">Units done</Table.Th>
                      <Table.Th scope="col">Claimed</Table.Th>
                      <Table.Th scope="col">Lease ends</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {summary.claims.map(claim => (
                      <Table.Tr key={claim.claimId} data-claim={claim.claimId}>
                        <Table.Td>{claim.shard}</Table.Td>
                        <Table.Td>{claim.done} of {claim.units}</Table.Td>
                        <Table.Td><time dateTime={new Date(claim.createdAtMs).toISOString()} title={exactTime(claim.createdAtMs)}>{ago(claim.createdAtMs, now)}</time></Table.Td>
                        <Table.Td><time dateTime={new Date(claim.expiresAtMs).toISOString()} title={exactTime(claim.expiresAtMs)}>{claim.expiresAtMs > now ? `in ${duration(claim.expiresAtMs - now)}` : 'now'}</time></Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            )}
            {summary.shards.length > 0 && (
              <Table.ScrollContainer minWidth={420}>
                <Table aria-label="Shards">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th scope="col">Shard</Table.Th>
                      <Table.Th scope="col">Status</Table.Th>
                      <Table.Th scope="col">Units collected</Table.Th>
                      <Table.Th scope="col">Failed</Table.Th>
                      <Table.Th scope="col">Last seen</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {summary.shards.map(shard => (
                      <Table.Tr key={shard.shard} data-shard={shard.shard}>
                        <Table.Td>{shard.shard}</Table.Td>
                        <Table.Td><Badge variant="light" color={SHARD_COLOR[shard.status]}>{shard.status === 'active' ? 'Active' : shard.status === 'idle' ? 'Idle' : 'Lost: its claim expired'}</Badge></Table.Td>
                        <Table.Td>{shard.done}</Table.Td>
                        <Table.Td>{shard.failed}</Table.Td>
                        <Table.Td><time dateTime={new Date(shard.lastSeenAtMs).toISOString()} title={exactTime(shard.lastSeenAtMs)}>{ago(shard.lastSeenAtMs, now)}</time></Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            )}
            {summary.exhausted.length > 0 && (
              <Stack gap="xs">
                <Text fw={600}>Stopped after repeated failures</Text>
                <Text c="dimmed" fz="sm">These units failed too many times in a row and are no longer handed out in that collection. Their failures are in the catalog.</Text>
                <Table aria-label="Units that hit the retry limit">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th scope="col">Unit</Table.Th>
                      <Table.Th scope="col">Attempts</Table.Th>
                      <Table.Th scope="col">Collection</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {summary.exhausted.map(entry => (
                      <Table.Tr key={`${entry.collection}|${entry.unit}`}>
                        <Table.Td>{entry.unit}</Table.Td>
                        <Table.Td>{entry.attempts}</Table.Td>
                        <Table.Td>{entry.collection.slice(0, 16)}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Stack>
            )}
          </Stack>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  );
}
