import { Alert, Box, Table, Text, Title } from '@mantine/core';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
type Xml = Record<string, unknown>;
const array = (value: unknown): Xml[] => (Array.isArray(value) ? value : value ? [value] : []) as Xml[];
export function decisionTables(text: string) {
  if (XMLValidator.validate(text) !== true) throw new Error('Invalid decision-table XML');
  const doc = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false }).parse(text) as Xml;
  const tables: Xml[] = [];
  function collect(node: unknown) {
    if (!node || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (key === 'decisionTable') tables.push(...array(value));
      else collect(value);
    }
  }
  collect(doc);
  return tables.map((table) => ({
    id: String(table['@_id'] ?? 'Decision table'),
    policy: String(table['@_hitPolicy'] ?? 'UNIQUE'),
    inputs: array(table.input).length,
    columns: [...array(table.input), ...array(table.output)].map((column) =>
      String(column['@_label'] ?? column['@_name'] ?? (column.inputExpression as Xml | undefined)?.text ?? 'Condition')
    ),
    rows: array(table.rule).map((rule) => [...array(rule.inputEntry), ...array(rule.outputEntry)].map((entry) => String(entry.text ?? '')))
  }));
}
/** Each decision as its conditions and the outcomes they lead to, side by side. */
export function DecisionTables({ text }: { text: string }) {
  let tables: ReturnType<typeof decisionTables>;
  try {
    tables = decisionTables(text);
  } catch (error) {
    return (
      <Alert role="alert" color={'red'} my="sm">
        This decision table could not be read: {error instanceof Error ? error.message : String(error)}
      </Alert>
    );
  }
  return (
    <>
      {tables.map((table) => (
        <Box key={table.id} component="section" mb="lg">
          <Title order={2} mb="sm">
            {table.id}{' '}
            <Text span inherit c="dimmed">
              Hit policy {table.policy.toLowerCase()}
            </Text>
          </Title>
          <Table.ScrollContainer minWidth={600}>
            <Table>
              <Table.Thead>
                <Table.Tr>
                  {table.columns.map((column, index) => (
                    <Table.Th key={index} scope="col" data-output={index >= table.inputs || undefined}>
                      {column}
                    </Table.Th>
                  ))}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {table.rows.map((row, index) => (
                  <Table.Tr key={index}>
                    {row.map((cell, at) => (
                      <Table.Td key={at} data-output={at >= table.inputs || undefined}>
                        {cell || '—'}
                      </Table.Td>
                    ))}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        </Box>
      ))}
    </>
  );
}
