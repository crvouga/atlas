import { Badge, Group } from '@mantine/core';
import { KindIcon } from './labels';
export function Legend({ showTime }: { showTime: boolean }) {
  return (
    <Group gap="xs" role="group" aria-label="Legend">
      <Badge leftSection={<KindIcon kind="user" size={12} />}>User action</Badge>
      <Badge color="gray" leftSection={<KindIcon kind="system" size={12} />}>
        System event
      </Badge>
      {showTime && (
        <Badge color="gray" leftSection={<KindIcon kind="time" size={12} />}>
          Time passes
        </Badge>
      )}
      <Badge color="gray">Not reached or not run</Badge>
      <Badge color="green">Working</Badge>
      <Badge color="orange">Unreliable</Badge>
      <Badge color="red">Broken</Badge>
      <Badge color="gray">Not checked</Badge>
    </Group>
  );
}
