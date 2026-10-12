/**
 * Build one package for npm: `tsc -p tsconfig.build.json`, with every relative import in the emitted
 * JavaScript and declarations given the `.js` extension Node needs.
 *
 * The sources import each other without extensions (`from './plan'`), which a bundler, tsx, Bun and
 * Vitest all resolve. Node's own ESM loader does not, and neither does TypeScript under
 * `moduleResolution: nodenext`, so a plain `tsc` build installs from npm and then fails on its first
 * import. Rewriting at emit keeps the sources as they are.
 *
 *   node ../../scripts/build-package.ts        (from a package directory, as its `build` script)
 */
import { existsSync, rmSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts'];

/** The specifier Node can resolve, or undefined when it is not a relative import of a source file. */
export function withJsExtension(specifier: string, fromFile: string, exists: (file: string) => boolean = existsSync): string | undefined {
  if (!/^\.\.?(\/|$)/.test(specifier)) return undefined;
  const target = path.resolve(path.dirname(fromFile), specifier);
  if (SOURCE_EXTENSIONS.some((ext) => exists(target + ext))) return `${specifier}.js`;
  if (SOURCE_EXTENSIONS.some((ext) => exists(path.join(target, `index${ext}`)))) return `${specifier.replace(/\/$/, '')}/index.js`;
  return undefined;
}

function rewriteImports(context: ts.TransformationContext) {
  const { factory } = context;
  const rewritten = (node: ts.Expression | undefined, file: string): ts.StringLiteral | undefined => {
    if (!node || !ts.isStringLiteral(node)) return undefined;
    const next = withJsExtension(node.text, file);
    return next === undefined ? undefined : factory.createStringLiteral(next, true);
  };
  const visitFile = (source: ts.SourceFile): ts.SourceFile => {
    const file = source.fileName;
    const visit = (node: ts.Node): ts.Node => {
      if (ts.isImportDeclaration(node)) {
        const specifier = rewritten(node.moduleSpecifier, file);
        if (specifier) return factory.updateImportDeclaration(node, node.modifiers, node.importClause, specifier, node.attributes);
      } else if (ts.isExportDeclaration(node)) {
        const specifier = rewritten(node.moduleSpecifier, file);
        if (specifier) return factory.updateExportDeclaration(node, node.modifiers, node.isTypeOnly, node.exportClause, specifier, node.attributes);
      } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const specifier = rewritten(node.arguments[0], file);
        if (specifier) return factory.updateCallExpression(node, node.expression, node.typeArguments, [specifier, ...node.arguments.slice(1)]);
      } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
        const specifier = rewritten(node.argument.literal as ts.Expression, file);
        if (specifier) {
          const argument = factory.updateLiteralTypeNode(node.argument, specifier);
          return ts.visitEachChild(factory.updateImportTypeNode(node, argument, node.attributes, node.qualifier, node.typeArguments, node.isTypeOf), visit, context);
        }
      }
      return ts.visitEachChild(node, visit, context);
    };
    return ts.visitEachChild(source, visit, context);
  };
  return (node: ts.SourceFile | ts.Bundle): ts.SourceFile | ts.Bundle => (ts.isSourceFile(node) ? visitFile(node) : node);
}

function build(packageDir: string): number {
  const configPath = path.join(packageDir, 'tsconfig.build.json');
  const host: ts.FormatDiagnosticsHost = { getCanonicalFileName: (f) => f, getCurrentDirectory: () => packageDir, getNewLine: () => '\n' };
  const config = ts.getParsedCommandLineOfConfigFile(configPath, undefined, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (diagnostic) => console.error(ts.formatDiagnosticsWithColorAndContext([diagnostic], host))
  });
  if (!config) return 1;
  // A file deleted from src must not survive in the tarball.
  if (config.options.outDir) rmSync(config.options.outDir, { recursive: true, force: true });

  const program = ts.createProgram({ rootNames: config.fileNames, options: config.options });
  const emitted = program.emit(undefined, undefined, undefined, false, {
    after: [rewriteImports as ts.TransformerFactory<ts.SourceFile>],
    afterDeclarations: [rewriteImports]
  });
  const diagnostics = [...config.errors, ...ts.getPreEmitDiagnostics(program), ...emitted.diagnostics];
  if (diagnostics.length > 0) console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, host));
  return diagnostics.some((d) => d.category === ts.DiagnosticCategory.Error) ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) process.exit(build(process.cwd()));
