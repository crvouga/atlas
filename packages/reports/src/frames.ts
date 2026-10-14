/**
 * @module Frames of a recorded test
 *
 * Pure helpers over a recorded test's step tree: flattening it into time-ordered frames (captured snapshots),
 * choosing the frame and actor a route selects, stepping to neighbouring frames or failures, and listing the files
 * a report names. Results of `testFrames` and the per-actor orderings are cached per test, keyed by the identity of
 * `test.report.steps`, so treat a loaded report as immutable. Nothing here reads a store.
 */
import type { HtmlReportTest } from './recording-bundle';
import type {
  ReportFrame,
  ReportSnapshotBlob,
  ReportStep,
  RunReport,
} from './report-types';

import type { Route } from './hash';

/** A frame placed in its step, in the flattened timeline. */
export type FlatFrame = {
  step: ReportStep;
  frame: ReportFrame;
  /** How deeply the step is nested (0 for a top-level step). */
  depth: number;
  /** Position in the flattened list this frame came from; `testFrames` renumbers it by capture time. Route `frame=N` is `index + 1`. */
  index: number;
};

/** A UI snapshot slot for one client (actor) of a frame. */
export type OrderedUiBlob = {
  readonly nodeId: string;
  /** This frame's snapshot, or the client's latest earlier one when stale. */
  readonly blob: ReportSnapshotBlob | null;
  /** True when `blob` is carried forward from an earlier frame. */
  readonly stale: boolean;
};

const frameCache = new WeakMap<object, FlatFrame[]>();
const actorOrderCache = new WeakMap<object, string[]>();
const carryCache = new WeakMap<
  object,
  ReadonlyMap<string, ReportSnapshotBlob>[]
>();

/** Per frame index: each client's latest UI snapshot at or before it. */
function carriedUiBlobs(
  test: HtmlReportTest
): ReadonlyMap<string, ReportSnapshotBlob>[] {
  const cached = carryCache.get(test.report.steps);
  if (cached) return cached;
  const out: ReadonlyMap<string, ReportSnapshotBlob>[] = [];
  let last = new Map<string, ReportSnapshotBlob>();
  for (const frame of testFrames(test)) {
    const next = new Map(last);
    for (const blob of uiBlobs(frame)) {
      if (blob.nodeId) next.set(blob.nodeId, blob);
    }
    out.push(next);
    last = next;
  }
  carryCache.set(test.report.steps, out);
  return out;
}

/** A step placed in the flattened (depth-first) step list. */
export type FlatStep = {
  step: ReportStep;
  depth: number;
  /** The enclosing step, or null for a top-level step. */
  parent: FlatStep | null;
  index: number;
};

/** Flattens the frames of a step tree depth first (a step's own frames, then its children's), in step order, not capture-time order. Appends to `out`. */
export function flattenFrames(
  steps: readonly ReportStep[],
  out: FlatFrame[] = [],
  depth = 0
): FlatFrame[] {
  for (const step of steps) {
    for (const frame of step.frames) {
      out.push({ step, frame, depth, index: out.length });
    }
    flattenFrames(step.steps, out, depth + 1);
  }
  return out;
}

/** Flattens a step tree depth first into rows that know their depth and parent. Appends to `out`. */
export function flattenSteps(
  steps: readonly ReportStep[],
  out: FlatStep[] = [],
  depth = 0,
  parent: FlatStep | null = null
): FlatStep[] {
  for (const step of steps) {
    const row: FlatStep = { step, depth, parent, index: out.length };
    out.push(row);
    flattenSteps(step.steps, out, depth + 1, row);
  }
  return out;
}

/** The first frame of `step`, or failing that of its first descendant that has one; null when none of them has a frame. */
export function firstFrameFor(
  step: ReportStep,
  frames: readonly FlatFrame[]
): FlatFrame | null {
  for (const f of frames) {
    if (f.step === step) return f;
  }
  for (const kid of step.steps) {
    const f = firstFrameFor(kid, frames);
    if (f) return f;
  }
  return null;
}

/** The last frame (in list order, which should be capture-time order) captured at or before the step ended; null when none was. */
export function lastFrameBefore(
  step: ReportStep,
  frames: readonly FlatFrame[]
): FlatFrame | null {
  let best: FlatFrame | null = null;
  for (const f of frames) {
    if (f.frame.capturedAtMs <= step.endedAtMs) best = f;
  }
  return best;
}

