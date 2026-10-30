/** Capture the example app's UI inventory with the same layer format any consumer can publish. */
import path from 'node:path';
import { chromium, type Page } from 'playwright';

import { captureUiState } from '../../packages/playwright/src/ui-catalog';
import { directoryStore } from '../../packages/reports/src/directory-store';
import type { ObjectStore } from '../../packages/reports/src/object-store';
import { publishChecks } from '../../packages/reports/src/publish-checks';
import { uiPlanLayer, uiStateLayer } from '../../packages/reports/src/ui-catalog-publish';
import { gitOrigin } from './spec-outline';
import { startTodoServer } from './server';

const profiles = [
  { environment: 'desktop-web', viewport: { width: 1280, height: 800 }, isMobile: false },
  { environment: 'mobile-web', viewport: { width: 390, height: 844 }, isMobile: true }
] as const;

// Each step uses the real app, retaining local changes for the offline states.
const states: { id: string; title: string; kind: string; covers: string[]; ready(page: Page, url: string): Promise<unknown> }[] = [
  { id: 'todo/welcome', title: 'Welcome', kind: 'screen', covers: ['onboarding'], ready: page => page.getByRole('heading', { name: 'Plan your day' }).waitFor() },
  { id: 'todo/naming', title: 'Name your list', kind: 'screen', covers: ['onboarding'], ready: async page => {
    await page.getByRole('button', { name: 'Get started', exact: true }).click();
    await page.getByRole('heading', { name: 'Name your list' }).waitFor();
  } },
  { id: 'todo/empty', title: 'Empty list', kind: 'empty', covers: ['list'], ready: async page => {
    await page.getByLabel('List name', { exact: true }).fill('Weekend chores');
    await page.getByRole('button', { name: 'Create list', exact: true }).click();
    await page.getByText('Nothing to do yet', { exact: true }).waitFor();
  } },
  { id: 'todo/active', title: 'Todos to do', kind: 'screen', covers: ['list'], ready: async page => {
    for (const title of ['Water the plants', 'Pick up groceries']) {
      await page.getByLabel('New todo').fill(title);
      const synced = page.waitForResponse(response => response.url().endsWith('/api/ops') && response.ok());
      await page.getByRole('button', { name: 'Add', exact: true }).click();
      await synced;
    }
    await page.getByText('2 left', { exact: true }).waitFor();
  } },
  { id: 'todo/offline', title: 'Sync interrupted', kind: 'error', covers: ['list', 'sync'], ready: async (page, url) => {
    const response = await fetch(`${url}/control/sync-failure`, { method: 'POST' });
    if (!response.ok) throw new Error(`Arming sync failure answered ${response.status}`);
    await page.clock.runFor(1000);
    await page.getByText('Offline', { exact: true }).waitFor();
  } },
  { id: 'todo/offline-pending', title: 'Changes waiting to sync', kind: 'error', covers: ['list', 'sync'], ready: async page => {
    await page.getByLabel('New todo').fill('Walk the dog');
    await page.getByRole('button', { name: 'Add', exact: true }).click();
    await page.getByText('not synced', { exact: true }).waitFor();
  } },
  { id: 'todo/completed', title: 'All todos completed', kind: 'screen', covers: ['list', 'sync'], ready: async page => {
    await page.clock.fastForward(30_000);
    await page.getByText('All changes synced', { exact: true }).waitFor();
    const synced = page.waitForResponse(response => response.url().endsWith('/api/ops') && response.ok());
    await page.getByRole('button', { name: 'Mark all done', exact: true }).click();
    await synced;
    await page.getByText('All done!', { exact: true }).waitFor();
  } }
];

/** Publish the expected set and real screenshots; owns and closes its browser and isolated app server. */
export async function populateExampleCatalog(store: ObjectStore = directoryStore(path.join(import.meta.dir, 'atlas-reports'))): Promise<void> {
  const origin = { producer: 'todo-ui-catalog', recordedAtMs: Date.now(), ...await gitOrigin(import.meta.dir) };
  const inventory = ['onboarding', 'list', 'sync'].map(id => ({ id, title: id, inventory: true }));
  const profileOf = ({ viewport }: typeof profiles[number]) => ({ viewport: `${viewport.width}x${viewport.height}`, scheme: 'light' });
  for (const profile of profiles) {
    await publishChecks(store, uiPlanLayer({ ...origin, environment: profile.environment, profile: profileOf(profile), states: [...states, ...inventory] }));
  }
  const server = await startTodoServer();
  try {
    const browser = await chromium.launch({ headless: true });
    let failed = 0;
    try {
      for (const profile of profiles) {
        const context = await browser.newContext({ viewport: profile.viewport, isMobile: profile.isMobile, hasTouch: profile.isMobile, colorScheme: 'light' });
        try {
          const page = await context.newPage();
          page.setDefaultTimeout(5000);
          await page.clock.install();
          const reset = await fetch(`${server.url}/control/reset`, { method: 'POST' });
          if (!reset.ok) throw new Error(`Resetting the app answered ${reset.status}`);
          await page.goto(server.url);
          for (const state of states) {
            const capture = await captureUiState(page, {
              id: state.id, title: state.title, kind: state.kind, covers: state.covers,
              route: '/', area: 'Todo app', fixture: state.id, labels: { browser: 'chromium' },
              readyTimeoutMs: 10_000, ready: async () => { await state.ready(page, server.url); }
            });
            if (capture.status === 'failed') failed++;
            // Publish as collection progresses, not only after the entire profile succeeds.
            await publishChecks(store, uiStateLayer({ ...origin, environment: profile.environment, profile: profileOf(profile), states: [capture] }));
            console.log(`UI catalog: ${profile.environment} ${state.id} ${capture.status}${capture.detail ? ` (${capture.detail})` : ''}`);
          }
        } finally { await context.close(); }
      }
    } finally { await browser.close(); }
    if (failed) throw new Error(`${failed} example UI catalog captures failed; diagnostic results were saved.`);
  } finally { await server.close(); }
}

if (import.meta.main) await populateExampleCatalog();
