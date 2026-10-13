import { readFileSync } from 'node:fs';
import path from 'node:path';

import { afterEach, expect, test } from 'bun:test';

import { APP_ROOT } from '../vite/atlas-files';
import { EXAMPLE_BRANCH, EXAMPLE_CURRENT, EXAMPLE_PREVIOUS, exampleReports, readExampleSpecs, servesExampleReports } from '../vite/example-reports';
import { openAtlas, type Atlas } from './atlas';

const coffeeRoot = path.join(APP_ROOT, 'example/specs');
const todoRoot = path.resolve(APP_ROOT, '../../examples/todo/specs');
const fixtureFeature = path.join(APP_ROOT, 'fixtures/full/specs/coffee/ordering/ordering.feature');

let atlas: Atlas | null = null;
afterEach(async () => {
  await atlas?.close();
  atlas = null;
});

function scenario(label: string) {
  return [...atlas!.host.querySelectorAll('li[data-status]')].find((item) => item.querySelector(':scope > button')?.textContent?.includes(label));
}

test('the example reports are served only for the coffee and todo specs', async () => {
  expect(servesExampleReports(coffeeRoot)).toBe(true);
  expect(servesExampleReports(todoRoot)).toBe(true);
  expect(servesExampleReports(path.resolve(APP_ROOT, '../../specs'))).toBe(false);
  expect(await exampleReports({ 'reports/catalog.feature': 'Feature: Catalog\n  Scenario: One\n    When it runs\n' })).toBeNull();
  expect(readFileSync(fixtureFeature, 'utf8')).toBe(readFileSync(path.join(coffeeRoot, 'coffee/ordering/ordering.feature'), 'utf8'));
});

test('the coffee example shows each environment, and a focused layer leaves the checks it did not run', async () => {
  const specs = readExampleSpecs(coffeeRoot);
  const deps = await exampleReports(specs);
  expect(deps).not.toBeNull();
  atlas = await openAtlas({ at: '/specs/gherkin', deps: deps!, specs });
  await atlas.sees('Order a drink');
  expect(atlas.find('nav[aria-label="Gherkin features"] a', 'Order a drink')!.getAttribute('data-result')).toBe('failed');
  expect(atlas.find('nav[aria-label="Gherkin features"] a', 'Loyalty stamps')!.getAttribute('data-result')).toBe('none');
  expect(atlas.find('button', 'Sources')!.textContent).toContain('5 layers');

  await atlas.click('nav[aria-label="Gherkin features"] a', 'Order a drink');
  await atlas.sees('Paying for the order');
  const card = () => scenario('Pays by card');
  expect(card()?.getAttribute('data-status')).toBe('failed');
  expect(card()?.textContent).toContain('Desktop web');
  expect(card()?.textContent).toContain('Mobile web');
  expect(card()?.textContent).toContain('iOS');
  expect(card()?.textContent).toContain('Android');
  const declined = () => scenario('Card declined, then a wallet works');
  expect(declined()?.getAttribute('data-status')).toBe('failed');
  expect(declined()?.textContent).toContain('Desktop web');
  expect(declined()?.textContent).not.toContain('iOS');
  const left = scenario('Drink left too long');
  expect(left?.getAttribute('data-status')).toBe('passed');
  expect(left?.textContent).not.toContain('iOS');
  expect(left?.textContent).not.toContain('Mobile web');
  expect(left?.textContent).not.toContain('Android');

  await atlas.click('button', 'Pays by card');
  await atlas.sees('The card form never appeared');
  await atlas.click('[aria-label="Environments"] button', 'Desktop web');
  await atlas.until(() => !atlas!.text().includes('The card form never appeared'), 'the desktop web pass');
  await atlas.sees('Open recording');
  await atlas.click('button', 'Open recording');
  await atlas.sees('Moment 3 of 3');
  await atlas.sees('Customer');
  await atlas.click('button', 'Order a drink');
  await atlas.sees('Paying for the order');

  await atlas.click('button', 'Card declined, then a wallet works');
  await atlas.sees('Recorded in 3 runs');
  await atlas.click('section[aria-label="Other runs of this check"] li button', 'Shared reports');
  await atlas.sees('An earlier result. A newer run replaced it in the combined report.');
  await atlas.click('button', 'Slow payment');
  await atlas.sees('Payment');
  await atlas.sees('60 s');
  await atlas.sees('Potentially outdated: related code has not been compared');

  await atlas.click('button', 'Sources');
  await atlas.sees('5 of 5 layers contribute');
  expect(atlas.text()).toContain('This machine');
  expect(atlas.text()).toContain('Shared reports');
  expect(atlas.text()).toContain('Device lab');
  expect(atlas.text()).toContain('feat/wallet');
  expect(atlas.text()).toContain(EXAMPLE_CURRENT.slice(0, 7));
  expect(atlas.text()).toContain(EXAMPLE_PREVIOUS.slice(0, 7));
  expect(atlas.text()).toContain(EXAMPLE_BRANCH.slice(0, 7));
  await atlas.click('label', 'iOS');
  await atlas.until(() => card()?.getAttribute('data-status') === 'passed', 'the desktop web result');
  expect(card()?.textContent).not.toContain('iOS');
  expect(declined()?.getAttribute('data-status')).toBe('failed');

  await atlas.go('/specs/gherkin?spec=coffee/ordering/loyalty.feature');
  await atlas.sees('No completed test report for this feature yet.');
  await atlas.go('/specs/quint?spec=coffee/ordering/cart.qnt');
  await atlas.sees('trace 1');
  await atlas.click('button', 'trace 1');
  await atlas.sees('items = 1');
  await atlas.go('/specs/dmn?spec=coffee/ordering/drink-price.dmn');
  await atlas.sees('large oat latte');
  await atlas.sees('Oat');
  expect(scenario('large oat latte')?.textContent).toContain('Mobile web');
});

test('the todo example shows the same list on each environment, filled by separate layers', async () => {
  const specs = readExampleSpecs(todoRoot);
  const deps = await exampleReports(specs);
  expect(deps).not.toBeNull();
  atlas = await openAtlas({ at: '/specs/gherkin?spec=share-a-list.feature', deps: deps!, specs });
  await atlas.sees('A weekend list');
  const weekend = () => scenario('Plans a weekend');
  expect(weekend()?.getAttribute('data-status')).toBe('failed');
  expect(weekend()?.textContent).toContain('Desktop web');
  expect(weekend()?.textContent).toContain('Mobile web');
  expect(weekend()?.textContent).toContain('iOS');
  expect(weekend()?.textContent).toContain('Android');
  await atlas.click('button', 'Plans a weekend');
  expect(atlas.find('[aria-label="Environments"] button', 'Android')!.textContent).toContain('device: phone');
  const offline = scenario('Starts over while offline');
  expect(offline?.getAttribute('data-status')).toBe('passed');
  expect(offline?.textContent).not.toContain('iOS');
  expect(scenario('Keeps working through a sync outage')?.getAttribute('data-status')).toBe('failed');
  await atlas.click('button', 'Keeps working through a sync outage');
  await atlas.sees('The retry never caught up');
  expect(atlas.find('nav[aria-label="Gherkin features"] a', 'Rename a list')!.getAttribute('data-result')).toBe('none');

  await atlas.click('button', 'Sources');
  await atlas.sees('5 of 5 layers contribute');
  expect(atlas.text()).toContain('feat/offline');
  expect(atlas.text()).toContain('Device lab');
  await atlas.click('label', 'iOS');
  await atlas.until(() => weekend()?.getAttribute('data-status') === 'passed', 'the other environments');
  expect(weekend()?.textContent).not.toContain('iOS');
});
