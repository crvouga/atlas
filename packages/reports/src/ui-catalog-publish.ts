/**
 * @module Writing a UI catalog from any collector
 *
 * Two small builders that turn what a collector captured, or what a planner expects, into the input of `publishChecks`
 * (and of `atlas report publish --checks`), following the convention in {@link ./ui-state}. They are plain data in and plain
 * data out: no browser, no test framework, no file system. A Playwright test, a Cypress run, a mobile device lab, a Storybook
 * crawler or a shell script that writes the same JSON all produce the same catalog.
 *
 * Shards need no coordination: each shard calls {@link uiStateLayer} for the states it captured (and optionally
 * {@link uiPlanLayer} for the states it was given), with its own `shard` label, and publishes. A planner that knows the whole
 * product publishes the plan once.
 *
 * @see docs/ui-catalog.md
 */
import type { PublishChecksInput } from '../../schema/src/layer';
import { UI_PLAN_KIND, UI_STATE_EXTENSION, UI_STATE_KIND, type UiStateFacts } from './ui-state';

/** A picture to store with a capture: its bytes (`data`, `base64`), or where it already is (`uri`). */
export type UiPicture = {
  /** The file name; default `<id>.png`. */
  readonly name?: string;
  readonly data?: Uint8Array;
  readonly base64?: string;
  readonly uri?: string;
  /** Default `image/png`. */
  readonly contentType?: string;
  readonly width?: number;
  readonly height?: number;
};

/**
 * More evidence of the same capture, beside its primary {@link UiPicture}: another view of the state (a scrolled region, a
 * detail), a trace, a video, a log. It stays with its state and profile (one result, never a state per file), keeps its
 * `label` and `order`, and never decides the result: a trace on a failed capture leaves it failed.
 *
 * Give the bytes (`data`, `base64`, `text`), an address (`uri`), or nothing but `omitted` (why they are not here: `not-found`,
 * `too-large`, `over-budget`, `policy`…). One with none of these is published as omitted `not-found`, so a missing file is
 * shown as missing and never as evidence that exists.
 */
export type UiCaptureAttachment = Omit<UiPicture, 'contentType'> & {
  /** What it is, in the open vocabulary of attachment roles: `view` (default), `trace`, `video`, `log`, `snapshot`, `har`… `screenshot` is the primary picture's role; give that as `screenshot` instead. */
  readonly role?: string;
  /** For a person (`Order summary, scrolled`). Default the name. */
  readonly label?: string;
  /** Where it is listed among the capture's attachments, lowest first; ties keep the order given. */
  readonly order?: number;
  /** Default `image/png` for a `view`, `application/octet-stream` otherwise. */
  readonly contentType?: string;
  /** A small UTF-8 value inline (a log excerpt). */
  readonly text?: string;
  /** Why the bytes are not here. Recorded as the attachment's `omitted`. */
  readonly omitted?: string;
};

/** The attachment extension `uiStateLayer` writes on each supplemental attachment: its label and order, so a reader keeps both. */
export type UiAttachmentFacts = { readonly supplemental: true; readonly label?: string; readonly order: number };

/** One captured state. `id` must be stable across runs: it is how a new capture replaces an old one. */
export type UiStateCapture = UiStateFacts & {
  readonly id: string;
  /** For a person; default the id. */
  readonly title?: string;
  /** `passed` (default): captured. `failed`: the capture was attempted and did not work (say why in `detail`). `running`: being taken. `not-run`: skipped. */
  readonly status?: 'passed' | 'failed' | 'running' | 'not-run';
  /** Why it failed or was skipped: a readiness check that never became true, a console error. */
  readonly detail?: string;
  readonly screenshot?: UiPicture;
  /** Supplemental evidence of this capture (more views, a trace, a video), in order after the primary picture. See {@link UiCaptureAttachment}. */
  readonly attachments?: readonly UiCaptureAttachment[];
  readonly durationMs?: number;
  /** More facts about the capture that never split it (`browser`, `os`). */
  readonly labels?: Readonly<Record<string, string>>;
  readonly tags?: readonly string[];
};

