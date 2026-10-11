import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import type { CheckResult, Driver, RecognizerResult, StateImplementation, Timeline } from '@crvouga/atlas';
import type { Signal, SignalContext } from '@crvouga/atlas/signals';
import { describeSignal } from '@crvouga/atlas/signals';

/**
 * The parts of Detox's global API the driver uses (`device`, `element`, `by`, `waitFor`), typed
 * structurally so this package needs no Detox install to build.
 */
export type DetoxMatcher = unknown;
export type DetoxApi = {
  device: {
    launchApp(params?: Record<string, unknown>): Promise<void>;
    openURL?(params: { url: string }): Promise<void>;
    terminateApp?(): Promise<void>;
    takeScreenshot(name: string): Promise<string>;
  };
  element(matcher: DetoxMatcher): { tap(): Promise<void>; typeText(text: string): Promise<void>; replaceText?(text: string): Promise<void> };
  by: {
    id(id: string): DetoxMatcher;
    text(text: string): DetoxMatcher;
    label(label: string): DetoxMatcher;
    traits?(traits: string[]): DetoxMatcher & { and?(other: DetoxMatcher): DetoxMatcher };
  };
  waitFor(element: unknown): { toBeVisible(): { withTimeout(ms: number): Promise<void> } };
};

/** Detox's API plus a `SignalContext`, so implementations written against signals run here too. */
export type DetoxContext = DetoxApi & SignalContext & {
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
 * A signal as a Detox matcher: test IDs are `by.id` (React Native's `testID`), labels `by.label`,
 * text `by.text`, a role with a name `by.label` (with the iOS `button` trait when Detox has it).
 * Detox matches exact strings, so regular expressions and CSS selectors are refused.
 */
export function detoxMatcher(api: DetoxApi, signal: Signal): DetoxMatcher {
  if ('testId' in signal) return api.by.id(signal.testId);
  if ('css' in signal) throw new Error(`${describeSignal(signal)}: CSS selectors only work in web sessions`);
  const value = 'label' in signal ? signal.label : 'role' in signal ? signal.name : signal.text;
  if (value === undefined) throw new Error(`${describeSignal(signal)}: Detox needs a name to find a role`);
  if (value instanceof RegExp) throw new Error(`${describeSignal(signal)}: Detox matches exact text, not regular expressions`);
  if ('text' in signal) return api.by.text(value);
  const byLabel = api.by.label(value);
  if ('role' in signal && signal.role === 'button' && api.by.traits) {
    const trait = api.by.traits(['button']);
    return trait.and ? trait.and(byLabel) : byLabel;
  }
  return byLabel;
}

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
      const tap = async (matcher: DetoxMatcher, label: string) => {
        timeline.add({ kind: 'tap', label });
        await d.element(matcher).tap();
      };
      const type = async (matcher: DetoxMatcher, text: string, label: string) => {
        timeline.add({ kind: 'type', label, text });
        await d.element(matcher).typeText(text);
      };
      const ctx: DetoxContext = {
        ...d,
        timeline,
        tap,
        type,
        async goto(url) {
          if (!d.device.openURL) throw new Error('This Detox device cannot open URLs');
          await d.device.openURL({ url });
        },
        isVisible: (signal) => visible(ctx, detoxMatcher(d, signal)),
        user: {
          tap: (signal, label) => tap(detoxMatcher(d, signal), label),
          type: (signal, text, label) => type(detoxMatcher(d, signal), text, label)
        }
      };
      return ctx;
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
