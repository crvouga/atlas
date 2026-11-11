/**
 * @module Playwright driver entry point (`@crvouga/atlas/playwright`)
 *
 * Re-exports the Playwright driver for statechart runs (`playwrightDriver`), the helpers an implementation uses to
 * recognise screens and tap or type (`screen`, `recognize`, `locate`, the signal constructors and `UserActions`), and
 * the media tools (`captureScreen`, `ScreencastRecorder`, `ffmpeg`, `PHONE` and the pacing presets). Needs the
 * `playwright` package; clips and thumbnails need FFmpeg on the PATH.
 *
 * Also `captureUiState`, the optional Playwright adapter of the UI catalog with its opt-in readiness policies, and
 * `catalogWorkerPool`, warm reusable capture workers for `collectCatalog` (neither needs a Playwright import itself).
 *
 * @see docs/statecharts.md
 * @see docs/ui-catalog.md
 */
export { playwrightDriver, type PlaywrightContext, type PlaywrightDriverOptions } from './driver';
export { captureScreen, ScreencastRecorder, UserActions, PHONE, SHOWCASE_PACING, FAST_PACING, ffmpeg, type Pacing } from './media';
export { recognize, checkSignals, screen, locate, describeSignal, testId, text, role, label, css, type Signal, type SignatureSpec } from './signals';
export { captureUiState, READINESS_LABEL, READINESS_TIMEOUT_LABEL, type CaptureLocator, type CapturePage, type CapturePhase, type CapturePhaseTiming, type CaptureReadiness, type CaptureReadyContext, type CaptureRegion, type CaptureResult, type CaptureUiStateOptions, type StabilityPolicy } from './ui-catalog';
export { catalogWorkerPool, type CatalogRecipe, type CatalogRecipeContext, type CatalogWorkerPool, type CatalogWorkerPoolOptions, type CatalogWorkerPoolStats } from './ui-catalog-pool';
