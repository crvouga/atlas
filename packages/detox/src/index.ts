/**
 * @module Detox driver
 *
 * The Atlas driver for native iOS and Android apps tested with Detox (https://wix.github.io/Detox/).
 * It owns launching and terminating the app, mapping signals to Detox matchers, screenshots, and
 * logging taps and typing to the step timeline; it does not record video (Detox does that through its
 * artifacts plugin). It must run inside a Detox test, where Detox's `device`, `element`, `by` and
 * `waitFor` globals exist, or be given them as `api`. Detox is typed structurally here, so importing
 * this module needs no Detox install.
 */
import { copyFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

import type { CheckResult, Driver, RecognizerResult, StateImplementation, Timeline } from '../../core/src/index';
import type { Signal, SignalContext } from '../../core/src/signals';
import { describeSignal } from '../../core/src/signals';

/** What Detox's `by.*` builders return: an opaque matcher that is only passed back to Detox's `element(...)`. */
export type DetoxMatcher = unknown;

/**
 * The parts of Detox's global API the driver uses (`device`, `element`, `by`, `waitFor`), typed
 * structurally so this package needs no Detox install to build. Detox's real globals satisfy it.
 */
export type DetoxApi = {
  /** The device under test; Detox's `device`. */
  device: {
    /** Launches the app; the driver passes `newInstance: true` and any `launchArgs`. */
    launchApp(params?: Record<string, unknown>): Promise<void>;
    /** Opens a deep link; when the device lacks it, `goto` throws. */
    openURL?(params: { url: string }): Promise<void>;
    /** Terminates the app; skipped when absent. */
    terminateApp?(): Promise<void>;
    /** Takes a screenshot and resolves to the path of the file Detox wrote. */
    takeScreenshot(name: string): Promise<string>;
  };
  /** Detox's `element(matcher)`: the actions the driver performs on an element. */
  element(matcher: DetoxMatcher): { tap(): Promise<void>; typeText(text: string): Promise<void>; replaceText?(text: string): Promise<void> };
  /** Detox's `by`: matcher builders. `traits` exists on iOS only. */
  by: {
    id(id: string): DetoxMatcher;
    text(text: string): DetoxMatcher;
    label(label: string): DetoxMatcher;
    traits?(traits: string[]): DetoxMatcher & { and?(other: DetoxMatcher): DetoxMatcher };
  };
  /** Detox's `waitFor(element)`, used to ask whether an element is visible. */
  waitFor(element: unknown): { toBeVisible(): { withTimeout(ms: number): Promise<void> } };
};

/**
 * What every event and recogniser receives from `detoxDriver`: Detox's API plus a `SignalContext`,
 * so implementations written against signals run here too. One context is created per path attempt.
 */
export type DetoxContext = DetoxApi & SignalContext & {
  /** The step timeline the actions below write to. */
  timeline: Timeline;
  /** Tap the element a matcher finds and log it to the step timeline. Rejects with Detox's error if the element is not found. */
  tap(matcher: DetoxMatcher, label: string): Promise<void>;
  /** Type `text` into the element a matcher finds (Detox `typeText`, which appends) and log it to the step timeline; `label` is the caption. */
  type(matcher: DetoxMatcher, text: string, label: string): Promise<void>;
};

/** Options of `detoxDriver`. */
export type DetoxDriverOptions = {
  /** Detox's globals; `globalThis` (where Detox puts them) by default. */
  api?: DetoxApi;
  /** Passed to `device.launchApp` as `launchArgs` at the start of every attempt. */
  launchArgs?: Record<string, unknown>;
};

/**
 * Translates a signal into a Detox matcher: test IDs are `by.id` (React Native's `testID`), labels
 * `by.label`, text `by.text`, a role with a name `by.label` (with the iOS `button` trait when Detox
 * has it). Detox matches exact strings, so regular expressions and CSS selectors are refused.
 *
 * @param api the Detox API whose `by` builds the matcher.
 * @throws Error for a `css` signal, a regular expression, or a role without a name.
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
 * Creates a driver for a native app tested with Detox. Every path attempt relaunches the app
 * (`device.launchApp({ newInstance: true })`) and terminates it afterwards. Screenshots come from
 * `device.takeScreenshot`. Detox records video per test through its artifacts plugin rather than per
 * call, so this driver does not record clips; enable Detox's `--record-videos` to keep a video of
 * each attempt.
 *
 * The Detox globals are read when an attempt opens, so call `runConfig` from inside a Detox test.
 * Signals are resolved with `detoxMatcher`, so regular expressions and CSS selectors are refused.
 *
 * @param options `api` to use instead of the globals, and `launchArgs` for the app.
 * @returns a driver whose context is a `DetoxContext`.
 *
 * @example
 * const config = defineConfig<DetoxContext>({
 *   specs: './specs',
 *   driver: detoxDriver({ launchArgs: { resetData: true } }),
 *   implementation
 * });
 * await runConfig(config, { mode: 'fast' });
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

/** Whether the matcher's element is visible right now: asks Detox with a zero timeout and counts any failure as not visible. */
async function visible(ctx: DetoxContext, matcher: DetoxMatcher) {
  try {
    await ctx.waitFor(ctx.element(matcher)).toBeVisible().withTimeout(0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Builds a state implementation recognised by Detox matchers: matched when every `all` matcher is
 * visible and no `none` matcher is. `checks` pair a statement from the state's `meta.checks` with
 * the matcher that proves it. Each entry's `name` appears in failure reports. Unlike
 * `screen(...)` from the signals module it takes matchers, not signals, and has no `any`.
 *
 * @example
 * states: { 'No todos': detoxScreen({ all: [{ matcher: by.text('Nothing to do yet'), name: 'empty message' }] }) }
 */
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
