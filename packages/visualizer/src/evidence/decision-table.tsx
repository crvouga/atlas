import { XMLParser, XMLValidator } from 'fast-xml-parser';

import styles from './evidence.module.css';

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
    columns: [...array(table.input), ...array(table.output)].map((column) => String(column['@_label'] ?? column['@_name'] ?? (column.inputExpression as Xml | undefined)?.text ?? 'Condition')),
    rows: array(table.rule).map((rule) => [...array(rule.inputEntry), ...array(rule.outputEntry)].map((entry) => String(entry.text ?? '')))
  }));
}

/** Each decision as its conditions and the outcomes they lead to, side by side. */
export function DecisionTables({ text }: { text: string }) {
  let tables: ReturnType<typeof decisionTables>;
  try {
    tables = decisionTables(text);
  } catch (error) {
    return <p role="alert" className={styles.notice}>This decision table could not be read: {error instanceof Error ? error.message : String(error)}</p>;
  }
  return (
    <>
      {tables.map((table) => (
        <section key={table.id} className={styles.block}>
          <h2 className={styles.blockTitle}>
            {table.id} <span className={styles.aside}>Hit policy {table.policy.toLowerCase()}</span>
          </h2>
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  {table.columns.map((column, index) => (
                    <th key={index} scope="col" data-output={index >= table.inputs || undefined}>{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, index) => (
                  <tr key={index}>
                    {row.map((cell, at) => (
                      <td key={at} data-output={at >= table.inputs || undefined}>{cell || '—'}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </>
  );
}
