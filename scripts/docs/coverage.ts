/**
 * @module Documentation coverage
 *
 * The rule that keeps documentation next to the code it describes: every source module of the library packages
 * starts with a `/** @module … *\/` comment, and every exported declaration (and every public member of an exported
 * class) has a doc comment. The reference documentation (`docs/reference/`, `llms-full.txt`) is generated from
 * these comments, so a comment that is missing is a gap an agent or a person would otherwise hit.
 *
 * Run `bun scripts/docs/coverage.ts [dir…]` to list what is missing. `scripts/docs/coverage.test.ts` fails when
 * anything is.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import * as ts from 'typescript';

/** Where the repository's root is: this file is `scripts/docs/coverage.ts`. */
export const REPO = path.resolve(import.meta.dirname, '..', '..');

/** The source folders whose documentation is the package's public documentation. */
export const DOCUMENTED_ROOTS = ['core', 'reports', 'schema', 'server', 'playwright', 'bun', 'webdriver', 'detox', 'vitest', 'runners', 'playwright-reporter', 'critics'].map(name => path.join(REPO, 'packages', name, 'src'));

/** One thing that should have a comment and does not. */
export type Gap = { readonly file: string; readonly line: number; readonly what: string };

/** The source files under `dir` that are library code: not tests, declarations, benchmarks or fixtures. */
export function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      if (['node_modules', 'tests', 'dist', 'bench', 'fixtures'].includes(entry)) continue;
      const full = path.join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry) && !/\.(test|spec)\./.test(entry) && !entry.endsWith('.d.ts')) found.push(full);
    }
  };
  walk(dir);
  return found.sort();
}

const hasDoc = (node: ts.Node) => ((node as { jsDoc?: unknown[] }).jsDoc?.length ?? 0) > 0;
const isExported = (node: ts.Node) => ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword);
const isPrivate = (member: ts.ClassElement) => (ts.canHaveModifiers(member) && (ts.getModifiers(member) ?? []).some(modifier => modifier.kind === ts.SyntaxKind.PrivateKeyword || modifier.kind === ts.SyntaxKind.ProtectedKeyword)) || (member.name !== undefined && ts.isPrivateIdentifier(member.name));

/** What is missing from one file's documentation. */
export function gapsIn(file: string): Gap[] {
  const text = readFileSync(file, 'utf8');
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const gaps: Gap[] = [];
  const lineOf = (node: ts.Node) => source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
  const missing = (node: ts.Node, what: string) => gaps.push({ file: path.relative(REPO, file), line: lineOf(node), what });

  // The module comment: the first comment in the file, before anything else, saying `@module`.
  const leading = ts.getLeadingCommentRanges(text, text.startsWith('#!') ? text.indexOf('\n') + 1 : 0) ?? [];
  if (!leading.some(range => text.slice(range.pos, range.end).startsWith('/**') && /@module\b/.test(text.slice(range.pos, range.end)))) {
    gaps.push({ file: path.relative(REPO, file), line: 1, what: 'module comment (`/** @module Title … */` at the top)' });
  }

  for (const statement of source.statements) {
    if (!isExported(statement)) continue;
    if (ts.isVariableStatement(statement)) {
      if (!hasDoc(statement)) missing(statement, `export ${statement.declarationList.declarations.map(declaration => declaration.name.getText(source)).join(', ')}`);
    } else if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement)) {
      const name = statement.name?.getText(source) ?? 'default';
      // Overloads share the comment of the first.
      if (!hasDoc(statement) && !(ts.isFunctionDeclaration(statement) && !statement.body)) missing(statement, `export ${name}`);
      if (ts.isClassDeclaration(statement)) {
        for (const member of statement.members) {
          if (ts.isConstructorDeclaration(member) || ts.isSemicolonClassElement(member) || isPrivate(member) || hasDoc(member)) continue;
          if (ts.isMethodDeclaration(member) && !member.body) continue;
          missing(member, `${name}.${member.name?.getText(source) ?? '(member)'}`);
        }
      }
    }
  }
  return gaps;
}

/** Every gap under the given folders. */
export function findGaps(roots: readonly string[] = DOCUMENTED_ROOTS): Gap[] {
  return roots.flatMap(root => sourceFiles(root).flatMap(gapsIn));
}

if (import.meta.main) {
  const roots = process.argv.slice(2).map(root => path.resolve(root));
  const gaps = findGaps(roots.length ? roots : DOCUMENTED_ROOTS);
  for (const gap of gaps) process.stdout.write(`${gap.file}:${gap.line}  ${gap.what}\n`);
  process.stdout.write(`${gaps.length} gap${gaps.length === 1 ? '' : 's'}\n`);
  process.exitCode = gaps.length ? 1 : 0;
}
