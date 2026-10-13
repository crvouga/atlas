import { afterEach, expect, test } from 'bun:test';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import type { Looks } from '../src/looks/collect';
import { Stage } from '../src/looks/Stage';

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

async function render(node: ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(node);
  });
  return host;
}

const picture = (id: string, label: string) => ({ id, label, alt: label, src: `/${id}.png`, thumb: `/${id}.png` });

test('a single still is the whole stage', async () => {
  const looks: Looks = { pictures: [picture('welcome', 'Welcome')], films: [], moments: [] };
  const host = await render(<Stage looks={looks} prefer="pictures" />);
  expect(host.querySelector('img')?.getAttribute('alt')).toBe('Welcome');
  expect(host.querySelector('[role="tablist"]')).toBeNull();
  expect(host.textContent).not.toContain('Nothing was captured');
});

test('pictures, video, and a timeline are peers and each fills the stage', async () => {
  const looks: Looks = {
    pictures: [picture('before', 'Before'), picture('after', 'After')],
    films: [{ id: 'clip', label: 'Start', src: '/start.mp4', poster: '/start.webp', captions: null, durationMs: 4000, chapters: [{ atMs: 0, label: 'Tap start' }] }],
    moments: [
      { id: 'm1', label: 'Tap start', caption: 'tap', status: null, thumb: null, pauseMs: null },
      { id: 'm2', label: 'Working', caption: 'screen', status: 'passed', thumb: null, pauseMs: null }
    ]
  };
  const host = await render(<Stage looks={looks} prefer="film" />);
  const tabs = [...host.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent);
  expect(tabs).toEqual(['Pictures', 'Video', 'Timeline']);
  expect(host.querySelector('video')?.getAttribute('src')).toBe('/start.mp4');
  expect(host.textContent).toContain('Tap start');

  await act(async () => {
    [...host.querySelectorAll('button')].find((button) => button.textContent === 'Pictures')?.click();
  });
  expect(host.querySelector('video')).toBeNull();
  expect(host.querySelector('img')?.getAttribute('alt')).toBe('Before');
  expect(host.textContent).toContain('Picture 1 of 2');

  await act(async () => {
    host.querySelector<HTMLButtonElement>('button[aria-label="Next picture"]')?.click();
  });
  expect(host.querySelector('img')?.getAttribute('alt')).toBe('After');

  await act(async () => {
    [...host.querySelectorAll('button')].find((button) => button.textContent === 'Timeline')?.click();
  });
  expect(host.querySelector('h3')?.textContent).toBe('Tap start');
  expect(host.textContent).toContain('Moment 1 of 2');
});

test('a run with no capture says so', async () => {
  const host = await render(<Stage looks={{ pictures: [], films: [], moments: [] }} prefer="pictures" empty={<p>No picture of this screen.</p>} />);
  expect(host.textContent).toContain('No picture of this screen.');
});
