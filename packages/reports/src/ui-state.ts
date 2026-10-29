/**
 * @module UI state conventions
 *
 * How a captured UI state is written in a layer, using nothing but what the layer format already has. A **state** is a
 * check in a part of kind `ui-state`: its `id` names the state, its `status` says how the capture went, a `screenshot`
 * attachment is the picture, and the facts the producer declares about it (route, fixture, cohort, flags, the surfaces it
 * covers) sit under the `atlas.ui-state` extension. A **profile** (viewport, color scheme, device) is the layer's
 * `environment` and `parameters`, so a state captured at another viewport is another result, side by side. What is
 * **expected** is a layer of kind `ui-plan` with the same ids and profiles, every check `not-run`.
 *
 * Nothing here decides a result: a status, a slot and a winner are what the report contract says they are. This module
 * only reads the convention into a small optional row field ({@link UiStateFact}) so a viewer needs no second request to
 * list a catalog. A producer that writes something else is still read; what cannot be read is left out, never rejected.
 *
 * @see docs/ui-catalog.md
 */
import type { Check } from '../../schema/src/layer';

/** The part kind of captured states. */
export const UI_STATE_KIND = 'ui-state';
/** The part kind of the expected set: states (and surfaces) that should exist, whether or not they were captured. */
export const UI_PLAN_KIND = 'ui-plan';
/** The check extension that carries the facts a producer declares about a state. */
export const UI_STATE_EXTENSION = 'atlas.ui-state';

/** Whether a part kind belongs to the UI catalog (`ui-state` or `ui-plan`). */
export function isUiKind(kind: string): boolean {
  return kind === UI_STATE_KIND || kind === UI_PLAN_KIND;
}

/** The picture of a captured state: a stored file (`bundleKey`), or an address (`uri`). Everything but `name` is optional. */
export type UiScreenshot = {
  readonly name: string;
  readonly bundleKey?: string;
  readonly uri?: string;
  readonly contentType?: string;
  readonly width?: number;
  readonly height?: number;
  readonly bytes?: number;
  readonly sha256?: string;
  /** Why the producer left the bytes out (`too-large`, `policy`…): a picture that was never taken is told apart from one left out. */
  readonly omitted?: string;
};

/** The facts a producer declares about a state, under the `atlas.ui-state` extension. All optional, all strings or lists of strings. */
export type UiStateFacts = {
  /** The address or screen the state is of (`/checkout/payment`). */
  readonly route?: string;
  /** The test data it was captured with. */
  readonly fixture?: string;
  /** The audience or account kind it shows (`new-customer`). */
  readonly cohort?: string;
  /** Feature flags that were on. */
  readonly flags?: readonly string[];
  /** The product surfaces (screens, components) this state covers, for coverage against an inventory. */
  readonly covers?: readonly string[];
  /** A grouping a person navigates by (`checkout`). */
  readonly area?: string;
  /** The kind of UI state: `screen`, `overlay`, `loading`, `error`, `empty`, or any other word. Open vocabulary. Critics judge a state against others of its kind, so declare it; when it is absent the kind is unknown. */
  readonly kind?: string;
  /**
   * Facts of your own that the fields above do not name (`locale`, `brand`, `theme`, `build-channel`): a name and a text value each.
   * This is where the convention grows without a new version: the catalog carries them, offers them as a filter
   * (`attribute=name=value`) and shows them with the state, and none of them ever splits a slot or decides a result. A fact that
   * must split a result (another viewport, another locale rendered as another picture) is a profile `parameter` of the layer instead.
   */
  readonly attributes?: Readonly<Record<string, string>>;
  /** On a `ui-plan` check only: this entry is a surface of the product's inventory, not a state. Nothing is captured for it. */
  readonly inventory?: boolean;
};

/** What a row of a `ui-state` or `ui-plan` part carries for the catalog. Rides in the report row, only for those kinds. */
export type UiStateFact = UiStateFacts & {
  /** The check's picture: its `screenshot` attachment, else its first image. */
  readonly screenshot?: UiScreenshot;
};

