/**
 * @module Needs-polish page
 *
 * The opinions of automated reviewers (critics) about the product's captured UI states, ranked so people review the likeliest
 * problems first. It reads the report the viewer already holds, so a critique appears the moment its layer arrives. A critique is
 * an opinion and is shown as one: never with a passed or failed mark, never in a test count, and never changing whether anything
 * passes. A critique that judged an earlier picture is shown as that and is not ranked; a critic that could not judge says why.
 */
import type { EntryCritique } from '@crvouga/atlas/reports/ui-catalog-entries';
import { Accordion, Alert, Anchor, Badge, Code, Container, Drawer, Group, Image, NativeSelect, Stack, Table, Text, Title } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import { useMemo } from 'react';

import { reportAssetUrl } from '../evidence/api';
import { useEvidence } from '../evidence/evidence-context';
import { ago, exactTime, plural, useNow } from '../evidence/format';
import { EvidenceIncomplete, EvidenceWaiting } from '../evidence/load-state';
import { polishList, type RankedEntry } from './ranking';
import { useCritiqueNavigate, useCritiqueSearch } from './search';

type Critique = EntryCritique['critique'];

const SEVERITY_COLOR: Readonly<Record<string, string>> = { major: 'red', minor: 'yellow', info: 'blue' };
const severityRank = (severity: string | undefined) => (severity === 'major' ? 3 : severity === 'minor' ? 2 : severity === 'info' ? 1 : 0);

function worst(critique: Critique): string | undefined {
  return [...(critique.findings ?? [])].sort((a, b) => severityRank(b.severity) - severityRank(a.severity))[0]?.severity;
}

function score(critique: Critique): string {
  const value = critique.verdict?.score;
  return value === undefined ? 'No score' : String(Math.round(value * 1000) / 1000);
}

function standing(critique: Critique): string {
  const relative = critique.verdict?.relative;
  if (!relative || relative.percentile === undefined) return 'Not compared';
  return `${Math.round(relative.percentile)}th percentile among ${plural(relative.sampleSize ?? 0, 'score', 'scores')} of ${relative.stateKind}`;
}

function Label({ critique }: { critique: Critique }) {
  const label = critique.verdict?.label;
  return label ? <Badge variant="light" color={label === 'needs-polish' ? 'orange' : 'gray'}>{label}</Badge> : <Text span c="dimmed" fz="sm">No label</Text>;
}

function Thumb({ item }: { item: RankedEntry }) {
  return <Image src={reportAssetUrl(item.entry.image.path)} alt={`${item.entry.title}, ${item.entry.profile.label}`} loading="lazy" fit="contain" h={56} w={56} />;
}

function EntryLink({ item }: { item: RankedEntry }) {
  return (
    <Anchor fw={700} aria-label={`Open ${item.entry.title}, ${item.entry.profile.label}`} renderRoot={(props) => <Link {...props} to="/critiques" search={((prev: Record<string, unknown>) => ({ ...prev, entry: item.entry.key })) as never} resetScroll={false} />}>
      {item.entry.title}
    </Anchor>
  );
}

function regionText(region: NonNullable<Critique['findings']>[number]['region']): string {
  return region ? `${region.x}, ${region.y} · ${region.w}×${region.h} ${region.unit}` : '';
}

