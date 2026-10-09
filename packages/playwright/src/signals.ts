import type { CheckResult, RecognizerResult, StateImplementation } from '@crvouga/atlas';
import type { Signal } from '@crvouga/atlas/signals';
import type { Locator, Page } from 'playwright';
import { describeSignal } from '@crvouga/atlas/signals';

export { css, describeSignal, label, role, testId, text, type Signal } from '@crvouga/atlas/signals';

type AriaRole = Parameters<Page['getByRole']>[0];

/** A signal as a Playwright locator: the first visible match, with Playwright's own role and text rules. */
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

export type SignatureSpec = { all?: Signal[]; any?: Signal[]; none?: Signal[] };

/** Recognise a state from its UI signature: every `all` visible, one `any` visible, no `none`. */
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

/** Checks that a quoted piece of the spec is on screen; records expected and actual on failure. */
export async function checkSignals(page: Page, checks: { check: string; signal: Signal }[]): Promise<CheckResult[]> {
  const results: CheckResult[] = [];
  for (const { check, signal } of checks) {
    const visible = await isVisible(page, signal);
    results.push({ check, passed: visible, expected: `${describeSignal(signal)} visible`, actual: visible ? 'visible' : 'not on screen' });
  }
  return results;
}

/**
 * A state implementation from a UI signature, for a context that exposes `page`. Extra fields
 * (`lookIn`, `settle`, `transient`, `sameAs`, `checks`) pass through.
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
