import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { captureUiState } from '../../packages/playwright/src/ui-catalog';
import { publishChecks } from '../../packages/reports/src/publish-checks';
import { uiPlanLayer, uiStateLayer, type UiStateCapture } from '../../packages/reports/src/ui-catalog-publish';
import { directoryStore } from '../../packages/reports/src/directory-store';
import { startTodoServer } from './server';
import { gitOrigin } from './spec-outline';

const root = path.dirname(fileURLToPath(import.meta.url));
const states = [
  { id: 'todo/welcome', title: 'Welcome', kind: 'screen' },
  { id: 'todo/naming', title: 'Name your list', kind: 'screen' },
  { id: 'todo/naming-filled', title: 'List name entered', kind: 'screen' },
  { id: 'todo/empty', title: 'Empty list', kind: 'empty' },
  { id: 'todo/open', title: 'Open todos', kind: 'screen' },
  { id: 'todo/done', title: 'All todos done', kind: 'screen' },
  { id: 'todo/offline', title: 'Offline list', kind: 'error' }
].map(state => ({ ...state, area: 'Todo', route: '/', fixture: 'todo-example', covers: ['todo-app'] }));

/** Capture the real Todo app under desktop and mobile profiles; publish failures truthfully as diagnostic captures. */
export async function populateUiCatalog(reports = path.join(root, 'atlas-reports')): Promise<void> {
  const server = await startTodoServer({ port: 0 });
  const store = directoryStore(reports);
  let browser;
  let failed = false;
  try {
    browser = await chromium.launch();
    const origin = await gitOrigin(root);
    for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
      const context = await browser.newContext({ viewport, isMobile: viewport.width < 600, deviceScaleFactor: 1 });
      try {
        const page = await context.newPage();
        await page.clock.install();
        await fetch(`${server.url}/control/reset`, { method: 'POST' });
        await page.goto(server.url);
        const input = { ...origin, recordedAtMs: Date.now(), environment: viewport.width < 600 ? 'mobile-web' : 'desktop-web',
          profile: { viewport: `${viewport.width}x${viewport.height}`, scheme: 'light' } };
        await publishChecks(store, uiPlanLayer({ ...input, producer: 'todo-ui-plan', states }));
        const captures: UiStateCapture[] = [];
        const capture = async (index: number, ready: () => Promise<unknown>) => {
          const result = await captureUiState(page, { ...states[index]!, ready: async () => { await ready(); }, readyTimeoutMs: 5000 });
          captures.push(result);
          if (result.status === 'failed') failed = true;
        };
        await capture(0, () => page.getByRole('heading', { name: 'Plan your day' }).waitFor());
        await page.getByRole('button', { name: 'Get started' }).click();
        await capture(1, () => page.getByRole('heading', { name: 'Name your list' }).waitFor());
        await page.getByLabel('List name', { exact: true }).fill('Weekend chores');
        await capture(2, () => page.locator('[data-testid="create-list"]:enabled').waitFor());
        await page.getByRole('button', { name: 'Create list' }).click();
        await capture(3, () => page.getByText('Nothing to do yet', { exact: true }).waitFor());
        await page.getByLabel('New todo', { exact: true }).fill('Water the plants');
        await page.getByRole('button', { name: 'Add', exact: true }).click();
        await capture(4, () => page.getByText('1 left', { exact: true }).waitFor());
        await page.getByRole('button', { name: 'Mark all done' }).click();
        await capture(5, () => page.getByText('All done!', { exact: true }).waitFor());
        await fetch(`${server.url}/control/sync-failure`, { method: 'POST' });
        await page.clock.fastForward(1000);
        await capture(6, () => page.getByText('Offline', { exact: true }).waitFor());
        await publishChecks(store, uiStateLayer({ ...input, producer: 'todo-ui-capture', states: captures }));
        console.log(`UI catalog: ${captures.length} states captured at ${input.profile.viewport}`);
      } finally { await context.close(); }
    }
  } finally {
    await browser?.close();
    await server.close();
  }
  if (failed) throw new Error('Some UI catalog captures failed; diagnostic evidence was saved.');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await populateUiCatalog();
