/**
 * @module Catalog health view
 *
 * The Catalog health tab: why the Specs and the Tests of a report disagree, and what a producer or an operator can change.
 * It shows the denominators apart (spec files, defined specs, specs with an executed test, tests, outlines, examples and
 * per-environment observations), the steps from the Specs count to the Tests count, the domains in use, specs seen under
 * more than one path, and every finding with the paths it affects. Two paths are one logical spec only when a root mapping
 * relates them: the server's configured mappings are shown as such, and further `from>to` mappings can be tried here
 * (they are the address's `root`, so a link reproduces the figures). Ambiguous paths are never merged by similar title.
 * The tab only reads: it never changes a status, a count of passed checks or a domain.
 */
import { parseRootMappings, type CatalogHealth, type HealthFinding, type RootMapping } from '@crvouga/atlas/reports/catalog-health';
import { Accordion, ActionIcon, Alert, Badge, Box, Button, Code, Group, List, Paper, SimpleGrid, Stack, Table, Text, TextInput, Title, Tooltip } from '@mantine/core';
import { IconTrash } from '@tabler/icons-react';
import { useMemo, useState } from 'react';

import { plural } from '../evidence/format';
import { useCatalogHealth } from './catalog';
import { useExplorerNavigate, useExplorerSearch } from './navigate';

const label = (root: { readonly from: string; readonly to: string }) => `${root.from}>${root.to}`;

function Figure({ name, value, hint }: { name: string; value: number; hint: string }) {
  return (
    <Paper withBorder p="sm" title={hint}>
      <Text size="xs" c="dimmed" component="div">
        {name}
      </Text>
      <Text fw={700} size="xl" component="div" data-health-figure={name}>
        {value}
      </Text>
    </Paper>
  );
}

function Counts({ health }: { health: CatalogHealth }) {
  const { specs, tests, scenarios } = health.counts;
  return (
    <Stack gap="md">
      <Box component="section" aria-label="Spec counts">
        <Title order={4} mb="xs">
          Specs
        </Title>
        <SimpleGrid cols={{ base: 2, sm: 3, md: 5 }}>
          <Figure name="Spec files" value={specs.files} hint="Files the report is laid over, before any root mapping. This is the number the Specs view shows." />
          <Figure name="Defined specs" value={specs.defined} hint="Spec files, with those joined by a declared root mapping counted once." />
          <Figure name="Specs with tests" value={specs.withTests} hint="Specs, defined or not, with at least one test. This is what the Tests view groups by." />
          <Figure name="Specs executed" value={specs.executed} hint="Defined specs with a test that passed or failed: the denominator of execution coverage." />
          <Figure name="Defined, not executed" value={specs.withoutExecution} hint="Defined specs with no passed or failed test: the coverage gaps. They add to no passed count." />
        </SimpleGrid>
      </Box>
      <Box component="section" aria-label="Test counts">
        <Title order={4} mb="xs">
          Tests
        </Title>
        <SimpleGrid cols={{ base: 2, sm: 3, md: 5 }}>
          <Figure name="Tests" value={tests.total} hint="Check identities: a spec path and an id, however many environments ran them." />
          <Figure name="Tests passed" value={tests.passed} hint="Tests whose current status is passed." />
          <Figure name="Tests with a spec" value={tests.withSpec} hint="Tests that name the spec they belong to." />
          <Figure name="Tests without a spec" value={tests.withoutSpec} hint="Tests that name no spec; they are in no spec or domain group." />
          <Figure name="Only in history" value={tests.historicalOnly} hint="Tests the history holds but the report has no current result for (removed, renamed or not re-run)." />
        </SimpleGrid>
      </Box>
      <Box component="section" aria-label="Scenario counts">
        <Title order={4} mb="xs">
          Outlines, examples and observations
        </Title>
        <SimpleGrid cols={{ base: 2, sm: 3, md: 5 }}>
          <Figure name="Outlines" value={scenarios.outlines} hint="Tests sharing the label outline count once; a test without it is its own outline." />
          <Figure name="Examples" value={scenarios.examples} hint="Concrete examples: tests, however many environments ran them." />
          <Figure name="Observations" value={scenarios.observations} hint="Current results per producer, environment and parameter set." />
          <Figure name="Observations executed" value={scenarios.executedObservations} hint="Observations that passed or failed." />
          <Figure name="Observations passed" value={scenarios.passedObservations} hint="Observations that passed." />
        </SimpleGrid>
      </Box>
    </Stack>
  );
}

