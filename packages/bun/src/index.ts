/**
 * @module Bun WebView driver entry point (`@crvouga/atlas/bun`)
 *
 * Re-exports the Bun WebView driver for statechart runs (`bunWebViewDriver`), its context and option types, `screen`
 * for recognising states from signals, and the signal constructors. Needs the Bun runtime.
 *
 * @see docs/statecharts.md
 */
export { bunWebViewDriver, screen, type BunWebView, type BunWebViewDriverOptions, type WebViewContext } from './driver';
export { css, label, role, testId, text, describeSignal, type Signal } from '../../core/src/signals';
