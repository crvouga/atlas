import type { CheckSlot } from '@crvouga/atlas/reports/evidence-view';
import { Button, Group, Text } from '@mantine/core';
import { useUiStore } from '../state/ui-store';
/** Filter actual test rows as well as the spec index. Counts always describe the whole document. */
export function TestFilter({ slots }: { slots: readonly CheckSlot[] }) {
  const filter = useUiStore((s) => s.resultFilter);
  const setFilter = useUiStore((s) => s.setResultFilter);
  const running = slots.filter((slot) => slot.status === 'running').length;
  return (
    <>
      <Group role="group" aria-label="Test status" gap="sm" my="md">
        <Button
          type="button"
          aria-pressed={filter !== 'running'}
          onClick={() => setFilter('all')}
          variant={filter !== 'running' ? 'light' : 'subtle'}
        >
          All tests{' '}
          <Text span inherit>
            {slots.length}
          </Text>
        </Button>
        <Button
          type="button"
          aria-pressed={filter === 'running'}
          onClick={() => setFilter('running')}
          variant={filter === 'running' ? 'light' : 'subtle'}
        >
          Running{' '}
          <Text span inherit>
            {running}
          </Text>
        </Button>
      </Group>
      {filter === 'running' && running === 0 && (
        <Text role="status" component="div" c="dimmed">
          No running tests.
        </Text>
      )}
    </>
  );
}
export function useRunningFilter() {
  return useUiStore((s) => s.resultFilter === 'running');
}
