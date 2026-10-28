import { IconCheck, IconX, IconCircle } from '@tabler/icons-react';
import type { BackendInfo, LayerHeader, StatusCounts } from '@crvouga/atlas/reports/evidence-types';
import type { SpecStatus, SpecSummary } from '@crvouga/atlas/reports/evidence-view';
import { environmentLabel } from '@crvouga/atlas/reports/layer-axes';
import { Badge, Box, Button, Flex, List, Loader, Progress, Text, ThemeIcon } from '@mantine/core';
import { useState, type ReactNode } from 'react';
import { statusColor } from '../ui/theme';
import { ago, exactTime, plural, shortSha, statusWord } from './format';
/** A named outcome mark; color is always accompanied by a distinct symbol and accessible text. */
export function StatusMark({ status, size = 16 }: { status: SpecStatus; size?: number }) {
  if (status === 'running') return <Loader size={size} role="img" aria-label={statusWord(status)} />;
  return (
    <ThemeIcon
      size={size}
      radius="xl"
      variant={status === 'none' ? 'outline' : 'light'}
      color={statusColor(status)}
      role="img"
      aria-label={statusWord(status)}
    >
      {status === 'passed' ? (
        <IconCheck size={size} aria-hidden="true" />
      ) : status === 'failed' ? (
        <IconX size={size} aria-hidden="true" />
      ) : (
        <IconCircle size={size} aria-hidden="true" />
      )}
    </ThemeIcon>
  );
}
/** An index row's outcome, with the exact recorded count. */
export function Tally({ summary }: { summary: SpecSummary }) {
  const label =
    summary.status === 'none'
      ? 'No results'
      : summary.counts.failed
        ? `${summary.counts.failed} failed`
        : summary.counts.running
          ? 'Running'
          : !summary.counts.passed
            ? 'Not run'
            : summary.counts.passed === summary.total
              ? `${summary.total} passed`
              : `${summary.counts.passed}/${summary.total}`;
  return (
    <Badge color={statusColor(summary.status)} size="sm">
      {label}
    </Badge>
  );
}
const SEGMENTS = ['failed', 'running', 'passed', 'not-run'] as const;
/** Recorded outcome proportions. Missing evidence remains an unfilled gray segment. */
export function Meter({ counts, missing = 0 }: { counts: StatusCounts; missing?: number }) {
  const total = SEGMENTS.reduce((sum, status) => sum + counts[status], 0) + missing;
  return (
    <Progress.Root size="sm" w="100%" miw="4rem" aria-hidden="true">
      {total > 0 &&
        SEGMENTS.map(
          (status) =>
            counts[status] > 0 && <Progress.Section key={status} value={(counts[status] / total) * 100} color={statusColor(status)} />
        )}
      {total > 0 && missing > 0 && <Progress.Section value={(missing / total) * 100} color="gray.3" />}
    </Progress.Root>
  );
}
export function CountLine({ summary, noun, nouns }: { summary: SpecSummary; noun: string; nouns: string }) {
  if (summary.status === 'none') return <Text span>No {nouns} recorded yet</Text>;
  return (
    <Flex component="span" display="inline-flex" wrap="wrap" gap="xs">
      <Text span>{plural(summary.total, noun, nouns)}</Text>
      {SEGMENTS.map(
        (status) =>
          summary.counts[status] > 0 && (
            <Text span key={status} c={statusColor(status)}>
              {summary.counts[status]} {status === 'not-run' ? 'not run' : status}
            </Text>
          )
      )}
    </Flex>
  );
}
export function backendLabel(backends: readonly BackendInfo[], id: string) {
  return backends.find((backend) => backend.id === id)?.label ?? id;
}
/**
 * Recording completeness of a layer, apart from its test outcomes: how many expected videos were published. A layer
 * that declared no expectations returns null (its completeness is unknown, so nothing is claimed).
 */
export function recordingLabel(layer: Pick<LayerHeader, 'recordings'>): { text: string; incomplete: boolean } | null {
  const recordings = layer.recordings;
  if (!recordings || recordings.expected === 0) return null;
  const published = recordings.uploaded + recordings.referenced;
  return { text: `Recordings ${published} of ${recordings.expected}`, incomplete: recordings.skipped + recordings.unresolved > 0 };
}
/** A result's provenance; incomplete origin data is stated explicitly. */
export function Origin({ layer, backends, now }: { layer: LayerHeader; backends: readonly BackendInfo[]; now: number }) {
  const sha = shortSha(layer.sha);
  const recording = recordingLabel(layer);
  return (
    <Flex component="span" display="inline-flex" wrap="wrap" gap="xs" align="center" c="dimmed" fz="xs">
      {layer.live && <Badge size="sm">Running now</Badge>}
      {recording && (
        <Badge size="sm" variant="light" color={recording.incomplete ? 'orange' : 'gray'} title={recording.incomplete ? 'Some expected recordings were not published. The test outcomes are unaffected.' : 'Every expected recording was published.'}>
          {recording.incomplete ? `${recording.text}: incomplete` : recording.text}
        </Badge>
      )}
      <Text span inherit>
        {backendLabel(backends, layer.backend)}
      </Text>
      {layer.branch && (
        <Text span inherit>
          {layer.branch}
        </Text>
      )}
      {layer.environment && (
        <Text span inherit>
          {environmentLabel(layer.environment)}
        </Text>
      )}
      {sha && <Box component="code">{sha}</Box>}
      {layer.freshness === 'modified' && (
        <Text span inherit>
          with local changes
        </Text>
      )}
      {layer.freshness === 'unknown' && (
        <Text span inherit>
          origin not captured
        </Text>
      )}
      {!layer.live && (
        <time dateTime={new Date(layer.recordedAtMs).toISOString()} title={exactTime(layer.recordedAtMs)}>
          {ago(layer.recordedAtMs, now)}
        </time>
      )}
      {Object.entries(layer.parameters).map(([name, value]) => (
        <Text span inherit key={name}>
          {name}: {value}
        </Text>
      ))}
    </Flex>
  );
}
/** Bound long report lists without losing access to earlier evidence. */
export function Bounded<T>({
  items,
  size,
  more,
  children
}: {
  items: readonly T[];
  size: number;
  more: string;
  children: (item: T, index: number) => ReactNode;
}) {
  const [shown, setShown] = useState(size);
  return (
    <>
      {items.slice(0, shown).map(children)}
      {items.length > shown && (
        <List.Item>
          <Button variant="subtle" onClick={() => setShown(shown + size)}>
            {more} ({items.length - shown} more)
          </Button>
        </List.Item>
      )}
    </>
  );
}
