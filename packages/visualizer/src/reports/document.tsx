import { AstBuilder, GherkinClassicTokenMatcher, Parser } from '@cucumber/gherkin';
import { IdGenerator } from '@cucumber/messages';
import { useMemo } from 'react';

export function parseFeature(text: string) {
  return new Parser(new AstBuilder(IdGenerator.incrementing()), new GherkinClassicTokenMatcher()).parse(text);
}

/** A Gherkin feature, read as rules, scenarios, steps, and examples. */
export function SpecDocument({ path, text, heading = true }: { path: string; text: string; heading?: boolean }) {
  const parsed = useMemo(() => {
    if (!path.toLowerCase().endsWith('.feature')) return null;
    try { return { document: parseFeature(text), error: null }; }
    catch (error) { return { document: null, error: String(error) }; }
  }, [path, text]);
  const feature = parsed?.document?.feature;
  return <article>
    {heading && <h1 className="plate-title">{feature?.name ?? path.split('/').at(-1)}</h1>}
    {parsed?.error && <p role="alert">This Gherkin document could not be parsed: {parsed.error}</p>}
    {feature?.description && <p className="gherkin-description">{feature.description}</p>}
    {feature && feature.children.map((child, i) => {
      const rule = child.rule;
      const scenarios = rule ? rule.children : [child];
      return <section key={i} className="gherkin-rule">{rule && <><h2>{rule.keyword}: {rule.name}</h2>{rule.description && <p>{rule.description}</p>}</>}
        {scenarios.map((entry, j) => {
          const scenario = entry.scenario ?? entry.background;
          return scenario && <section key={j} className="gherkin-scenario"><h3>{scenario.keyword}: {scenario.name}</h3>{scenario.description && <p>{scenario.description}</p>}
            <ol className="gherkin-steps">{scenario.steps.map(step => <li key={step.id}><strong className="gherkin-keyword">{step.keyword}</strong>{step.text}
              {step.docString && <pre>{step.docString.content}</pre>}
              {step.dataTable && <table className="gherkin-examples"><tbody>{step.dataTable.rows.map(row => <tr key={row.id}>{row.cells.map((cell, k) => <td key={k}>{cell.value}</td>)}</tr>)}</tbody></table>}
            </li>)}</ol>
            {entry.scenario?.examples.map(example => <section key={example.id}><h4>{example.keyword}: {example.name}</h4><table className="gherkin-examples"><thead><tr>{example.tableHeader?.cells.map((cell, k) => <th key={k}>{cell.value}</th>)}</tr></thead><tbody>{example.tableBody.map(row => <tr key={row.id}>{row.cells.map((cell, k) => <td key={k}>{cell.value}</td>)}</tr>)}</tbody></table></section>)}
          </section>;
        })}</section>;
    })}
    <details open={!feature}><summary>Feature source</summary><pre>{text}</pre></details>
  </article>;
}
