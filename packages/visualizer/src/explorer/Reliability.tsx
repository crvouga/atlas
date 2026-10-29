/**
 * @module Reliability of a test
 *
 * The open test's reliability, qualified: how many independent executions it rests on (not snapshots, not tries), for
 * which environment, branch, spec revision and time window, how often it passed first time and in the end, and why the
 * figure may not be what it looks like (a small sample, pooled environments, failed cases published again, bounded
 * history). The scope is in the address and the executions behind the figure (its denominator) open in place, so a link
 * shows the same figure and the same executions. It is worked out from the history the page already holds
 * (`reliability` in the reports library), so it needs no further request.
 */
import { Accordion, Alert, Anchor, Badge, Box, Button, Checkbox, Code, CopyButton, Flex, List, MultiSelect, SimpleGrid, Stack, Table, Text, TextInput, Title, VisuallyHidden } from '@mantine/core';
import { IconLink } from '@tabler/icons-react';
import { environmentLabel } from '@crvouga/atlas/reports/layer-axes';
import { reliability, type ReliabilityExecution } from '@crvouga/atlas/reports/reliability';
import type { TestResultEntry } from '@crvouga/atlas/reports/test-catalog';
import { Link } from '@tanstack/react-router';
import { useMemo } from 'react';
import { exactTime, plural, shortSha, STATUS_WORD } from '../evidence/format';
import { StatusMark } from '../evidence/marks';
import { joined, reliabilityScopeOf, values } from './search';
import { patched, useExplorerNavigate, useExplorerSearch } from './navigate';

/** A recorded status as a mark and a word; one this viewer does not know is shown by its own name and as unknown, never as a pass. */
const known = (status: string) => (Object.hasOwn(STATUS_WORD, status) && status !== 'none' ? (status as keyof typeof STATUS_WORD) : 'none');
const word = (status: string) => (known(status) === 'none' ? status : STATUS_WORD[known(status)]);
const percent = (rate: number | null) => (rate === null ? 'no rate' : `${Math.round(rate * 1000) / 10}%`);
const outOf = (passed: number, executions: number) => `${passed} of ${plural(executions, 'execution', 'executions')} passed`;
const REASONS: Record<string, string> = {
  'not-run': 'Did not run',
  unfinished: 'Not finished',
  'unknown-status': 'Status not understood',
  'historical-revision': 'Earlier spec revision',
  'revision-not-recorded': 'Spec revision not recorded'
};

function Choice({ label, param, options, chosen }: { label: string; param: 'relEnv' | 'relProducer' | 'relBranch' | 'relParam'; options: readonly { value: string; label: string }[]; chosen: string[] }) {
  const go = useExplorerNavigate();
  if (options.length < 2 && !chosen.length) return null;
  return (
    <MultiSelect
      label={label}
      data={options as { value: string; label: string }[]}
      value={chosen}
      searchable
      clearable
      placeholder={chosen.length ? undefined : `Any ${label.toLowerCase()}`}
      nothingFoundMessage="Nothing found"
      onChange={(next) => go({ [param]: joined(next) } as never, { replace: true })}
    />
  );
}

