/**
 * @module Playwright screenshots, clips and paced actions
 *
 * The media side of the Playwright driver: `UserActions` taps and types like a person (pausing, and drawing a touch
 * indicator in showcase videos) while logging each action to the step's timeline; `captureScreen` takes a settled,
 * deterministic screenshot at device resolution plus a WebP thumbnail; `ScreencastRecorder` records an H.264 clip at
 * device resolution; `ffmpeg` runs the `ffmpeg` binary, which must be on the PATH for thumbnails and clips.
 *
 * @see docs/statecharts.md
 */
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { CDPSession, Locator, Page } from 'playwright';
import type { Timeline } from '../../core/src/index';
import type { Signal } from '../../core/src/signals';

import { locate } from './signals';

const isLocator = (target: Locator | Signal): target is Locator => 'waitFor' in target;

/**
 * Pauses, in milliseconds, that make a showcase video readable: how long the touch indicator takes to glide to a tap
 * target, the pause before the tap, the delay between typed characters, and the holds after and before a step.
 */
export type Pacing = {
  moveMs: number;
  pauseBeforeTapMs: number;
  typeDelayMs: number;
  holdAfterMs: number;
  holdBeforeMs: number;
};

/** The default pacing of showcase mode: a visible glide and pauses, so a person can follow the clip. */
export const SHOWCASE_PACING: Pacing = {
  moveMs: 600,
  pauseBeforeTapMs: 300,
  typeDelayMs: 60,
  holdAfterMs: 1000,
  holdBeforeMs: 500
};

/** No pauses at all; the pacing of fast mode. */
export const FAST_PACING: Pacing = {
  moveMs: 0,
  pauseBeforeTapMs: 0,
  typeDelayMs: 0,
  holdAfterMs: 0,
  holdBeforeMs: 0
};

/**
 * The default `device` of `playwrightDriver`: a 390 by 844 CSS pixel viewport at device scale factor 3 (screenshots
 * are 1170 by 2532 pixels), a mobile user agent and touch.
 */
export const PHONE = {
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true
} as const;

/**
 * A soft touch indicator for videos: a dot that glides to each tap target, a pressed state, and a
 * ripple. It lives in its own fixed layer and is hidden for screenshots.
 */
const TOUCH_OVERLAY = `(() => {
  if (window.__specTouch) return;
  const install = () => {
    const layer = document.createElement('div');
    layer.setAttribute('data-spec-touch', '');
    layer.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
    const dot = document.createElement('div');
    dot.style.cssText = 'position:absolute;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;background:rgba(124,58,237,.28);border:2px solid rgba(124,58,237,.75);box-shadow:0 2px 10px rgba(76,29,149,.25);opacity:0;transition:opacity .2s, transform .12s;left:50%;top:70%;';
    layer.appendChild(dot);
    document.documentElement.appendChild(layer);
    let x = window.innerWidth / 2, y = window.innerHeight * 0.7;
    window.__specTouch = {
      move(tx, ty, ms) {
        dot.style.opacity = '1';
        return new Promise((resolve) => {
          const sx = x, sy = y, start = performance.now();
          const step = (now) => {
            const t = ms <= 0 ? 1 : Math.min(1, (now - start) / ms);
            const e = t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
            x = sx + (tx - sx) * e; y = sy + (ty - sy) * e;
            dot.style.left = x + 'px'; dot.style.top = y + 'px';
            if (t < 1) requestAnimationFrame(step); else resolve();
          };
          requestAnimationFrame(step);
        });
      },
      press(down) { dot.style.transform = down ? 'scale(.78)' : 'scale(1)'; dot.style.background = down ? 'rgba(124,58,237,.5)' : 'rgba(124,58,237,.28)'; },
      ripple() {
        const r = document.createElement('div');
        r.style.cssText = 'position:absolute;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;border:2px solid rgba(124,58,237,.6);left:' + x + 'px;top:' + y + 'px;transition:transform .5s ease-out, opacity .5s ease-out;';
        layer.appendChild(r);
        requestAnimationFrame(() => { r.style.transform = 'scale(2.6)'; r.style.opacity = '0'; });
        setTimeout(() => r.remove(), 600);
      },
      visible(on) { layer.style.display = on ? 'block' : 'none'; }
    };
  };
  if (document.documentElement) install(); else document.addEventListener('DOMContentLoaded', install);
})();`;

