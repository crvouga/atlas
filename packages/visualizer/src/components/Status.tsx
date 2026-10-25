import { Badge, Box, Progress, Stack, Text } from '@mantine/core';
import { ITEM_STATUSES, STATUS_LABEL, type ItemStatus, type StatusCounts } from '../data/model';
import { statusColor } from '../ui/theme';
export function StatusDot({ status }: { status: ItemStatus }) {
  return <Box component="span" display="inline-block" w="0.5rem" h="0.5rem" bg={`${statusColor(status)}.6`} bdrs="xl" aria-hidden="true" />;
}
export function StatusBadge({ status, label }: { status: ItemStatus; label?: string }) {
  return (
    <Badge color={statusColor(status)} leftSection={<StatusDot status={status} />}>
      {label ?? STATUS_LABEL[status]}
    </Badge>
  );
}
const BAR_ORDER: ItemStatus[] = ['passed', 'flaky', 'failed', 'not-reached', 'not-yet-run', 'spec-only'];
function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}
/** The same outcome proportions and accessible description wherever a chart is summarized. */
export function SummaryBar({ noun, nounPlural, counts, verb }: { noun: string; nounPlural: string; counts: StatusCounts; verb: string }) {
  const unrun = counts['spec-only'] === counts.total;
  const description = unrun
    ? `${plural(counts.total, noun, nounPlural)}, not yet run`
    : `${counts.passed} of ${counts.total} ${nounPlural} ${verb}` +
      (counts.failed ? `, ${counts.failed} broken` : '') +
      (counts.flaky ? `, ${counts.flaky} unreliable` : '') +
      (counts['not-reached'] ? `, ${counts['not-reached']} not reached` : '') +
      (counts['not-yet-run'] ? `, ${counts['not-yet-run']} not in this run` : '');
  return (
    <Stack gap="xs">
      <Text size="xs">
        {unrun
          ? `${plural(counts.total, noun, nounPlural)} · not yet run`
          : `${nounPlural[0]!.toUpperCase() + nounPlural.slice(1)} ${counts.passed + counts.flaky}/${counts.total} ${verb}`}
      </Text>
      <Progress.Root size="sm" role="img" aria-label={description}>
        {BAR_ORDER.map(
          (status) =>
            counts[status] > 0 && (
              <Progress.Section key={status} value={counts.total ? (counts[status] / counts.total) * 100 : 0} color={statusColor(status)} />
            )
        )}
      </Progress.Root>
    </Stack>
  );
}
export { ITEM_STATUSES };
