import { useMemo } from 'react';

const ORDER = ['module', 'import', 'type', 'const', 'var', 'action', 'val', 'pure val', 'def', 'pure def'] as const;

const GROUP_LABEL: Record<string, string> = {
  module: 'Modules',
  import: 'Imports',
  type: 'Types',
  const: 'Constants',
  var: 'State',
  action: 'Actions',
  val: 'Values',
  'pure val': 'Pure values',
  def: 'Definitions',
  'pure def': 'Pure definitions',
};

/** Declarations in source order. The rest of a line is the declaration, not an execution trace. */
export function quintOutline(text: string) {
  return text.split('\n').flatMap((line, index) => {
    const match = /^\s*(module|import|var|const|type|action|val|def|pure val|pure def)\s+([\w:]+)/.exec(line);
    return match ? [{ kind: match[1]!, name: match[2]!, line: index + 1, text: line.trim() }] : [];
  });
}

export function QuintDocument({ path, text, heading = true }: { path: string; text: string; heading?: boolean }) {
  const items = useMemo(() => quintOutline(text), [text]);
  const moduleName = items.find((item) => item.kind === 'module')?.name;
  return <article>
    {heading && <h1 className="plate-title">{moduleName ?? path.split('/').at(-1)}</h1>}
    {ORDER.map((kind) => {
      const group = items.filter((item) => item.kind === kind);
      if (!group.length) return null;
      return <section key={kind} className="quint-group">
        <h2>{GROUP_LABEL[kind]}</h2>
        <ul className="quint-list">{group.map((item) => <li key={item.line}>
          <button type="button" onClick={() => document.getElementById(`quint-line-${item.line}`)?.scrollIntoView({ block: 'center' })}>{item.text}</button>
        </li>)}</ul>
      </section>;
    })}
    <h2 className="quint-source-heading">Module source</h2>
    <pre className="quint-source">{text.split('\n').map((line, index) => <span id={`quint-line-${index + 1}`} key={index}>{line}{'\n'}</span>)}</pre>
  </article>;
}
