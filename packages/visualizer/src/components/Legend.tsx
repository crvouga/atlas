import { Badge, Group } from '@mantine/core';
import { KindIcon } from './labels';
export function Legend({ showTime }: { showTime: boolean }) {
  return (
    <Group gap={6} role="group" aria-label="Legend">
      <Badge size="sm" variant="default" leftSection={<KindIcon kind="user" size={12} />}>
        User action
      </Badge>
      <Badge size="sm" variant="default" leftSection={<KindIcon kind="system" size={12} />}>
        System event
      </Badge>
      {showTime && (
        <Badge size="sm" variant="default" leftSection={<KindIcon kind="time" size={12} />}>
          Time passes
        </Badge>
      )}
      <Badge size="sm" variant="dot" color="gray.5">
        Not reached or not run
      </Badge>
      <Badge size="sm" variant="dot" color="green">
        Working
      </Badge>
      <Badge size="sm" variant="dot" color="orange">
        Unreliable
      </Badge>
      <Badge size="sm" variant="dot" color="red">
        Broken
      </Badge>
      <Badge size="sm" variant="dot" color="gray.5">
        Not checked
      </Badge>
    </Group>
  );
}
