import type { CheckResult, RecognizerResult, StateImplementation } from './run/types';

/**
 * A UI signal: something visible (or not) that proves where the app is. Test IDs first, then
 * accessible roles and names, then labels and text, as the Testing Library guidance orders them.
 * The same values work with every driver that recognises screens by signals (Playwright, Bun
 * WebView, WebDriver); each resolves them against its own UI tree.
 */
export type Signal =
  | { testId: string }
  | { role: string; name?: string | RegExp; exact?: boolean }
  | { text: string | RegExp; exact?: boolean }
  | { label: string | RegExp }
  | { css: string };

export const testId = (id: string): Signal => ({ testId: id });
export const text = (value: string | RegExp, options: { exact?: boolean } = {}): Signal => ({ text: value, ...options });
export const role = (r: string, name?: string | RegExp, options: { exact?: boolean } = {}): Signal => ({ role: r, ...(name ? { name } : {}), ...options });
export const label = (value: string | RegExp): Signal => ({ label: value });
export const css = (selector: string): Signal => ({ css: selector });

export function describeSignal(signal: Signal) {
  if ('testId' in signal) return `test ID "${signal.testId}"`;
  if ('role' in signal) return `${signal.role}${signal.name ? ` "${String(signal.name)}"` : ''}`;
  if ('label' in signal) return `label ${String(signal.label)}`;
  if ('css' in signal) return `selector ${signal.css}`;
  return `text ${String(signal.text)}`;
}

export type SignatureSpec<S = Signal> = { all?: S[]; any?: S[]; none?: S[] };

export type ScreenSpec<C, S = Signal> = SignatureSpec<S> & {
  checks?: { check: string; signal: S }[];
  transient?: boolean;
  sameAs?: string;
  lookIn?: (ctx: C) => Promise<void>;
  settle?: (ctx: C) => Promise<void>;
};

/**
 * Build `screen()` for a driver from one question: is this signal visible right now? A state is
 * recognised when every `all` is visible, one `any` is visible and no `none` is. Drivers with
 * their own locators (WebDriver's) pass their signal type and how to describe it.
 */
export function signatureScreen<C, S = Signal>(isVisible: (ctx: C, signal: S) => Promise<boolean>, describe: (signal: S) => string) {
  const visible = (ctx: C, signal: S) => isVisible(ctx, signal).catch(() => false);
  const describeSignal = describe;
  return function screen(spec: ScreenSpec<C, S>): StateImplementation<C> {
    return {
      async recognize(ctx): Promise<RecognizerResult> {
        const signals: RecognizerResult['signals'] = [];
        for (const s of spec.all ?? []) signals.push({ signal: describeSignal(s), expected: 'visible', visible: await visible(ctx, s) });
        if (spec.any?.length) {
          let seen = false;
          for (const s of spec.any) if (await visible(ctx, s)) seen = true;
          signals.push({ signal: `one of: ${spec.any.map(describeSignal).join(' | ')}`, expected: 'visible', visible: seen });
        }
        for (const s of spec.none ?? []) signals.push({ signal: describeSignal(s), expected: 'hidden', visible: await visible(ctx, s) });
        return { matched: signals.every((x) => (x.expected === 'visible' ? x.visible : !x.visible)), signals };
      },
      ...(spec.checks
        ? {
            async checks(ctx: C): Promise<CheckResult[]> {
              const results: CheckResult[] = [];
              for (const { check, signal } of spec.checks!) {
                const seen = await visible(ctx, signal);
                results.push({ check, passed: seen, expected: `${describeSignal(signal)} visible`, actual: seen ? 'visible' : 'not on screen' });
              }
              return results;
            }
          }
        : {}),
      ...(spec.transient ? { transient: true } : {}),
      ...(spec.sameAs ? { sameAs: spec.sameAs } : {}),
      ...(spec.lookIn ? { lookIn: spec.lookIn } : {}),
      ...(spec.settle ? { settle: spec.settle } : {})
    };
  };
}

/**
 * The driver-neutral surface of a screen: Playwright, Bun WebView and WebDriver (web and native)
 * contexts all provide it, so an implementation written against it runs on any of them, and the
 * clients of one run can use different drivers.
 */
export type SignalContext = {
  /** Open a URL (a path resolves against the driver's base URL; a deep link in a native app). */
  goto(url: string): Promise<void>;
  isVisible(signal: Signal): Promise<boolean>;
  user: {
    tap(target: Signal, label: string): Promise<void>;
    type(target: Signal, text: string, label: string): Promise<void>;
  };
};

/** A state recognised from signals on any driver that provides a `SignalContext`. */
export const screen = signatureScreen<SignalContext>((ctx, signal) => ctx.isVisible(signal), describeSignal);

