/** Browser audit of every published story, including its interaction play. Start `bun run dev --storybook` first. */
import { chromium } from 'playwright';
import { resolve, sep } from 'node:path';

const built = process.argv.includes('--built');
const root = resolve(process.env.ATLAS_STORYBOOK_DIR ?? '.atlas-workspace/storybook');
const server = built ? Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
  const path = resolve(root, '.' + decodeURIComponent(new URL(request.url).pathname));
  if (path !== root && !path.startsWith(root + sep)) return new Response('Not found', { status: 404 });
  const file = Bun.file(path === root ? resolve(root, 'index.html') : path);
  return await file.exists() ? new Response(file) : new Response('Not found', { status: 404 });
} }) : null;
const base = server ? server.url.href.replace(/\/$/, '') : process.env.ATLAS_STORYBOOK_URL ?? 'http://127.0.0.1:6006';
try {
const index = await (await fetch(`${base}/index.json`)).json() as { entries: Record<string, { id: string; type: string }> };
const stories = Object.values(index.entries).filter(entry => entry.type === 'story' && (!process.env.ATLAS_STORYBOOK_STORY || entry.id === process.env.ATLAS_STORYBOOK_STORY));
if (!stories.length) throw new Error('No Storybook stories matched the audit selection.');
const browser = await chromium.launch({ headless: true, executablePath: process.env.ATLAS_CHROMIUM || undefined });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const failures: { story: string; message: string }[] = [];
try {
  for (const story of stories) {
    const page = await context.newPage();
    if (story.id.includes('--mobile')) await page.setViewportSize({ width: 390, height: 844 });
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(`${base}/iframe.html?id=${encodeURIComponent(story.id)}&viewMode=story`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => {
        const preview = (window as unknown as { __STORYBOOK_PREVIEW__?: { currentRender?: { phase: string } } }).__STORYBOOK_PREVIEW__;
        return preview?.currentRender?.phase === 'finished' || preview?.currentRender?.phase === 'errored';
      }, undefined, { timeout: 30_000 });
      await page.waitForFunction(() => !!document.querySelector('#storybook-root')?.textContent?.trim(), undefined, { timeout: 10_000 });
      // Queries resolve after the story's render phase; inspect the resulting screen as well.
      await page.waitForTimeout(400);
      const status = await page.evaluate(() => ({
        phase: (window as unknown as { __STORYBOOK_PREVIEW__?: { currentRender?: { phase: string } } }).__STORYBOOK_PREVIEW__?.currentRender?.phase,
        text: document.querySelector('#storybook-root')?.textContent ?? '',
        storyError: document.body.classList.contains('sb-show-errordisplay')
      }));
      if (status.phase === 'errored' || status.storyError || !status.text.trim() || errors.length) throw new Error(errors.join('; ') || `Story ${status.phase}; empty=${!status.text.trim()}`);
      const expected: Record<string, string> = {
        'tests-explorer--tests': 'Evidence states', 'tests-explorer--mobile-tests': 'Evidence states',
        'ui-catalog--ui-catalog': 'Browse the coffee menu', 'ui-catalog--mobile-catalog': 'Browse the coffee menu',
        'ui-catalog--catalog-gallery': 'Browse the coffee menu', 'specs-gherkin--gherkin': 'Order a drink',
        'specs-gherkin--mobile-feature': 'Order a drink', 'tests-test-detail--test-detail': 'Test detail',
        'tests-test-detail--failed-test-detail': 'Test detail', 'behaviors-workspace--behavior-workspace': 'What should happen',
        'states-empty--empty-tests': 'No reports yet', 'states-unavailable--unavailable-reports': 'unavailable',
        'settings--loaded': 'Reload settings', 'settings--conflict': 'Settings changed on the server.'
      };
      if (expected[story.id]) await page.getByText(expected[story.id]!, { exact: false }).filter({ visible: true }).first().waitFor({ state: 'visible', timeout: 10_000 });
      if (story.id === 'ui-catalog--catalog-gallery') {
        const images = page.locator('img[src*="/api/reports/layers/"]');
        await images.first().waitFor({ state: 'visible' });
        await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>('img[src*="/api/reports/layers/"]')].some(image => image.complete && image.naturalWidth > 0));
      }
      if (story.id === 'behaviors-coverage-states--demonstrated-behavior') {
        await page.locator('video').first().waitFor({ state: 'attached' });
        await page.waitForFunction(() => [...document.querySelectorAll('video')].some(video => video.readyState >= 1));
      }
      if (process.argv.includes('--a11y')) {
        await page.addScriptTag({ path: Bun.resolveSync('axe-core/axe.min.js', import.meta.dir) });
        const violations = await page.evaluate(async () => {
          const axe = (window as unknown as { axe: { run: (element: Element) => Promise<{ violations: { id: string; impact: string; nodes: { target: string[]; html: string; failureSummary?: string }[] }[] }> } }).axe;
          return (await axe.run(document.body)).violations.filter(issue => issue.impact === 'serious' || issue.impact === 'critical')
            // An open Mantine Menu keeps a focusable presentational guard inside its role="menu"; the library renders it, no story can remove it.
            .filter(issue => !(issue.id === 'aria-required-children' && issue.nodes.every(node => node.html.includes('data-menu-dropdown')))).map(issue => `${issue.id} (${issue.nodes.length}): ${issue.nodes.map(node => node.target.join(' ') + ' ' + node.html + ' ' + (node.failureSummary ?? '')).join('; ')}`);
        });
        if (violations.length) throw new Error('Accessibility: ' + violations.join(', '));
      }
      console.log(`PASS ${story.id}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ story: story.id, message });
      console.error(`FAIL ${story.id}: ${message.slice(0, 2500)}`);
    } finally { await page.close(); }
  }
} finally { await browser.close(); server?.stop(true); }
console.log(JSON.stringify({ stories: stories.length, passed: stories.length - failures.length, failures }, null, 2));
if (failures.length) process.exitCode = 1;

} finally { server?.stop(true); }
