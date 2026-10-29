import { afterEach, beforeEach, expect, test } from 'bun:test';
import { publishChecks } from '@crvouga/atlas/reports/publish-checks';
import { act } from 'react';

import { createNode } from '../../server/tests/node-compat';
import { memoryStore, openAtlas, type Atlas } from './atlas';

class FinderResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= FinderResizeObserver as unknown as typeof ResizeObserver;

beforeEach(() => localStorage.clear());
let atlas: Atlas | null = null;
let closeNode: (() => void) | null = null;
afterEach(async () => {
  await atlas?.close();
  atlas = null;
  closeNode?.();
  closeNode = null;
});

type Check = Record<string, unknown> & { id: string; status: string };
const feature = (file: string) => `Feature: ${file}\n  Scenario: One\n    When it happens\n`;
const DEFAULT_FILES = ['checkout/cart.feature', 'checkout/pay.feature'];
/** The spec files the page is laid over, as the viewer reads them (`specs/<file>`, the folder is the domain). */
let files = DEFAULT_FILES;
const outline = () => Object.fromEntries(files.map((file) => [file, feature(file)]));

/** Results published as `checkout/cart.feature`, specs recorded under `specs/`: the same promise under two roots. */
async function seed(extra: { files?: string[]; checks?: Check[]; devices?: string[] } = {}) {
  files = extra.files ?? DEFAULT_FILES;
  const store = memoryStore();
  const specs = files.map((file) => ({ path: `specs/${file}`, domain: file.split('/')[0]!, kind: 'feature', title: file }));
  const checks = extra.checks ?? [{ id: 'add', title: 'Add an item', status: 'passed', specPath: 'checkout/cart.feature' }];
  for (const [index, device] of (extra.devices ?? ['desktop']).entries()) {
    await publishChecks(store, { producer: 'web', environment: device, recordedAtMs: 1_000 + index, branch: 'main', sha: 'a'.repeat(40), runUrl: null, specs, checks: checks as never });
  }
  return store;
}

const open = async (at: string, store: Awaited<ReturnType<typeof seed>>, node?: Parameters<typeof openAtlas>[0]['node']) => {
  atlas = await openAtlas({ at, specs: outline(), deps: { localStore: store }, ...(node ? { node } : {}) });
  // The page shows what it holds as layers stream in: wait for the tests to be counted.
  await atlas.until(() => document.querySelector('section[aria-label="Catalog health"] [data-health-summary]') !== null && figure('Tests') !== '0', 'the catalog health');
  return atlas;
};
const findings = () => [...document.querySelectorAll<HTMLElement>('[data-health-finding]')].map((item) => item.getAttribute('data-health-finding'));
const figure = (name: string) => document.querySelector(`[data-health-figure="${name}"]`)?.textContent;

test('without a mapping, paths that might be one promise are reported as ambiguous and are not merged', async () => {
  const view = await open('/?tab=health', await seed());
  expect(findings()).toContain('ambiguous-spec-path');
  expect(document.querySelector('[data-health-summary]')?.textContent).toContain('warning');
  expect(document.querySelector('[data-health-aliases]')).toBeNull();
  expect(view.text()).toContain('may be the same promise as');
  expect(view.text()).toContain('not merged');
  // The totals reconcile: two spec files, one defined without a test, one with tests and no definition.
  expect(figure('Spec files')).toBe('2');
  expect(figure('Specs with tests')).toBe('1');
  const rows = [...document.querySelectorAll('[data-health-reconciliation] tbody tr')].map((row) => [...row.querySelectorAll('td')].map((cell) => cell.textContent));
  expect(rows[0]).toEqual(['Spec files the Specs view lists', '', '2']);
  expect(rows.at(-1)?.[2]).toBe('1');
  expect(rows.at(-1)?.[0]).toBe('Specs the Tests view groups its tests into');
});

test('a mapping in the address joins the paths into one spec and keeps both original paths', async () => {
  const view = await open('/?tab=health&root=%3Especs%2F', await seed());
  expect(findings()).not.toContain('ambiguous-spec-path');
  const aliases = document.querySelector('[data-health-aliases]')!;
  expect(aliases.textContent).toContain('specs/checkout/cart.feature');
  expect(aliases.textContent).toContain('checkout/cart.feature');
  expect(view.text()).toContain('Tried here');
  expect(view.text()).toContain('changed 1 path');
});

