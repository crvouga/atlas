import { SpecLogo } from '../components/SpecLogo';
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react';
import { ActionIcon, Badge, Box, Group, NavLink, Stack, Title } from '@mantine/core';
/**
 * @module Project index
 *
 * The left index of a project without statecharts: its published spec kinds (when it has spec files), then every
 * domain and spec its tests were recorded against, with a tally each. Choosing a domain or a spec filters the explorer.
 */
import type { StatusCounts } from '@crvouga/atlas/reports/evidence-types';
import { Link } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { useEvidence } from '../evidence/evidence-context';
import { StatusMark } from '../evidence/marks';
import { SPEC_KINDS } from '../spec-kind';
import { useTestCatalog } from './catalog';
import { patched, useExplorerSearch } from './navigate';
import { values } from './search';
/** Domains start open when the index has at most this many specs. */
const OPEN_SPECS = 80;
function statusOf(counts: StatusCounts) {
  return counts.failed ? 'failed' : counts.running ? 'running' : counts.passed ? 'passed' : 'not-run';
}
/** A tally for an index row: failures in red, otherwise how many tests, quietly. */
function Tally({ counts, tests }: { counts: StatusCounts; tests: number }) {
  return (
    <Badge size="xs" color={counts.failed ? 'red' : counts.running ? 'blue' : counts.passed === tests ? 'green' : 'gray'}>
      {counts.failed
        ? `${counts.failed} failed`
        : counts.running
          ? 'Running'
          : counts.passed === tests
            ? `${tests} passed`
            : `${counts.passed}/${tests}`}
    </Badge>
  );
}
function add(a: StatusCounts, b: StatusCounts): StatusCounts {
  return {
    passed: a.passed + b.passed,
    failed: a.failed + b.failed,
    running: a.running + b.running,
    'not-run': a['not-run'] + b['not-run']
  };
}
/** The index beside the explorer. */
export function ProjectIndex() {
  const { files } = useEvidence();
  const { model } = useTestCatalog();
  const search = useExplorerSearch();
  const kinds = SPEC_KINDS.filter((kind) => files.some(kind.accepts));
  const domains = useMemo(() => {
    const byDomain = new Map<
      string,
      {
        specs: NonNullable<typeof model>['facets']['specs'][number][];
        counts: StatusCounts;
        tests: number;
      }
    >();
    for (const spec of model?.facets.specs ?? []) {
      const domain = spec.domain || '(no domain)';
      const entry = byDomain.get(domain) ?? { specs: [], counts: { passed: 0, failed: 0, running: 0, 'not-run': 0 }, tests: 0 };
      entry.specs.push(spec);
      entry.counts = add(entry.counts, spec.counts);
      entry.tests += spec.tests;
      byDomain.set(domain, entry);
    }
    return [...byDomain];
  }, [model]);
  const specCount = model?.facets.specs.length ?? 0;
  const chosenSpecs = values(search.spec);
  const chosenDomains = values(search.domain);
  const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(new Map());
  const isOpen = (
    domain: string,
    specs: readonly {
      path: string;
    }[]
  ) =>
    toggled.get(domain) ??
    (specCount <= OPEN_SPECS || chosenDomains.includes(domain) || specs.some((spec) => chosenSpecs.includes(spec.path)));
  const everything = !search.spec && !search.domain;
  return (
    <Box component="nav" aria-label="Project specs" p="md">
      <Stack gap="lg">
        {kinds.length > 0 && (
          <Stack gap="xs">
            <Title order={3} c="dimmed">
              Specs
            </Title>
            {kinds.map((kind) => (
              <NavLink
                key={kind.id}
                label={kind.label}
                leftSection={<SpecLogo kind={kind} />}
                renderRoot={(props) => <Link {...props} to="/specs/$kind" params={{ kind: kind.id }} search={{}} />}
              />
            ))}
          </Stack>
        )}
        {domains.length > 0 && (
          <Box component="section" aria-label="Tests by spec">
            <Title order={3} c="dimmed" mb="sm">
              Tests
            </Title>
            <NavLink
              label="All tests"
              active={everything}
              rightSection={model && <Tally counts={model.summary.counts} tests={model.summary.tests} />}
              aria-current={everything ? 'page' : undefined}
              renderRoot={(props) => (
                <Link
                  {...props}
                  to="/"
                  search={patched({ spec: undefined, domain: undefined, tab: undefined })}
                  resetScroll={false}
                  activeOptions={{ exact: true }}
                />
              )}
            />
            {domains.map(([domain, entry]) => {
              const open = isOpen(domain, entry.specs);
              const chosen = chosenDomains.length === 1 && chosenDomains[0] === domain && !search.spec;
              return (
                <Box key={domain} mt="sm">
                  <Group wrap="nowrap" gap={0}>
                    <ActionIcon
                      color="gray"
                      aria-expanded={open}
                      aria-label={`${open ? 'Collapse' : 'Expand'} ${domain}`}
                      onClick={() => setToggled(new Map(toggled).set(domain, !open))}
                    >
                      {open ? <IconChevronDown size={16} aria-hidden="true" /> : <IconChevronRight size={16} aria-hidden="true" />}
                    </ActionIcon>
                    <NavLink
                      flex={1}
                      label={domain}
                      active={chosen}
                      rightSection={<Tally counts={entry.counts} tests={entry.tests} />}
                      aria-current={chosen ? 'page' : undefined}
                      renderRoot={(props) => (
                        <Link
                          {...props}
                          to="/"
                          search={patched({ domain, spec: undefined, tab: undefined })}
                          resetScroll={false}
                          activeOptions={{ exact: true }}
                        />
                      )}
                    />
                  </Group>
                  {open && (
                    <Box pl="sm">
                      {entry.specs.map((spec) => {
                        const chosen = chosenSpecs.length === 1 && chosenSpecs[0] === spec.path;
                        return (
                          <NavLink
                            key={spec.path}
                            label={spec.title}
                            title={spec.path}
                            active={chosen}
                            leftSection={<StatusMark status={statusOf(spec.counts)} size={14} />}
                            rightSection={<Tally counts={spec.counts} tests={spec.tests} />}
                            aria-current={chosen ? 'page' : undefined}
                            renderRoot={(props) => (
                              <Link
                                {...props}
                                to="/"
                                search={patched({ spec: spec.path, domain: undefined, tab: undefined })}
                                resetScroll={false}
                                activeOptions={{ exact: true }}
                              />
                            )}
                          />
                        );
                      })}
                    </Box>
                  )}
                </Box>
              );
            })}
          </Box>
        )}
      </Stack>
    </Box>
  );
}