function Reconciliation({ health }: { health: CatalogHealth }) {
  const { reconciliation } = health;
  let total = reconciliation.specs;
  const rows = reconciliation.steps.map((step) => {
    total += step.delta;
    return (
      <Table.Tr key={step.code}>
        <Table.Td>{step.label}</Table.Td>
        <Table.Td ta="right">{step.delta > 0 ? `+${step.delta}` : step.delta}</Table.Td>
        <Table.Td ta="right">{total}</Table.Td>
      </Table.Tr>
    );
  });
  return (
    <Box component="section" aria-label="Why Specs and Tests differ">
      <Title order={3} mb="xs">
        Why Specs and Tests differ
      </Title>
      <Table.ScrollContainer minWidth={420}>
        <Table data-health-reconciliation>
          <Table.Thead>
            <Table.Tr>
              <Table.Th scope="col">Step</Table.Th>
              <Table.Th scope="col" ta="right">
                Change
              </Table.Th>
              <Table.Th scope="col" ta="right">
                Total
              </Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            <Table.Tr>
              <Table.Td>Spec files the Specs view lists</Table.Td>
              <Table.Td />
              <Table.Td ta="right">{reconciliation.specs}</Table.Td>
            </Table.Tr>
            {rows}
            <Table.Tr>
              <Table.Td fw={600}>Specs the Tests view groups its tests into</Table.Td>
              <Table.Td />
              <Table.Td ta="right" fw={600}>
                {reconciliation.testSpecs}
              </Table.Td>
            </Table.Tr>
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
      <List size="sm" mt="sm" data-health-explanation>
        {reconciliation.explanation.map((line) => (
          <List.Item key={line}>{line}</List.Item>
        ))}
      </List>
    </Box>
  );
}

function Finding({ item }: { item: HealthFinding }) {
  return (
    <Accordion.Item value={item.code} data-health-finding={item.code}>
      <Accordion.Control>
        <Group gap="xs" wrap="wrap">
          <Badge variant="light" color={item.severity === 'warning' ? 'orange' : 'blue'} tt="none">
            {item.severity === 'warning' ? 'Warning' : 'Note'}
          </Badge>
          <Code>{item.code}</Code>
          <Text span size="sm" c="dimmed">
            {item.count} affected
          </Text>
        </Group>
      </Accordion.Control>
      <Accordion.Panel>
        <Stack gap="xs">
          <Text component="div" size="sm">
            {item.message}
          </Text>
          {item.items.length > 0 && (
            <List size="sm" listStyleType="none">
              {item.items.map((entry) => (
                <List.Item key={entry.path}>
                  <Code>{entry.path}</Code>
                  {entry.candidates?.map((candidate) => (
                    <Text key={candidate.path} component="div" size="xs" c="dimmed" ml="md">
                      may be the same promise as <Code>{candidate.path}</Code> ({candidate.reason}); not merged
                    </Text>
                  ))}
                </List.Item>
              ))}
            </List>
          )}
          {item.count > item.items.length && (
            <Text size="xs" c="dimmed" component="div">
              and {item.count - item.items.length} more
            </Text>
          )}
        </Stack>
      </Accordion.Panel>
    </Accordion.Item>
  );
}

