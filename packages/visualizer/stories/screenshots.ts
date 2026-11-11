/** Captures a full-page picture of every built story for review. Run `bun run storybook:build` first.
 * Usage: `bun packages/visualizer/stories/screenshots.ts <output directory> [story id filter]`. */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { resolve, sep } from 'node:path';

const out = resolve(process.argv[2] ?? '.atlas-workspace/story-screenshots');
const filter = process.argv[3];
const scheme = process.env.ATLAS_STORYBOOK_SCHEME === 'dark' ? 'dark' : 'light';
const root = resolve('.atlas-workspace/storybook');
mkdirSync(out, { recursive: true });
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
  const path = resolve(root, '.' + decodeURIComponent(new URL(request.url).pathname));
  if (path !== root && !path.startsWith(root + sep)) return new Response('Not found', { status: 404 });
  const file = Bun.file(path === root ? resolve(root, 'index.html') : path);
  return await file.exists() ? new Response(file) : new Response('Not found', { status: 404 });
} });
const base = server.url.href.replace(/\/$/, '');
try {
  const index = await (await fetch(`${base}/index.json`)).json() as { entries: Record<string, { id: string; type: string }> };
  const stories = Object.values(index.entries).filter(entry => entry.type === 'story' && (!filter || entry.id.includes(filter)));
  const browser = await chromium.launch({ headless: true, executablePath: process.env.ATLAS_CHROMIUM || undefined });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', colorScheme: scheme });
  try {
    for (const story of stories) {
      const page = await context.newPage();
      if (story.id.includes('--mobile')) await page.setViewportSize({ width: 390, height: 844 });
      try {
        await page.goto(`${base}/iframe.html?id=${encodeURIComponent(story.id)}&viewMode=story&globals=scheme:${scheme}`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => {
          const phase = (window as unknown as { __STORYBOOK_PREVIEW__?: { currentRender?: { phase: string } } }).__STORYBOOK_PREVIEW__?.currentRender?.phase;
          return phase === 'finished' || phase === 'errored';
        }, undefined, { timeout: 30_000 });
        await page.waitForTimeout(1200);
        await page.screenshot({ path: resolve(out, `${story.id}.png`), fullPage: !story.id.includes('--mobile') ? false : false });
        console.log(`SHOT ${story.id}`);
      } catch (error) {
        console.error(`FAIL ${story.id}: ${error instanceof Error ? error.message : String(error)}`);
        process.exitCode = 1;
      } finally { await page.close(); }
    }
  } finally { await browser.close(); }
} finally { server.stop(true); }