function Detail({ item, onClose }: { item: RankedEntry; onClose: () => void }) {
  const now = useNow();
  const { critique } = item.found;
  const findings = critique.findings ?? [];
  return (
    <Drawer opened onClose={onClose} position="right" size="xl" title={item.entry.title} closeButtonProps={{ 'aria-label': 'Close the critique' }}>
      <Stack gap="md">
        <Text c="dimmed" fz="sm">{item.entry.key} · {item.entry.state}</Text>
        <Image src={reportAssetUrl(item.entry.image.path)} alt={`${item.entry.title}, ${item.entry.profile.label}`} loading="lazy" fit="contain" />
        {item.found.currency === 'earlier-image' && (
          <Alert role="status" color="orange" title="This critique judged an earlier picture">
            The picture of this state has changed since {critique.critic.name} looked at it. Its opinion is shown for reference and does not count as a judgement of what is shown now.
          </Alert>
        )}
        {critique.failure ? (
          <Alert role="status" color="gray" title="The critic could not judge this picture">
            Reason: <Code>{critique.failure.reason}</Code>{critique.failure.message ? ` — ${critique.failure.message}` : ''}. The next run tries again. This says nothing about the picture.
          </Alert>
        ) : (
          <Group gap="sm" aria-label="Verdict">
            <Title order={3}>Opinion</Title>
            <Badge variant="outline">Score {score(critique)}</Badge>
            <Label critique={critique} />
            {critique.verdict?.confidence !== undefined && <Badge variant="outline">Confidence {Math.round(critique.verdict.confidence * 100)}%</Badge>}
            <Text fz="sm">{standing(critique)}</Text>
            {critique.verdict?.relative?.delta !== undefined && <Text fz="sm">Change against the previous picture: {critique.verdict.relative.delta > 0 ? '+' : ''}{critique.verdict.relative.delta}</Text>}
          </Group>
        )}
        {findings.length > 0 ? (
          <Table.ScrollContainer minWidth={420}>
            <Table aria-label="Findings">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th scope="col">Category</Table.Th>
                  <Table.Th scope="col">Severity</Table.Th>
                  <Table.Th scope="col">Where</Table.Th>
                  <Table.Th scope="col">Why</Table.Th>
                  <Table.Th scope="col">Suggestion</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {findings.map((finding, index) => (
                  <Table.Tr key={finding.id ?? index}>
                    <Table.Td>{finding.category ?? 'Uncategorized'}</Table.Td>
                    <Table.Td><Badge variant="light" color={SEVERITY_COLOR[finding.severity ?? ''] ?? 'gray'}>{finding.severity ?? 'No severity'}</Badge></Table.Td>
                    <Table.Td>{regionText(finding.region) || <Text span c="dimmed">Whole picture</Text>}</Table.Td>
                    <Table.Td>{finding.rationale ?? ''}</Table.Td>
                    <Table.Td>{finding.suggestion ?? ''}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        ) : (
          !critique.failure && <Text c="dimmed">This critic gives a score and no findings, so it cannot say what to fix.</Text>
        )}
        <Accordion variant="contained">
          <Accordion.Item value="provenance">
            <Accordion.Control>Where this opinion came from</Accordion.Control>
            <Accordion.Panel>
              <Table aria-label="Provenance" withRowBorders>
                <Table.Tbody>
                  {([
                    ['Critic', `${critique.critic.name} ${critique.critic.version}${critique.critic.kind ? ` (${critique.critic.kind})` : ''}`],
                    ['Model', critique.model ? `${critique.model.id}${critique.model.provider ? `, ${critique.model.provider}` : ''}` : 'None declared'],
                    ['Parameters', critique.parameters ? JSON.stringify(critique.parameters) : 'None declared'],
                    ['Picture judged', critique.subject.imageSha256],
                    ['Layer', `${item.found.layer.slice(0, 12)} (${item.found.producer})`],
                    ['Recorded', `${ago(item.found.recordedAtMs, now)} (${exactTime(item.found.recordedAtMs)})`],
                    ['Cost', critique.usage ? [critique.usage.inputTokens === undefined ? '' : `${critique.usage.inputTokens} tokens in`, critique.usage.outputTokens === undefined ? '' : `${critique.usage.outputTokens} out`, critique.usage.latencyMs === undefined ? '' : `${critique.usage.latencyMs} ms`].filter(Boolean).join(', ') || 'Not reported' : 'Not reported']
                  ] as const).map(([name, value]) => (
                    <Table.Tr key={name}>
                      <Table.Th scope="row" w="30%">{name}</Table.Th>
                      <Table.Td>{value}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      </Stack>
    </Drawer>
  );
}

/** The `/critiques` route. */
export function CritiquesPage() {
  const evidence = useEvidence();
  const search = useCritiqueSearch();
  const go = useCritiqueNavigate();
  const list = useMemo(() => polishList(evidence.evidence, search), [evidence.evidence, search]);
  const unavailable = evidence.backends.filter((backend) => !backend.available);
  const all = [...list.ranked, ...list.unranked];
  const open = search.entry ? all.find((item) => item.entry.key === search.entry) ?? null : null;
  return (
    <Container size="xl" w="100%" py="xl" component="article" aria-label="Needs polish">
      <Stack gap="md">
        <Stack gap={4}>
          <Title order={1}>Needs polish</Title>
          <Text c="dimmed">
            What automated reviewers think of the captured UI states, lowest first, so the likeliest problems are reviewed first. These are opinions: they are not test results, are never counted with them, and never change whether a report passes.
          </Text>
        </Stack>
        {evidence.unavailable && <Alert role="alert" color="red" title="Recorded results cannot be read">{evidence.unavailable}</Alert>}
        {unavailable.length > 0 && (
          <Alert role="status" color="orange" title={`${plural(unavailable.length, 'backend is', 'backends are')} not available`}>
            {unavailable.map((backend) => backend.label).join(', ')}: critiques held there are not shown. This list may be incomplete.
          </Alert>
        )}
        <EvidenceIncomplete />
        {!evidence.ready && !evidence.unavailable && <EvidenceWaiting label="Reading the recorded critiques…" />}
        {evidence.ready && list.critics.length === 0 && (
          <Text c="dimmed" role="status" component="div" data-empty>
            No critic has judged a captured UI state yet. Run <Code>atlas critic run --critic &lt;name&gt; --all</Code> against this server; critiques appear here the moment they arrive.
            {list.unjudgeable > 0 ? ` ${plural(list.unjudgeable, 'captured state has', 'captured states have')} no stored picture, so a critic cannot see ${list.unjudgeable === 1 ? 'it' : 'them'}.` : ''}
          </Text>
        )}
        {list.critic && (
          <>
            <Group align="flex-end" gap="md">
              <NativeSelect label="Critic" description="Scores are ranked within one critic" value={list.critic} data={list.critics.map((critic) => ({ value: critic.name, label: `${critic.name} (${critic.critiques})` }))} onChange={(event) => go({ critic: event.currentTarget.value })} />
              <NativeSelect label="State kind" value={search.kind ?? ''} data={[{ value: '', label: 'All kinds' }, ...list.kinds.map((kind) => ({ value: kind, label: kind }))]} onChange={(event) => go({ kind: event.currentTarget.value || undefined })} />
            </Group>
            <Group gap="xs" role="status" aria-label="Critique summary">
              <Badge variant="light">{plural(list.ranked.length, 'state judged', 'states judged')}</Badge>
              {list.unranked.length > 0 && <Badge variant="outline">{list.unranked.length} not judged at the current picture</Badge>}
              {list.unjudged > 0 && <Badge variant="outline">{list.unjudged} not judged yet</Badge>}
            </Group>
            {list.ranked.length > 0 ? (
              <Table.ScrollContainer minWidth={640}>
                <Table aria-label="States ranked by score, lowest first" striped>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th scope="col">Rank</Table.Th>
                      <Table.Th scope="col">Picture</Table.Th>
                      <Table.Th scope="col">State</Table.Th>
                      <Table.Th scope="col">Kind</Table.Th>
                      <Table.Th scope="col">Score</Table.Th>
                      <Table.Th scope="col">Within its kind</Table.Th>
                      <Table.Th scope="col">Findings</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {list.ranked.map((item, index) => {
                      const severity = worst(item.found.critique);
                      return (
                        <Table.Tr key={item.entry.key} data-entry={item.entry.key}>
                          <Table.Td>{index + 1}</Table.Td>
                          <Table.Td><Thumb item={item} /></Table.Td>
                          <Table.Td><Stack gap={2}><EntryLink item={item} /><Text c="dimmed" fz="xs">{item.entry.profile.label}</Text></Stack></Table.Td>
                          <Table.Td>{item.entry.state}</Table.Td>
                          <Table.Td><Group gap="xs" wrap="nowrap"><Text span>{score(item.found.critique)}</Text><Label critique={item.found.critique} /></Group></Table.Td>
                          <Table.Td>{standing(item.found.critique)}</Table.Td>
                          <Table.Td>
                            {(item.found.critique.findings ?? []).length > 0 ? (
                              <Group gap="xs" wrap="nowrap">
                                <Text span>{plural((item.found.critique.findings ?? []).length, 'finding', 'findings')}</Text>
                                {severity && <Badge variant="light" color={SEVERITY_COLOR[severity] ?? 'gray'}>{severity}</Badge>}
                              </Group>
                            ) : <Text span c="dimmed">None given</Text>}
                          </Table.Td>
                        </Table.Tr>
                      );
                    })}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            ) : (
              <Text c="dimmed" role="status" component="div">{list.critic} has not produced a score for any state in view.</Text>
            )}
            {list.unranked.length > 0 && (
              <Stack gap="xs">
                <Title order={2}>Not judged at the current picture</Title>
                <Table.ScrollContainer minWidth={420}>
                  <Table aria-label="States not judged at the current picture">
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th scope="col">State</Table.Th>
                        <Table.Th scope="col">Why</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {list.unranked.map((item) => (
                        <Table.Tr key={item.entry.key} data-entry={item.entry.key}>
                          <Table.Td><Stack gap={2}><EntryLink item={item} /><Text c="dimmed" fz="xs">{item.entry.profile.label}</Text></Stack></Table.Td>
                          <Table.Td>
                            {item.found.critique.failure
                              ? `The critic could not judge it (${item.found.critique.failure.reason}); the next run tries again`
                              : 'The picture changed since it was judged; the older opinion is kept for reference'}
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
              </Stack>
            )}
          </>
        )}
        {search.entry && !open && evidence.ready && evidence.pending === 0 && (
          <Alert role="status" color="gray" title="That entry has no critique in this view">
            <Text span inherit>{search.entry}</Text> is not among the states this critic has judged or tried to judge.{' '}
            <Anchor renderRoot={(props) => <Link {...props} to="/critiques" search={((prev: Record<string, unknown>) => ({ ...prev, entry: undefined })) as never} />}>Back to the list</Anchor>
          </Alert>
        )}
      </Stack>
      {open && <Detail item={open} onClose={() => go({ entry: undefined })} />}
    </Container>
  );
}