function Mappings({ health, tried }: { health: CatalogHealth | undefined; tried: readonly RootMapping[] }) {
  const go = useExplorerNavigate();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const configured = (health?.roots ?? []).filter((root) => root.source === 'configuration');
  const write = (list: readonly RootMapping[]) => go({ root: list.length ? list.map(label).join(',') : undefined }, { replace: true });
  const known = [...configured, ...tried].some((root) => root.from === from.trim() && root.to === to.trim());
  const matched = (root: RootMapping) => health?.roots.find((item) => item.from === root.from && item.to === root.to && item.source !== 'configuration')?.matched;
  return (
    <Box component="section" aria-label="Root mappings">
      <Title order={3} mb="xs">
        Root mappings
      </Title>
      <Text size="sm" c="dimmed" mb="sm">
        Two spec paths are one spec only when a mapping says so. A mapping states that paths under one folder are the same specs as paths under another; Atlas never merges paths by a similar title. A mapping tried here is kept in the address and changes nothing on the server. To keep one, set <Code>catalog.roots</Code> or <Code>ATLAS_CATALOG_ROOTS</Code> on the server.
      </Text>
      {configured.length + tried.length > 0 && (
        <List size="sm" listStyleType="none" mb="sm" aria-label="Declared root mappings">
          {configured.map((root) => (
            <List.Item key={`c${label(root)}`}>
              <Group gap="xs" wrap="wrap">
                <Code>{label(root)}</Code>
                <Badge variant="light" tt="none">
                  Configured on the server
                </Badge>
                <Text span size="xs" c="dimmed">
                  changed {plural(root.matched, 'path', 'paths')}
                </Text>
              </Group>
            </List.Item>
          ))}
          {tried.map((root) => (
            <List.Item key={`t${label(root)}`}>
              <Group gap="xs" wrap="wrap">
                <Code>{label(root)}</Code>
                <Badge variant="light" color="gray" tt="none">
                  Tried here
                </Badge>
                {matched(root) !== undefined && (
                  <Text span size="xs" c="dimmed">
                    changed {plural(matched(root)!, 'path', 'paths')}
                  </Text>
                )}
                <Tooltip label="Stop trying this mapping">
                  <ActionIcon variant="subtle" color="gray" aria-label={`Stop trying ${label(root)}`} onClick={() => write(tried.filter((item) => item !== root))}>
                    <IconTrash size={16} aria-hidden="true" />
                  </ActionIcon>
                </Tooltip>
              </Group>
            </List.Item>
          ))}
        </List>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!to.trim() || known) return;
          write([...tried, { from: from.trim(), to: to.trim() }]);
          setFrom('');
          setTo('');
        }}
      >
        <Group align="flex-end" gap="md" wrap="wrap">
          <TextInput label="Paths under" description="Leave empty to match every path" placeholder="checkout/" value={from} onChange={(event) => setFrom(event.currentTarget.value)} />
          <TextInput label="are the same specs as paths under" description="Where the specs are recorded" placeholder="specs/checkout/" value={to} onChange={(event) => setTo(event.currentTarget.value)} />
          <Button type="submit" disabled={!to.trim() || known}>
            Try this mapping
          </Button>
        </Group>
      </form>
    </Box>
  );
}