/** One expected state, or (with `inventory`) one surface of the product's inventory. */
export type UiStatePlan = UiStateFacts & {
  readonly id: string;
  readonly title?: string;
};

/** What every layer of a catalog says about where and when it was recorded. */
export type UiLayerOrigin = {
  /** The suite or tool that makes the layer. Part of the slot; a planner and a collector normally differ. */
  readonly producer: string;
  /** When the captures were taken (or the plan was made), epoch milliseconds. Take it from the run, not from the moment of publishing. */
  readonly recordedAtMs: number;
  /** The client: `desktop-web`, `mobile-web`, `ios`, `android`… Part of the slot. */
  readonly environment?: string;
  /** The rest of the profile, such as `{ viewport: '390x844', scheme: 'dark' }`. Each combination is its own result. Part of the slot. */
  readonly profile?: Readonly<Record<string, string>>;
  readonly sha?: string | null;
  readonly branch?: string | null;
  readonly runUrl?: string | null;
  /** Which shard this is (`2/4`, `checkout`, a machine name). Shown with each capture; never part of the slot. */
  readonly shard?: string;
  /** The execution these layers belong to, so shards of one run stay one run. */
  readonly run?: { readonly id: string; readonly title?: string };
};

function common(origin: UiLayerOrigin, kind: string, title: string) {
  return {
    producer: origin.producer, kind, title, recordedAtMs: origin.recordedAtMs,
    ...(origin.environment ? { environment: origin.environment } : {}),
    parameters: { ...origin.profile },
    ...(origin.sha !== undefined ? { sha: origin.sha } : {}), ...(origin.branch !== undefined ? { branch: origin.branch } : {}), ...(origin.runUrl !== undefined ? { runUrl: origin.runUrl } : {}),
    ...(origin.run ? { run: origin.run } : {})
  };
}

const slug = (text: string) => text.replace(/[^\w.-]+/g, '-');
const EXTENSIONS: Readonly<Record<string, string>> = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif', 'video/webm': '.webm', 'video/mp4': '.mp4', 'application/zip': '.zip', 'text/plain': '.txt', 'application/json': '.json' };

/** The layer attachments of a state's supplemental evidence, ordered, uniquely named, and each either holding its bytes or saying why not. */
function supplemental(state: UiStateCapture, taken: Set<string>) {
  const ordered = (state.attachments ?? []).map((item, index) => ({ item, index })).sort((a, b) => (a.item.order ?? a.index) - (b.item.order ?? b.index) || a.index - b.index);
  return ordered.map(({ item }, position) => {
    const role = item.role ?? 'view';
    const contentType = item.contentType ?? (role === 'view' ? 'image/png' : item.text !== undefined ? 'text/plain' : 'application/octet-stream');
    let name = item.name ?? `${slug(state.id)}-${slug(item.label ?? role)}${EXTENSIONS[contentType] ?? ''}`;
    for (let n = 2; taken.has(name); n++) name = name.replace(/(-\d+)?(\.[^.]*)?$/, (_whole, _n, ext) => `-${n}${ext ?? ''}`);
    taken.add(name);
    const held = item.data !== undefined || item.base64 !== undefined || item.uri !== undefined || item.text !== undefined;
    const omitted = item.omitted ?? (held ? undefined : 'not-found');
    const extension: UiAttachmentFacts = { supplemental: true, ...(item.label ? { label: item.label } : {}), order: position };
    return {
      name, role, contentType, ...(item.label ? { description: item.label } : {}),
      ...(!omitted && item.data ? { data: item.data } : {}), ...(!omitted && item.base64 ? { base64: item.base64 } : {}), ...(!omitted && item.uri ? { uri: item.uri } : {}), ...(!omitted && item.text !== undefined ? { text: item.text } : {}),
      ...(item.width !== undefined ? { width: item.width } : {}), ...(item.height !== undefined ? { height: item.height } : {}),
      ...(omitted ? { omitted } : {}),
      extensions: { [UI_STATE_EXTENSION]: extension }
    };
  });
}