test('a mapping can be tried from the form and stopped, and the address keeps it', async () => {
  const view = await open('/?tab=health', await seed());
  const type = async (label: string, value: string) => {
    const input = [...document.querySelectorAll<HTMLInputElement>('input')].find((each) => each.labels?.[0]?.textContent?.includes(label))!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  };
  const submit = [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Try this mapping')!;
  expect(submit.disabled).toBe(true);
  await type('are the same specs as', 'specs/');
  await act(async () => submit.click());
  await view.until(() => document.querySelector('[data-health-aliases]') !== null, 'the joined spec');
  expect(view.router.state.location.search).toMatchObject({ root: '>specs/' });
  await view.click('button', 'Stop trying >specs/');
  await view.until(() => findings().includes('ambiguous-spec-path'), 'the ambiguity again');
});

test('one outline with five examples on three devices is told apart from fifteen observations', async () => {
  const checks = [1, 2, 3, 4, 5].map((n) => ({ id: `pay-${n}`, title: `Pay example ${n}`, status: 'passed', specPath: 'specs/checkout/pay.feature', labels: { outline: 'Pay with a card' } }));
  await open('/?tab=health', await seed({ checks, devices: ['phone', 'tablet', 'desktop'] }));
  expect([figure('Outlines'), figure('Examples'), figure('Observations')]).toEqual(['1', '5', '15']);
});

test('a definition with no execution is a gap and adds to no passed count', async () => {
  const view = await open('/?tab=health', await seed({ checks: [{ id: 'pay', title: 'Pay', status: 'passed', specPath: 'specs/checkout/pay.feature' }] }));
  expect(figure('Defined, not executed')).toBe('1');
  expect(figure('Specs executed')).toBe('1');
  expect(figure('Tests passed')).toBe('1');
  expect(findings()).toContain('spec-without-execution');
  expect(view.text()).toContain('coverage gaps');
});

test('a root folder used as the domain of nearly every spec is discoverable, and the domain is left as declared', async () => {
  const view = await open('/?tab=health', await seed({ files: ['product/a.feature', 'product/b.feature', 'product/c.feature', 'product/d.feature'], checks: [{ id: 'a1', title: 'A', status: 'passed', specPath: 'specs/product/a.feature' }] }));
  expect(findings()).toContain('generic-domain');
  expect(view.text()).toContain('looks like a root folder');
  expect(document.querySelector('[data-health-domains]')?.textContent).toContain('product');
});

test('a check known only by its title says so, with the limit of that identity', async () => {
  const view = await open('/?tab=health', await seed({ checks: [{ id: 'Add an item', title: 'Add an item', status: 'passed', specPath: 'specs/checkout/cart.feature' }] }));
  expect(findings()).toContain('fallback-identity');
  expect(document.querySelector('[data-health-identity]')?.textContent).toContain('1 of 1 checks');
  expect(view.text()).toContain('a rename is a new check');
});

test('the Specs list links to the explanation of the counts', async () => {
  const store = await seed();
  atlas = await openAtlas({ at: '/', specs: outline(), deps: { localStore: store } });
  await atlas.sees('Why do these counts differ from the Tests?');
  await atlas.click('a', 'Why do these counts differ from the Tests?');
  await atlas.until(() => document.querySelector('[data-health-summary]') !== null && figure('Tests') !== '0', 'the catalog health');
  expect(atlas.router.state.location.search).toMatchObject({ tab: 'health' });
});

test('on a server, its configured mappings apply, are labelled, and a mapping tried here is added to them', async () => {
  const store = await seed();
  const node = createNode({ stores: [{ id: 'shared', store }], refreshMs: 60_000, catalogRoots: ['>specs/'] });
  closeNode = () => node.close();
  await node.ready;
  const view = await open('/?tab=health&root=x%2F%3Ey%2F', store, node);
  expect(view.text()).toContain('Configured on the server');
  expect(view.text()).toContain('Tried here');
  expect(findings()).not.toContain('ambiguous-spec-path');
  expect(findings()).toContain('unused-root-mapping');
  expect(document.querySelector('[data-health-aliases]')?.textContent).toContain('checkout/cart.feature');
});
