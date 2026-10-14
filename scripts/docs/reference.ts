/**
 * @module API reference from doc comments
 *
 * Renders the doc comments of a library package's source into Markdown: for each module its `@module` description and
 * its public import path, and for each exported declaration its signature and its comment (summary, parameters,
 * `@example`, `@see`). The source is the only place this text is written, so the reference cannot drift from the code;
 * `bun run docs` regenerates it and a test fails when it is stale.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as ts from 'typescript';

import { REPO, sourceFiles } from './coverage';

type Exports = Readonly<Record<string, string>>;

/** The package's `exports` map, source form: import path (`@crvouga/atlas/reports/*`) to source path. */
function exportsMap(): Exports {
  const pkg = JSON.parse(readFileSync(path.join(REPO, 'package.json'), 'utf8')) as { name: string; exports: Record<string, string> };
  return Object.fromEntries(Object.entries(pkg.exports).map(([subpath, target]) => [path.posix.join(pkg.name, subpath), target.replace(/^\.\//, '')]));
}

/** The import specifiers under which a source file can be imported (`@crvouga/atlas/reports/compose`), from the exports map. */
function importPaths(relative: string, map: Exports): string[] {
  const found: string[] = [];
  for (const [specifier, target] of Object.entries(map)) {
    if (!target.includes('*')) { if (target === relative) found.push(specifier); continue; }
    const [before, after] = target.split('*') as [string, string];
    if (relative.startsWith(before) && relative.endsWith(after)) found.push(specifier.replace('*', relative.slice(before.length, relative.length - after.length)));
  }
  return found.filter(specifier => !specifier.includes('*'));
}

/** The comment of a node as Markdown: summary, then tags (`@param`, `@returns`, `@throws`, `@example`, `@see`). */
function commentOf(node: ts.Node): string {
  const docs = (node as { jsDoc?: ts.JSDoc[] }).jsDoc;
  const doc = docs?.at(-1);
  if (!doc) return '';
  const parts: string[] = [];
  const summary = ts.getTextOfJSDocComment(doc.comment)?.trim();
  if (summary) parts.push(summary);
  for (const tag of doc.tags ?? []) {
    const text = ts.getTextOfJSDocComment(tag.comment)?.trim() ?? '';
    const name = tag.tagName.text;
    if (name === 'example') parts.push(`**Example**\n\n${/^```/.test(text) ? text : `\`\`\`ts\n${text}\n\`\`\``}`);
    else if (name === 'param' && ts.isJSDocParameterTag(tag)) parts.push(`- \`${tag.name.getText()}\`${text ? `: ${text.replace(/^-\s*/, '')}` : ''}`);
    else if (name === 'returns' || name === 'return') parts.push(`**Returns** ${text}`);
    else if (name === 'throws') parts.push(`**Throws** ${text}`);
    else if (name === 'see') parts.push(`See ${text}`);
    else if (name === 'deprecated') parts.push(`**Deprecated** ${text}`);
  }
  return parts.join('\n\n');
}

const MAX_TYPE_LINES = 40;

/** The declaration as it is written, without a function's body or a long initializer. */
function signatureOf(node: ts.Node, source: ts.SourceFile): string {
  const text = (from: number, to: number) => source.text.slice(from, to).replace(/\s+$/, '');
  let out: string;
  if (ts.isFunctionDeclaration(node)) out = text(node.getStart(source), node.body ? node.body.getStart(source) : node.end);
  else if (ts.isVariableStatement(node)) {
    const declaration = node.declarationList.declarations[0]!;
    const head = text(node.getStart(source), declaration.initializer ? declaration.initializer.getStart(source) : node.end).replace(/\s*=\s*$/, '');
    out = declaration.type || !declaration.initializer ? head : `${head} = …`;
  } else if (ts.isClassDeclaration(node)) out = text(node.getStart(source), node.members.length ? node.members[0]!.getFullStart() : node.end).replace(/\{\s*$/, '').trim();
  else out = text(node.getStart(source), node.end);
  const lines = out.split('\n');
  return lines.length > MAX_TYPE_LINES ? `${lines.slice(0, MAX_TYPE_LINES).join('\n')}\n  …` : out;
}

const isExported = (node: ts.Node) => ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword);
const isHidden = (member: ts.ClassElement) => (ts.canHaveModifiers(member) && (ts.getModifiers(member) ?? []).some(modifier => modifier.kind === ts.SyntaxKind.PrivateKeyword || modifier.kind === ts.SyntaxKind.ProtectedKeyword)) || (member.name !== undefined && ts.isPrivateIdentifier(member.name));

/** One module's section of the reference. */
function moduleSection(file: string, map: Exports): string {
  const relative = path.relative(REPO, file);
  const text = readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const header = (ts.getLeadingCommentRanges(text, 0) ?? []).map(range => text.slice(range.pos, range.end)).find(comment => /@module\b/.test(comment)) ?? '';
  const lines = header.replace(/^\/\*\*|\*\/$/g, '').split('\n').map(line => line.replace(/^\s*\* ?/, ''));
  const title = lines.find(line => /^@module\b/.test(line))?.replace(/^@module\s*/, '').trim() || path.basename(file);
  const description: string[] = [];
  let skippedTitle = false;
  for (const line of lines) {
    if (/^@module\b/.test(line)) { skippedTitle = true; continue; }
    if (/^@see\b/.test(line)) { description.push(`See ${line.replace(/^@see\s*/, '')}`); continue; }
    if (skippedTitle || !/^@/.test(line)) description.push(line);
  }
  const imports = importPaths(relative, map);
  const out: string[] = [`### ${title}`, '', `Source: \`${relative}\`${imports.length ? `. Import: ${imports.map(item => `\`${item}\``).join(', ')}` : ''}`, '', description.join('\n').trim(), ''];
  for (const statement of source.statements) {
    if (!isExported(statement)) continue;
    const names = ts.isVariableStatement(statement) ? statement.declarationList.declarations.map(declaration => declaration.name.getText(source)) : [(statement as { name?: ts.Identifier }).name?.getText(source) ?? 'default'];
    if (ts.isFunctionDeclaration(statement) && !statement.body) continue;
    out.push(`#### \`${names.join(', ')}\``, '', '```ts', signatureOf(statement, source), '```', '', commentOf(statement), '');
    if (ts.isClassDeclaration(statement)) {
      for (const member of statement.members) {
        if (ts.isConstructorDeclaration(member) || ts.isSemicolonClassElement(member) || isHidden(member)) continue;
        if (ts.isMethodDeclaration(member) && !member.body) continue;
        const name = member.name?.getText(source) ?? '(member)';
        const signature = ts.isMethodDeclaration(member) ? text.slice(member.getStart(source), member.body!.getStart(source)).trim() : text.slice(member.getStart(source), member.end).trim().replace(/\s*=[\s\S]*$/, '');
        out.push(`- \`${signature.replace(/\s+/g, ' ')}\` — ${commentOf(member).replace(/\n+/g, ' ')}`.trimEnd());
      }
      out.push('');
    }
  }
  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`;
}

/** The reference of one package: every module of `packages/<name>/src`, in path order. */
export function packageReference(name: string, summary: string): string {
  const map = exportsMap();
  const root = path.join(REPO, 'packages', name, 'src');
  const modules = sourceFiles(root).map(file => moduleSection(file, map));
  return `# Reference: ${name}\n\n${summary}\n\n> Generated from the doc comments of \`packages/${name}/src\` by \`bun run docs\`. Do not edit: change the comment next to the code.\n\n${modules.join('\n')}`;
}