/** The Catalog health tab. */
export function HealthView() {
  const search = useExplorerSearch();
  const tried = useMemo(() => (search.root ? parseRootMappings(new URLSearchParams([['root', search.root]])) : []), [search.root]);
  const answer = useCatalogHealth(tried);
  const health = answer.data && !answer.data.unsupported ? answer.data.health : undefined;
  const warnings = health?.findings.filter((item) => item.severity === 'warning') ?? [];
  return (
    <Box aria-label="Catalog health" component="section" mb="lg">
      <Title order={2} mb="sm">
        Catalog health
      </Title>
      <Text component="div" c="dimmed" mb="md">
        Specs, domains and coverage counts can disagree because of how specs are named and described, not because of a defect in a test. This explains each number, where the totals differ, and what to change at the source. It only reads: it changes no result.
      </Text>
      <Stack gap="lg">
        <Mappings health={health} tried={tried} />
        {answer.isPending && (
          <Text role="status" component="div" c="dimmed">
            Reading the catalog…
          </Text>
        )}
        {answer.isError && (
          <Alert role="alert" color="red">
            The catalog health could not be read. {answer.error.message}
            <Group mt="xs">
              <Button type="button" variant="light" onClick={() => void answer.refetch()}>
                Try again
              </Button>
            </Group>
          </Alert>
        )}
        {answer.data?.unsupported && (
          <Alert role="status" color="blue">
            This server is older than the catalog health report, so it cannot explain these counts. Upgrade the server to read it.
          </Alert>
        )}
        {health && (
          <>
            <Alert role="status" color={health.ok ? 'green' : 'orange'} title={health.ok ? 'No warnings' : plural(warnings.length, 'warning', 'warnings')} data-health-summary>
              {health.ok ? 'Nothing found that makes a count or a domain filter misleading.' : 'These make a count or a domain filter misleading. Each says what to change at its source.'}
            </Alert>
            <Reconciliation health={health} />
            <Counts health={health} />
            {health.aliases.length > 0 && (
              <Box component="section" aria-label="Specs under more than one path">
                <Title order={3} mb="xs">
                  Specs under more than one path
                </Title>
                <Text size="sm" c="dimmed" mb="xs">
                  Joined because a root mapping relates them. Every original path stays inspectable.
                </Text>
                <Table.ScrollContainer minWidth={420}>
                  <Table data-health-aliases>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th scope="col">Spec</Table.Th>
                        <Table.Th scope="col">Original paths</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {health.aliases.map((alias) => (
                        <Table.Tr key={alias.path}>
                          <Table.Td>
                            <Code>{alias.path}</Code>
                          </Table.Td>
                          <Table.Td>
                            <Stack gap={2}>
                              {alias.sources.map((source) => (
                                <Code key={source}>{source}</Code>
                              ))}
                            </Stack>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
              </Box>
            )}
            <Box component="section" aria-label="Domains">
              <Title order={3} mb="xs">
                Domains
              </Title>
              <Text size="sm" c="dimmed" mb="xs">
                A domain is what a spec&apos;s own metadata says. Explicit metadata is always authoritative; a domain shared by nearly every spec is reported as a finding below, not changed.
              </Text>
              {health.domains.length === 0 ? (
                <Text component="div" c="dimmed">
                  No spec declares a domain.
                </Text>
              ) : (
                <Table.ScrollContainer minWidth={320}>
                  <Table data-health-domains>
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th scope="col">Domain</Table.Th>
                        <Table.Th scope="col" ta="right">
                          Specs
                        </Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {health.domains.map((domain) => (
                        <Table.Tr key={domain.name}>
                          <Table.Td>{domain.name}</Table.Td>
                          <Table.Td ta="right">{domain.specs}</Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                </Table.ScrollContainer>
              )}
            </Box>
            <Box component="section" aria-label="Findings">
              <Title order={3} mb="xs">
                Findings
              </Title>
              {health.findings.length === 0 ? (
                <Text component="div" c="dimmed">
                  Nothing to report.
                </Text>
              ) : (
                <Accordion multiple defaultValue={warnings.map((item) => item.code)}>
                  {health.findings.map((item) => (
                    <Finding key={item.code} item={item} />
                  ))}
                </Accordion>
              )}
            </Box>
            <Box component="section" aria-label="Identity">
              <Title order={3} mb="xs">
                Identity
              </Title>
              <Text size="sm" component="div" data-health-identity>
                Fallback identity (known by title only): {health.identity.fallbackIdentity} of {health.identity.checks} checks.
                {health.identity.declaredBehaviorIds !== undefined && ` Declared behavior ids: ${health.identity.declaredBehaviorIds}. Declared example ids: ${health.identity.declaredExampleIds ?? 0}.`}
              </Text>
              <Text size="sm" c="dimmed" component="div" mt="xs">
                {health.identity.basis}
              </Text>
            </Box>
          </>
        )}
      </Stack>
    </Box>
  );
}