/** All frames of a test in capture-time order (ties keep step order), each numbered by its position. Cached per report. */
export function testFrames(test: HtmlReportTest): FlatFrame[] {
  const cached = frameCache.get(test.report.steps);
  if (cached) return cached;

  const flattened = flattenFrames(test.report.steps, [], 0).map(
    (frame, order) => ({ frame, order })
  );
  flattened.sort(
    (a, b) =>
      a.frame.frame.capturedAtMs - b.frame.frame.capturedAtMs ||
      a.order - b.order
  );
  const frames = flattened.map(({ frame }, index) => ({
    ...frame,
    index,
  }));
  frameCache.set(test.report.steps, frames);
  return frames;
}

function allUiActorIds(test: HtmlReportTest): string[] {
  const cached = actorOrderCache.get(test.report.steps);
  if (cached) return cached;
  const observed: string[] = [];
  const seen = new Set<string>();
  for (const frame of testFrames(test)) {
    for (const blob of uiBlobs(frame)) {
      const id = blob.nodeId;
      if (id && !seen.has(id)) {
        seen.add(id);
        observed.push(id);
      }
    }
  }
  if (observed.length === 0) {
    actorOrderCache.set(test.report.steps, []);
    return [];
  }

  const ordered = test.report.meta.actorIds.filter((id) => seen.has(id));
  for (const id of observed) {
    if (!ordered.includes(id)) ordered.push(id);
  }
  actorOrderCache.set(test.report.steps, ordered);
  return ordered;
}

/**
 * Returns a frame's UI snapshots (html or png) in one stable actor order, including empty slots, so each client
 * stays in the same column from frame to frame. The order is the report's `meta.actorIds`, then any other client in
 * the order first seen. A client with no snapshot at this frame carries its latest earlier one (`stale: true`), or
 * `null` blob if it has none yet. Snapshots with no `nodeId` follow, named `snapshot-N`.
 */
export function orderedUiBlobs(
  frame: FlatFrame | null,
  test: HtmlReportTest
): OrderedUiBlob[] {
  const blobs = uiBlobs(frame);
  const byNode = new Map<string, ReportSnapshotBlob>();
  const unassigned: ReportSnapshotBlob[] = [];
  for (const blob of blobs) {
    const nodeId = blob.nodeId || '';
    if (nodeId && !byNode.has(nodeId)) byNode.set(nodeId, blob);
    else if (!nodeId) unassigned.push(blob);
  }

  const carried = frame ? carriedUiBlobs(test)[frame.index] : undefined;
  const ordered: OrderedUiBlob[] = allUiActorIds(test).map((nodeId) => {
    const own = byNode.get(nodeId);
    if (own) return { nodeId, blob: own, stale: false };
    return { nodeId, blob: carried?.get(nodeId) ?? null, stale: true };
  });
  for (const blob of unassigned) {
    ordered.push({
      nodeId: `snapshot-${ordered.length + 1}`,
      blob,
      stale: false,
    });
  }
  return ordered;
}

/** The frame a route selects: the 1-based `frame` param when in range, otherwise the first frame of a failed step, otherwise the last frame; null with no frames. */
export function selectedFrame(
  frames: readonly FlatFrame[],
  route: Route
): FlatFrame | null {
  const n = Number.parseInt(route.params['frame'] || '', 10);
  if (Number.isFinite(n) && n >= 1 && n <= frames.length) {
    return frames[n - 1] ?? null;
  }
  for (const f of frames) {
    if (f.step.status === 'failed') return f;
  }
  return frames[frames.length - 1] ?? null;
}

/** Every distinct file a report names, relative to the test's folder: step snapshots, and files attached to the test as a whole (artifacts with their poster and captions). Used to know what to copy or prefetch. */
export function capturedFiles(report: Pick<RunReport, 'steps' | 'artifacts'>): string[] {
  const files = new Set<string>();
  const visit = (steps: readonly ReportStep[]) => {
    for (const step of steps) {
      for (const frame of step.frames) for (const blob of frame.snapshots) files.add(blob.file);
      visit(step.steps);
    }
  };
  visit(report.steps);
  for (const artifact of report.artifacts ?? []) {
    files.add(artifact.file);
    if (artifact.poster) files.add(artifact.poster);
    if (artifact.captions) files.add(artifact.captions);
  }
  return [...files];
}

/** Whether a snapshot is a rendered user interface (`html` or `png`), as opposed to data such as JSON or text. */
export function isUi(b: ReportSnapshotBlob): boolean {
  return b.media === 'html' || b.media === 'png';
}

