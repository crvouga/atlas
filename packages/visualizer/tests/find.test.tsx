import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';

import { commandPortalTarget } from '../src/find/commands';
import { setFinderOpen, setHelpOpen } from '../src/find/open';

class FinderResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= FinderResizeObserver as unknown as typeof ResizeObserver;
import { memoryStore, openAtlas, publishRun, step, type Atlas } from './atlas';

let atlas: Atlas | null = null;
afterEach(async () => {
  await act(async () => {
    setFinderOpen(false);
    setHelpOpen(false);
  });
  await atlas?.close();
  atlas = null;
});

function finder() {
  return document.querySelector<HTMLElement>('[aria-label="Find"]');
}

function finderInput() {
  const input = document.querySelector<HTMLInputElement>('input[aria-label="Search and commands"]');
  expect(input).not.toBeNull();
  return input!;
}

async function openFinder() {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true }));
  });
  await atlas!.until(() => finder() !== null, 'the finder');
}

async function typeQuery(value: string) {
  const input = finderInput();
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

test('the finder opens a flow from ordinary words and gets out of the way', async () => {
  atlas = await openAtlas({ at: '/', deps: {} });
  await atlas.sees('Gherkin');
  await openFinder();
  expect(finder()?.getAttribute('role')).toBe('dialog');
  await typeQuery('add');
  await atlas.until(() => (finder()?.textContent ?? '').includes('Add an item'), 'Add an item');
  const input = finderInput();
  const selectedRow = () => document.querySelector<HTMLElement>('[role="option"][aria-selected="true"]');
  await atlas.until(() => selectedRow() !== null, 'a selected row');
  const first = selectedRow()!;
  expect(first.textContent).toContain('Add an item');
  const press = async (key: string) => {
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true, cancelable: true }));
    });
  };
  await press('ArrowDown');
  expect(selectedRow()?.id).not.toBe(first.id);
  expect(input.getAttribute('aria-activedescendant')).toBe(selectedRow()?.id);
  await press('ArrowUp');
  expect(selectedRow()?.id).toBe(first.id);
  await press('Enter');
  await atlas.until(() => atlas!.router.state.location.pathname === '/specs/gherkin', 'the feature');
  expect(atlas.router.state.location.search).toMatchObject({ spec: 'lists/add.feature', check: 'scenario:Add an item' });
  expect(finder()).toBeNull();

  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true }));
  });
  await atlas.until(() => finder() !== null, 'finder from slash');
  await act(async () => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  });
  await atlas.until(() => finder() === null, 'finder closed');

  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', bubbles: true, cancelable: true }));
  });
  await atlas.until(() => document.querySelector('[aria-label="Keyboard shortcuts"]') !== null, 'the shortcut sheet');
  expect(document.body.textContent).toContain('Open the recording');
  await act(async () => {
    document.querySelector<HTMLButtonElement>('[aria-label="Keyboard shortcuts"] button')!.click();
  });
  expect(document.querySelector('[aria-label="Keyboard shortcuts"]')).toBeNull();
});

test('recording keys stay put while the finder is open', async () => {
  const localStore = memoryStore();
  const frames = (index: number) => ({ frames: [{ index, capturedAtMs: index, snapshots: [] }] });
  await publishRun(localStore, {
    at: 20,
    checks: [
      {
        test: 'add',
        title: 'Share a list: Add an item',
        status: 'failed',
        error: 'Expected tea in the list',
        steps: [
          step(1, 'Given a list', 'passed', frames(1)),
          step(2, 'When adding tea', 'failed', { error: 'Expected tea in the list', ...frames(2) }),
          step(3, 'Then the list includes tea', 'passed', frames(3))
        ]
      }
    ]
  });
  atlas = await openAtlas({ at: '/specs/gherkin?spec=lists/add.feature&check=lists/add&view=recording', deps: { localStore } });
  await atlas.sees('Moment 2 of 3');
  await openFinder();
  await act(async () => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }));
  });
  expect(atlas.text()).toContain('Moment 2 of 3');
  await act(async () => {
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  });
  await atlas.until(() => finder() === null, 'finder closed');
  await act(async () => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }));
  });
  await atlas.sees('Moment 1 of 3');
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
  });
  expect(atlas.text()).toContain('Moment 2 of 3');
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
  });
  expect(atlas.text()).toContain('Moment 3 of 3');
});

