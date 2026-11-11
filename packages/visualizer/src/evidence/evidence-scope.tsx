import { scopeBadges, scopeCaveats, scopeFacts, type ScopeBasis } from '@crvouga/atlas/reports/evidence-scope';
import type { EvidenceScope } from '@crvouga/atlas/schema';
import { Anchor, Badge, Button, Card, Collapse, Group, List, Stack, Table, Text } from '@mantine/core';
import { IconChevronDown, IconChevronUp } from '@tabler/icons-react';
import { createContext, useContext, useId, useState, type ReactNode } from 'react';
import { safeUri } from './format';

/** The scope declared by the nearest holder around an attachment: its attempt, its check, or the run. */
const Around = createContext<EvidenceScope | undefined>(undefined);

/**
 * Makes `scope` the one that applies to the attachments inside, unless it is undefined, in which case the scope
 * declared further out still applies. The nearest declaration wins as a whole and is never mixed with another.
 */
export function ScopeProvider({ scope, children }: { scope: EvidenceScope | undefined; children: ReactNode }) {
  const outer = useContext(Around);
  return <Around.Provider value={scope ?? outer}>{children}</Around.Provider>;
}

/** The scope in effect here, undefined when none was declared. */
export function useScope(): EvidenceScope | undefined {
  return useContext(Around);
}

const BASIS_WORD: Record<ScopeBasis, string> = { verified: 'Verified', declared: 'Declared', undeclared: 'Not declared' };

/**
 * What a recording does and does not show, in the producer's declaration: concise badges that are visible before it
 * is played, and the exact declaration, caveats and provenance on demand. A recording that declared nothing says its
 * scope is unknown. `scope` is the declaration that applies to this one source (see `effectiveScope`).
 */
export function ScopeNotice({ scope, name }: { scope: EvidenceScope | undefined; name: string }) {
  const badges = scopeBadges(scope);
  const unknown = badges[0]?.dimension === 'unknown';
  const links = (scope?.provenance ?? []).flatMap((link) => {
    const url = safeUri(link.url);
    return url ? [{ url, label: link.name ?? link.rel ?? link.url }] : [];
  });
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const Chevron = open ? IconChevronUp : IconChevronDown;
  return (
    <Stack gap="xs" aria-label={`Evidence scope of ${name}`} data-scope={unknown ? 'unknown' : 'declared'} mb="xs">
      <Group gap="xs" justify="space-between" wrap="wrap">
        <Group gap={6} role="list" aria-label="Scope badges">
          {badges.map((badge) => (
            <Badge
              key={badge.text}
              role="listitem"
              variant={badge.basis === 'verified' ? 'filled' : 'light'}
              color={unknown ? 'gray' : undefined}
              tt="none"
              data-basis={badge.basis}
            >
              {badge.text}
              {badge.basis === 'verified' ? ' (verified)' : ''}
            </Badge>
          ))}
        </Group>
        <Button type="button" variant="subtle" size="compact-xs" aria-expanded={open} aria-controls={detailsId} onClick={() => setOpen(!open)} rightSection={<Chevron size={14} aria-hidden="true" />}>
          Scope details
        </Button>
      </Group>
      <Collapse expanded={open} id={detailsId} keepMountedMode="display-none">
        <Card padding="md" shadow="none">
          <Stack gap="sm">
            <Table.ScrollContainer minWidth={280}>
              <Table aria-label="Declared scope">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Dimension</Table.Th>
                    <Table.Th>Value</Table.Th>
                    <Table.Th>Basis</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {scopeFacts(scope).map((fact) => (
                    <Table.Tr key={fact.dimension}>
                      <Table.Td>{fact.label}</Table.Td>
                      <Table.Td>{fact.value}</Table.Td>
                      <Table.Td>{BASIS_WORD[fact.basis]}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
            <Text component="div">
              {unknown ? 'The producer declared no scope for this recording. ' : scope?.declaredBy ? `Declared by ${scope.declaredBy}. ` : 'The producer declared this; Atlas did not check it. '}
              {scope?.verified?.length ? `Verified by ${scope.verifiedBy ?? 'something independent of the producer'}: ${scope.verified.join(', ')}.` : ''}
            </Text>
            <List aria-label="What this does not show" spacing="xs" size="sm">
              {scopeCaveats(scope).map((caveat) => (
                <List.Item key={caveat}>{caveat}</List.Item>
              ))}
            </List>
            {links.length > 0 && (
              <List aria-label="Provenance" spacing="xs" size="sm">
                {links.map((link) => (
                  <List.Item key={link.url}>
                    <Anchor href={link.url} target="_blank" rel="noreferrer">
                      {link.label}
                    </Anchor>
                  </List.Item>
                ))}
              </List>
            )}
          </Stack>
        </Card>
      </Collapse>
    </Stack>
  );
}
