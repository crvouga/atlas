import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';
import { publishChecks } from '@crvouga/atlas/reports/publish-checks';

import { createAtlasServer } from '../../server/src/app';
import { createNode } from '../../server/tests/node-compat';
import { FEATURE, memoryStore, openAtlas, type Atlas } from './atlas';

let atlas: Atlas | null = null;
afterEach(async () => {
  await atlas?.close();
  atlas = null;
});

const SPEC = 'specs/lists/add.feature';
const bytes = (...values: number[]) => new Uint8Array(values);

async function seed() {
  const store = memoryStore();
  await publishChecks(store, {
    producer: 'e2e',
    environment: 'ios',
    recordedAtMs: 5,
    tags: ['demo'],
    checks: [
      {
        id: `${SPEC} > Add an item`,
        title: 'Add an item',
        status: 'passed',
        specPath: SPEC,
        attachments: [
          { id: 'tour', name: 'tour.webm', role: 'video', data: bytes(1), contentType: 'video/webm', tags: ['#Demo', 'Walkthrough'] },
          { id: 'plain', name: 'plain.webm', role: 'video', data: bytes(2), contentType: 'video/webm' },
          { id: 'old', name: 'old.png', data: bytes(3), contentType: 'image/png', tags: ['team/lists'] }
        ]
      }
    ]
  });
  return store;
}

async function open(node: { fetch: (request: Request) => Promise<Response> }) {
  atlas = await openAtlas({ at: '/specs/gherkin?spec=lists/add.feature', deps: {}, specs: { 'lists/add.feature': FEATURE }, node });
  await atlas.sees('1 passed');
  await atlas.click('button', 'Add an item');
  // The row opens on Watch when there is a recording; the attachments are the technical record.
  await atlas.click('[role="tab"]', 'Inspect');
  await atlas.sees('tour.webm');
  return atlas;
}

const card = (name: string) => [...document.body.querySelectorAll('li[data-role]')].find((item) => item.textContent?.includes(name)) as HTMLElement;
const chip = (name: string, tag: string) => [...card(name).querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find((input) => input.closest('div')?.textContent?.includes(tag))!;
const flip = (input: HTMLInputElement) => act(async () => input.click());

test('a recording tagged demo shows a #demo chip, a run tag is said to be inherited, and selecting a chip filters the evidence', async () => {
  const node = createNode({ stores: [{ id: 'shared', store: await seed() }], refreshMs: 60_000 });
  await node.ready;
  const view = await open(node);

  // The producer's tag, whatever its spelling, is one normalized chip; an untagged recording says what it inherits.
  expect(card('tour.webm').textContent).toContain('#demo');
  expect(card('tour.webm').textContent).toContain('#walkthrough');
  expect(card('tour.webm').textContent).not.toContain('inherited');
  expect(card('plain.webm').textContent).toContain('#demo inherited');
  expect(card('old.png').textContent).toContain('#team/lists');

  await flip(chip('tour.webm', '#demo'));
  await view.sees('1 of 3 attachments tagged #demo');
  expect(card('plain.webm')).toBeUndefined();
  expect(card('tour.webm')).toBeDefined();

  // The exact artifact-only query differs from the inherited one.
  const include = document.body.querySelector<HTMLInputElement>('input[type="checkbox"][role="switch"]')!;
  await flip(include);
  await view.sees('3 of 3 attachments tagged #demo');
  expect(card('plain.webm')).toBeDefined();
  expect(card('old.png')).toBeDefined();

  // A tag only one recording has finds only that recording, whichever way it is asked.
  await view.click('button', 'Clear filter');
  await flip(chip('old.png', '#team/lists'));
  await view.sees('1 of 3 attachments tagged #team/lists');
  expect(card('tour.webm')).toBeUndefined();

  await view.click('button', 'Clear filter');
  expect(card('old.png')).toBeDefined();
  node.close();
});

test('a reviewer adds a tag after upload: it survives a reload with who added it, and the layer and the result are unchanged', async () => {
  const store = await seed();
  const node = createNode({ stores: [{ id: 'shared', store }], refreshMs: 60_000 });
  await node.ready;
  const keys = (await store.listKeys('layers/')).sort();
  const view = await open(node);
  await view.sees('Add tag');
  await view.click('button', 'Add tag');
  const field = [...document.body.querySelectorAll<HTMLInputElement>('form input')].find((item) => item.type !== 'password')!;
  expect(field).toBeDefined();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, '#Review');
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await view.click('button', 'Save tag');
  await view.sees('added by open');
  expect(await store.listKeys('layers/')).toEqual(keys);

  // Reload: a new viewer over the same store.
  await view.close();
  atlas = null;
  const again = createNode({ stores: [{ id: 'shared', store }], refreshMs: 60_000 });
  await again.ready;
  const reopened = await open(again);
  await reopened.sees('added by open');
  expect(reopened.text()).toContain('1 passed');
  node.close();
  again.close();
});

test('a visitor without a token may look and is refused when they try to tag', async () => {
  const store = await seed();
  const server = createAtlasServer({ backends: [{ id: 'shared', store }], write: 'shared', tokens: [{ name: 'eyes', role: 'read', token: 'read-token-1234567' }], anonymousRead: true, refreshMs: 60_000 });
  await server.ready;
  const view = await open(server);
  await view.sees('Add tag');
  await view.click('button', 'Add tag');
  const field = [...document.body.querySelectorAll<HTMLInputElement>('form input')].find((item) => item.type !== 'password')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, 'demo');
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await view.click('button', 'Save tag');
  await view.sees('A token is needed');
  expect(await store.listKeys('curation/')).toEqual([]);
  server.close();
});