function Denominator({ executions, layer }: { executions: readonly ReliabilityExecution[]; layer: string | undefined }) {
  return (
    <Table.ScrollContainer minWidth={760}>
      <Table>
        <Table.Caption>Independent executions of this test in the scope, newest first. Snapshots of one execution are one row.</Table.Caption>
        <Table.Thead>
          <Table.Tr>
            <Table.Th scope="col">Recorded</Table.Th>
            <Table.Th scope="col">Environment</Table.Th>
            <Table.Th scope="col">Status</Table.Th>
            <Table.Th scope="col">Tries</Table.Th>
            <Table.Th scope="col">Snapshots</Table.Th>
            <Table.Th scope="col">Branch</Table.Th>
            <Table.Th scope="col">Commit</Table.Th>
            <Table.Th scope="col">Counted</Table.Th>
            <Table.Th scope="col">
              <VisuallyHidden>Evidence</VisuallyHidden>
            </Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {executions.map((execution) => (
            <Table.Tr key={`${execution.layer}|${execution.kind}|${execution.producer}|${execution.environment}|${JSON.stringify(execution.parameters)}`} data-status={execution.status} data-counted={execution.counted}>
              <Table.Td title={exactTime(execution.at)}>{exactTime(execution.at)}</Table.Td>
              <Table.Td>
                {environmentLabel(execution.environment)}
                {Object.entries(execution.parameters).map(([name, value]) => (
                  <Text key={name} span inherit c="dimmed">
                    {' '}
                    {name}: {value}
                  </Text>
                ))}
              </Table.Td>
              <Table.Td>
                <Flex component="span" display="inline-flex" gap="xs" align="center" wrap="wrap">
                  <StatusMark status={known(execution.status)} size={12} />
                  {word(execution.status)}
                </Flex>
              </Table.Td>
              <Table.Td>{execution.attempts ? execution.attempts.map(word).join(' → ') : 'Not recorded'}</Table.Td>
              <Table.Td>
                {execution.snapshots}
                {execution.republished && (
                  <Text span inherit c="dimmed">
                    {' '}
                    (published again after a failure)
                  </Text>
                )}
              </Table.Td>
              <Table.Td c="dimmed">{execution.branch ?? '—'}</Table.Td>
              <Table.Td>
                <Code>{shortSha(execution.sha) ?? '—'}</Code>
              </Table.Td>
              <Table.Td>{execution.counted ? 'Yes' : `No: ${REASONS[execution.excluded ?? ''] ?? execution.excluded}`}</Table.Td>
              <Table.Td>
                <Anchor
                  aria-label={`Open the ${word(execution.status)} result recorded ${exactTime(execution.at)} in ${environmentLabel(execution.environment)}`}
                  aria-current={execution.layer === layer ? 'true' : undefined}
                  renderRoot={(props) => <Link {...props} to="/" search={patched({ layer: execution.layer })} resetScroll={false} activeOptions={{ exact: true }} />}
                >
                  Open this result
                </Anchor>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}

/**
 * The reliability section of an open test: scope choices, the qualified figures, why they may mislead, and the
 * executions they count. `entries` is every recorded result of the test the page holds, newest first; while it is
 * `undefined` the history is still being read.
 */
export function Reliability({ testKey, entries }: { testKey: string; entries: readonly TestResultEntry[] | undefined }) {
  const search = useExplorerSearch();
  const go = useExplorerNavigate();
  const scope = useMemo(() => reliabilityScopeOf(search), [search]);
  const document = useMemo(() => (entries ? reliability(testKey, entries, scope) : null), [testKey, entries, scope]);
  const parameters = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of entries ?? []) for (const [name, value] of Object.entries(entry.parameters)) counts.set(`${name}=${value}`, (counts.get(`${name}=${value}`) ?? 0) + 1);
    return [...counts].map(([value, count]) => ({ value, label: `${value} (${count})` }));
  }, [entries]);
  if (!document)
    return (
      <Box aria-label="Reliability" component="section" mb="lg">
        <Title order={3} mb="sm" c="dimmed">
          Reliability
        </Title>
        <Text role="status" component="div" c="dimmed">
          Reading the history…
        </Text>
      </Box>
    );
  const { eventual, firstAttempt } = document;
  const label = (list: readonly { value: string; count: number }[], format: (value: string) => string = (value) => value) => list.map(({ value, count }) => ({ value, label: `${format(value)} (${count})` }));
  const warnings = document.notes.filter((note) => note.severity === 'warning');
  const infos = document.notes.filter((note) => note.severity === 'info');
  const scoped = Object.keys(scope).length > 0;
  return (
    <Box aria-label="Reliability" component="section" mb="lg">
      <Title order={3} mb="sm" c="dimmed">
        Reliability
      </Title>
      <Text component="div" c="dimmed" mb="sm">
        Counted over independent executions: the snapshots one run recorded for one environment are one execution, and a retry is a try of it, not another
        execution. This describes the checks Atlas holds, not how often the product fails in production.
      </Text>
      <Stack gap="sm" mb="md">
        <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }}>
          <Choice label="Environment" param="relEnv" options={label(document.available.environments, environmentLabel)} chosen={values(search.relEnv)} />
          <Choice label="Producer" param="relProducer" options={label(document.available.producers)} chosen={values(search.relProducer)} />
          <Choice label="Branch" param="relBranch" options={label(document.available.branches)} chosen={values(search.relBranch)} />
          <Choice label="Parameters" param="relParam" options={parameters} chosen={values(search.relParam)} />
          <TextInput type="date" label="Executions from" value={search.relSince ?? ''} onChange={(event) => go({ relSince: event.target.value || undefined }, { replace: true })} />
          <TextInput type="date" label="Executions until" value={search.relUntil ?? ''} onChange={(event) => go({ relUntil: event.target.value || undefined }, { replace: true })} />
        </SimpleGrid>
        {document.available.specRevisions.length > 0 && (
          <Checkbox
            label="Include earlier revisions of the spec"
            description={document.currentRevision ? 'Off: only executions of the newest recorded spec revision count; earlier ones are shown as context.' : 'On: every revision is pooled, though the behavior may have changed between them.'}
            checked={search.relRevision === 'any'}
            onChange={(event) => go({ relRevision: event.currentTarget.checked ? 'any' : undefined }, { replace: true })}
          />
        )}
      </Stack>

      <Flex gap="xs" align="center" wrap="wrap" mb="sm" role="status" aria-label="Reliability sample">
        <Badge color={document.sample === 'sufficient' ? 'gray' : 'orange'} variant="light">
          {document.sample === 'none' ? 'No independent executions' : document.sample === 'insufficient' ? 'Insufficient evidence' : 'Sample large enough to read as a rate'}
        </Badge>
        <Text span inherit fw={600}>
          {plural(eventual.executions, 'independent execution', 'independent executions')}
        </Text>
        <Text span inherit c="dimmed">
          {scoped ? 'in this scope' : 'in all recorded history'}
          {document.sample === 'insufficient' ? `; at least ${document.minimumExecutions} are needed before a rate means much` : ''}
        </Text>
      </Flex>

      <SimpleGrid component="dl" cols={{ base: 1, sm: 2, md: 3 }}>
        <Stack gap="sm">
          <Box component="dt">Eventual success</Box>
          <Box component="dd" m={0}>
            {eventual.executions ? `${outOf(eventual.passed, eventual.executions)} (${percent(eventual.rate)})` : 'No rate: nothing completed in this scope'}
          </Box>
        </Stack>
        <Stack gap="sm">
          <Box component="dt">First-try success</Box>
          <Box component="dd" m={0}>
            {firstAttempt.executions ? `${outOf(firstAttempt.passed, firstAttempt.executions)} first time (${percent(firstAttempt.rate)})` : 'Unknown: no tries recorded'}
            {document.unrecordedAttempts > 0 && firstAttempt.executions > 0 && (
              <Text span inherit c="dimmed">
                {' '}
                · {document.unrecordedAttempts} recorded no tries
              </Text>
            )}
          </Box>
        </Stack>
        <Stack gap="sm">
          <Box component="dt">Tries</Box>
          <Box component="dd" m={0}>
            {document.attempts.total
              ? `${document.attempts.total} recorded; ${plural(document.attempts.retried, 'execution', 'executions')} retried, ${document.attempts.recovered} failed first and passed after`
              : 'None recorded'}
          </Box>
        </Stack>
        <Stack gap="sm">
          <Box component="dt">Interval (95%)</Box>
          <Box component="dd" m={0} title={document.interval?.assumptions}>
            {document.interval ? `${percent(document.interval.lower)} to ${percent(document.interval.upper)} (Wilson)` : '—'}
          </Box>
        </Stack>
        <Stack gap="sm">
          <Box component="dt">Recorded snapshots</Box>
          <Box component="dd" m={0}>
            {document.snapshots} behind the counted {plural(eventual.executions, 'execution', 'executions')}
          </Box>
        </Stack>
        <Stack gap="sm">
          <Box component="dt">Not counted</Box>
          <Box component="dd" m={0}>
            {document.outsideScope} outside the scope
            {Object.entries(document.excluded)
              .filter(([, count]) => count > 0)
              .map(([reason, count]) => `, ${count} ${(REASONS[reason] ?? reason).toLowerCase()}`)
              .join('')}
          </Box>
        </Stack>
      </SimpleGrid>

      {warnings.length > 0 && (
        <Alert color="orange" title="Read this figure with care" mt="sm">
          <List>
            {warnings.map((note) => (
              <List.Item key={note.code}>{note.message}</List.Item>
            ))}
          </List>
        </Alert>
      )}
      {infos.length > 0 && (
        <List mt="sm" c="dimmed">
          {infos.map((note) => (
            <List.Item key={note.code}>{note.message}</List.Item>
          ))}
        </List>
      )}
      {document.interval && (
        <Text component="div" c="dimmed" mt="sm">
          Interval assumes: {document.interval.assumptions}
        </Text>
      )}
      {document.historical.executions > 0 && (
        <Text component="div" c="dimmed" mt="sm">
          Earlier spec revisions, shown as context and not counted: {outOf(document.historical.passed, document.historical.executions)}.
        </Text>
      )}

      {document.cohorts.length > 1 && (
        <Table.ScrollContainer minWidth={500} mt="sm">
          <Table>
            <Table.Caption>Each environment, producer and parameter set on its own</Table.Caption>
            <Table.Thead>
              <Table.Tr>
                <Table.Th scope="col">Environment</Table.Th>
                <Table.Th scope="col">Producer</Table.Th>
                <Table.Th scope="col">Executions</Table.Th>
                <Table.Th scope="col">Passed</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {document.cohorts.map((cohort) => (
                <Table.Tr key={JSON.stringify([cohort.environment, cohort.producer, cohort.parameters])}>
                  <Table.Td>
                    {environmentLabel(cohort.environment)}
                    {Object.entries(cohort.parameters).map(([name, value]) => (
                      <Text key={name} span inherit c="dimmed">
                        {' '}
                        {name}: {value}
                      </Text>
                    ))}
                  </Table.Td>
                  <Table.Td>{cohort.producer}</Table.Td>
                  <Table.Td>{cohort.executions}</Table.Td>
                  <Table.Td>
                    {cohort.passed} ({percent(cohort.rate)})
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}

      <Accordion variant="separated" mt="sm" value={search.relOpen ? 'denominator' : null} onChange={(value) => go({ relOpen: value ? true : undefined }, { replace: true })}>
        <Accordion.Item value="denominator">
          <Accordion.Control>
            Executions behind this figure: {document.executions.filter((execution) => execution.counted).length} counted
            {document.executions.some((execution) => !execution.counted) ? `, ${document.executions.filter((execution) => !execution.counted).length} not counted` : ''}
          </Accordion.Control>
          <Accordion.Panel>
            <Stack gap="sm">
              <Flex gap="xs" align="center" wrap="wrap">
                <CopyButton value={typeof window === 'undefined' ? '' : window.location.href}>
                  {({ copied, copy }) => (
                    <Button type="button" variant="default" onClick={copy} leftSection={<IconLink size={16} aria-hidden="true" />}>
                      {copied ? 'Link copied' : 'Copy link to this scope'}
                    </Button>
                  )}
                </CopyButton>
                <Text span inherit c="dimmed">
                  The link opens this scope and these executions.
                </Text>
              </Flex>
              {document.executions.length > 0 ? <Denominator executions={document.executions} layer={search.layer} /> : <Text c="dimmed">No execution of this test matches the scope.</Text>}
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </Box>
  );
}