test('the header opens and closes Spotlight under the application’s StrictMode', async () => {
  atlas = await openAtlas({ at: '/', deps: {}, strict: true });
  await atlas.sees('Gherkin');
  await atlas.click('button[aria-label="Search and commands"]', 'Search and commands');
  await atlas.until(() => !!document.querySelector('input[aria-label="Search and commands"]'), 'finder opened from header');
  await act(async () => finderInput().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  await atlas.until(() => finder() === null, 'finder dismissed');
});

async function runPaletteCommand(query: string) {
  await typeQuery(query);
  await act(async () => finderInput().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true })));
}

test('IDE command shortcut navigates to every destination, including notation names, without a mouse', async () => {
  atlas = await openAtlas({ at: '/', deps: {} });
  await atlas.sees('Gherkin');
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'P', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true })));
  await atlas.until(() => finderInput().value === '>', 'command-only mode');
  await runPaletteCommand('> go to UI catalog');
  await atlas.until(() => atlas!.router.state.location.pathname === '/catalog', 'catalog command');
  expect(finder()).toBeNull();
  await openFinder();
  await runPaletteCommand('> open Gherkin');
  await atlas.until(() => atlas!.router.state.location.pathname === '/specs/gherkin', 'notation command');
});

test('palette invokes current controls, respects disabled/hidden actions, and focuses fields without copying their values', async () => {
  atlas = await openAtlas({ at: '/', deps: {} });
  await atlas.sees('Gherkin');
  const group = document.createElement('section');
  group.innerHTML = '<label for="command-secret">Private input</label><input id="command-secret" type="password" value="never-index-this-secret"><button>Run local action</button><button disabled>Unavailable action</button><button hidden>Hidden action</button>';
  atlas.host.append(group);
  let calls = 0;
  group.querySelector('button')!.onclick = () => calls++;
  await openFinder();
  expect(finder()!.textContent).not.toContain('never-index-this-secret');
  await typeQuery('> unavailable action');
  expect(finder()!.querySelectorAll('[role="option"]')).toHaveLength(0);
  await typeQuery('> hidden action');
  expect(finder()!.querySelectorAll('[role="option"]')).toHaveLength(0);
  await runPaletteCommand('> run local action');
  await atlas.until(() => calls === 1, 'page action called once');
  await openFinder();
  await runPaletteCommand('> focus private input');
  await atlas.until(() => document.activeElement === group.querySelector('input'), 'focus returned to chosen field');
  expect(group.querySelector('input')!.value).toBe('never-index-this-secret');
  group.remove();
});

test('commands open inside a dialog and Escape closes only the palette, restoring the original dialog', async () => {
  atlas = await openAtlas({ at: '/', deps: {} });
  await atlas.sees('Gherkin');
  await openFinder();
  await runPaletteCommand('> show evidence sources');
  await atlas.until(() => !!document.querySelector('button[aria-label="Close sources"]'), 'sources dialog');
  const parent = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].find(dialog => dialog.textContent?.includes('Sources'))!;
  expect(parent).toBeDefined();
  const close = parent.querySelector<HTMLButtonElement>('button[aria-label="Close sources"]')!;
  await act(async () => { close.focus(); close.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true })); });
  await atlas.until(() => finder() !== null, 'palette from a dialog control');
  // Mantine disables portals in env="test"; the browser uses this target for the nested trap.
  expect(commandPortalTarget()).toBe(parent);
  await act(async () => finderInput().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  await atlas.until(() => !finder(), 'only palette closed');
  expect(parent.isConnected).toBe(true);
  await atlas.until(() => document.activeElement === close, 'focus restored inside parent dialog');
});

test('global palette shortcuts work from fields and buttons without stealing text entry or IME composition', async () => {
  atlas = await openAtlas({ at: '/', deps: {} });
  await atlas.sees('Gherkin');
  const field = document.createElement('input');
  field.setAttribute('aria-label', 'Keyboard fixture');
  field.value = 'draft text';
  atlas.host.append(field);
  for (const key of ['/', '?']) {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    await act(async () => { field.focus(); field.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(false);
    expect(finder()).toBeNull();
  }
  const composing = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, isComposing: true, bubbles: true, cancelable: true });
  await act(async () => field.dispatchEvent(composing));
  expect(composing.defaultPrevented).toBe(false);
  expect(finder()).toBeNull();
  field.onkeydown = event => event.stopPropagation();
  await act(async () => field.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true })));
  await atlas.until(() => !!finder(), 'palette shortcut before field propagation stops');
  await act(async () => finderInput().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
  await atlas.until(() => !finder(), 'palette dismissed');
  expect(field.value).toBe('draft text');
  const button = atlas.find('button', 'Spec type')!;
  await act(async () => { button.focus(); button.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true })); });
  await atlas.until(() => !!finder(), 'slash shortcut from a button');
  field.remove();
});