const MAX_TEXT = 512;
const MAX_LIST = 64;
/** How many attributes a state keeps, and how long a name may be. The rest are dropped, in name order, never an error. */
export const MAX_ATTRIBUTES = 32;
const MAX_NAME = 64;

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim().slice(0, MAX_TEXT) : undefined;
}

function list(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = [...new Set(value.map(text).filter((item): item is string => item !== undefined))].slice(0, MAX_LIST);
  return out.length ? out : undefined;
}

function map(value: unknown): Record<string, string> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [name, raw] of Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const key = name.trim().slice(0, MAX_NAME);
    // A number or a boolean is the text it prints as; anything structured is not a fact about a screen and is left out.
    const given = typeof raw === 'number' || typeof raw === 'boolean' ? String(raw) : raw;
    const item = text(given);
    if (key && item !== undefined && !(key in out) && Object.keys(out).length < MAX_ATTRIBUTES) out[key] = item;
  }
  return Object.keys(out).length ? out : undefined;
}

function screenshotOf(check: Pick<Check, 'attachments'>): UiScreenshot | undefined {
  const images = (check.attachments ?? []).filter(item => item.role === 'screenshot' || (item.contentType ?? '').startsWith('image/'));
  const picked = images.find(item => item.role === 'screenshot') ?? images[0];
  if (!picked) return undefined;
  return {
    name: picked.name,
    ...(picked.bundleKey ? { bundleKey: picked.bundleKey } : {}),
    ...(picked.uri ? { uri: picked.uri } : {}),
    ...(picked.contentType ? { contentType: picked.contentType } : {}),
    ...(picked.width !== undefined ? { width: picked.width } : {}),
    ...(picked.height !== undefined ? { height: picked.height } : {}),
    ...(picked.bytes !== undefined ? { bytes: picked.bytes } : {}),
    ...(picked.sha256 ? { sha256: picked.sha256 } : {}),
    ...(picked.omitted ? { omitted: picked.omitted } : {})
  };
}

/**
 * The declared facts of a check, read from its `atlas.ui-state` extension. Strings are trimmed and bounded, lists are
 * distinct and bounded, `attributes` keep at most {@link MAX_ATTRIBUTES} text values, and anything of another shape (or a key
 * this version does not know) is dropped from the reading and left in the layer; a check without the extension has no facts.
 */
export function uiStateFacts(check: Pick<Check, 'extensions'>): UiStateFacts {
  const raw = check.extensions?.[UI_STATE_EXTENSION];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const given = raw as Record<string, unknown>;
  const route = text(given.route), fixture = text(given.fixture), cohort = text(given.cohort), area = text(given.area), kind = text(given.kind);
  const flags = list(given.flags), covers = list(given.covers), attributes = map(given.attributes);
  return {
    ...(route ? { route } : {}), ...(fixture ? { fixture } : {}), ...(cohort ? { cohort } : {}), ...(area ? { area } : {}), ...(kind ? { kind } : {}),
    ...(flags ? { flags } : {}), ...(covers ? { covers } : {}), ...(attributes ? { attributes } : {}),
    ...(given.inventory === true ? { inventory: true } : {})
  };
}

/**
 * What a check of a part of `kind` carries for the catalog: its declared facts and, in a `ui-state` part, its picture.
 * `undefined` for any other kind, and for a UI check that carries neither, so ordinary rows stay as small as they were.
 */
export function uiStateOf(kind: string, check: Pick<Check, 'extensions' | 'attachments'>): UiStateFact | undefined {
  if (!isUiKind(kind)) return undefined;
  const facts = uiStateFacts(check);
  const screenshot = kind === UI_STATE_KIND ? screenshotOf(check) : undefined;
  return screenshot || Object.keys(facts).length ? { ...facts, ...(screenshot ? { screenshot } : {}) } : undefined;
}
