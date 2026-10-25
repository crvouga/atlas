import { SpecLogo } from '../components/SpecLogo';
import type { SpecEvidence } from '@crvouga/atlas/reports/evidence-view';
import { NO_EVIDENCE } from '@crvouga/atlas/reports/evidence-view';
import { Box, Flex, Group, Stack, Text, Title } from '@mantine/core';
import type { ReactNode } from 'react';
import type { SpecKind } from '../spec-kind';
import { useEvidence } from './evidence-context';
import { useNow } from './format';
import { CountLine, Meter, Origin } from './marks';
/** A spec's name, where it lives, and what the combined report holds for it. */
export function SpecHeader({
  title,
  file,
  kind,
  entry,
  planned,
  children
}: {
  title: string;
  file: string;
  kind: SpecKind;
  entry: SpecEvidence | undefined;
  planned?: number;
  children?: ReactNode;
}) {
  const { backends, ready, unavailable, pending } = useEvidence();
  const now = useNow();
  const summary = entry?.summary ?? NO_EVIDENCE;
  const newest = entry?.slots
    .flatMap((slot) => slot.outcomes)
    .reduce<(typeof entry.slots)[number]['outcomes'][number] | null>(
      (best, result) => (!best || result.layer.recordedAtMs > best.layer.recordedAtMs ? result : best),
      null
    );
  const missing = planned === undefined ? 0 : Math.max(0, planned - summary.total);
  return (
    <Box component="header" mb="lg">
      <Text component="div" c="dimmed">
        specs/{file}
      </Text>
      <Group gap="sm" mb="sm" wrap="nowrap">
        <SpecLogo kind={kind} />
        <Title order={1}>{title}</Title>
      </Group>
      {children}
      <Stack gap="sm" miw={0}>
        <Meter counts={summary.counts} missing={missing} />
        <Flex gap="xs" align="center" wrap="wrap">
          {unavailable ? (
            <Text span inherit>
              Recorded results are unavailable.
            </Text>
          ) : !ready ? (
            <Text role="status" span inherit>
              Loading recorded results…
            </Text>
          ) : summary.status === 'none' ? (
            <Text span inherit>
              {pending > 0 ? 'Loading recorded results…' : `No completed test report for this ${kind.one} yet.`}
            </Text>
          ) : (
            <>
              <CountLine summary={summary} noun={kind.check} nouns={`${kind.check}s`} />
              {missing > 0 && (
                <Text span inherit>
                  {missing} without a result
                </Text>
              )}
            </>
          )}
        </Flex>
        {newest && (
          <Flex gap="xs" align="center" wrap="wrap" c="dimmed">
            Latest from <Origin layer={newest.layer} backends={backends} now={now} />
          </Flex>
        )}
      </Stack>
    </Box>
  );
}