/** The UI snapshots (html or png) of a frame; empty for no frame. */
export function uiBlobs(frame: FlatFrame | null): ReportSnapshotBlob[] {
  return frame ? frame.frame.snapshots.filter(isUi) : [];
}

/** All snapshots of a frame of any media; empty for no frame. */
export function stageBlobs(frame: FlatFrame | null): ReportSnapshotBlob[] {
  return frame ? [...frame.frame.snapshots] : [];
}

/** Whether a frame has at least one UI snapshot. */
export function frameHasUi(frame: FlatFrame | null): boolean {
  return uiBlobs(frame).length > 0;
}

const PREFETCH_MEDIA: ReadonlySet<string> = new Set([
  'html',
  'png',
  'json',
  'text',
]);

/** The distinct html, png, json and text files of the frames within `radius` of `index` (the visible one plus neighbors, clamped to the list), to fetch ahead. */
export function frameFilesNear(
  frames: readonly FlatFrame[],
  index: number,
  radius: number
): readonly string[] {
  const files: string[] = [];
  const seen = new Set<string>();
  const from = Math.max(0, index - radius);
  const to = Math.min(frames.length, index + radius + 1);
  for (let i = from; i < to; i += 1) {
    for (const blob of frames[i]?.frame.snapshots ?? []) {
      if (!PREFETCH_MEDIA.has(blob.media) || seen.has(blob.file)) continue;
      seen.add(blob.file);
      files.push(blob.file);
    }
  }
  return files;
}

/** The clients (actors) to show for a frame: those with a UI snapshot, else those with any snapshot, else the report's declared `meta.actorIds`. */
export function actorIds(
  frame: FlatFrame | null,
  test: HtmlReportTest
): string[] {
  const ids: string[] = [];
  const seen: Record<string, true> = {};
  const add = (id: string) => {
    if (!id || seen[id]) return;
    seen[id] = true;
    ids.push(id);
  };
  for (const b of uiBlobs(frame)) add(b.nodeId || '');
  if (ids.length === 0) {
    for (const b of stageBlobs(frame)) add(b.nodeId || '');
  }
  if (ids.length === 0) {
    for (const id of test.report.meta.actorIds) add(id);
  }
  return ids;
}

/** The client a route selects: the `node` param when it is one of the frame's actors, else the frame's step actor, else the first actor; null with none. */
export function selectedNode(
  frame: FlatFrame | null,
  route: Route,
  test: HtmlReportTest
): string | null {
  const ids = actorIds(frame, test);
  const param = route.params['node'];
  if (param && ids.includes(param)) return param;
  if (frame?.step.actorId && ids.includes(frame.step.actorId)) {
    return frame.step.actorId;
  }
  return ids[0] ?? null;
}

/** The text of a blob the test holds as text, or null when it is missing or held as bytes. */
export function blobText(
  test: HtmlReportTest,
  blob: ReportSnapshotBlob
): string | null {
  const b = test.blobs[blob.file];
  return b && typeof b.text === 'string' ? b.text : null;
}

/** A `data:` URL for a blob the test holds as base64 bytes, or null when it is missing or held as text. */
export function blobDataUrl(
  test: HtmlReportTest,
  blob: ReportSnapshotBlob
): string | null {
  const b = test.blobs[blob.file];
  if (!b?.base64) return null;
  return `data:${b.contentType};base64,${b.base64}`;
}

/** Whether any frame of `step` (not its children) shows a press target. */
export function stepHasPress(step: ReportStep): boolean {
  return step.frames.some((f) => f.hit !== undefined);
}

/** Next (`delta` 1) / previous (-1) frame of a failed step, wrapping. */
export function neighborFailure(
  frames: readonly FlatFrame[],
  from: number,
  delta: 1 | -1
): FlatFrame | null {
  const n = frames.length;
  for (let k = 1; k <= n; k += 1) {
    const f = frames[(((from + delta * k) % n) + n) % n];
    if (f && f.step.status === 'failed' && f.index !== from) return f;
  }
  return null;
}

/** First frame of the next / previous step (skipping same-step frames). */
export function neighborStepFrame(
  frames: readonly FlatFrame[],
  from: number,
  delta: 1 | -1
): FlatFrame | null {
  const cur = frames[from];
  if (!cur) return null;
  let i = from + delta;
  while (frames[i] && frames[i]?.step === cur.step) i += delta;
  const target = frames[i];
  if (!target) return null;
  if (delta === 1) return target;
  while (frames[i - 1] && frames[i - 1]?.step === target.step) i -= 1;
  return frames[i] ?? null;
}
