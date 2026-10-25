import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SourceText } from '../src/evidence/source-text';
import { specHighlightAdapter, specLanguage } from '../src/ui/highlight';
import { AtlasThemeProvider } from '../src/ui/theme';
import { openAtlas, type Atlas } from './atlas';

let atlas: Atlas | null = null;
let root: Root | undefined;
let host: HTMLDivElement | undefined;
afterEach(async () => {
  await atlas?.close();
  atlas = null;
  if (root) await act(async () => root!.unmount());
  root = undefined;
  host?.remove();
});

const samples = [
  [
    'sample.feature',
    'gherkin',
    '# Comment\n@smoke\nFeature: Lists\n\n  Scenario: Add\n    Given "<script>unsafe()</script>"\n    Then the list is shared\n'
  ],
  ['sample.qnt', 'quint', "// Counter\nmodule counter {\n  var size: int\n  action add = size' = size + 1\n}\n"],
  ['sample.als', 'alloy', '-- Lists\nsig List {}\nfact Nonempty { some List }\nrun {} for 3\n'],
  ['sample.dmn', 'xml', '<?xml version="1.0"?>\n<definitions id="d">\n  <decision id="choose" />\n</definitions>\n'],
  ['sample.openslo.yaml', 'yaml', '# Latency\napiVersion: openslo/v1\nkind: SLO\nmetadata:\n  name: latency\n'],
  ['sample.scxml', 'xml', '<scxml xmlns="http://www.w3.org/2005/07/scxml">\n  <state id="ready" />\n</scxml>\n'],
  ['sample.machine.json', 'json', '{\n  "id": "list",\n  "initial": "ready",\n  "states": { "ready": {} }\n}\n'],
  ['sample.machine.yaml', 'yaml', 'id: list\ninitial: ready\nstates:\n  ready: {}\n']
] as const;

test.each(samples)('%s is complete and highlighted in its actual language', async (file, language, text) => {
  expect(specLanguage(file)).toBe(language);
  const context = await specHighlightAdapter.loadContext!();
  await specHighlightAdapter.loadLanguage!(context, language);
  const highlighted = specHighlightAdapter.getHighlighter(context)({ code: text.trimEnd(), language, colorScheme: 'light' });
  expect(highlighted.isHighlighted).toBe(true);
  // Exercise Mantine's real async adapter/provider and copy controls, not a mock code renderer.
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(
      <AtlasThemeProvider env="test">
        <SourceText file={file} text={text} />
      </AtlasThemeProvider>
    );
  });
  for (let i = 0; i < 50 && !host.querySelector('code #line-1'); i++)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  const code = host.querySelector('pre code')!;
  expect(code.textContent).toBe(text.trimEnd());
  expect(code.querySelector('span[style*="color"]')).not.toBeNull();
  if (language === 'quint' || language === 'alloy') {
    const keyword = language === 'quint' ? 'action' : 'sig';
    expect([...code.querySelectorAll('span[style*="color"]')].some((token) => token.textContent?.trim() === keyword)).toBe(true);
  }
  expect(code.querySelector('#line-1')).not.toBeNull();
  expect(code.querySelector('script')).toBeNull();
  expect(host.querySelector(`button[aria-label="Copy ${file} code"]`)).not.toBeNull();
  expect(host.querySelector('[data-source-control]')).toBeNull();
});

test('Gherkin shows the full source before recorded results while preserving scenario selection', async () => {
  const source =
    '@smoke\nFeature: Name a list\n  Description remains indented.\n\n  Background:\n    Given a welcome screen\n\n  Scenario: Create a named list\n    When I name it "Weekend"\n    Then I can add items\n\n  Scenario: Skip naming\n    When I skip\n    Then the default name is kept\n';
  atlas = await openAtlas({
    at: '/specs/gherkin?spec=naming.feature&check=scenario%3ACreate+a+named+list',
    specs: { 'naming.feature': source },
    deps: {}
  });
  await atlas.until(() => document.querySelector('[data-source] code') !== null, 'the expanded feature source');
  expect(document.querySelector('[data-source] code')!.textContent).toBe(source.trimEnd());
  expect(atlas.find('button', 'Create a named list')?.getAttribute('aria-expanded')).toBe('true');
  const written = document.querySelector('[data-source]')!;
  const results = document.getElementById('spec-results')!;
  expect(written.compareDocumentPosition(results) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  expect(atlas.find('button', 'Recorded results')).toBeDefined();
  await atlas.click('button', 'Recorded results');
  expect(document.activeElement).toBe(results);
  expect(atlas.text()).not.toContain('Spec snapshot');
});

test('XML comments remain escaped source in Shiki output', async () => {
  const context = await specHighlightAdapter.loadContext!();
  await specHighlightAdapter.loadLanguage!(context, 'xml');
  const output = specHighlightAdapter.getHighlighter(context)({ code: '<!-- Decisions -->', language: 'xml', colorScheme: 'light' });
  // happy-dom misparses numeric entities before XML comments; verify the actual generated markup here.
  expect(output.highlightedCode).toMatch(/(?:&#x3C;|&lt;)!-- Decisions -->/);
  expect(output.highlightedCode).not.toContain('<!--');
});

test('Quint declaration links still reach their source line after leading blank lines', async () => {
  const text = "\n\nmodule counter {\n  var size: int\n  action increment = size' = size + 1\n}\n";
  atlas = await openAtlas({ at: '/specs/quint?spec=counter.qnt', specs: { 'counter.qnt': text }, deps: {} });
  await atlas.until(() => !!document.querySelector('[data-source] #line-3'), 'the highlighted action line');
  const line = document.querySelector<HTMLElement>('[data-source] #line-3')!;
  let scrolled = false;
  line.scrollIntoView = () => {
    scrolled = true;
  };
  await atlas.click('a', 'action increment');
  expect(scrolled).toBe(true);
  expect(atlas.router.state.location.pathname).toBe('/specs/quint');
  expect(atlas.router.state.location.search.spec).toBe('counter.qnt');
});

test('statechart screen details retain their raw executable source alongside the map workflow', async () => {
  const text = JSON.stringify({ id: 'order', initial: 'Browsing', states: { Browsing: {} } }, null, 2);
  atlas = await openAtlas({ at: '/chart/order?screen=Browsing', specs: { 'order.machine.json': text }, deps: {} });
  await atlas.until(() => !!document.querySelector('[data-source] code'), 'statechart source');
  expect(document.querySelector('[data-source] code')!.textContent).toBe(text);
  expect(atlas.find('a', 'Show the map')).toBeDefined();
});

test('parse errors leave the raw source available and unknown file types remain safe plain text', async () => {
  expect(specLanguage('unknown.txt')).toBe('text');
  const source = 'Feature: Broken\n  Scenario: Missing step text\n    Given a document\n      """\n      unclosed';
  atlas = await openAtlas({ at: '/specs/gherkin?spec=broken.feature', specs: { 'broken.feature': source }, deps: {} });
  await atlas.until(() => document.querySelector('[data-source] code') !== null, 'raw source after a parse failure');
  expect(document.querySelector('[data-source] code')!.textContent).toBe(source);
  expect(atlas.text()).toContain('could not be parsed');
});
