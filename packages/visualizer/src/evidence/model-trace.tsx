import { Button, Code, List, Stack, Table, Text } from '@mantine/core';
import { useState } from 'react';
import type { ModelState } from './quint';
function shown(value: unknown) {
  if (value === undefined) return '—';
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}
/** The states a model run went through, one at a time, with what each step changed. */
export function ModelTrace({ states }: { states: readonly ModelState[] }) {
  const [selected, setSelected] = useState(0);
  if (!states.length)
    return (
      <Text component="div" c="dimmed">
        No model states were recorded.
      </Text>
    );
  const at = Math.min(selected, states.length - 1);
  const state = states[at]!;
  const previous = states[at - 1];
  const variables = [...new Set([...Object.keys(previous ?? {}), ...Object.keys(state)])].filter((name) => !name.startsWith('#'));
  const changed = (name: string) => previous !== undefined && JSON.stringify(previous[name]) !== JSON.stringify(state[name]);
  return (
    <Stack gap="sm" miw={0}>
      <List aria-label="Model trace states" spacing="xs" listStyleType="none" type="ordered">
        {states.map((entry, index) => (
          <List.Item key={index}>
            <Button
              type="button"
              aria-label={`State ${index + 1}`}
              aria-pressed={at === index}
              onClick={() => setSelected(index)}
              variant="light"
            >
              <Text span inherit>
                {index + 1}
              </Text>
              <Text span inherit>
                {typeof entry['#action'] === 'string' ? entry['#action'] : index === 0 ? 'Start' : 'Step'}
              </Text>
            </Button>
          </List.Item>
        ))}
      </List>
      <Table.ScrollContainer minWidth={600}>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th scope="col">Variable</Table.Th>
              <Table.Th scope="col">Before</Table.Th>
              <Table.Th scope="col">State {at + 1}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {variables.map((name) => (
              <Table.Tr key={name} data-changed={changed(name) || undefined}>
                <Table.Th scope="row">
                  {name}
                  {changed(name) && (
                    <Text span inherit>
                      Changed
                    </Text>
                  )}
                </Table.Th>
                <Table.Td>
                  <Code block>{previous ? shown(previous[name]) : '—'}</Code>
                </Table.Td>
                <Table.Td>
                  <Code block>{shown(state[name])}</Code>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Stack>
  );
}
