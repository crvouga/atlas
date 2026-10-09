import type { BusinessContract } from '@crvouga/atlas-schema';
import styles from './explorer.module.css';

export function RuleCards({ contracts, owner }: { contracts: BusinessContract[]; owner: string }) {
  if (!contracts.length) return null;
  return (
    <section className={styles.rules} aria-label={`Rules for ${owner}`}>
      <h3>Rules for this capability</h3>
      <p>From {owner}. These examples explain conditions and outcomes; exploring the model does not execute their checks.</p>
      {contracts.map((contract) => (
        <details key={contract.id} className={styles.rule}>
          <summary>{contract.name}</summary>
          {contract.description && <p>{contract.description}</p>}
          <ol>
            {contract.steps.map((step, index) => (
              <li key={index}>
                <strong>{step.keyword} </strong>{step.text}
                {step.table && <div className={styles.tableScroll}><table><tbody>{step.table.map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>)}</tbody></table></div>}
                {step.docString && <pre>{step.docString}</pre>}
              </li>
            ))}
          </ol>
          <small className={styles.ruleSource}>Source: {contract.source}</small>
        </details>
      ))}
    </section>
  );
}
