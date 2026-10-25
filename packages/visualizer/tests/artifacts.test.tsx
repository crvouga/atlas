import { AtlasThemeProvider } from '../src/ui/theme';
import { afterEach, expect, test } from 'bun:test';
import { createNode } from '../../server/tests/node-compat';
import { publishChecks } from '@crvouga/atlas/reports/publish-checks';
import { renderToStaticMarkup } from 'react-dom/server';
import { QueryClientProvider } from '@tanstack/react-query';

import { artifactRenderers, Attachments, Notes, registerArtifactRenderer, Timeline } from '../src/evidence/artifacts';
import { createQueryClient } from '../src/data/queries';
import { FEATURE, memoryStore, openAtlas, type Atlas } from './atlas';

let atlas: Atlas | null = null;
afterEach(async () => {
  await atlas?.close();
  atlas = null;
});

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const wrap = (node: React.ReactNode) =>
  renderToStaticMarkup(
    <AtlasThemeProvider env="test">
      <QueryClientProvider client={createQueryClient()}>{node}</QueryClientProvider>
    </AtlasThemeProvider>
  );

test('a result opens to everything it carries: facts, timeline, retries, annotations and attachments of each kind, and what nobody planned for', async () => {
  const store = memoryStore();
  const SPEC = 'specs/lists/add.feature';
  await publishChecks(store, {
    producer: 'e2e',
    environment: 'ios',
    branch: 'main',
    recordedAtMs: 5,
    labels: { build: '42' },
    links: [{ url: 'https://ci.example.com/42', name: 'CI run' }],
    checks: [
      {
        id: `${SPEC} > Add an item`,
        title: 'Add an item',
        status: 'failed',
        detail: 'no tea',
        specPath: SPEC,
        tags: ['smoke'],
        labels: { owner: 'lists-team' },
        steps: [
          { id: 'a', name: 'Open the list', status: 'passed', offsetMs: 0, durationMs: 40 },
          { id: 'b', parentId: 'a', name: 'GET /list', kind: 'request', status: 'passed', offsetMs: 5 },
          { name: 'Add tea', status: 'failed', offsetMs: 60, detail: 'timeout' }
        ],
        attachments: [
          { name: 'failure.png', role: 'screenshot', data: PNG, contentType: 'image/png' },
          { name: 'run.webm', data: new Uint8Array([1, 2, 3]), contentType: 'video/webm' },
          { name: 'console.log', text: 'warn: slow response' },
          { name: 'hologram.holo', role: 'hologram', data: new Uint8Array([7, 7]), contentType: 'application/x-hologram' }
        ],
        annotations: [{ type: 'accessibility', level: 'warning', message: 'Low contrast on Add' }],
        attempts: [
          { index: 0, status: 'failed', detail: 'first try' },
          { index: 1, status: 'failed', detail: 'second try' }
        ],
        extensions: { 'com.example.cost': { cents: 3 } }
      }
    ]
  });
  const node = createNode({ stores: [{ id: 'shared', store }], refreshMs: 60_000 });
  await node.ready;
  atlas = await openAtlas({ at: '/specs/gherkin?spec=lists/add.feature', deps: {}, specs: { 'lists/add.feature': FEATURE }, node });
  await atlas.sees('1 failed');
  await atlas.click('button', 'Add an item');
  await atlas.sees('Low contrast on Add');
  const text = atlas.text();
  for (const expected of [
    'smoke',
    'owner',
    'lists-team',
    'Open the list',
    'GET /list',
    'Add tea',
    '3 steps',
    '2 tries',
    'Try 2',
    'second try',
    '4 attachments',
    'failure.png',
    'run.webm',
    'console.log',
    'warn: slow response',
    'hologram.holo',
    'hologram',
    'From the run',
    'CI run',
    '1 extension',
    'com.example.cost'
  ])
    expect(text).toContain(expected);
  // A picture is shown as a picture, a video as a video, a page snapshot would be a locked frame; an unknown kind is listed with a way to get it.
  expect(document.body.querySelector('img[alt="failure.png"]')).not.toBeNull();
  expect(document.body.querySelector('video')).not.toBeNull();
  const unknown = [...document.body.querySelectorAll('li[data-role="hologram"]')][0]!;
  expect(unknown.querySelector('a[download]')).not.toBeNull();
  expect(unknown.querySelector('img, video, iframe')).toBeNull();
  // A child step is nested under its parent.
  const parent = [...document.body.querySelectorAll('li[data-evidence-step]')].find((item) => item.textContent?.includes('Open the list'));
  expect(parent?.querySelector('ol li')?.textContent).toContain('GET /list');
  node.close();
});

test('a link a producer wrote can never run script: only web addresses are followed', () => {
  const html = wrap(
    <Attachments
      layer={'a'.repeat(64)}
      attachments={[
        { name: 'evil', uri: 'javascript:alert(1)' },
        { name: 'ok', uri: 'https://example.com/trace.zip', contentType: 'application/zip' },
        { name: 'data', uri: 'data:text/html,<script>1</script>' }
      ]}
    />
  );
  expect(html).not.toContain('javascript:');
  expect(html).not.toContain('data:text/html');
  expect(html).toContain('https://example.com/trace.zip');
  expect(html).toContain('No file to show');
});

test('a step with a status or a level nobody planned for is still a step and a note', () => {
  const steps = wrap(<Timeline layer={'a'.repeat(64)} steps={[{ name: 'Teleport', status: 'quantum', kind: 'portal' }]} />);
  expect(steps).toContain('Teleport');
  expect(steps).toContain('quantum');
  const notes = wrap(<Notes notes={[{ type: 'vibes', level: 'existential', message: 'Feels off' }]} />);
  expect(notes).toContain('vibes');
  expect(notes).toContain('Feels off');
  expect(notes).toContain('existential');
});

test('a new kind of artifact is one more renderer, ahead of the others', () => {
  const before = artifactRenderers.length;
  registerArtifactRenderer({
    id: 'flame',
    matches: (_, type) => type === 'application/x-flamegraph',
    render: (attachment) => <b>flame: {attachment.name}</b>
  });
  expect(artifactRenderers.length).toBe(before + 1);
  const html = wrap(
    <Attachments
      layer={'a'.repeat(64)}
      attachments={[{ name: 'cpu.flame', contentType: 'application/x-flamegraph', bundleKey: 'attachments/x' }]}
    />
  );
  expect(html).toContain('flame: cpu.flame');
  artifactRenderers.shift();
});
