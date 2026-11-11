import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { INVENTORY, ROUTES } from './inventory';

test('every screen/state story is explicitly inventoried and every inventory item has a story', () => {
  for (const [file, stories] of Object.entries(INVENTORY)) {
    const source = readFileSync(new URL(`./${file}.stories.tsx`, import.meta.url), 'utf8');
    const actual = [...source.matchAll(/export const (\w+): Story\b/g)].map(match => match[1]!).sort();
    expect(actual).toEqual([...stories].sort());
  }
  const files = readdirSync(new URL('.', import.meta.url)).filter(name => name.endsWith('.stories.tsx')).map(name => name.replace('.stories.tsx', ''));
  expect(files.sort()).toEqual(Object.keys(INVENTORY).sort());
});
test('every viewer route family has an audit inventory entry', () => {
  const router = readFileSync(new URL('../src/app/router.tsx', import.meta.url), 'utf8');
  const routes = [...router.matchAll(/\bpath: '([^']+)'/g)].map(match => match[1]!);
  expect([...routes, '/admin'].sort()).toEqual([...ROUTES].sort());
  const kinds = readFileSync(new URL('../src/spec-kind.ts', import.meta.url), 'utf8');
  const names = [...kinds.matchAll(/id: '(\w+)', label:/g)].map(match => match[1]!);
  expect(names.sort()).toEqual(['gherkin', 'quint', 'dmn', 'alloy', 'openslo'].sort());
});