function facts(source: UiStateFacts): UiStateFacts {
  const { route, fixture, cohort, area, kind, flags, covers, attributes, inventory } = source;
  return { ...(route ? { route } : {}), ...(fixture ? { fixture } : {}), ...(cohort ? { cohort } : {}), ...(area ? { area } : {}), ...(kind ? { kind } : {}), ...(flags?.length ? { flags } : {}), ...(covers?.length ? { covers } : {}), ...(attributes && Object.keys(attributes).length ? { attributes } : {}), ...(inventory ? { inventory } : {}) };
}

/**
 * The input of `publishChecks` for the states one collector (or one shard) captured under one profile. Throws when a state id
 * repeats, because the second would silently replace the first. A state without a `status` is `passed`: it was captured.
 *
 * @example
 * ```ts
 * await publishChecks(store, uiStateLayer({
 *   producer: 'web-capture', recordedAtMs: Date.now(), environment: 'mobile-web', profile: { viewport: '390x844', scheme: 'dark' }, shard: '1/4',
 *   states: [{ id: 'checkout/payment', title: 'Payment', route: '/checkout', covers: ['payment-form'], screenshot: { data: png } }]
 * }));
 * ```
 */
export function uiStateLayer(input: UiLayerOrigin & { readonly states: readonly UiStateCapture[] }): PublishChecksInput {
  const seen = new Set<string>();
  const checks = input.states.map(state => {
    if (seen.has(state.id)) throw new Error(`uiStateLayer: the state "${state.id}" appears twice; give each state of one profile its own id`);
    seen.add(state.id);
    const shot = state.screenshot;
    const primary = shot ? [{
      name: shot.name ?? `${slug(state.id)}.png`, role: 'screenshot', contentType: shot.contentType ?? 'image/png',
      ...(shot.data ? { data: shot.data } : {}), ...(shot.base64 ? { base64: shot.base64 } : {}), ...(shot.uri ? { uri: shot.uri } : {}),
      ...(shot.width !== undefined ? { width: shot.width } : {}), ...(shot.height !== undefined ? { height: shot.height } : {})
    }] : [];
    const more = state.attachments?.length ? supplemental(state, new Set(primary.map(item => item.name))) : [];
    const attachments = primary.length || more.length ? [...primary, ...more] : undefined;
    const labels = { ...state.labels, ...(input.shard ? { shard: input.shard } : {}) };
    return {
      id: state.id, title: state.title ?? state.id, status: state.status ?? 'passed', detail: state.detail ?? '',
      ...(state.durationMs !== undefined ? { durationMs: state.durationMs } : {}),
      ...(attachments ? { attachments } : {}),
      ...(Object.keys(labels).length ? { labels } : {}), ...(state.tags?.length ? { tags: [...state.tags] } : {}),
      extensions: { [UI_STATE_EXTENSION]: facts(state) }
    };
  });
  return { ...common(input, UI_STATE_KIND, 'UI states'), checks };
}

/**
 * The input of `publishChecks` for what is expected: states that should be captured under this profile and, with `inventory`,
 * surfaces the product is known to have. Every entry is `not-run`, so a plan never counts as a pass, and it fills a slot of
 * its own (kind `ui-plan`), so a capture never erases it and it never hides a capture. Throws when an id repeats.
 */
export function uiPlanLayer(input: UiLayerOrigin & { readonly states: readonly UiStatePlan[] }): PublishChecksInput {
  const seen = new Set<string>();
  const checks = input.states.map(state => {
    if (seen.has(state.id)) throw new Error(`uiPlanLayer: "${state.id}" appears twice`);
    seen.add(state.id);
    return {
      id: state.id, title: state.title ?? state.id, status: 'not-run' as const, detail: state.inventory ? 'In the product inventory' : 'Expected, not captured yet',
      ...(input.shard ? { labels: { shard: input.shard } } : {}),
      extensions: { [UI_STATE_EXTENSION]: facts(state) }
    };
  });
  return { ...common(input, UI_PLAN_KIND, 'UI states expected'), checks };
}
