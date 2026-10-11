import { plugin } from 'bun';
import { Window } from 'happy-dom';

// A stylesheet has no meaning in a DOM test: a CSS module's class is its own name.
plugin({
  name: 'css',
  setup(build) {
    build.onLoad({ filter: /\.css$/ }, () => ({ exports: { default: new Proxy({}, { get: (_, key) => String(key) }) }, loader: 'object' }));
  }
});

/** The viewer under test reads its reports from this address; each test serves it from memory. */
export const REPORTS_URL = 'http://atlas.test/api/reports';
process.env.VITE_ATLAS_REPORTS_URL = REPORTS_URL;

const browser = new Window({ url: 'http://atlas.test/' });
Object.assign(globalThis, {
  window: browser,
  document: browser.document,
  navigator: browser.navigator,
  sessionStorage: browser.sessionStorage,
  localStorage: browser.localStorage,
  history: browser.history,
  location: browser.location,
  HTMLElement: browser.HTMLElement,
  Element: browser.Element,
  Node: browser.Node,
  DOMParser: browser.DOMParser,
  MutationObserver: browser.MutationObserver,
  HashChangeEvent: browser.HashChangeEvent,
  PopStateEvent: browser.PopStateEvent,
  Event: browser.Event,
  CustomEvent: browser.CustomEvent,
  MouseEvent: browser.MouseEvent,
  FocusEvent: browser.FocusEvent,
  PointerEvent: browser.PointerEvent,
  HTMLInputElement: browser.HTMLInputElement,
  DocumentFragment: browser.DocumentFragment,
  NodeFilter: browser.NodeFilter,
  KeyboardEvent: browser.KeyboardEvent,
  getComputedStyle: browser.getComputedStyle.bind(browser),
  requestAnimationFrame: (callback: (time: number) => void) => setTimeout(() => callback(0), 0),
  cancelAnimationFrame: (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle),
  scrollTo: () => {},
  IS_REACT_ACT_ENVIRONMENT: true
});
