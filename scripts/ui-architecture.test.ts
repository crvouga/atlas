import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const root = path.resolve(import.meta.dir, '../packages/visualizer/src');
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(path.join(dir, entry.name)) : [path.join(dir, entry.name)]
  );
}
const theme = path.join(root, 'ui/theme.tsx');
const stylesheet = path.join(root, 'map/map.module.css');
const frontendImports = [
  '@mantine/core',
  '@mantine/code-highlight',
  'shiki',
  '@tabler/icons-react',
  '@mantine/hooks',
  '@mantine/spotlight',
  '@tanstack/react-query',
  '@tanstack/react-router',
  '@xyflow/react',
  '@crvouga/atlas',
  'elkjs',
  'bun:test',
  'react',
  'react-dom',
  'zustand',
  'xstate',
  'yaml',
  'zod',
  'fast-xml-parser',
  '@cucumber/gherkin',
  '@cucumber/messages'
];

test('the viewer has one Mantine setup and only documented graph styling exceptions', () => {
  const violations: string[] = [];
  let providers = 0,
    themes = 0;
  for (const file of files(root)) {
    const relative = path.relative(root, file);
    if (/\.(css|scss|sass|less)$/.test(file) && file !== stylesheet) violations.push(`${relative}: undocumented stylesheet`);
    if (!/\.[jt]sx?$/.test(file)) continue;
    const source = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      file.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );
    const visit = (node: ts.Node) => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const module = node.moduleSpecifier.text;
        if (
          !module.startsWith('.') &&
          !module.startsWith('virtual:') &&
          !module.startsWith('node:') &&
          !frontendImports.some((allowed) => module === allowed || module.startsWith(`${allowed}/`))
        )
          violations.push(`${relative}: unapproved frontend dependency ${module}`);
      }
      if (ts.isCallExpression(node) && node.expression.getText(source) === 'createTheme') {
        themes++;
        if (file !== theme) violations.push(`${relative}: theme outside ui/theme.tsx`);
      }
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = node.tagName.getText(source);
        // Data plots and graph arrow markers are geometry; ordinary icons come from Tabler.
        if (tag === 'svg' && !['explorer/TestDetail.tsx', 'map/EventEdge.tsx'].includes(relative.split(path.sep).join('/')))
          violations.push(`${relative}: use @tabler/icons-react for UI icons`);
        if (tag === 'MantineProvider') {
          providers++;
          if (file !== theme) violations.push(`${relative}: provider outside ui/theme.tsx`);
        }
        if (['button', 'input', 'select', 'textarea', 'details', 'summary', 'dialog'].includes(tag))
          violations.push(`${relative}: use Mantine instead of ${tag}`);
        for (const prop of node.attributes.properties)
          if (ts.isJsxAttribute(prop)) {
            const name = prop.name.getText(source);
            if (['style', 'styles', 'classNames', 'className'].includes(name) && !relative.startsWith(`map${path.sep}`))
              violations.push(`${relative}: undocumented ${name}`);
          }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  expect(violations).toEqual([]);
  expect(providers).toBe(1);
  expect(themes).toBe(1);
});

test('obsolete component systems cannot return as dependencies', () => {
  const pkg = JSON.parse(readFileSync(path.resolve(root, '../../../package.json'), 'utf8'));
  const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  expect(
    names.filter((name) =>
      /^(?:@radix-ui\/|@mui\/|@chakra-ui\/|antd$|tailwindcss$|@tailwindcss\/|cmdk$|@emotion\/|styled-components$)/.test(name)
    )
  ).toEqual([]);
});
