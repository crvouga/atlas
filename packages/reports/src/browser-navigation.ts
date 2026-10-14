// @io-wall-ok — the browser host supplies navigation to the reports viewer.
/**
 * @module Browser navigation for the reports viewer
 *
 * The one implementation of {@link ReportNavigation} that touches `window` and `document`: the explorer's selection
 * lives in the URL hash, keys come from `keydown`, and the tab title is `document.title`. Browser-only; nothing
 * here runs until {@link browserReportNavigation} is called, so importing it is safe in Node.
 */
import type { ReportNavigation } from './navigation';

/**
 * Creates a {@link ReportNavigation} backed by `window.location.hash`, `history`, `keydown` and `document.title`.
 *
 * `writeHash` does nothing when the hash is already the given one; otherwise it replaces or pushes a history entry
 * (no `hashchange` is fired by `replaceState`/`pushState`, so the caller owns re-reading). `subscribeHash` listens to both
 * `hashchange` and `popstate`. Every `subscribe*` returns its unsubscribe function. Must be called in a browser.
 */
export function browserReportNavigation(): ReportNavigation {
  return {
    readHash: () => window.location.hash,
    writeHash: (hash, replace) => {
      if (window.location.hash === hash) return;
      if (replace) window.history.replaceState(null, '', hash);
      else window.history.pushState(null, '', hash);
    },
    subscribeHash: (listener) => {
      window.addEventListener('hashchange', listener);
      window.addEventListener('popstate', listener);
      return () => {
        window.removeEventListener('hashchange', listener);
        window.removeEventListener('popstate', listener);
      };
    },
    subscribeKeys: (listener) => {
      window.addEventListener('keydown', listener);
      return () => window.removeEventListener('keydown', listener);
    },
    setTitle: (title) => {
      document.title = title;
    },
  };
}
