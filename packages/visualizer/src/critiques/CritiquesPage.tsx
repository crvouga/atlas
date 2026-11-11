/**
 * @module Needs-polish page
 *
 * The opinions of automated reviewers (critics) about the product's captured UI states, ranked so people review the likeliest
 * problems first. It reads the report the viewer already holds, so a critique appears the moment its layer arrives. A critique is
 * an opinion and is shown as one: never with a passed or failed mark, never in a test count, and never changing whether anything
 * passes. A critique that judged an earlier picture is shown as that and is not ranked; a critic that could not judge says why.
 *
 * Three readings sit on the same evidence: the findings drawn where they were found on the picture (`FindingOverlay`), whether the
 * critics agree about the pictures several of them judged (the Agreement view), and what reviewers decided about an opinion (marks:
 * accepted or dismissed, per finding or for the whole opinion). Marks are made with `atlas critic review`, because a browser's sign-in
 * box may only look; the viewer reads them and says how to make one.
 */
import { markStanding, type AgreementOutcome, type MarkStanding, type Stance } from '@crvouga/atlas/reports/critique-review';
import type { EntryCritique } from '@crvouga/atlas/reports/ui-catalog-entries';
import { Accordion, Alert, Anchor, Badge, Button, Card, Center, Code, Drawer, Group, Image, NativeSelect, Stack, Switch, Table, Tabs, Text, ThemeIcon, Title } from '@mantine/core';
import { IconSparkles, IconUsers } from '@tabler/icons-react';
import { Link } from '@tanstack/react-router';
import { useId, useMemo, useState } from 'react';

import { PageHeader, Panel } from '../components/Page';

import { reportAssetUrl } from '../evidence/api';
import { useEvidence } from '../evidence/evidence-context';
import { ago, exactTime, plural, useNow } from '../evidence/format';
import { EvidenceIncomplete, EvidenceWaiting } from '../evidence/load-state';
import { FindingOverlay, SEVERITY_COLOR } from './FindingOverlay';
import { polishList, type PolishList, type RankedEntry } from './ranking';
import { useCritiqueNavigate, useCritiqueSearch } from './search';

type Critique = EntryCritique['critique'];

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

/** What reviewers decided, as a short word and who. Never a pass or a failure: accepting an opinion says the UI needs polish. */
const MARK_WORD: Readonly<Record<MarkStanding['state'], string>> = { accepted: 'Accepted', dismissed: 'Dismissed', disputed: 'Reviewers disagree', unmarked: 'Not reviewed' };
const MARK_COLOR: Readonly<Record<MarkStanding['state'], string>> = { accepted: 'orange', dismissed: 'gray', disputed: 'yellow', unmarked: 'gray' };

/** Who decided what, one line each. */
function markWho(standing: MarkStanding): string[] {
  const lines = [];
  if (standing.accepted.length) lines.push(`Accepted by ${standing.accepted.join(', ')}`);
  if (standing.dismissed.length) lines.push(`Dismissed by ${standing.dismissed.join(', ')}`);
  if (standing.earlier) lines.push(`Marks at an earlier picture (${standing.earlier}) count for nothing now`);
  return lines;
}

function MarkBadge({ standing }: { standing: MarkStanding }) {
  const who = markWho(standing);
  return (
    <Stack gap={2} align="flex-start">
      <Badge size="sm" variant={standing.state === 'unmarked' ? 'default' : 'light'} color={MARK_COLOR[standing.state]}>{MARK_WORD[standing.state]}</Badge>
      {who.map((line) => <Text key={line} fz="xs" c="dimmed">{line}</Text>)}
      {standing.notes.map((note, index) => <Text key={index} fz="xs" c="dimmed">“{note}”</Text>)}
    </Stack>
  );
}

function Label({ critique }: { critique: Critique }) {
  const label = critique.verdict?.label;
  return label ? <Badge size="sm" variant={label === 'needs-polish' ? 'light' : 'default'} color={label === 'needs-polish' ? 'orange' : 'gray'}>{label}</Badge> : <Text span c="dimmed" fz="xs">No label</Text>;
}

