/**
 * @module Playwright driver entry point (`@crvouga/atlas/playwright`)
 *
 * Re-exports the Playwright driver for statechart runs (`playwrightDriver`), the helpers an implementation uses to
 * recognise screens and tap or type (`screen`, `recognize`, `locate`, the signal constructors and `UserActions`), and
 * the media tools (`captureScreen`, `ScreencastRecorder`, `ffmpeg`, `PHONE` and the pacing presets). Needs the
 * `playwright` package; clips and thumbnails need FFmpeg on the PATH.
 *
 * @see docs/statecharts.md
 */
export { playwrightDriver, type PlaywrightContext, type PlaywrightDriverOptions } from './driver';
export { captureScreen, ScreencastRecorder, UserActions, PHONE, SHOWCASE_PACING, FAST_PACING, ffmpeg, type Pacing } from './media';
export { recognize, checkSignals, screen, locate, describeSignal, testId, text, role, label, css, type Signal, type SignatureSpec } from './signals';
