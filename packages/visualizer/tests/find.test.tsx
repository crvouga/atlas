import { afterEach, expect, test } from 'bun:test';
import { act } from 'react';

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
  const input = document.querySelector<HTMLInputElement>('[cmdk-input]');
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
  const selectedRow = () => document.querySelector<HTMLElement>('[cmdk-item][aria-selected="true"]');
  await atlas.until(() => selectedRow() !== null, 'a selected row');
  const first = selectedRow()!;
  expect(first.textContent).toContain('Add an item');
  const press = async (key: string) => {
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
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
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
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
    checks: [{
      test: 'add',
      title: 'Share a list: Add an item',
      status: 'failed',
      error: 'Expected tea in the list',
      steps: [
        step(1, 'Given a list', 'passed', frames(1)),
        step(2, 'When adding tea', 'failed', { error: 'Expected tea in the list', ...frames(2) }),
        step(3, 'Then the list includes tea', 'passed', frames(3))
      ]
    }]
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
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
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