function Thumb({ item }: { item: RankedEntry }) {
  return (
    <Center w={104} h={68} bg="var(--mantine-color-default-hover)" bdrs="md" flex="0 0 auto">
      <Image src={reportAssetUrl(item.entry.image.path)} alt={`${item.entry.title}, ${item.entry.profile.label}`} loading="lazy" fit="contain" h={60} w={96} />
    </Center>
  );
}

function EntryLink({ item }: { item: RankedEntry }) {
  return (
    <Anchor fw={600} c="inherit" aria-label={`Open ${item.entry.title}, ${item.entry.profile.label}`} renderRoot={(props) => <Link {...props} to="/critiques" search={((prev: Record<string, unknown>) => ({ ...prev, entry: item.entry.key })) as never} resetScroll={false} />}>
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
  const [showFindings, setShowFindings] = useState(true);
  const [selected, setSelected] = useState<number | null>(null);
  const placed = findings.some((finding) => finding.region);
  const whole = markStanding(item.entry.marks, { critic: critique.critic.name });
  return (
    <Drawer opened onClose={onClose} position="right" size="xl" title={item.entry.title} closeButtonProps={{ 'aria-label': 'Close the critique' }}>
      <Stack gap="md">
        <Text c="dimmed" fz="xs">{item.entry.key} · {item.entry.state}</Text>
        <Center bg="var(--mantine-color-default-hover)" bdrs="md" p="sm">
          <FindingOverlay src={reportAssetUrl(item.entry.image.path)} alt={`${item.entry.title}, ${item.entry.profile.label}`} size={item.entry.image} findings={findings} selected={selected} show={showFindings && item.found.currency === 'current'} />
        </Center>
        {placed && (
          <Switch checked={showFindings} onChange={(event) => setShowFindings(event.currentTarget.checked)} label="Show findings on the picture" description={item.found.currency === 'current' ? 'Numbered boxes match the findings below. A finding without a region is listed but not drawn.' : 'Not drawn: the picture changed since these findings were made, so their places no longer apply.'} disabled={item.found.currency !== 'current'} />
        )}
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
          <Stack gap="xs" aria-label="Verdict">
            <Title order={3}>Opinion</Title>
            <Group gap="xs">
              <Badge variant="default">Score {score(critique)}</Badge>
              <Label critique={critique} />
              {critique.verdict?.confidence !== undefined && <Badge variant="default">Confidence {Math.round(critique.verdict.confidence * 100)}%</Badge>}
              <Text fz="sm" c="dimmed">{standing(critique)}</Text>
              {critique.verdict?.relative?.delta !== undefined && <Text fz="sm" c="dimmed">Change against the previous picture: {critique.verdict.relative.delta > 0 ? '+' : ''}{critique.verdict.relative.delta}</Text>}
            </Group>
          </Stack>
        )}
        {!critique.failure && (
          <Stack gap="xs" aria-label="Review of the opinion">
            <Title order={3}>Review</Title>
            <MarkBadge standing={whole} />
            <Text c="dimmed" fz="xs">
              Accepting says the opinion is right and the UI needs polish; dismissing says it does not. Marks are made on the command line (a browser sign-in only reads):{' '}
              <Code>atlas critic review --entry {item.entry.key} --critic {critique.critic.name} --accept</Code> or <Code>--dismiss</Code>, with <Code>--finding &lt;id&gt;</Code> for one finding. A mark never changes a result or the gate.
            </Text>
          </Stack>
        )}
        {findings.length > 0 ? (
          <Stack gap="xs">
          <Title order={3}>Findings</Title>
          <Card padding={0} shadow="none">
          <Table.ScrollContainer minWidth={640}>
            <Table aria-label="Findings" verticalSpacing="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th scope="col">#</Table.Th>
                  <Table.Th scope="col">Category</Table.Th>
                  <Table.Th scope="col">Severity</Table.Th>
                  <Table.Th scope="col">Where</Table.Th>
                  <Table.Th scope="col">Why</Table.Th>
                  <Table.Th scope="col">Suggestion</Table.Th>
                  <Table.Th scope="col">Review</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {findings.map((finding, index) => (
                  <Table.Tr key={finding.id ?? index} data-finding={finding.id ?? String(index + 1)}>
                    <Table.Td>
                      {finding.region && item.found.currency === 'current' && showFindings
                        ? <Button size="compact-xs" variant={selected === index ? 'filled' : 'subtle'} aria-pressed={selected === index} aria-label={`Locate finding ${index + 1} on the picture`} onClick={() => setSelected(selected === index ? null : index)}>{index + 1}</Button>
                        : index + 1}
                    </Table.Td>
                    <Table.Td>{finding.category ?? 'Uncategorized'}</Table.Td>
                    <Table.Td><Badge size="sm" variant="light" color={SEVERITY_COLOR[finding.severity ?? ''] ?? 'gray'}>{finding.severity ?? 'No severity'}</Badge></Table.Td>
                    <Table.Td>{regionText(finding.region) || <Text span c="dimmed">Whole picture</Text>}</Table.Td>
                    <Table.Td>{finding.rationale ?? ''}</Table.Td>
                    <Table.Td>{finding.suggestion ?? ''}</Table.Td>
                    <Table.Td>{finding.id ? <MarkBadge standing={markStanding(item.entry.marks, { critic: critique.critic.name, finding: finding.id })} /> : <Text span c="dimmed" fz="sm">Cannot be marked alone: it has no id</Text>}</Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
          </Card>
          </Stack>
        ) : (
          !critique.failure && <Text c="dimmed" size="sm">This critic gives a score and no findings, so it cannot say what to fix.</Text>
        )}
        <Accordion>
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
                      <Table.Th scope="row" w="30%" fw={500} c="dimmed">{name}</Table.Th>
                      <Table.Td><Text inherit lineClamp={3}>{value}</Text></Table.Td>
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

const STANCE_WORDS: Readonly<Record<Stance, string>> = { flags: 'Flags it', clear: 'Does not flag it', 'no-view': 'No view' };
const STANCE_COLOR: Readonly<Record<Stance, string>> = { flags: 'orange', clear: 'gray', 'no-view': 'gray' };
const OUTCOME_WORDS: Readonly<Record<AgreementOutcome, string>> = { 'agree-flag': 'All flag it', 'agree-clear': 'None flag it', disagree: 'Critics disagree', unclear: 'Not enough views' };

/** Whether the critics agree about the pictures several of them judged. A reading for people: not a verdict, a status or a gate. */
function AgreementPanel({ list }: { list: PolishList }) {
  const { agreement } = list;
  if (agreement.critics.length < 2 || agreement.rows.length === 0) {
    return (
      <Card>
        <Stack align="center" gap="xs" py="xl" role="status" data-empty>
          <ThemeIcon variant="default" size={44} radius="xl" c="dimmed"><IconUsers size={22} aria-hidden="true" /></ThemeIcon>
          <Text c="dimmed" size="sm" ta="center" maw={560}>
            {agreement.critics.length < 2
              ? 'Agreement needs two critics to have judged the same picture. Run another critic against this server (atlas critic run --critic <name> --all) and compare them here.'
              : `No picture has been judged by more than one critic yet${list.kinds.length > 1 ? ' in this state kind' : ''}.`}
          </Text>
        </Stack>
      </Card>
    );
  }
  return (
    <Panel flush title="Where the critics agree" description={
      <Text c="dimmed" fz="sm" maw={960}>
        Only each critic’s opinion of the picture an entry has now is compared. A critic flags a UI when its label says needs-polish, when it has findings, or, with neither, when its score is in the lowest quarter of its state kind; a bare score with no standing, or a critic that failed, gives no view and never makes critics agree. Entries every critic flags come first, then those they disagree about.
        {agreement.single > 0 ? ` ${plural(agreement.single, 'state has', 'states have')} been judged by only one critic and ${agreement.single === 1 ? 'is' : 'are'} not shown.` : ''}
      </Text>
    }>
      <Table.ScrollContainer minWidth={560}>
        <Table aria-label="Critics compared, those that all flag a state first" horizontalSpacing="lg" verticalSpacing="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th scope="col">State</Table.Th>
              <Table.Th scope="col">Kind</Table.Th>
              {agreement.critics.map((critic) => <Table.Th key={critic} scope="col">{critic}</Table.Th>)}
              <Table.Th scope="col">Agreement</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {agreement.rows.map((row) => (
              <Table.Tr key={row.entry.key} data-entry={row.entry.key} data-outcome={row.outcome}>
                <Table.Td><Stack gap={0}><Text fw={600} fz="sm">{row.entry.title}</Text><Text c="dimmed" fz="xs">{row.entry.profile.label}</Text></Stack></Table.Td>
                <Table.Td><Text fz="sm" c="dimmed">{row.entry.state}</Text></Table.Td>
                {agreement.critics.map((critic) => {
                  const view = row.views.find((candidate) => candidate.critic === critic);
                  if (!view) return <Table.Td key={critic}><Text c="dimmed" fz="sm">Not judged at this picture</Text></Table.Td>;
                  const scoreLabel = `${view.score === undefined ? 'No score' : `Score ${Math.round(view.score * 1000) / 1000}`}${view.percentile === undefined ? '' : `, ${Math.round(view.percentile)}th percentile`}`;
                  return (
                    <Table.Td key={critic}>
                      <Stack gap={2} align="flex-start">
                        <Badge size="sm" variant={view.stance === 'flags' ? 'light' : 'default'} color={STANCE_COLOR[view.stance]}>{STANCE_WORDS[view.stance]}</Badge>
                        <Anchor fz="xs" c="dimmed" aria-label={`${scoreLabel}. Open ${critic}’s critique of ${row.entry.title}, ${row.entry.profile.label}`} renderRoot={(props) => <Link {...props} to="/critiques" search={((prev: Record<string, unknown>) => ({ ...prev, critic, entry: row.entry.key })) as never} resetScroll={false} />}>
                          {scoreLabel}
                        </Anchor>
                      </Stack>
                    </Table.Td>
                  );
                })}
                <Table.Td><Badge variant={row.outcome === 'agree-flag' || row.outcome === 'disagree' ? 'light' : 'default'} color={row.outcome === 'disagree' ? 'yellow' : row.outcome === 'agree-flag' ? 'orange' : 'gray'}>{OUTCOME_WORDS[row.outcome]}</Badge></Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Panel>
  );
}

/** The `/critiques` route. */
export function CritiquesPage() {
  const evidence = useEvidence();
  const search = useCritiqueSearch();
  const go = useCritiqueNavigate();
  const id = useId();
  const list = useMemo(() => polishList(evidence.evidence, search), [evidence.evidence, search]);
  const unavailable = evidence.backends.filter((backend) => !backend.available);
  const all = [...list.ranked, ...list.unranked];
  const view = search.view === 'agreement' ? 'agreement' : 'ranked';
  const open = search.entry ? all.find((item) => item.entry.key === search.entry) ?? null : null;
  return (
    <Stack gap="md" component="article" aria-label="Needs polish">
      <PageHeader
        title="Needs polish"
        description="What automated reviewers think of the captured UI states, lowest first, so the likeliest problems are reviewed first. These are opinions: they are not test results, are never counted with them, and never change whether a report passes."
      />
      {evidence.unavailable && <Alert role="alert" color="red" title="Recorded results cannot be read">{evidence.unavailable}</Alert>}
      {unavailable.length > 0 && (
        <Alert role="status" color="orange" title={`${plural(unavailable.length, 'backend is', 'backends are')} not available`}>
          {unavailable.map((backend) => backend.label).join(', ')}: critiques held there are not shown. This list may be incomplete.
        </Alert>
      )}
      <EvidenceIncomplete />
      {!evidence.ready && !evidence.unavailable && <EvidenceWaiting label="Reading the recorded critiques…" />}
      {evidence.ready && list.critics.length === 0 && (
        <Card>
          <Stack align="center" gap="xs" py="xl" role="status" data-empty>
            <ThemeIcon variant="default" size={44} radius="xl" c="dimmed"><IconSparkles size={22} aria-hidden="true" /></ThemeIcon>
            <Text fw={600}>No critic has judged a captured UI state yet.</Text>
            <Text c="dimmed" size="sm" ta="center" maw={560}>
              Run <Code>atlas critic run --critic &lt;name&gt; --all</Code> against this server; critiques appear here the moment they arrive.
              {list.unjudgeable > 0 ? ` ${plural(list.unjudgeable, 'captured state has', 'captured states have')} no stored picture, so a critic cannot see ${list.unjudgeable === 1 ? 'it' : 'them'}.` : ''}
            </Text>
          </Stack>
        </Card>
      )}
      {list.critic && (
        <Tabs value={view} onChange={(next) => go({ view: next === 'agreement' ? 'agreement' : undefined })} keepMounted={false}>
          <Group justify="space-between" align="flex-end" gap="sm" mb="md">
            <Tabs.List flex={{ base: '1 0 100%', sm: '0 0 auto' }}>
              <Tabs.Tab value="ranked">Ranked</Tabs.Tab>
              <Tabs.Tab value="agreement">Agreement across critics</Tabs.Tab>
            </Tabs.List>
            <Group gap="md">
              {view === 'ranked' && (
                <Group gap="xs" wrap="nowrap">
                  <Text component="label" htmlFor={`${id}-critic`} size="sm" c="dimmed">Critic</Text>
                  <NativeSelect id={`${id}-critic`} value={list.critic} data={list.critics.map((critic) => ({ value: critic.name, label: `${critic.name} (${critic.critiques})` }))} onChange={(event) => go({ critic: event.currentTarget.value })} />
                </Group>
              )}
              <Group gap="xs" wrap="nowrap">
                <Text component="label" htmlFor={`${id}-kind`} size="sm" c="dimmed">State kind</Text>
                <NativeSelect id={`${id}-kind`} value={search.kind ?? ''} data={[{ value: '', label: 'All kinds' }, ...list.kinds.map((kind) => ({ value: kind, label: kind }))]} onChange={(event) => go({ kind: event.currentTarget.value || undefined })} />
              </Group>
            </Group>
          </Group>
          <Tabs.Panel value="agreement"><AgreementPanel list={list} /></Tabs.Panel>
          <Tabs.Panel value="ranked">
            <Stack gap="md">
              <Panel flush title={`Ranked by ${list.critic}`} description="Scores are ranked within one critic" actions={
                <Group gap="md" role="status" aria-label="Critique summary">
                  <Text size="sm" fw={500}>{plural(list.ranked.length, 'state judged', 'states judged')}</Text>
                  {list.unranked.length > 0 && <Text size="sm" c="dimmed">{list.unranked.length} not judged at the current picture</Text>}
                  {list.unjudged > 0 && <Text size="sm" c="dimmed">{list.unjudged} not judged yet</Text>}
                </Group>
              }>
                {list.ranked.length > 0 ? (
                  <Table.ScrollContainer minWidth={760}>
                    <Table aria-label="States ranked by score, lowest first" horizontalSpacing="lg" verticalSpacing="sm" highlightOnHover>
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th scope="col" w={56}>Rank</Table.Th>
                          <Table.Th scope="col">State</Table.Th>
                          <Table.Th scope="col">Score</Table.Th>
                          <Table.Th scope="col">Within its kind</Table.Th>
                          <Table.Th scope="col">Findings</Table.Th>
                          <Table.Th scope="col">Review</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {list.ranked.map((item, index) => {
                          const severity = worst(item.found.critique);
                          return (
                            <Table.Tr key={item.entry.key} data-entry={item.entry.key}>
                              <Table.Td><Text fz="sm" c="dimmed">{index + 1}</Text></Table.Td>
                              <Table.Td>
                                <Group gap="md" wrap="nowrap">
                                  <Thumb item={item} />
                                  <Stack gap={0} miw={0}>
                                    <EntryLink item={item} />
                                    <Text c="dimmed" fz="xs">{item.entry.profile.label}</Text>
                                    <Text c="dimmed" fz="xs">{item.entry.state}</Text>
                                  </Stack>
                                </Group>
                              </Table.Td>
                              <Table.Td><Group gap="xs" wrap="nowrap"><Text span fw={600} fz="sm">{score(item.found.critique)}</Text><Label critique={item.found.critique} /></Group></Table.Td>
                              <Table.Td><Text fz="sm" c="dimmed">{standing(item.found.critique)}</Text></Table.Td>
                              <Table.Td>
                                {(item.found.critique.findings ?? []).length > 0 ? (
                                  <Group gap="xs" wrap="nowrap">
                                    <Text span fz="sm">{plural((item.found.critique.findings ?? []).length, 'finding', 'findings')}</Text>
                                    {severity && <Badge size="sm" variant="light" color={SEVERITY_COLOR[severity] ?? 'gray'}>{severity}</Badge>}
                                  </Group>
                                ) : <Text span fz="sm" c="dimmed">None given</Text>}
                              </Table.Td>
                              <Table.Td><MarkBadge standing={markStanding(item.entry.marks, { critic: item.found.critique.critic.name })} /></Table.Td>
                            </Table.Tr>
                          );
                        })}
                      </Table.Tbody>
                    </Table>
                  </Table.ScrollContainer>
                ) : (
                  <Text c="dimmed" size="sm" role="status" component="div" px="lg" pb="lg">{list.critic} has not produced a score for any state in view.</Text>
                )}
              </Panel>
              {list.unranked.length > 0 && (
                <Panel flush title="Not judged at the current picture">
                  <Table.ScrollContainer minWidth={420}>
                    <Table aria-label="States not judged at the current picture" horizontalSpacing="lg" verticalSpacing="sm">
                      <Table.Thead>
                        <Table.Tr>
                          <Table.Th scope="col">State</Table.Th>
                          <Table.Th scope="col">Why</Table.Th>
                        </Table.Tr>
                      </Table.Thead>
                      <Table.Tbody>
                        {list.unranked.map((item) => (
                          <Table.Tr key={item.entry.key} data-entry={item.entry.key}>
                            <Table.Td><Stack gap={0}><EntryLink item={item} /><Text c="dimmed" fz="xs">{item.entry.profile.label}</Text></Stack></Table.Td>
                            <Table.Td>
                              <Text fz="sm" c="dimmed">
                                {item.found.critique.failure
                                  ? `The critic could not judge it (${item.found.critique.failure.reason}); the next run tries again`
                                  : 'The picture changed since it was judged; the older opinion is kept for reference'}
                              </Text>
                            </Table.Td>
                          </Table.Tr>
                        ))}
                      </Table.Tbody>
                    </Table>
                  </Table.ScrollContainer>
                </Panel>
              )}
            </Stack>
          </Tabs.Panel>
        </Tabs>
      )}
      {search.entry && !open && evidence.ready && evidence.pending === 0 && (
        <Alert role="status" color="gray" title="That entry has no critique in this view">
          <Text span inherit>{search.entry}</Text> is not among the states this critic has judged or tried to judge.{' '}
          <Anchor inherit renderRoot={(props) => <Link {...props} to="/critiques" search={((prev: Record<string, unknown>) => ({ ...prev, entry: undefined })) as never} />}>Back to the list</Anchor>
        </Alert>
      )}
      {open && <Detail item={open} onClose={() => go({ entry: undefined })} />}
    </Stack>
  );
}