/**
 * Taps and typing a person would do, paced for showcase videos and logged to the step timeline. Provided to event
 * implementations as `user` on the `PlaywrightContext`. `showTouches` turns on the touch indicator (showcase mode).
 */
export class UserActions {
  constructor(
    readonly page: Page,
    readonly pacing: Pacing,
    public timeline: Timeline,
    readonly showTouches: boolean
  ) {}

  /**
   * Registers the touch indicator overlay to be added to every page load, so it exists before the app's scripts run.
   * Call it once per page, before navigating.
   */
  static async install(page: Page) {
    await page.addInitScript(TOUCH_OVERLAY);
  }

  private async overlay<T>(fn: string, ...args: unknown[]) {
    if (!this.showTouches) return undefined as T;
    return this.page
      .evaluate(
        ({ fn, args }) => {
          const touch = (
            window as unknown as { __specTouch?: Record<string, (...a: unknown[]) => unknown> }
          ).__specTouch;
          return touch?.[fn]?.(...args);
        },
        { fn, args }
      )
      .catch(() => undefined) as Promise<T>;
  }

  /**
   * Taps the centre of a locator or a signal (resolved with `locate`). Waits up to 15 s for it to be visible, scrolls
   * it
   * into view, logs a `tap` entry labelled `label` to the timeline, then clicks (10 s timeout). In showcase mode the
   * touch
   * indicator glides there first. Throws when the target has no position on screen.
   */
  async tap(target: Locator | Signal, label: string) {
    const locator = isLocator(target) ? target : locate(this.page, target);
    await locator.waitFor({ state: 'visible', timeout: 15_000 });
    await locator.scrollIntoViewIfNeeded().catch(() => undefined);
    const box = await locator.boundingBox();
    if (!box) throw new Error(`"${label}" has no position on screen`);
    const x = Math.round(box.x + box.width / 2);
    const y = Math.round(box.y + box.height / 2);
    if (this.showTouches) {
      await this.overlay('move', x, y, this.pacing.moveMs);
      await this.page.waitForTimeout(this.pacing.pauseBeforeTapMs);
      await this.overlay('press', true);
    }
    this.timeline.add({ kind: 'tap', label, x, y });
    await locator.click({ timeout: 10_000 });
    if (this.showTouches) {
      await this.overlay('ripple');
      await this.overlay('press', false);
    }
  }

  /**
   * Taps `target`, clears it, then types `text` one character at a time, `pacing.typeDelayMs` apart. Logs a `tap` and
   * a `type` entry labelled `label` to the timeline.
   */
  async type(target: Locator | Signal, text: string, label: string) {
    const locator = isLocator(target) ? target : locate(this.page, target);
    await this.tap(locator, label);
    this.timeline.add({ kind: 'type', label, text });
    await locator.fill('');
    await locator.pressSequentially(text, { delay: this.pacing.typeDelayMs });
  }

  /** Waits `ms` milliseconds; does nothing when `ms` is zero or less. */
  async hold(ms: number) {
    if (ms > 0) await this.page.waitForTimeout(ms);
  }

  /** Hides the touch indicator, so a screenshot does not show it. */
  async hideTouches() {
    await this.overlay('visible', false);
  }

  /** Shows the touch indicator again after `hideTouches`. */
  async showTouchLayer() {
    await this.overlay('visible', true);
  }
}

/** The files `captureScreen` wrote: the full-size PNG and its WebP thumbnail. */
export type ScreenshotFiles = { png: string; webp?: string };

/**
 * Takes a settled, deterministic screenshot at device resolution, with the touch layer hidden: waits for the network to
 * go quiet (up to 5 s) and for fonts, disables animations and hides the caret. Writes the PNG to `file` (creating its
 * folder) and a 400 px wide WebP thumbnail beside it with FFmpeg. `mask` lists locators to paint over. Rejects when
 * FFmpeg is missing or fails.
 */
export async function captureScreen(
  page: Page,
  driver: UserActions,
  file: string,
  mask: Locator[] = []
): Promise<ScreenshotFiles> {
  mkdirSync(path.dirname(file), { recursive: true });
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
  await page.evaluate(() => document.fonts.ready.then(() => undefined)).catch(() => undefined);
  await driver.hideTouches();
  await page.screenshot({
    path: file,
    animations: 'disabled',
    caret: 'hide',
    scale: 'device',
    mask
  });
  await driver.showTouchLayer();
  const webp = file.replace(/\.png$/, '.webp');
  await ffmpeg([
    '-y',
    '-loglevel',
    'error',
    '-i',
    file,
    '-vf',
    'scale=400:-2',
    '-quality',
    '82',
    webp
  ]);
  return { png: file, webp };
}

