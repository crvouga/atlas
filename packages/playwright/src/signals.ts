/**
 * @module Playwright signal helpers
 *
 * Maps the driver-neutral `Signal` values (test ID, role, label, text, CSS) to Playwright locators, and builds state
 * recognisers from them: `recognize` evaluates a UI signature, `checkSignals` verifies quoted spec text is on screen,
 * and `screen` wraps both into a `StateImplementation` for any context that exposes `page`. Also re-exports the
 * signal constructors so an implementation imports everything from `@crvouga/atlas/playwright`. Visibility always
 * means the first visible match.
 *
 * @see docs/statecharts.md
 */
import type { CheckResult, RecognizerResult, StateImplementation } from '../../core/src/index';
import type { Signal } from '../../core/src/signals';
import type { Locator, Page } from 'playwright';
import { describeSignal } from '../../core/src/signals';

export { css, describeSignal, label, role, testId, text, type Signal } from '../../core/src/signals';

type AriaRole = Parameters<Page['getByRole']>[0];

/**
 * Resolves a `Signal` to a Playwright locator for the first visible match, using Playwright's own role, label and
 * text rules (text matches are substrings unless `exact`).
 */
export function locate(page: Page, signal: Signal): Locator {
  if ('testId' in signal) return page.getByTestId(signal.testId).filter({ visible: true }).first();
  if ('role' in signal) {
    const options = { ...(signal.name ? { name: signal.name } : {}), ...(signal.exact ? { exact: true } : {}) };
    return page.getByRole(signal.role as AriaRole, options).filter({ visible: true }).first();
  }
  if ('label' in signal) return page.getByLabel(signal.label).filter({ visible: true }).first();
  if ('css' in signal) return page.locator(signal.css).filter({ visible: true }).first();
  return page.getByText(signal.text, signal.exact ? { exact: true } : {}).filter({ visible: true }).first();
}

const isVisible = (page: Page, signal: Signal) => locate(page, signal).isVisible().catch(() => false);

/**
 * A state's UI signature: every `all` signal visible, at least one `any` signal visible (when `any` is given), and no
 * `none` signal visible.
 */
export type SignatureSpec = { all?: Signal[]; any?: Signal[]; none?: Signal[] };

/**
 * Recognises a state from its UI signature on `page`: every `all` signal visible, one `any` signal visible (when `any`
 * is given), no `none` signal visible. Returns `matched` plus one entry per signal with what was expected and whether
 * it
 * was visible, which the report shows when the state is not recognised. A signal that cannot be evaluated counts as not
 * visible.
 */
export async function recognize(page: Page, spec: SignatureSpec): Promise<RecognizerResult> {
  const signals: RecognizerResult['signals'] = [];
  for (const s of spec.all ?? []) signals.push({ signal: describeSignal(s), expected: 'visible', visible: await isVisible(page, s) });
  if (spec.any?.length) {
    let seen = false;
    for (const s of spec.any) if (await isVisible(page, s)) seen = true;
    signals.push({ signal: `one of: ${spec.any.map(describeSignal).join(' | ')}`, expected: 'visible', visible: seen });
  }
  for (const s of spec.none ?? []) signals.push({ signal: describeSignal(s), expected: 'hidden', visible: await isVisible(page, s) });
  return { matched: signals.every((x) => (x.expected === 'visible' ? x.visible : !x.visible)), signals };
}

/**
 * Checks that each quoted piece of the spec (`check`) is visible on screen; returns one result per check, with
 * `expected` and `actual` filled in.
 */
export async function checkSignals(page: Page, checks: { check: string; signal: Signal }[]): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const { check, signal } of checks) {
    const visible = await isVisible(page, signal);
    results.push({ check, passed: visible, expected: `${describeSignal(signal)} visible`, actual: visible ? 'visible' : 'not on screen' });
  }
  return results;
}

/**
 * Builds a state implementation from a UI signature, for a context that exposes `page` (the `PlaywrightContext`). The
 * state is recognised as `recognize` describes; `checks` become the state's `meta.checks` results. The other fields
 * (`lookIn`, `settle`, `transient`, `sameAs`) pass through to the `StateImplementation`.
 *
 * @see docs/statecharts.md
 *
 * @example
 * ```ts
 * import { role, screen, text } from '@crvouga/atlas/playwright';
 *
 * const states = {
 *   'No todos': screen({ all: [text('Nothing to do yet')], none: [role('listitem')] })
 * };
 * ```
 */
export function screen<C extends { page: Page }>(
  spec: SignatureSpec & {
    checks?: { check: string; signal: Signal }[];
    transient?: boolean;
    sameAs?: string;
    lookIn?: (ctx: C) => Promise<void>;
    settle?: (ctx: C) => Promise<void>;
  }
): StateImplementation<C> {
  return {
    recognize: (ctx) => recognize(ctx.page, spec),
    ...(spec.checks ? { checks: (ctx: C) => checkSignals(ctx.page, spec.checks!) } : {}),
    ...(spec.transient ? { transient: true } : {}),
    ...(spec.sameAs ? { sameAs: spec.sameAs } : {}),
    ...(spec.lookIn ? { lookIn: spec.lookIn } : {}),
    ...(spec.settle ? { settle: spec.settle } : {})
  };
}
