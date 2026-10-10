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
      if (key === 'decisionTable') tables.push(...array(value)); else collect(value);
    }
  }
  collect(doc);
  return tables.map(table => ({
    id: String(table['@_id'] ?? 'Decision table'),
    policy: String(table['@_hitPolicy'] ?? 'UNIQUE'),
    columns: [...array(table.input), ...array(table.output)].map(column => String(column['@_label'] ?? column['@_name'] ?? (column.inputExpression as Xml | undefined)?.text ?? 'Condition')),
    rows: array(table.rule).map(rule => [...array(rule.inputEntry), ...array(rule.outputEntry)].map(entry => String(entry.text ?? '')))
  }));
}
export function DecisionTables({ text }: { text: string }) {
  try {
    return <>{decisionTables(text).map(table => <section key={table.id}><h3>{table.id}</h3><p>Hit policy: {table.policy}</p><table><thead><tr>{table.columns.map((column, index) => <th key={index}>{column}</th>)}</tr></thead><tbody>{table.rows.map((row, index) => <tr key={index}>{row.map((cell, at) => <td key={at}>{cell}</td>)}</tr>)}</tbody></table></section>)}</>;
  } catch (error) { return <p role="alert">{String(error)}</p>; }
}
