import YAML from 'yaml';

import type { IssueSink } from './issues';

function plainYamlMessage(message: string) {
  const first = message.split('\n')[0] ?? message;
  return first
    .replace(/^[A-Z_]+:\s*/, '')
    .replace(/ at line \d+, column \d+:?$/, '')
    .replace(/^Nested mappings are not allowed in compact mappings/, 'A line has a colon where the file expected plain text')
    .replace(/^Implicit keys need to be on a single line/, 'A name runs over more than one line')
    .replace(/^Map keys must be unique/, 'The same name appears twice at this level');
}

/**
 * YAML or JSON text to plain data. YAML syntax errors are reported with their line, and whatever
 * the parser could still read is returned, so one bad line doesn't hide a whole chart.
 */
export function readStructured(file: string, text: string, sink: IssueSink): unknown {
  if (file.endsWith('.json')) {
    try {
      return JSON.parse(text) as unknown;
    } catch (error) {
      const detail = error instanceof Error ? error.message.replace(/^JSON\.parse: /, '') : '';
      sink.add('error', file, [], `This file is not valid JSON, so it was skipped. ${detail}`.trim());
      return undefined;
    }
  }
  const doc = YAML.parseDocument(text, { uniqueKeys: true, prettyErrors: true });
  for (const error of doc.errors) {
    const line = error.linePos?.[0]?.line;
    sink.add('error', file, line ? [`line ${line}`] : [], `${plainYamlMessage(error.message)}. The rest of the file was still read.`);
  }
  for (const warning of doc.warnings) {
    const line = warning.linePos?.[0]?.line;
    sink.add('info', file, line ? [`line ${line}`] : [], plainYamlMessage(warning.message));
  }
  try {
    return doc.toJS({ maxAliasCount: 10_000 }) as unknown;
  } catch (error) {
    sink.add('error', file, [], `This file could not be read: ${error instanceof Error ? error.message : 'unknown problem'}.`);
    return undefined;
  }
}
