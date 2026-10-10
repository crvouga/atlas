import { AstBuilder, GherkinClassicTokenMatcher, Parser } from '@cucumber/gherkin';
import { IdGenerator } from '@cucumber/messages';
import { DecisionTables } from './decision-table';
import { useMemo } from 'react';

export function parseFeature(text: string) {
  return new Parser(new AstBuilder(IdGenerator.incrementing()), new GherkinClassicTokenMatcher()).parse(text);
}

/** Source outline only: declarations are not inferred execution transitions. */
export function quintOutline(text: string) {
  return text.split('\n').flatMap((line, index) => {
    const match = /^\s*(module|import|var|const|type|action|val|def|pure val|pure def)\s+([\w:]+)/.exec(line);
    return match ? [{ kind: match[1]!, name: match[2]!, line: index + 1 }] : [];
  });
}

export function SpecDocument({ path, text }: { path: string; text: string }) {
  const parsed = useMemo(() => {
    if (!path.endsWith('.feature')) return null;
    try { return { document: parseFeature(text), error: null }; }
    catch (error) { return { document: null, error: String(error) }; }
  }, [path, text]);
  const feature = parsed?.document?.feature;
  return <article>
    <h2>{feature?.name ?? path.split('/').at(-1)}</h2>
    <p>{path}</p>
    {parsed?.error && <p role="alert">This Gherkin document could not be parsed: {parsed.error}</p>}
    {feature && <><p>{feature.description}</p>{feature.children.map((child, i) => {
      const rule = child.rule;
      const scenarios = rule ? rule.children : [child];
      return <section key={i}>{rule && <><h3>{rule.keyword}: {rule.name}</h3><p>{rule.description}</p></>}
        {scenarios.map((entry, j) => {
          const scenario = entry.scenario ?? entry.background;
          return scenario && <section key={j}><h4>{scenario.keyword}: {scenario.name}</h4><p>{scenario.description}</p>
            <ol>{scenario.steps.map(step => <li key={step.id}><strong>{step.keyword}</strong>{step.text}
              {step.docString && <pre>{step.docString.content}</pre>}
              {step.dataTable && <table><tbody>{step.dataTable.rows.map(row => <tr key={row.id}>{row.cells.map((cell, k) => <td key={k}>{cell.value}</td>)}</tr>)}</tbody></table>}
            </li>)}</ol>
            {entry.scenario?.examples.map(example => <section key={example.id}><h5>{example.keyword}: {example.name}</h5><table><thead><tr>{example.tableHeader?.cells.map((cell, k) => <th key={k}>{cell.value}</th>)}</tr></thead><tbody>{example.tableBody.map(row => <tr key={row.id}>{row.cells.map((cell, k) => <td key={k}>{cell.value}</td>)}</tr>)}</tbody></table></section>)}
          </section>;
        })}</section>;
    })}</>}
    {path.endsWith('.dmn') && <DecisionTables text={text} />}
    {path.endsWith('.qnt') && <section><h3>Model outline</h3><p>Declarations in source order. Recorded traces and verification outcomes appear in Evidence.</p><ul>{quintOutline(text).map(item => <li key={item.line}><button onClick={() => document.getElementById(`source-${item.line}`)?.scrollIntoView({ block: 'center' })}>{item.kind} {item.name}</button></li>)}</ul></section>}
    <details open={!feature}><summary>Source document</summary><pre>{text.split('\n').map((line, i) => <span id={`source-${i + 1}`} key={i}>{line}{'\n'}</span>)}</pre></details>
  </article>;
}
