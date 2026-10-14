/**
 * @module URL hash routes of the reports viewer
 *
 * The explorer keeps its state in the URL hash (`#/test/<id>?view=single&zoom=fit`) so a link reproduces a view.
 * This module parses a hash into a {@link Route} and builds it back; it is pure and never throws on a missing
 * value, but `parseHash` throws `URIError` on a malformed percent-escape. Unknown params are carried untouched.
 */

/** The query part of a hash: decoded keys and values. Empty values are dropped when a hash is built. */
export type RouteParams = Readonly<Record<string, string>>;

/** The list of reports or tests (`#/`). */
export type ListRoute = {
  readonly view: 'list';
  readonly params: RouteParams;
};

/** One recorded test (`#/test/<id>`). */
export type TestRoute = {
  readonly view: 'test';
  /** The test's id, decoded; it may contain slashes (`libs/chess/monkey`). */
  readonly testId: string;
  readonly params: RouteParams;
};

/** Where the viewer is: the list, or one test. Anything that is not `#/test/<id>` is the list. */
export type Route = ListRoute | TestRoute;

/** Parses a `location.hash` (with or without the leading `#` and `/`) into a {@link Route}; an unrecognized path is the list. */
export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#\/?/, '');
  const q = raw.split('?');
  const parts = (q[0] ?? '').split('/').filter(Boolean);
  const params: Record<string, string> = {};
  for (const kv of (q[1] ?? '').split('&')) {
    if (!kv) continue;
    const i = kv.indexOf('=');
    const key = decodeURIComponent(kv.slice(0, i < 0 ? kv.length : i));
    const value = decodeURIComponent(i < 0 ? '' : kv.slice(i + 1));
    params[key] = value;
  }
  if (parts[0] === 'test' && parts[1]) {
    // `buildHash` encodes the id; an aggregated report's ids carry slashes
    // (`libs/chess/monkey`), so the encoded form must be read back.
    return { view: 'test', testId: decodeURIComponent(parts[1]), params };
  }
  return { view: 'list', params };
}

/** Builds the hash for a route (`#/` or `#/test/<encoded id>`) with its non-empty params encoded; the inverse of {@link parseHash}. */
export function buildHash(route: Route): string {
  const qs = Object.keys(route.params)
    .filter((k) => {
      const v = route.params[k];
      return v !== undefined && v !== null && v !== '';
    })
    .map(
      (k) =>
        `${encodeURIComponent(k)}=${encodeURIComponent(route.params[k] ?? '')}`
    )
    .join('&');
  const path =
    route.view === 'test' ? `/test/${encodeURIComponent(route.testId)}` : '/';
  return `#${path}${qs ? `?${qs}` : ''}`;
}

/** `single` when the `view` param says so, otherwise `multi`. */
export function viewMode(route: Route): 'single' | 'multi' {
  return route.params['view'] === 'single' ? 'single' : 'multi';
}

/** The `zoom` param, or `fit` when it is absent. */
export function zoomMode(route: Route): string {
  return route.params['zoom'] || 'fit';
}

/** Whether the side panel is shown: true unless `aside=0`. */
export function showAside(route: Route): boolean {
  return route.params['aside'] !== '0';
}

/** Whether press targets are drawn on frames: true unless `press=0`. */
export function showPress(route: Route): boolean {
  return route.params['press'] !== '0';
}
