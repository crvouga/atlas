import { SpecLogo } from '../components/SpecLogo';
import type { SpecEvidence } from '@crvouga/atlas/reports/evidence-view';
import { NO_EVIDENCE } from '@crvouga/atlas/reports/evidence-view';
import { Card, Group, Stack, Text } from '@mantine/core';
import type { ReactNode } from 'react';
import { PageHeader } from '../components/Page';
import type { SpecKind } from '../spec-kind';
import { useEvidence } from './evidence-context';
import { useNow } from './format';
import { EvidenceIncomplete, EvidenceWaiting } from './load-state';
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
  const { backends, ready, unavailable, pending, failed } = useEvidence();
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
    <Card component="header">
      <PageHeader
        eyebrow={
          <Text component="div" size="xs" c="dimmed" ff="monospace" truncate>
            specs/{file}
          </Text>
        }
        mark={<SpecLogo kind={kind} />}
        title={title}
        description={children}
      >
        <Stack gap="xs" miw={0}>
          <Meter counts={summary.counts} missing={missing} />
          <Group gap="xs" justify="space-between" align="center" wrap="wrap">
            <Group gap="xs" align="center" wrap="wrap">
              {unavailable ? (
                <Text span>Recorded results are unavailable.</Text>
              ) : !ready || (summary.status === 'none' && pending > 0) ? (
                <EvidenceWaiting usable={`The ${kind.one} below is readable.`} />
              ) : summary.status === 'none' ? (
                <Text span c="dimmed">
                  {failed.length > 0
                    ? `No completed test report for this ${kind.one} in the layers that could be read.`
                    : `No completed test report for this ${kind.one} yet.`}
                </Text>
              ) : (
                <>
                  <CountLine summary={summary} noun={kind.check} nouns={`${kind.check}s`} />
                  {missing > 0 && (
                    <Text span c="dimmed">
                      {missing} without a result
                    </Text>
                  )}
                </>
              )}
            </Group>
            {newest && (
              <Group gap={6} align="center" wrap="wrap" c="dimmed" fz="xs">
                Latest from <Origin layer={newest.layer} backends={backends} now={now} />
              </Group>
            )}
          </Group>
          {ready && <EvidenceIncomplete />}
        </Stack>
      </PageHeader>
    </Card>
  );
}
