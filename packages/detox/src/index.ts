import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import type { CheckResult, Driver, RecognizerResult, StateImplementation, Timeline } from '@crvouga/atlas';

/**
 * The parts of Detox's global API the driver uses (`device`, `element`, `by`, `waitFor`), typed
 * structurally so this package needs no Detox install to build.
 */
export type DetoxMatcher = unknown;
export type DetoxApi = {
  device: {
    launchApp(params?: Record<string, unknown>): Promise<void>;
    terminateApp?(): Promise<void>;
    takeScreenshot(name: string): Promise<string>;
  };
  element(matcher: DetoxMatcher): { tap(): Promise<void>; typeText(text: string): Promise<void>; replaceText?(text: string): Promise<void> };
  by: { id(id: string): DetoxMatcher; text(text: string): DetoxMatcher; label(label: string): DetoxMatcher };
  waitFor(element: unknown): { toBeVisible(): { withTimeout(ms: number): Promise<void> } };
};

export type DetoxContext = DetoxApi & {
  timeline: Timeline;
  /** Tap an element and log it to the step timeline. */
  tap(matcher: DetoxMatcher, label: string): Promise<void>;
  type(matcher: DetoxMatcher, text: string, label: string): Promise<void>;
};

export type DetoxDriverOptions = {
  /** Detox's globals; `globalThis` (where Detox puts them) by default. */
  api?: DetoxApi;
  launchArgs?: Record<string, unknown>;
};

/**
 * Drive a native app with Detox. Screenshots come from `device.takeScreenshot`. Detox records
 * video per test through its artifacts plugin rather than per call, so this driver does not
 * record clips; enable Detox's `--record-videos` to keep a video of each attempt.
 */
export function detoxDriver(options: DetoxDriverOptions = {}): Driver<DetoxContext> {
  const api = () => options.api ?? (globalThis as unknown as DetoxApi);
  return {
    name: 'detox',
    async open({ timeline }) {
      const d = api();
      await d.device.launchApp({ newInstance: true, ...(options.launchArgs ? { launchArgs: options.launchArgs } : {}) });
      return {
        ...d,
        timeline,
        async tap(matcher, label) {
          timeline.add({ kind: 'tap', label });
          await d.element(matcher).tap();
        },
        async type(matcher, text, label) {
          timeline.add({ kind: 'type', label, text });
          await d.element(matcher).typeText(text);
        }
      };
    },
    async close(ctx) {
      await ctx.device.terminateApp?.().catch(() => undefined);
    },
    async screenshot(ctx, file) {
      const taken = await ctx.device.takeScreenshot(path.basename(file, '.png'));
      mkdirSync(path.dirname(file), { recursive: true });
      copyFileSync(taken, file);
      return { png: file };
    }
  };
}

async function visible(ctx: DetoxContext, matcher: DetoxMatcher) {
  try {
    await ctx.waitFor(ctx.element(matcher)).toBeVisible().withTimeout(0);
    return true;
  } catch {
    return false;
  }
}

/** A state recognised by Detox matchers: every `all` visible and no `none` visible. */
export function detoxScreen(spec: {
  all: { matcher: DetoxMatcher; name: string }[];
  none?: { matcher: DetoxMatcher; name: string }[];
  checks?: { check: string; matcher: DetoxMatcher; name: string }[];
}): StateImplementation<DetoxContext> {
  return {
    async recognize(ctx): Promise<RecognizerResult> {
      const signals: RecognizerResult['signals'] = [];
      for (const s of spec.all) signals.push({ signal: s.name, expected: 'visible', visible: await visible(ctx, s.matcher) });
      for (const s of spec.none ?? []) signals.push({ signal: s.name, expected: 'hidden', visible: await visible(ctx, s.matcher) });
      return { matched: signals.every((x) => (x.expected === 'visible' ? x.visible : !x.visible)), signals };
    },
    ...(spec.checks
      ? {
          async checks(ctx): Promise<CheckResult[]> {
            const out: CheckResult[] = [];
            for (const c of spec.checks!) {
              const ok = await visible(ctx, c.matcher);
              out.push({ check: c.check, passed: ok, expected: `${c.name} visible`, actual: ok ? 'visible' : 'not on screen' });
            }
            return out;
          }
        }
      : {})
  };
}