type WireMatch = { text: string; exact: boolean } | { regex: string; flags: string };
export type WireSignal =
  | { kind: 'css'; selector: string }
  | { kind: 'testId'; id: string }
  | { kind: 'role'; role: string; name: WireMatch | null }
  | { kind: 'label'; match: WireMatch }
  | { kind: 'text'; match: WireMatch };

const wire = (value: string | RegExp, exact = false): WireMatch =>
  typeof value === 'string' ? { text: value, exact } : { regex: value.source, flags: value.flags };

/** A signal as JSON, for a probe that runs inside the page. */
export function toWire(signal: Signal): WireSignal {
  if ('testId' in signal) return { kind: 'testId', id: signal.testId };
  if ('role' in signal) return { kind: 'role', role: signal.role, name: signal.name ? wire(signal.name, signal.exact) : null };
  if ('label' in signal) return { kind: 'label', match: wire(signal.label) };
  if ('css' in signal) return { kind: 'css', selector: signal.css };
  return { kind: 'text', match: wire(signal.text, signal.exact) };
}

/** Where a probe found a signal: whether it is visible, and the centre of the first visible match in CSS pixels. */
export type DomProbeResult = { visible: boolean; count: number; x?: number; y?: number };

/**
 * A function expression, as source, that finds a wire signal in a DOM: `(signal, scroll,
 * withElement) => DomProbeResult`, plus the element itself when `withElement` is set (WebDriver
 * returns it as an element reference). It is plain JavaScript so any driver can run it in a page (Bun WebView's
 * `evaluate`, WebDriver's Execute Script). Roles follow the HTML-AAM implicit role mapping for the
 * common elements; names follow aria-label, the associated label, then text content.
 */
export const DOM_PROBE = `(signal, scroll, withElement) => {
  const norm = (s) => String(s || '').replace(/\\s+/g, ' ').trim();
  const matches = (value, m) => (m.regex !== undefined ? new RegExp(m.regex, m.flags).test(value) : m.exact ? value === m.text : value.toLowerCase().includes(m.text.toLowerCase()));
  const shown = (el) => {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && st.visibility !== 'hidden' && st.display !== 'none' && Number(st.opacity) !== 0;
  };
  const ROLES = {
    button: 'button,[role=button],input[type=button],input[type=submit],input[type=reset]',
    heading: 'h1,h2,h3,h4,h5,h6,[role=heading]',
    link: 'a[href],[role=link]',
    textbox: 'input:not([type]),input[type=text],input[type=email],input[type=tel],input[type=url],input[type=search],input[type=password],textarea,[role=textbox]',
    checkbox: 'input[type=checkbox],[role=checkbox]',
    radio: 'input[type=radio],[role=radio]',
    combobox: 'select,[role=combobox]',
    listitem: 'li,[role=listitem]',
    list: 'ul,ol,[role=list]',
    status: 'output,[role=status]',
    alert: '[role=alert]',
    dialog: 'dialog,[role=dialog]',
    img: 'img[alt],[role=img]'
  };
  const labelOf = (el) => norm(el.getAttribute('aria-label') || (el.labels && el.labels[0] ? el.labels[0].textContent : ''));
  const nameOf = (el) => labelOf(el) || norm(el.textContent) || norm(el.getAttribute('alt') || el.getAttribute('title') || el.getAttribute('placeholder') || (el.type === 'submit' || el.type === 'button' ? el.value : ''));
  const ownText = (el) => Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim());
  let found = [];
  if (signal.kind === 'css') found = Array.from(document.querySelectorAll(signal.selector));
  else if (signal.kind === 'testId') found = Array.from(document.querySelectorAll('[data-testid="' + CSS.escape(signal.id) + '"]'));
  else if (signal.kind === 'role') found = Array.from(document.querySelectorAll(ROLES[signal.role] || '[role="' + signal.role + '"]')).filter((el) => !signal.name || matches(nameOf(el), signal.name));
  else if (signal.kind === 'label') found = Array.from(document.querySelectorAll('input,textarea,select,[aria-label]')).filter((el) => matches(labelOf(el), signal.match));
  else found = Array.from(document.querySelectorAll('body *')).filter((el) => ownText(el) && matches(norm(el.textContent), signal.match));
  const el = found.find(shown);
  if (!el) return { visible: false, count: found.length };
  if (scroll) el.scrollIntoView({ block: 'center', inline: 'center' });
  const r = el.getBoundingClientRect();
  const at = { visible: true, count: found.length, x: r.x + r.width / 2, y: r.y + r.height / 2 };
  return withElement ? Object.assign(at, { element: el }) : at;
}`;