/**
 * Runs `ffmpeg` with `args` and resolves when it exits with code 0. Rejects with the spawn error when `ffmpeg` is not
 * on the PATH, or with `ffmpeg <code>: <stderr>` when it fails.
 */
export function ffmpeg(args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}: ${stderr}`))
    );
  });
}

/**
 * Records a clip of a page at its physical resolution (1170×2532 for the default `PHONE`). Chrome's screencast, and
 * Playwright's built-in video that rides on it, only deliver CSS-pixel frames (390×844) and
 * upscale them, so text goes soft. Instead this loops device-scale JPEG captures (about 20 fps
 * here), keeps each frame's own timestamp, and encodes H.264 at 30 fps, holding each frame for as
 * long as it was on screen. The first frame becomes the poster.
 */
export class ScreencastRecorder {
  private session: CDPSession | null = null;
  private frames: { file: string; at: number }[] = [];
  private directory = '';
  private stoppedAt = 0;
  private running = false;
  private loop: Promise<void> | null = null;

  constructor(
    private readonly page: Page,
    private readonly scale: number = PHONE.deviceScaleFactor
  ) {}

  /** Begins capturing frames of the page into `workDirectory`, which is emptied first. Call `stop` to encode them. */
  async start(workDirectory: string) {
    this.directory = workDirectory;
    rmSync(workDirectory, { recursive: true, force: true });
    mkdirSync(workDirectory, { recursive: true });
    this.frames = [];
    this.session = await this.page.context().newCDPSession(this.page);
    const { width, height } = this.page.viewportSize() ?? PHONE.viewport;
    const clip = { x: 0, y: 0, width, height, scale: this.scale };
    this.running = true;
    const session = this.session;
    this.loop = (async () => {
      while (this.running) {
        const at = Date.now();
        const shot = await session
          .send('Page.captureScreenshot', {
            format: 'jpeg',
            quality: 90,
            clip,
            optimizeForSpeed: true
          })
          .catch(() => null);
        if (!shot) {
          await new Promise((r) => setTimeout(r, 30));
          continue;
        }
        const file = path.join(
          this.directory,
          `f${String(this.frames.length).padStart(5, '0')}.jpg`
        );
        writeFileSync(file, Buffer.from(shot.data, 'base64'));
        this.frames.push({ file, at });
      }
    })();
  }

  /**
   * Stops capturing and encodes the frames to the MP4 file `output` (the poster is written beside it, with `.mp4`
   * replaced by `.poster.webp`), then deletes the work directory. Resolves to `{ video, poster, durationMs }`, or
   * `null` when no frame was captured.
   */
  async stop(output: string) {
    this.stoppedAt = Date.now();
    this.running = false;
    await this.loop;
    if (this.session) {
      await this.session.detach().catch(() => undefined);
      this.session = null;
    }
    if (this.frames.length === 0) return null;
    const list = this.frames
      .map((frame, i) => {
        const next = this.frames[i + 1]?.at ?? this.stoppedAt;
        const seconds = Math.max(1 / 30, (next - frame.at) / 1000);
        return `file '${frame.file}'\nduration ${seconds.toFixed(3)}`;
      })
      .join('\n');
    const last = this.frames.at(-1)!.file;
    const concat = path.join(this.directory, 'frames.txt');
    writeFileSync(concat, `${list}\nfile '${last}'\n`);
    mkdirSync(path.dirname(output), { recursive: true });
    await ffmpeg([
      '-y',
      '-loglevel',
      'error',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      concat,
      '-vf',
      'fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p',
      '-c:v',
      'libx264',
      '-preset',
      'slow',
      '-crf',
      '18',
      '-movflags',
      '+faststart',
      output
    ]);
    const poster = output.replace(/\.mp4$/, '.poster.webp');
    await ffmpeg([
      '-y',
      '-loglevel',
      'error',
      '-i',
      this.frames[0]!.file,
      '-vf',
      'scale=600:-2',
      '-quality',
      '82',
      poster
    ]);
    const durationMs = this.stoppedAt - this.frames[0]!.at;
    rmSync(this.directory, { recursive: true, force: true });
    return { video: output, poster, durationMs };
  }
}
