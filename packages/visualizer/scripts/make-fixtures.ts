import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { composeCharts, machineToScxml, parseChart, toCtrf, toJUnit, toMermaid, toWebVtt, type MachineConfig } from '@crvouga/atlas';
import type {
  CheckResult,
  Clip,
  CloudEvent,
  Count,
  EventKind,
  Image,
  PathRecord,
  RunInfo,
  RunStatus,
  StateRecord,
  TimelineEntry,
  TransitionRecord
} from '@crvouga/atlas-schema';
import YAML from 'yaml';

import { resolveEventKind } from '../src/data/model/event-kind';
import { createJourneyReplayer, type ReplayResult } from '../src/data/model/journeys';
import { createIssueSink } from '../src/data/parse/issues';
import { isMachineFile, parseSpec, slug, type ParsedState, type ParsedTransition, type SpecDocument } from '../src/data/parse/spec';
import { APP_ROOT, FIXTURES_ROOT, listSpecFiles } from '../vite/atlas-files';

/**
 * Regenerates every fixture from the example spec in `example/specs` (a coffee-ordering app: an
 * XState root chart with a parallel region that invokes an SCXML checkout chart) and a generated
 * large atlas. All media is synthetic: ImageMagick draws the screens and ffmpeg the clips.
 */

const EXAMPLE_SPECS = path.join(APP_ROOT, 'example/specs');
const SPEC_DIR = 'coffee/ordering';
const TOP_CHART = 'Coffee order';
const CHECKOUT_CHART = 'Checkout';
const ENTRY_STATES = ['Reviewing the cart'];
const ENTRY_TRANSITION = 'Reviewing the cart :: Starts checkout';
const MEDIA_CACHE = path.join(APP_ROOT, '.cache', 'fixture-media');
const MEDIA_VERSION = 3;
const SIZE_BUDGET = 6 * 1024 * 1024;
const CLIP_MS = 2500;

function tool(name: string) {
  const pinned = `/opt/homebrew/bin/${name}`;
  return existsSync(pinned) ? pinned : name;
}
const MAGICK = tool('magick');
const CWEBP = tool('cwebp');
const FFMPEG = tool('ffmpeg');
const FONT = '/System/Library/Fonts/Supplemental/Arial.ttf';
const FONT_BOLD = '/System/Library/Fonts/Supplemental/Arial Bold.ttf';

function exec(cmd: string, args: string[]) {
  execFileSync(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] });
}

function log(line: string) {
  process.stdout.write(`${line}\n`);
}

function hashOf(value: unknown, length = 16) {
  return createHash('sha1').update(JSON.stringify(value)).digest('hex').slice(0, length);
}

function seeded(key: string) {
  let a = Number.parseInt(hashOf(key, 8), 16);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function capitalize(text: string) {
  return text ? text[0]!.toUpperCase() + text.slice(1) : text;
}

function lowerFirst(text: string) {
  return text ? text[0]!.toLowerCase() + text.slice(1) : text;
}

function writeText(file: string, text: string) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
}

function place(src: string, dest: string) {
  mkdirSync(path.dirname(dest), { recursive: true });
  copyFileSync(src, dest);
}

function runIdOf(iso: string, mode: 'fast' | 'showcase') {
  return `${iso.replace(/:/g, '-').replace('.', '-')}-${mode}`;
}

function addMs(iso: string, ms: number) {
  return new Date(Date.parse(iso) + ms).toISOString();
}

// ---------------------------------------------------------------------------------------------
// Media

type ScreenArt = { title: string; subtitle: string; color: string; tone: 'normal' | 'error' };
type ClipKind = 'tap' | 'type' | 'system' | 'time';
const CLIP_KINDS: ClipKind[] = ['tap', 'type', 'system', 'time'];

function magickText(text: string) {
  return text.replace(/\\/g, '\\\\').replace(/%/g, '%%').replace(/^@/, '\\@');
}

function renderScreen(art: ScreenArt) {
  const key = hashOf({ v: MEDIA_VERSION, art });
  const png = path.join(MEDIA_CACHE, `screen-${key}.png`);
  const webp = path.join(MEDIA_CACHE, `screen-${key}.webp`);
  if (existsSync(png) && existsSync(webp)) return { png, webp };
  mkdirSync(MEDIA_CACHE, { recursive: true });
  const bar = art.tone === 'error' ? '#B42318' : art.color;
  const notice =
    art.tone === 'error'
      ? ['-fill', '#FEE4E2', '-draw', 'roundrectangle 20,604 370,664 12,12', '-fill', '#B42318', '-font', FONT_BOLD, '-pointsize', '15', '-annotate', '+36+640', 'Something went wrong']
      : [];
  exec(MAGICK, [
    '-size', '390x844', 'xc:#F5F6F8',
    '-fill', bar, '-draw', 'rectangle 0,0 390,108',
    '-font', FONT_BOLD, '-pointsize', '14', '-fill', '#FFFFFF', '-annotate', '+20+34', '9:41',
    '-font', FONT, '-pointsize', '15', '-annotate', '+20+88', magickText(art.subtitle),
    '(', '-size', '350x', '-background', 'none', '-font', FONT_BOLD, '-pointsize', '26', '-fill', '#111827', `caption:${magickText(art.title)}`, ')',
    '-geometry', '+20+132', '-composite',
    '-fill', '#D5D9E0',
    '-draw', 'roundrectangle 20,270 330,282 6,6',
    '-draw', 'roundrectangle 20,294 290,306 6,6',
    '-draw', 'roundrectangle 20,318 310,330 6,6',
    '-fill', '#FFFFFF', '-stroke', '#E3E6EB', '-draw', 'roundrectangle 20,380 370,560 16,16', '-stroke', 'none',
    '-fill', art.color, '-draw', 'circle 60,424 60,444',
    '-fill', '#D5D9E0',
    '-draw', 'roundrectangle 92,416 330,428 6,6',
    '-draw', 'roundrectangle 40,480 350,492 6,6',
    '-draw', 'roundrectangle 40,504 300,516 6,6',
    ...notice,
    '-fill', art.color, '-draw', 'roundrectangle 20,704 370,754 25,25',
    '-fill', 'none', '-stroke', art.color, '-strokewidth', '2', '-draw', 'roundrectangle 21,768 369,814 23,23', '-stroke', 'none',
    '-gravity', 'North', '-font', FONT_BOLD, '-pointsize', '16', '-fill', '#FFFFFF', '-annotate', '+0+720', 'Continue',
    '-fill', art.color, '-annotate', '+0+782', 'Not now',
    '-gravity', 'SouthEast', '-font', FONT, '-pointsize', '11', '-fill', '#9CA3AF', '-annotate', '+12+8', 'Fixture',
    '-strip', '-define', 'png:exclude-chunk=date,time', '-colors', '48', `PNG8:${png}`
  ]);
  exec(CWEBP, ['-quiet', '-q', '70', '-resize', '200', '0', png, '-o', webp]);
  return { png, webp };
}

const CLIP_ART: Record<ClipKind, { label: string; color: string; extra: string[] }> = {
  tap: {
    label: 'User taps',
    color: '0x2F6FED',
    extra: [
      "drawbox=x=48:y=352:w=100:h=26:color=0x2F6FED:t=fill",
      "drawbox=x='30+t*40':y='280+t*40':w=14:h=14:color=0x111827@0.5:t=fill:enable='lt(t,1.7)'",
      "drawbox=x=44:y=348:w=108:h=34:color=0x111827@0.25:t=fill:enable='gte(t,1.7)'"
    ]
  },
  type: {
    label: 'User types',
    color: '0x7A5AF8',
    extra: [
      "drawbox=x=10:y=200:w=176:h=30:color=0xFFFFFF:t=fill",
      "drawbox=x=16:y=212:w='min(150,t*80)':h=7:color=0x111827@0.6:t=fill"
    ]
  },
  system: {
    label: 'System update',
    color: '0x0F9D74',
    extra: [
      "drawbox=x=78:y=190:w=40:h=40:color=0x0F9D74@0.4:t=fill:enable='lt(t,1.2)'",
      "drawbox=x=10:y=260:w=176:h=90:color=0xFFFFFF:t=fill:enable='gte(t,1.2)'",
      "drawbox=x=20:y=280:w=120:h=8:color=0xD5D9E0:t=fill:enable='gte(t,1.2)'"
    ]
  },
  time: {
    label: 'Time passes',
    color: '0xDC6803',
    extra: [
      "drawbox=x=58:y=170:w=80:h=80:color=0xDC6803@0.3:t=fill",
      "drawbox=x=96:y='180+mod(t*40,60)':w=4:h=20:color=0x111827:t=fill"
    ]
  }
};

function renderClip(kind: ClipKind) {
  const art = CLIP_ART[kind];
  const key = hashOf({ v: MEDIA_VERSION, kind, art });
  const mp4 = path.join(MEDIA_CACHE, `clip-${key}.mp4`);
  const poster = path.join(MEDIA_CACHE, `clip-${key}.poster.webp`);
  if (existsSync(mp4) && existsSync(poster)) return { mp4, poster };
  mkdirSync(MEDIA_CACHE, { recursive: true });
  const filters = [
    `drawbox=x=0:y=0:w=196:h=54:color=${art.color}:t=fill`,
    `drawtext=fontfile=${FONT}:text='${art.label}':x=10:y=72:fontsize=15:fontcolor=0x111827`,
    'drawbox=x=10:y=110:w=150:h=7:color=0xD5D9E0:t=fill',
    'drawbox=x=10:y=126:w=120:h=7:color=0xD5D9E0:t=fill',
    ...art.extra,
    `drawtext=fontfile=${FONT}:text='Fixture':x=w-tw-6:y=h-th-6:fontsize=9:fontcolor=0x9CA3AF`
  ];
  exec(FFMPEG, [
    '-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=0xF5F6F8:s=196x424:r=12:d=${CLIP_MS / 1000}`,
    '-vf', filters.join(','),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '34', '-pix_fmt', 'yuv420p', '-threads', '1',
    '-movflags', '+faststart', '-fflags', '+bitexact', '-flags:v', '+bitexact', '-map_metadata', '-1', '-an', mp4
  ]);
  const posterPng = path.join(MEDIA_CACHE, `clip-${key}.poster.png`);
  exec(FFMPEG, ['-v', 'error', '-y', '-ss', '2', '-i', mp4, '-frames:v', '1', '-fflags', '+bitexact', '-flags:v', '+bitexact', posterPng]);
  exec(CWEBP, ['-quiet', '-q', '70', posterPng, '-o', poster]);
  return { mp4, poster };
}

type RunWriter = {
  dir: string;
  screen: (pathId: string, art: ScreenArt, options?: { prefix?: string; write?: boolean }) => Image;
  clip: (kind: ClipKind, timeline: TimelineEntry[]) => Clip;
  pendingClip: () => Clip;
};

/** Writes media the way the runner lays it out: `media/paths/<path>/NN.png|webp`, `media/clips/...`. */
function runWriter(runDir: string): RunWriter {
  const counters = new Map<string, number>();
  const placed = new Set<ClipKind>();
  let captions = 0;
  const clipBase = (n: number) => `media/clips/journey-1/${String(n).padStart(2, '0')}`;
  return {
    dir: runDir,
    screen(pathId, art, { prefix = '', write = true } = {}) {
      const n = (counters.get(pathId) ?? 0) + 1;
      counters.set(pathId, n);
      const base = `media/paths/${pathId}/${prefix}${String(n).padStart(2, '0')}`;
      if (write) {
        const media = renderScreen(art);
        place(media.png, path.join(runDir, `${base}.png`));
        place(media.webp, path.join(runDir, `${base}.webp`));
      }
      return { png: `${base}.png`, webp: `${base}.webp` };
    },
    clip(kind, timeline) {
      const base = clipBase(CLIP_KINDS.indexOf(kind) + 1);
      if (!placed.has(kind)) {
        const media = renderClip(kind);
        place(media.mp4, path.join(runDir, `${base}.mp4`));
        place(media.poster, path.join(runDir, `${base}.poster.webp`));
        placed.add(kind);
      }
      const vtt = `media/captions/${String(++captions).padStart(3, '0')}.vtt`;
      writeText(path.join(runDir, vtt), toWebVtt(timeline, CLIP_MS));
      return { video: `${base}.mp4`, poster: `${base}.poster.webp`, durationMs: CLIP_MS, captions: vtt };
    },
    pendingClip() {
      const base = clipBase(CLIP_KINDS.length + 1);
      return { video: `${base}.mp4`, poster: `${base}.poster.webp`, state: 'processing' };
    }
  };
}

// ---------------------------------------------------------------------------------------------
// Specs

type SpecText = { path: string; text: string };
type LoadedSpec = { doc: SpecDocument; files: SpecText[]; replays: Map<string, ReplayResult>; version: string; specDirectory: string };

function loadSpec(files: SpecText[], specDirectory: string): LoadedSpec {
  const sink = createIssueSink();
  const doc = parseSpec({ ref: null, files }, sink);
  const problems = sink.issues.filter((i) => i.severity !== 'info');
  if (problems.length) throw new Error(`Spec has problems: ${JSON.stringify(problems, null, 2)}`);
  const replay = createJourneyReplayer(doc, sink);
  const replays = new Map(doc.journeys.map((j) => [j.id, replay(j)]));
  const broken = doc.journeys.filter((j) => !replays.get(j.id)!.ok);
  if (broken.length) throw new Error(`Journeys don't replay: ${broken.map((j) => j.name).join(', ')}\n${JSON.stringify(sink.issues, null, 2)}`);
  return { doc, files, replays, version: hashOf(files.map((f) => f.text), 12), specDirectory };
}

function exampleFiles(): SpecText[] {
  return listSpecFiles(EXAMPLE_SPECS).map((file) => ({ path: file, text: readFileSync(path.join(EXAMPLE_SPECS, file), 'utf8') }));
}

function writeSpec(fixtureDir: string, files: SpecText[]) {
  for (const file of files) writeText(path.join(fixtureDir, 'specs', file.path), file.text);
}

/** The composed machine of one chart directory, as the runner composes it, for the Mermaid report. */
function composedMachine(files: SpecText[], dir: string, root: string): MachineConfig {
  const charts = files.filter((f) => f.path.startsWith(`${dir}/`) && isMachineFile(f.path)).map((f) => parseChart(f.path.slice(dir.length + 1), f.text));
  return composeCharts({ directory: dir, charts, journeys: [], root }).machine;
}

type Scope = { states: Set<string>; transitions: Set<string> };

/** The runner only knows composed transitions: hand-offs, never the parent transitions they replace. */
function runnable(t: ParsedTransition) {
  return !t.carriedBy;
}

function fullScope(doc: SpecDocument): Scope {
  return { states: new Set(doc.states.keys()), transitions: new Set([...doc.transitions.values()].filter(runnable).map((t) => t.id)) };
}

function chartScope(doc: SpecDocument, chartIds: string[]): Scope {
  const states = new Set(doc.charts.filter((c) => chartIds.includes(c.id)).flatMap((c) => c.states));
  const transitions = new Set([...doc.transitions.values()].filter((t) => chartIds.includes(t.chartId) && runnable(t)).map((t) => t.id));
  return { states, transitions };
}

function checkoutScope(doc: SpecDocument): Scope {
  const scope = chartScope(doc, [CHECKOUT_CHART]);
  for (const name of ENTRY_STATES) scope.states.add(name);
  const host = doc.charts.find((c) => c.id === CHECKOUT_CHART)?.parent?.state;
  if (host) scope.states.add(host);
  for (const t of doc.transitions.values()) if (t.chartId === CHECKOUT_CHART && t.handOff && t.target) scope.states.add(t.target);
  scope.transitions.add(ENTRY_TRANSITION);
  return scope;
}

function ancestors(doc: SpecDocument, name: string) {
  const out: string[] = [];
  for (let p = doc.states.get(name)?.parent ?? null; p; p = doc.states.get(p)?.parent ?? null) out.push(p);
  return out;
}

function isScreenLike(state: ParsedState) {
  return (state.type === 'atomic' || state.type === 'final') && !state.childChartId;
}

function kindOf(doc: SpecDocument, t: ParsedTransition): EventKind {
  const meta = doc.charts.find((c) => c.id === t.chartId)?.meta;
  return resolveEventKind({
    event: t.event,
    handOff: t.handOff || Boolean(t.carriedBy),
    specKind: meta?.eventKinds?.[t.event],
    specTimeSpan: meta?.timeEvents?.[t.event],
    runKind: undefined
  }).kind;
}

// ---------------------------------------------------------------------------------------------
// Timelines

const TYPED: [RegExp, string, string][] = [
  [/^Submits the card$/, 'Card number', '4242 4242 4242 4242'],
  [/^Submits the /, 'Details', 'Typed by the fixture'],
  [/^Saves the /, 'Details', 'Updated by the fixture']
];

const TIME_SPANS: [RegExp, number, string[]][] = [
  [/longer than a minute/, 70_000, ['Payment status check runs']],
  [/ten minutes/, 10 * 60_000, ['Pickup reminder is sent', 'Unclaimed order check runs']],
  [/longer than a day/, 26 * 3_600_000, ['Daily approval check runs']]
];

function imperative(verb: string) {
  const v = verb.toLowerCase();
  if (v.endsWith('ies')) return `${v.slice(0, -3)}y`;
  if (/(sh|ch|ss|x|o)es$/.test(v)) return v.slice(0, -2);
  if (v.endsWith('s')) return v.slice(0, -1);
  return v;
}

function buttonLabel(event: string) {
  const [verb = '', ...rest] = event.split(' ');
  const words = verb === 'Taps' ? rest : [imperative(verb), ...rest];
  return capitalize(words.slice(0, 5).join(' '));
}

function systemCall(event: string, seq: number) {
  const id = String(seq).padStart(4, '0');
  const payment: [RegExp, string][] = [
    [/approves the payment/, 'payment.approved'],
    [/declines the payment/, 'payment.declined']
  ];
  for (const [pattern, type] of payment) {
    if (pattern.test(event)) {
      return {
        source: 'Payment provider webhook',
        endpoint: 'POST /webhooks/payments',
        eventType: type,
        payload: { type, data: { paymentId: `pay_fixture_${id}`, status: type.split('.').pop() } },
        responseStatus: 200
      };
    }
  }
  if (/^Barista /.test(event)) {
    const type = /starts/.test(event) ? 'order.started' : 'order.finished';
    return { source: 'Barista display', endpoint: `POST /api/orders/order-fixture-${id}/status`, eventType: type, payload: { status: type.split('.').pop() }, responseStatus: 200 };
  }
  return { source: 'App backend', endpoint: `POST /api/${slug(event)}`, payload: { requestId: `request-fixture-${id}` }, responseStatus: 201 };
}

function notificationFor(event: string, target: string | null): TimelineEntry['notification'] | null {
  if (/^Barista finishes the drink/.test(event)) return { channel: 'push', title: 'Your drink is ready', body: 'Pick it up at the counter.' };
  if (/declines the payment/.test(event)) return { channel: 'in-app', title: 'Payment declined', body: 'Try another way to pay.' };
  if (/ten minutes/.test(event)) return { channel: 'email', title: 'Your order was refunded', body: 'The drink waited too long, so we refunded it.' };
  if (/longer than a minute/.test(event)) return { channel: 'in-app', title: 'Still waiting on your payment', body: 'This can take a little longer.' };
  if (/longer than a day/.test(event)) return { channel: 'email', title: 'Still under review', body: 'We will let you know when it is approved.' };
  if (/ approves the /.test(event)) return { channel: 'push', title: 'Approved', body: target ? `Next: ${lowerFirst(target)}.` : 'Approved.' };
  return null;
}

function timelineFor(t: ParsedTransition, kind: EventKind, seq: number, clock: string) {
  const rand = seeded(t.id);
  const entries: TimelineEntry[] = [];
  const screen = (atMs: number) => ({ atMs, kind: 'screen' as const, label: `Now: ${t.target ?? 'unknown'}` });
  let clip: ClipKind = 'system';
  let how = '';
  if (kind === 'user') {
    const typed = TYPED.find(([pattern]) => pattern.test(t.event));
    const x = 40 + Math.round(rand() * 310);
    const y = 560 + Math.round(rand() * 220);
    if (typed) {
      clip = 'type';
      entries.push({ atMs: 300, kind: 'tap', label: typed[1], x: 195, y: 300 + Math.round(rand() * 120) });
      entries.push({ atMs: 650, kind: 'type', label: typed[1], text: typed[2] });
      entries.push({ atMs: 1500, kind: 'tap', label: buttonLabel(t.event), x, y });
    } else {
      clip = 'tap';
      entries.push({ atMs: 700, kind: 'tap', label: buttonLabel(t.event), x, y });
    }
    if (/^Removes/.test(t.event)) entries.push({ atMs: 1700, kind: 'toast', label: 'Removed from the cart.' });
    entries.push(screen(2100));
    how = `The user ${lowerFirst(t.event)} in the app.`;
  } else if (kind === 'time') {
    clip = 'time';
    const [, span, fired] = TIME_SPANS.find(([pattern]) => pattern.test(t.event)) ?? [/./, 86_400_000, [t.event]];
    const to = addMs(clock, span);
    entries.push({
      atMs: 300,
      kind: 'time',
      label: t.event,
      time: { from: clock, to, fired: fired.map((label, i) => ({ at: addMs(clock, Math.round((span * (i + 1)) / fired.length)), label })) }
    });
    how = 'The test clock jumps forward; nothing in the app is touched.';
    const note = notificationFor(t.event, t.target);
    if (note) entries.push({ atMs: 1100, kind: 'notification', label: note.title ?? t.event, notification: note });
    entries.push(screen(1900));
  } else if (kind === 'hand-off') {
    entries.push({ atMs: 200, kind: 'note', label: `${t.chartId} is done and hands back with "${t.event}"` });
    entries.push(screen(700));
    how = 'The child chart reached an end, so the parent chart moves on.';
  } else {
    const call = systemCall(t.event, seq);
    entries.push({ atMs: 400, kind: 'note', label: 'The user waits on this screen' });
    entries.push({ atMs: 900, kind: 'system', label: t.event, system: call });
    const note = notificationFor(t.event, t.target);
    if (note) entries.push({ atMs: 1300, kind: 'notification', label: note.title ?? t.event, notification: note });
    entries.push(screen(1900));
    how = `The fixture sends ${call.endpoint} as ${call.source}.`;
  }
  return { entries, clip, how };
}

/** A CloudEvent for a business event the run observed, as an event source would report it. */
function cloudEvent(name: string, at: string, subject: string): CloudEvent {
  return {
    specversion: '1.0',
    id: hashOf({ name, at, subject }, 20),
    source: '/fixture/orders',
    type: `com.example.${slug(name).replace(/-/g, '.')}`,
    time: at,
    subject,
    datacontenttype: 'application/json',
    data: { name }
  };
}

// ---------------------------------------------------------------------------------------------
// Runs

type MediaChoice = 'ready' | 'none' | 'processing';

type RunPlan = {
  startedAt: string;
  mode: 'fast' | 'showcase';
  durationMs: number;
  scope: Scope;
  scopeInfo?: RunInfo['scope'];
  journeys: 'all' | string[];
  failing?: Record<string, string>;
  flaky?: Record<string, string>;
  reasons?: Record<string, string>;
  generated?: boolean;
  screenshot?: (name: string, index: number) => MediaChoice;
  clip?: (id: string, index: number) => MediaChoice;
  art: (state: ParsedState, tone: ScreenArt['tone']) => ScreenArt;
  branch?: string;
  mermaid?: MachineConfig;
};

type TransitionOut = TransitionRecord & { id: string; timeline: TimelineEntry[] };

type FixtureStep = { transition: string; event: string; status: RunStatus; reason: string | null };

type FixturePath = Omit<PathRecord, 'steps' | 'attempts'> & {
  attempts: { status: string; error: string | null; stoppedAt: string | null; trace: string | null }[];
  steps: FixtureStep[];
};

type Manifest = {
  $schema: string;
  schemaVersion: number;
  run: RunInfo;
  charts: { id: string; file: string; description: string; parentState: string | null; handOffs: Record<string, string> }[];
  map: { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] };
  states: Record<string, StateRecord>;
  transitions: Record<string, TransitionOut>;
  paths: FixturePath[];
  coverage: Record<string, { states: Count; transitions: Count }>;
  privacy: { passed: boolean; findings: string[] };
  reports: { junit: string; ctrf: string; mermaid?: string };
};

const STATUS_RANK: Record<RunStatus, number> = { failed: 3, flaky: 2, passed: 1, 'not-reached': 0 };

function worst(statuses: RunStatus[]) {
  return statuses.reduce<RunStatus>((w, s) => (STATUS_RANK[s] > STATUS_RANK[w] ? s : w), 'not-reached');
}

function baseState(state: ParsedState): StateRecord {
  return {
    name: state.name,
    chart: state.chartId,
    description: state.meta.description ?? '',
    snapshot: state.meta.snapshot ?? slug(state.name),
    confidence: state.meta.confidence ?? 'confirmed',
    source: state.meta.source ?? [],
    expectedEvents: state.meta.events ?? [],
    status: 'not-reached',
    screenshot: null,
    screenshotsByPath: {},
    recognizer: null,
    looksLike: [],
    businessEvents: null,
    checks: [],
    reachedBy: [],
    notes: []
  };
}

function screenCheck(state: ParsedState, passed: boolean): CheckResult {
  return {
    check: `The screen shows "${state.name}"`,
    passed,
    expected: `test ID "${state.meta.snapshot ?? slug(state.name)}" visible`,
    actual: passed ? 'visible' : 'hidden; the app looks like none of the known screens'
  };
}

function countOf(statuses: RunStatus[]): Count {
  return {
    total: statuses.length,
    passed: statuses.filter((s) => s === 'passed').length,
    failed: statuses.filter((s) => s === 'failed').length,
    flaky: statuses.filter((s) => s === 'flaky').length,
    notReached: statuses.filter((s) => s === 'not-reached').length
  };
}

function buildRun(spec: LoadedSpec, runsDir: string, plan: RunPlan) {
  const { doc } = spec;
  const id = runIdOf(plan.startedAt, plan.mode);
  const runDir = path.join(runsDir, id);
  const w = runWriter(runDir);
  const showcase = plan.mode === 'showcase';
  const failing = plan.failing ?? {};
  const flaky = plan.flaky ?? {};
  const reachedT = new Map<string, { path: string; status: RunStatus }[]>();
  const reachedS = new Map<string, string[]>();
  const failedTargets = new Map<string, { path: string; error: string }>();
  const reachState = (name: string, pathId: string) => {
    if (!plan.scope.states.has(name)) return;
    const list = reachedS.get(name) ?? [];
    if (!list.includes(pathId)) list.push(pathId);
    reachedS.set(name, list);
  };
  const reachTransition = (tid: string, pathId: string, status: RunStatus) => {
    const list = reachedT.get(tid) ?? [];
    list.push({ path: pathId, status });
    reachedT.set(tid, list);
  };

  const wanted = plan.journeys === 'all' ? null : new Set(plan.journeys);
  for (const name of wanted ?? []) if (!doc.journeys.some((j) => j.name === name)) throw new Error(`No journey called "${name}"`);
  const paths: FixturePath[] = [];
  doc.journeys.forEach((journey, index) => {
    if (wanted && !wanted.has(journey.name)) return;
    const pathId = `journey-${index + 1}`;
    const replay = spec.replays.get(journey.id)!;
    const steps: FixtureStep[] = [];
    let status: RunStatus = 'passed';
    let stoppedAt: string | null = null;
    let error: string | null = null;
    let flakyError: string | null = null;
    let started = false;
    walk: for (const step of replay.steps) {
      for (const tid of step.transitionIds) {
        if (!plan.scope.transitions.has(tid)) {
          if (started) break walk;
          continue;
        }
        const t = doc.transitions.get(tid)!;
        if (!started) for (const name of step.from) reachState(name, pathId);
        started = true;
        if (stoppedAt) {
          steps.push({ transition: tid, event: t.event, status: 'not-reached', reason: `Not reached: the path stopped at "${stoppedAt}".` });
          continue;
        }
        if (failing[tid]) {
          status = 'failed';
          stoppedAt = t.target ?? t.source;
          error = failing[tid]!;
          steps.push({ transition: tid, event: t.event, status: 'failed', reason: error });
          reachTransition(tid, pathId, 'failed');
          if (t.target && !failedTargets.has(t.target)) failedTargets.set(t.target, { path: pathId, error });
          continue;
        }
        const stepStatus: RunStatus = flaky[tid] ? 'flaky' : 'passed';
        if (stepStatus === 'flaky' && status === 'passed') {
          status = 'flaky';
          flakyError = flaky[tid]!;
        }
        steps.push({ transition: tid, event: t.event, status: stepStatus, reason: stepStatus === 'flaky' ? flaky[tid]! : null });
        reachTransition(tid, pathId, stepStatus);
        for (const name of step.to) reachState(name, pathId);
      }
    }
    if (steps.length === 0) return;
    const attempts =
      status === 'failed'
        ? [
            { status: 'failed', error, stoppedAt, trace: null },
            { status: 'failed', error, stoppedAt, trace: null }
          ]
        : status === 'flaky'
          ? [
              { status: 'failed', error: flakyError, stoppedAt: null, trace: null },
              { status: 'passed', error: null, stoppedAt: null, trace: null }
            ]
          : [{ status: 'passed', error: null, stoppedAt: null, trace: null }];
    paths.push({ id: pathId, name: journey.name, kind: 'journey', description: journey.description, status, attempts, steps, stoppedAt });
  });

  if (plan.generated) {
    const byChart = new Map<string, ParsedTransition[]>();
    for (const t of doc.transitions.values()) {
      if (!plan.scope.transitions.has(t.id) || reachedT.has(t.id)) continue;
      byChart.set(t.chartId, [...(byChart.get(t.chartId) ?? []), t]);
    }
    let n = 0;
    for (const [chartId, list] of byChart) {
      const pathId = `generated-${++n}`;
      for (const t of list) {
        reachTransition(t.id, pathId, 'passed');
        for (const name of [t.source, ...(t.target ? [t.target, ...ancestors(doc, t.target)] : [])]) reachState(name, pathId);
      }
      paths.push({
        id: pathId,
        name: `Every other event in ${chartId}`,
        kind: 'generated',
        description: `Generated to reach the ${list.length} events in "${chartId}" that no named journey takes.`,
        status: 'passed',
        attempts: [{ status: 'passed', error: null, stoppedAt: null, trace: null }],
        steps: list.map((t) => ({ transition: t.id, event: t.event, status: 'passed', reason: null })),
        stoppedAt: null
      });
    }
    for (const name of plan.scope.states) if (!reachedS.has(name)) reachState(name, paths.find((p) => p.kind === 'generated')?.id ?? 'generated-1');
  }

  const states: Record<string, StateRecord> = {};
  let screenIndex = 0;
  for (const state of doc.states.values()) {
    if (!plan.scope.states.has(state.name)) continue;
    const rec = baseState(state);
    const by = reachedS.get(state.name);
    const failed = failedTargets.get(state.name);
    if (failed) {
      rec.status = 'failed';
      rec.recognizer = { matched: false, signals: [{ signal: `test ID "${rec.snapshot}"`, expected: 'visible', visible: false }] };
      rec.checks = [screenCheck(state, false)];
      if (showcase && isScreenLike(state)) {
        rec.screenshotsByPath = { [`${failed.path} (failed)`]: w.screen(failed.path, plan.art(state, 'error'), { prefix: 'failed-' }) };
      }
    } else if (by) {
      rec.status = 'passed';
      rec.reachedBy = by;
      rec.recognizer = { matched: true, signals: [{ signal: `test ID "${rec.snapshot}"`, expected: 'visible', visible: true }] };
      if (isScreenLike(state)) rec.checks = [screenCheck(state, true)];
      if (rec.expectedEvents?.length) {
        const at = addMs(plan.startedAt, 60_000 * (screenIndex + 1));
        rec.businessEvents = {
          expected: rec.expectedEvents,
          observed: rec.expectedEvents,
          missing: [],
          noSignal: [],
          events: rec.expectedEvents.map((name) => cloudEvent(name, at, `order-fixture-${hashOf(id, 6)}`))
        };
      }
      if (showcase && isScreenLike(state)) {
        const choice = plan.screenshot?.(state.name, screenIndex++) ?? 'ready';
        if (choice === 'ready') {
          const image = w.screen(by[0]!, plan.art(state, 'normal'));
          rec.screenshot = image;
          rec.screenshotsByPath = { [by[0]!]: image };
        } else if (choice === 'processing') {
          rec.screenshot = w.screen(by[0]!, plan.art(state, 'normal'), { write: false });
          rec.screenshotState = 'processing';
        } else {
          rec.notes = ['Shown too briefly to capture; not seeing it is not a failure.'];
        }
      }
    }
    states[state.name] = rec;
  }

  const transitions: Record<string, TransitionOut> = {};
  let clipIndex = 0;
  let seq = 0;
  for (const t of doc.transitions.values()) {
    if (!plan.scope.transitions.has(t.id)) continue;
    const kind = kindOf(doc, t);
    const hits = reachedT.get(t.id);
    const rec: TransitionOut = {
      id: t.id,
      source: t.source,
      target: t.target,
      event: t.event,
      kind,
      how: null,
      status: 'not-reached',
      clip: null,
      timeline: [],
      reason: plan.reasons?.[t.id] ?? 'No path reached it.',
      reachedBy: []
    };
    if (hits?.length) {
      const status = worst(hits.map((h) => h.status));
      const clock = addMs(plan.startedAt, seq * 3_600_000);
      const timeline = timelineFor(t, kind, ++seq, clock);
      rec.status = status;
      rec.reason = status === 'failed' ? (failing[t.id] ?? null) : status === 'flaky' ? (flaky[t.id] ?? null) : null;
      rec.reachedBy = [...new Set(hits.map((h) => h.path))];
      rec.how = timeline.how;
      rec.timeline = timeline.entries;
      if (showcase) {
        const choice = plan.clip?.(t.id, clipIndex++) ?? 'ready';
        rec.clip = choice === 'ready' ? w.clip(timeline.clip, timeline.entries) : choice === 'processing' ? w.pendingClip() : null;
      }
    }
    transitions[t.id] = rec;
  }

  const coverage: Manifest['coverage'] = {};
  for (const chart of doc.charts) {
    const s = Object.values(states).filter((r) => r.chart === chart.id).map((r) => r.status);
    const tr = Object.values(transitions).filter((r) => doc.transitions.get(r.id)?.chartId === chart.id).map((r) => r.status);
    if (s.length || tr.length) coverage[chart.id] = { states: countOf(s), transitions: countOf(tr) };
  }
  coverage.overall = { states: countOf(Object.values(states).map((r) => r.status)), transitions: countOf(Object.values(transitions).map((r) => r.status)) };

  const manifest: Manifest = {
    $schema: 'https://github.com/crvouga/atlas/schemas/manifest.schema.json',
    schemaVersion: 1,
    run: {
      id,
      startedAt: plan.startedAt,
      finishedAt: addMs(plan.startedAt, plan.durationMs),
      durationMs: plan.durationMs,
      commit: hashOf(id, 40),
      branch: plan.branch ?? 'main',
      environment: { driver: 'playwright', baseUrl: 'http://localhost:3000', viewport: { width: 390, height: 844 }, deviceScaleFactor: 3 },
      mode: plan.mode,
      specVersion: spec.version,
      specDirectory: spec.specDirectory,
      approvals: [],
      ...(plan.scopeInfo ? { scope: plan.scopeInfo } : {})
    },
    charts: doc.charts.map((c) => ({
      id: c.id,
      file: c.file,
      description: c.meta.description ?? '',
      parentState: c.parent?.state ?? null,
      handOffs: Object.fromEntries([...doc.transitions.values()].filter((t) => t.chartId === c.id && t.handOff).map((t) => [t.source, t.event]))
    })),
    map: {
      nodes: [...doc.states.values()].map((s) => ({ id: s.name, parent: s.parent, chart: s.chartId, type: s.type, initial: s.initial, inScope: plan.scope.states.has(s.name) })),
      edges: [...doc.transitions.values()]
        .filter((t) => runnable(t) && t.target)
        .map((t) => ({ id: t.id, source: t.source, target: t.target, event: t.event, kind: kindOf(doc, t), inScope: plan.scope.transitions.has(t.id) }))
    },
    states,
    transitions,
    paths,
    coverage,
    privacy: { passed: true, findings: [] },
    reports: { junit: 'junit.xml', ctrf: 'ctrf.json', ...(plan.mermaid ? { mermaid: 'chart.mmd' } : {}) }
  };
  return { id, runDir, writer: w, manifest, mermaid: plan.mermaid };
}

function writeManifest(runDir: string, manifest: Manifest | Record<string, unknown>, mermaid?: MachineConfig) {
  writeText(path.join(runDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  if ('paths' in manifest && 'run' in manifest && manifest.run) {
    const m = manifest as Manifest;
    writeText(path.join(runDir, 'junit.xml'), toJUnit(m));
    writeText(path.join(runDir, 'ctrf.json'), `${JSON.stringify(toCtrf(m), null, 2)}\n`);
  }
  if (mermaid) writeText(path.join(runDir, 'chart.mmd'), toMermaid(mermaid));
}

const CHART_COLORS: Record<string, string> = { [TOP_CHART]: '#2F6FED', [CHECKOUT_CHART]: '#0F9D74' };

function exampleArt(state: ParsedState, tone: ScreenArt['tone']): ScreenArt {
  return { title: state.name, subtitle: state.chartId, color: CHART_COLORS[state.chartId] ?? '#475467', tone };
}

function resetFixture(name: string) {
  const dir = path.join(FIXTURES_ROOT, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(path.join(dir, 'runs'), { recursive: true });
  return { dir, runs: path.join(dir, 'runs') };
}

function checkoutRun(spec: LoadedSpec, runsDir: string, plan: Omit<RunPlan, 'scope' | 'art' | 'scopeInfo'>) {
  return buildRun(spec, runsDir, {
    ...plan,
    scope: checkoutScope(spec.doc),
    scopeInfo: { chart: CHECKOUT_CHART, start: 'A customer with a drink in the cart' },
    art: exampleArt
  });
}

// ---------------------------------------------------------------------------------------------
// Example fixtures

function makeSpecOnly(spec: LoadedSpec) {
  const f = resetFixture('spec-only');
  writeSpec(f.dir, spec.files);
  writeText(path.join(f.runs, '.gitkeep'), '');
}

function makePartial(spec: LoadedSpec, mermaid: MachineConfig) {
  const f = resetFixture('partial');
  writeSpec(f.dir, spec.files);
  const run = checkoutRun(spec, f.runs, {
    startedAt: '2026-10-06T14:40:00.000Z',
    mode: 'showcase',
    durationMs: 212_400,
    journeys: ['Orders a drink and pays by card', 'Pays with a wallet', 'Card declined, then a wallet works', 'Leaves checkout and comes back'],
    screenshot: (name, i) => (name === 'Waiting for the payment' ? 'processing' : i % 4 === 3 ? 'none' : 'ready'),
    clip: (_id, i) => (i === 2 ? 'processing' : i % 2 === 1 ? 'none' : 'ready'),
    reasons: { 'Waiting for the payment :: Payment takes longer than a minute': 'Needs a payment provider stand-in that can answer slowly; not wired yet.' },
    mermaid
  });
  writeManifest(run.runDir, run.manifest, run.mermaid);

  const running = runWriter(path.join(f.runs, runIdOf('2026-10-06T15:05:00.000Z', 'showcase')));
  const cart = spec.doc.states.get('Reviewing the cart')!;
  const paying = spec.doc.states.get('Choosing how to pay')!;
  running.screen('journey-1', exampleArt(cart, 'normal'), { prefix: '00-start-' });
  running.screen('journey-1', exampleArt(paying, 'normal'));
}

function makeFull(spec: LoadedSpec, mermaid: MachineConfig) {
  const f = resetFixture('full');
  writeSpec(f.dir, spec.files);
  const fast = checkoutRun(spec, f.runs, {
    startedAt: '2026-10-02T09:10:00.000Z',
    mode: 'fast',
    durationMs: 48_200,
    journeys: 'all',
    failing: { 'Confirming with the wallet :: Confirms with the wallet': 'Expected "Waiting for the payment", but the wallet sheet is still open' },
    mermaid
  });
  writeManifest(fast.runDir, fast.manifest, fast.mermaid);
  const older = checkoutRun(spec, f.runs, {
    startedAt: '2026-10-04T16:20:00.000Z',
    mode: 'showcase',
    durationMs: 402_900,
    journeys: 'all',
    flaky: { 'Told the payment was declined :: Tries another way to pay': 'The button responded only on the second tap.' },
    screenshot: (_name, i) => (i < 4 ? 'ready' : 'none'),
    clip: (_id, i) => (i < 6 ? 'ready' : 'none'),
    mermaid
  });
  writeManifest(older.runDir, older.manifest, older.mermaid);
  const newest = buildRun(spec, f.runs, {
    startedAt: '2026-10-06T14:40:00.000Z',
    mode: 'showcase',
    durationMs: 684_600,
    scope: fullScope(spec.doc),
    scopeInfo: { start: 'A customer on the menu' },
    journeys: 'all',
    generated: true,
    art: exampleArt,
    mermaid
  });
  writeManifest(newest.runDir, newest.manifest, newest.mermaid);
}

function makeFailures(spec: LoadedSpec, mermaid: MachineConfig) {
  const f = resetFixture('failures');
  writeSpec(f.dir, spec.files);
  const { doc } = spec;
  const run = checkoutRun(spec, f.runs, {
    startedAt: '2026-10-06T14:40:00.000Z',
    mode: 'showcase',
    durationMs: 455_000,
    journeys: 'all',
    failing: {
      'Waiting for the payment :: Payment provider declines the payment': 'Expected "Told the payment was declined", the app looks like none of the known screens'
    },
    flaky: {
      'Choosing how to pay :: Picks wallet': 'Timed out waiting for "Confirming with the wallet" on the first attempt',
      'Waiting for the payment :: Payment takes longer than a minute': 'The clock jump landed before the payment check started; passed on retry'
    },
    reasons: {
      'Confirming with the wallet :: Cancels the wallet': 'The wallet stand-in cannot be cancelled yet.',
      'Entering card details :: Goes back to the payment options': 'No journey goes back from the card form, and generated paths are off in this run.'
    },
    mermaid
  });
  const m = run.manifest;
  const subject = 'order-fixture-failures';
  const slow = m.states['Told the payment is slow']!;
  slow.status = 'flaky';
  slow.notes = ['Passed on the second attempt: the first attempt saw the spinner still running.'];
  const waiting = m.states['Waiting for the payment']!;
  waiting.businessEvents = { expected: waiting.expectedEvents ?? [], observed: [], missing: waiting.expectedEvents ?? [], noSignal: [], events: [] };
  const paid = m.states['Paid']!;
  const paidState = doc.states.get('Paid')!;
  paid.status = 'failed';
  paid.businessEvents = {
    expected: [...(paid.expectedEvents ?? []), 'Customer notified'],
    observed: paid.expectedEvents ?? [],
    missing: ['Customer notified'],
    noSignal: [],
    events: (paid.expectedEvents ?? []).map((name) => cloudEvent(name, '2026-10-06T14:45:00.000Z', subject))
  };
  paid.checks = [
    screenCheck(paidState, true),
    { check: 'Business event "Customer notified" is recorded', passed: false, expected: 'recorded within 10 seconds', actual: 'not recorded' }
  ];
  const confirm = m.transitions['Confirming with the wallet :: Confirms with the wallet']!;
  confirm.status = 'flaky';
  confirm.reason = 'The wallet sheet answered slowly once; passed on retry.';
  confirm.clip = run.writer.clip('tap', confirm.timeline);
  writeManifest(run.runDir, m, run.mermaid);
}

function makeRemoved(spec: LoadedSpec) {
  const f = resetFixture('removed');
  writeSpec(f.dir, spec.files);
  const run = checkoutRun(spec, f.runs, {
    startedAt: '2026-10-06T14:40:00.000Z',
    mode: 'showcase',
    durationMs: 133_000,
    journeys: ['Orders a drink and pays by card', 'Pays with a wallet'],
    screenshot: (_name, i) => (i < 4 ? 'ready' : 'none'),
    clip: (_id, i) => (i < 4 ? 'ready' : 'none')
  });
  const m = run.manifest;
  const gone = (name: string, status: RunStatus, description: string): StateRecord => ({
    name,
    chart: CHECKOUT_CHART,
    description,
    snapshot: slug(name),
    confidence: 'confirmed',
    source: [],
    expectedEvents: [],
    status,
    screenshot: status === 'passed' ? run.writer.screen('journey-1', { title: name, subtitle: CHECKOUT_CHART, color: '#98A2B3', tone: 'normal' }) : null,
    screenshotsByPath: {},
    recognizer: null,
    looksLike: [],
    businessEvents: null,
    checks: [],
    reachedBy: status === 'passed' ? ['journey-1'] : [],
    notes: []
  });
  m.states['Choosing a tip'] = gone('Choosing a tip', 'passed', 'The customer picks a tip before paying (removed from the spec since this run).');
  m.states['Told the card reader is offline'] = gone('Told the card reader is offline', 'failed', 'A sheet said the card reader was offline (removed from the spec).');
  const extra: [string, string, string | null, RunStatus][] = [
    ['Choosing a tip', 'Picks no tip', 'Choosing how to pay', 'passed'],
    ['Entering card details', 'Scans the card', 'Waiting for the payment', 'passed'],
    ['Told the card reader is offline', 'Closes the message', 'Choosing how to pay', 'not-reached']
  ];
  for (const [source, event, target, status] of extra) {
    const id = `${source} :: ${event}`;
    m.transitions[id] = { id, source, target, event, kind: 'user', how: null, status, clip: null, timeline: [], reason: status === 'passed' ? null : 'No path reached it.', reachedBy: status === 'passed' ? ['journey-1'] : [] };
  }
  writeManifest(run.runDir, m);
}

function plant(text: string, anchor: string, from: string, to: string) {
  const at = anchor ? text.indexOf(anchor) : 0;
  if (at < 0) throw new Error(`Anchor not found: ${anchor}`);
  const i = text.indexOf(from, at);
  if (i < 0) throw new Error(`Text not found after ${anchor}: ${from}`);
  return text.slice(0, i) + to + text.slice(i + from.length);
}

function makeMalformed(spec: LoadedSpec) {
  const f = resetFixture('malformed');
  const files = spec.files.map((file) => ({ ...file }));
  const byName = (name: string) => files.find((file) => file.path.endsWith(`/${name}`))!;
  const top = byName('machine.yaml');
  top.text = plant(top.text, 'snapshot: order-making', 'confidence: assumed', 'confidence: maybe');
  top.text = plant(top.text, 'snapshot: order-expired', "      Orders again:\n        target: '#Browsing the menu'\n", '      Orders again:\n');
  top.text = plant(top.text, 'snapshot: order-complete', '      events:\n        - Order completed\n', '      events: Order completed\n');
  const checkout = byName('checkout.scxml');
  checkout.text = plant(checkout.text, 'atlas:name="Tries another way to pay"', 'target="choosing-how-to-pay"', 'target="choosing-a-tip"');
  const journeys = byName('journeys.yaml');
  journeys.text = plant(journeys.text, '\n  Slow payment:\n', '      - Submits the card\n', '      - Submits the card: twice: over\n');
  journeys.text = `${journeys.text.trimEnd()}\n  Pays before ordering:\n    description: A planted journey whose second event can't happen at that point.\n    events:\n      - Picks a drink\n      - Submits the card\n`;
  files.push({ path: `${SPEC_DIR}/loyalty.scxml`, text: '<?xml version="1.0" encoding="UTF-8"?>\n<statechart name="Loyalty">\n  <state id="collecting-stamps"/>\n</statechart>\n' });
  writeSpec(f.dir, files);

  const base = (startedAt: string) =>
    checkoutRun(spec, f.runs, { startedAt, mode: 'showcase', durationMs: 120_000, journeys: ['Orders a drink and pays by card'], screenshot: () => 'none', clip: () => 'none' });

  const notJson = base('2026-10-06T10:00:00.000Z');
  writeText(path.join(notJson.runDir, 'manifest.json'), JSON.stringify(notJson.manifest, null, 2).slice(0, 1800));

  const newer = base('2026-10-06T11:00:00.000Z');
  const step = Object.values(newer.manifest.transitions).find((t) => t.timeline.length > 0)!;
  writeManifest(newer.runDir, {
    ...newer.manifest,
    schemaVersion: 2,
    replays: { format: 'rrweb', files: ['media/replays/journey-1.json'] },
    transitions: {
      ...newer.manifest.transitions,
      [step.id]: { ...step, timeline: [...step.timeline, { atMs: 1200, kind: 'haptic', label: 'The phone buzzes', pattern: 'success' }] }
    }
  });

  const invalid = base('2026-10-06T12:00:00.000Z');
  const names = Object.keys(invalid.manifest.states);
  writeManifest(invalid.runDir, {
    ...invalid.manifest,
    states: {
      ...invalid.manifest.states,
      [names[1]!]: { ...invalid.manifest.states[names[1]!], status: 'great' },
      [names[2]!]: { ...invalid.manifest.states[names[2]!], screenshot: 42 },
      [names[3]!]: 'passed'
    }
  });

  const noRun = base('2026-10-06T13:00:00.000Z');
  const { run: _run, ...rest } = noRun.manifest;
  writeManifest(noRun.runDir, rest);
}

// ---------------------------------------------------------------------------------------------
// Large atlas

type Node = {
  id?: string;
  initial?: string;
  type?: 'parallel' | 'final';
  meta?: Record<string, unknown>;
  states?: Record<string, Node>;
  on?: Record<string, { target: string }>;
  invoke?: { src: string; id: string };
};

/** How a context composes its child chart: a standard invoke (YAML or SCXML child) or the legacy meta. */
type Composition = 'invoke' | 'invoke-scxml' | 'legacy';

type LargeContext = {
  id: string;
  name: string;
  description: string;
  owner: string;
  dir: string;
  chart: string;
  child: string;
  approver: string;
  objects: string[];
  childObjects: string[];
  linkAfter: number;
  color: string;
  composition: Composition;
};

const LARGE_CONTEXTS: LargeContext[] = [
  {
    id: 'accounts', name: 'Accounts', description: 'Signing up and keeping a profile up to date.', owner: 'Accounts team',
    dir: 'accounts/sign-up', chart: 'Sign-up', child: 'Identity check', approver: 'Identity service',
    objects: ['account details', 'home address', 'date of birth', 'profile photo', 'notification preferences', 'security questions'],
    childObjects: ['photo ID', 'selfie match', 'address proof'], linkAfter: 2, color: '#2F6FED', composition: 'invoke'
  },
  {
    id: 'catalog', name: 'Catalog', description: 'Finding and comparing products.', owner: 'Catalog team',
    dir: 'catalog/browsing', chart: 'Product browsing', child: 'Product comparison', approver: 'Catalog service',
    objects: ['search filters', 'product list', 'product details', 'saved list', 'price alert', 'review draft'],
    childObjects: ['comparison list', 'comparison table', 'comparison summary'], linkAfter: 1, color: '#7A5AF8', composition: 'legacy'
  },
  {
    id: 'orders', name: 'Orders', description: 'Carts, checkout and order history.', owner: 'Orders team',
    dir: 'orders/checkout', chart: 'Order checkout', child: 'Payment', approver: 'Payment processor',
    objects: ['shopping cart', 'delivery address', 'payment method', 'promo code', 'gift message'],
    childObjects: ['payment details', 'payment authorization', 'payment receipt'], linkAfter: 1, color: '#0F9D74', composition: 'invoke-scxml'
  },
  {
    id: 'shipping', name: 'Shipping', description: 'Packing, shipping and delivery.', owner: 'Fulfillment team',
    dir: 'shipping/deliveries', chart: 'Deliveries', child: 'Delivery scheduling', approver: 'Carrier',
    objects: ['shipping label', 'package contents', 'pickup window', 'tracking number', 'delivery instructions', 'return label'],
    childObjects: ['delivery slot', 'delivery reminder', 'delivery confirmation'], linkAfter: 0, color: '#DD2590', composition: 'invoke'
  },
  {
    id: 'support', name: 'Support', description: 'Help requests, answers and escalations.', owner: 'Support team',
    dir: 'support/tickets', chart: 'Support tickets', child: 'Escalation', approver: 'Support desk',
    objects: ['help request', 'request details', 'attached screenshot', 'reply draft', 'satisfaction rating'],
    childObjects: ['escalation note', 'specialist review', 'escalation answer'], linkAfter: 2, color: '#DC6803', composition: 'legacy'
  },
  {
    id: 'billing', name: 'Billing', description: 'Invoices, receipts, refunds and credits.', owner: 'Billing team',
    dir: 'billing/invoices', chart: 'Invoices and payments', child: 'Refund handling', approver: 'Billing service',
    objects: ['monthly invoice', 'paid invoice', 'tax document', 'payment plan', 'billing dispute', 'account credit'],
    childObjects: ['refund request', 'refund approval', 'refund transfer'], linkAfter: 3, color: '#475467', composition: 'invoke-scxml'
  }
];

const go = (name: string) => ({ target: `#${name}` });

function stateMeta(name: string, description: string, extra: Record<string, unknown> = {}) {
  return { description, snapshot: slug(name), events: [], confidence: 'confirmed', source: [`src/screens/${slug(name)}.tsx`], ...extra };
}

type StageNames = { group: string; reviewing: string; approved: string };

function stageNames(o: string): StageNames {
  return { group: `Handling the ${o}`, reviewing: `Reviewing the ${o}`, approved: `Told the ${o} was approved` };
}

function stage(ctx: LargeContext, o: string, next: { event: string; target: string }, options: { nested: boolean; extraFirst?: Record<string, { target: string }> }): Node {
  const names = stageNames(o);
  const editing = `Editing the ${o}`;
  const details = `Editing the ${o} details`;
  const uploading = `Uploading a file for the ${o}`;
  const saveFailed = `Told the ${o} could not be saved`;
  const waiting = `Waiting for the ${o} to be approved`;
  const slow = `Told the ${o} is still under review`;
  const rejected = `Told the ${o} was rejected`;
  const editingOn = {
    [`Saves the ${o}`]: go(names.reviewing),
    [`Cancels the changes to the ${o}`]: go(names.reviewing),
    [`Saving the ${o} fails`]: go(saveFailed)
  };
  const editingNode: Node = options.nested
    ? {
        id: editing,
        initial: details,
        meta: stateMeta(editing, `The user changes the ${o}, with an optional file.`),
        states: {
          [details]: { id: details, meta: stateMeta(details, `A form with the ${o} fields.`, { hints: ['A text field per detail', 'An "Upload a file" link'] }), on: { 'Uploads a file': go(uploading) } },
          [uploading]: { id: uploading, meta: stateMeta(uploading, `A file picker for a document about the ${o}.`), on: { 'Finishes uploading the file': go(details) } }
        },
        on: editingOn
      }
    : { id: editing, meta: stateMeta(editing, `A form to change the ${o}.`), on: editingOn };
  return {
    id: names.group,
    initial: names.reviewing,
    meta: stateMeta(names.group, `Everything about the ${o}, from review to approval.`, { owner: ctx.owner }),
    states: {
      [names.reviewing]: {
        id: names.reviewing,
        meta: stateMeta(names.reviewing, `The user checks the ${o} before sending it.`, { gherkin: [`features/${ctx.dir}/${slug(o)}.feature`] }),
        on: { [`Taps edit on the ${o}`]: go(editing), [`Submits the ${o}`]: go(waiting), ...options.extraFirst }
      },
      [editing]: editingNode,
      [saveFailed]: { id: saveFailed, meta: stateMeta(saveFailed, `A message says the ${o} could not be saved, with "Try again".`), on: { [`Tries saving the ${o} again`]: go(editing) } },
      [waiting]: {
        id: waiting,
        meta: stateMeta(waiting, `A card says the ${o} is being checked.`, { events: [`${capitalize(o)} submitted`], tier: 'critical' }),
        on: {
          [`${ctx.approver} approves the ${o}`]: go(names.approved),
          [`${ctx.approver} rejects the ${o}`]: go(rejected),
          [`Approval of the ${o} takes longer than a day`]: go(slow)
        }
      },
      [slow]: { id: slow, meta: stateMeta(slow, `A card says the ${o} is still being checked.`, { confidence: 'assumed' }), on: { [`Checks the ${o} again`]: go(waiting) } },
      [rejected]: { id: rejected, meta: stateMeta(rejected, `A message explains why the ${o} was not accepted.`), on: { [`Starts the ${o} again`]: go(names.reviewing) } },
      [names.approved]: {
        id: names.approved,
        meta: stateMeta(names.approved, `A message confirms the ${o} is approved.`, { events: [`${capitalize(o)} approved`] }),
        on: { [next.event]: go(next.target) }
      }
    }
  };
}

function settingsNames(ctx: LargeContext) {
  const c = ctx.chart.toLowerCase();
  return {
    settings: `${ctx.chart} settings`,
    notifications: `${ctx.chart} notifications`,
    on: `${ctx.chart} notifications on`,
    off: `${ctx.chart} notifications off`,
    support: `${ctx.chart} help`,
    none: `No open ${c} help request`,
    open: `${ctx.chart} help request open`,
    answered: `${ctx.chart} help request answered`,
    finished: `${ctx.chart} finished`,
    closeEvent: `Closes the ${c} settings`,
    offEvent: `Turns off ${c} notifications`,
    onEvent: `Turns on ${c} notifications`,
    openEvent: `Opens a ${c} help request`,
    answerEvent: `Help desk answers the ${c} help request`,
    againEvent: `Opens another ${c} help request`,
    toSettings: `Continues to the ${c} settings`
  };
}

function largeCharts(ctx: LargeContext) {
  const child = ctx.child.toLowerCase();
  const link = `Going through the ${child}`;
  const completed = `${ctx.child} completed`;
  const abandoned = `${ctx.child} abandoned`;
  const completedEvent = `${ctx.child} is completed`;
  const abandonedEvent = `${ctx.child} is abandoned`;
  const startChild = `Starts the ${child}`;
  const s = settingsNames(ctx);
  const legacy = ctx.composition === 'legacy';

  const top: Record<string, Node> = {};
  ctx.objects.forEach((o, i) => {
    const nextO = ctx.objects[i + 1];
    const next =
      i === ctx.linkAfter
        ? { event: startChild, target: link }
        : nextO
          ? { event: `Continues to the ${nextO}`, target: stageNames(nextO).group }
          : { event: s.toSettings, target: s.settings };
    top[stageNames(o).group] = stage(ctx, o, next, { nested: i === 0 });
    if (i === ctx.linkAfter) {
      const after = ctx.objects[i + 1]!;
      top[link] = {
        id: link,
        meta: legacy
          ? stateMeta(link, `The ${child} runs as its own chart.`, { childMachine: ctx.child, childFinalEvents: { [completed]: completedEvent, [abandoned]: abandonedEvent } })
          : stateMeta(link, `The ${child} runs as its own chart.`),
        ...(legacy ? {} : { invoke: { src: ctx.child, id: slug(ctx.child) } }),
        on: { [completedEvent]: go(stageNames(after).group), [abandonedEvent]: go(stageNames(o).reviewing) }
      };
    }
  });
  top[s.settings] = {
    id: s.settings,
    type: 'parallel',
    meta: stateMeta(s.settings, `Settings for ${ctx.chart.toLowerCase()}: notifications and help side by side.`),
    states: {
      [s.notifications]: {
        id: s.notifications,
        initial: s.on,
        meta: stateMeta(s.notifications, 'Whether the user gets notifications.'),
        states: {
          [s.on]: { id: s.on, meta: stateMeta(s.on, 'The notifications switch is on.'), on: { [s.offEvent]: go(s.off) } },
          [s.off]: { id: s.off, meta: stateMeta(s.off, 'The notifications switch is off.'), on: { [s.onEvent]: go(s.on) } }
        }
      },
      [s.support]: {
        id: s.support,
        initial: s.none,
        meta: stateMeta(s.support, 'Help requests about this part of the product.'),
        states: {
          [s.none]: { id: s.none, meta: stateMeta(s.none, 'A "Get help" button.'), on: { [s.openEvent]: go(s.open) } },
          [s.open]: { id: s.open, meta: stateMeta(s.open, 'A card says the help desk will answer soon.'), on: { [s.answerEvent]: go(s.answered) } },
          [s.answered]: { id: s.answered, meta: stateMeta(s.answered, 'The answer shows in the help card.'), on: { [s.againEvent]: go(s.open) } }
        }
      }
    },
    on: { [s.closeEvent]: go(s.finished) }
  };
  top[s.finished] = { id: s.finished, type: 'final', meta: stateMeta(s.finished, `The user is done with ${ctx.chart.toLowerCase()}.`, { events: [`${ctx.chart} finished`] }) };

  const kid: Record<string, Node> = {};
  ctx.childObjects.forEach((o, i) => {
    const nextO = ctx.childObjects[i + 1];
    const next = nextO ? { event: `Continues to the ${nextO}`, target: stageNames(nextO).group } : { event: `Finishes the ${child}`, target: completed };
    kid[stageNames(o).group] = stage(ctx, o, next, { nested: i === 0, extraFirst: i === 0 ? { [`Closes the ${child}`]: go(abandoned) } : undefined });
  });
  const doneEvent = (event: string) => (legacy ? {} : { doneEvent: event });
  kid[completed] = { id: completed, type: 'final', meta: stateMeta(completed, `The ${child} is done.`, { events: [`${ctx.child} completed`], ...doneEvent(completedEvent) }) };
  kid[abandoned] = { id: abandoned, type: 'final', meta: stateMeta(abandoned, `The user left the ${child} before the end.`, doneEvent(abandonedEvent)) };

  const firstO = ctx.objects[0]!;
  const topMeta: Record<string, unknown> = { description: ctx.description, snapshot: slug(ctx.chart), events: [], confidence: 'confirmed', source: [`src/screens/${slug(ctx.chart)}`] };
  if (ctx.id === 'orders') {
    topMeta.timeEvents = { [`Approval of the ${firstO} takes longer than a day`]: '1 day' };
    topMeta.eventKinds = { [`${ctx.approver} approves the ${firstO}`]: 'system', [`Checks the ${firstO} again`]: 'user' };
  }
  const topChart = { id: ctx.chart, initial: stageNames(firstO).group, meta: topMeta, states: top };
  const childChart = {
    id: ctx.child,
    initial: stageNames(ctx.childObjects[0]!).group,
    meta: { description: `The ${child}, a step inside ${ctx.chart.toLowerCase()}.`, snapshot: slug(ctx.child), events: [], confidence: 'confirmed', source: [] },
    states: kid
  };
  return { topChart, childChart };
}

function largeJourneys(ctx: LargeContext) {
  const child = ctx.child.toLowerCase();
  const s = settingsNames(ctx);
  const approve = (o: string) => [`Submits the ${o}`, `${ctx.approver} approves the ${o}`];
  const childHappy = ctx.childObjects.flatMap((o, i) => [...approve(o), ctx.childObjects[i + 1] ? `Continues to the ${ctx.childObjects[i + 1]}` : `Finishes the ${child}`]);
  const through = (count: number) =>
    ctx.objects.slice(0, count).flatMap((o, i) => {
      const nextO = ctx.objects[i + 1];
      if (i === ctx.linkAfter) return [...approve(o), `Starts the ${child}`, ...childHappy];
      return [...approve(o), nextO ? `Continues to the ${nextO}` : s.toSettings];
    });
  const [o0, o1] = ctx.objects as [string, string];
  const oL = ctx.objects[ctx.linkAfter]!;
  const toLink = [...through(ctx.linkAfter), ...approve(oL), `Starts the ${child}`];
  const journeys: Record<string, { description: string; events: string[]; endsIn: string[]; owner?: string; tour?: boolean }> = {
    [`Happy path through ${ctx.chart.toLowerCase()}`]: {
      description: `Everything is approved the first time, through the ${child} and settings.`,
      events: [...through(ctx.objects.length), s.closeEvent],
      endsIn: [s.finished],
      owner: ctx.owner,
      tour: true
    },
    [`Edits the ${o0} with a file`]: {
      description: `The user edits the ${o0}, uploads a file, then sends it.`,
      events: [`Taps edit on the ${o0}`, 'Uploads a file', 'Finishes uploading the file', `Saves the ${o0}`, ...approve(o0)],
      endsIn: [stageNames(o0).approved]
    },
    [`Saving the ${o0} fails, then works`]: {
      description: 'The first save fails and the retry works.',
      events: [`Taps edit on the ${o0}`, `Saving the ${o0} fails`, `Tries saving the ${o0} again`, `Saves the ${o0}`],
      endsIn: [stageNames(o0).reviewing]
    },
    [`Slow approval of the ${o1}`]: {
      description: `Approval of the ${o1} takes more than a day.`,
      events: [...through(1), `Submits the ${o1}`, `Approval of the ${o1} takes longer than a day`, `Checks the ${o1} again`, `${ctx.approver} approves the ${o1}`],
      endsIn: [stageNames(o1).approved]
    },
    [`${capitalize(o0)} rejected, then approved`]: {
      description: `The ${o0} is rejected once, then approved.`,
      events: [`Submits the ${o0}`, `${ctx.approver} rejects the ${o0}`, `Starts the ${o0} again`, ...approve(o0)],
      endsIn: [stageNames(o0).approved]
    },
    [`Leaves the ${child} early`]: {
      description: `The user closes the ${child} right away and goes back a step.`,
      events: [...toLink, `Closes the ${child}`],
      endsIn: [stageNames(oL).reviewing]
    },
    [`Changes ${ctx.chart.toLowerCase()} settings`]: {
      description: 'Notifications off, then a help request that gets answered.',
      events: [...through(ctx.objects.length), s.offEvent, s.openEvent, s.answerEvent],
      endsIn: [s.off, s.answered]
    }
  };
  return { journeys };
}

function makeLarge() {
  const f = resetFixture('large');
  const files: SpecText[] = [];
  const atlas = {
    schemaVersion: 1,
    title: 'Example store atlas (fixture)',
    description: 'A generated atlas with several hundred states, for checking that the map stays fast and readable.',
    contexts: LARGE_CONTEXTS.map((c) => ({ id: c.id, name: c.name, description: c.description, owner: c.owner, directories: [c.dir.split('/')[0]!] })),
    handOffs: [
      { from: 'Sign-up finished', to: 'Reviewing the search filters', event: 'Starts browsing', description: 'A new user moves on to browsing.' },
      { from: 'Product browsing finished', to: 'Reviewing the shopping cart', event: 'Adds a product to the cart', description: 'Browsing ends in the cart.' },
      { from: 'Order checkout finished', to: 'Reviewing the shipping label', event: 'Order is shipped', description: 'A paid order is shipped.' },
      { from: 'Deliveries finished', to: 'Reviewing the help request', event: 'Asks for help with a delivery', description: 'A delivery problem becomes a help request.' },
      { from: 'Order checkout finished', to: 'Reviewing the monthly invoice', event: 'Invoice is issued', description: 'Every order shows up on an invoice.' }
    ],
    excluded: ['Marketplace sellers', 'Gift cards', 'Business accounts']
  };
  files.push({ path: 'atlas.yaml', text: YAML.stringify(atlas, { lineWidth: 0 }) });
  for (const ctx of LARGE_CONTEXTS) {
    const { topChart, childChart } = largeCharts(ctx);
    files.push({ path: `${ctx.dir}/machine.yaml`, text: `# ${ctx.chart}: generated fixture chart\n${YAML.stringify(topChart, { lineWidth: 0 })}` });
    if (ctx.composition === 'invoke-scxml') {
      files.push({ path: `${ctx.dir}/${slug(ctx.child)}.scxml`, text: machineToScxml(childChart as MachineConfig) });
    } else {
      files.push({ path: `${ctx.dir}/${slug(ctx.child)}.machine.yaml`, text: `# ${ctx.child}: generated child chart\n${YAML.stringify(childChart, { lineWidth: 0 })}` });
    }
    files.push({ path: `${ctx.dir}/journeys.yaml`, text: YAML.stringify(largeJourneys(ctx), { lineWidth: 0 }) });
  }
  files.push({
    path: 'orders/checkout/open-questions.md',
    text: [
      '# Open questions',
      '',
      '## Order checkout',
      '',
      '1. **How long should approval wait?** Approval can take more than a day.',
      '   - S: Told the shopping cart is still under review, Waiting for the shopping cart to be approved.',
      '   - T: Waiting for the shopping cart to be approved → Approval of the shopping cart takes longer than a day.',
      '   - Spec today: one day.',
      '2. **Who explains a rejected promo code?** Nobody tells the user why.',
      '   - S: Told the promo code was rejected (assumed).',
      '',
      '## Not modeled',
      '',
      '3. These are outside this spec today:',
      '   - split payments',
      '   - orders placed by phone',
      ''
    ].join('\n')
  });
  files.push({
    path: 'shipping/deliveries/known-issues.md',
    text: [
      '# Known issues',
      '',
      '## Reviewing the shipping label',
      '',
      '- The label preview sometimes shows the old address.',
      '',
      '## Waiting for the package contents to be approved → Carrier rejects the package contents',
      '',
      '- The rejection reason is not shown to the user.',
      '',
      '## Other',
      '',
      '- `Told the pickup window was rejected` uses the wrong icon.',
      ''
    ].join('\n')
  });
  writeSpec(f.dir, files);
  const spec = loadSpec(files, 'specs');
  if (spec.doc.states.size < 450) throw new Error(`Large atlas has only ${spec.doc.states.size} states`);

  const covered = LARGE_CONTEXTS.slice(0, 3);
  const scope = chartScope(spec.doc, covered.flatMap((c) => [c.chart, c.child]));
  const colors = new Map(LARGE_CONTEXTS.flatMap((c) => [[c.chart, c.color], [c.child, c.color]]));
  const orders = LARGE_CONTEXTS[2]!;
  const run = buildRun(spec, f.runs, {
    startedAt: '2026-10-06T14:40:00.000Z',
    mode: 'fast',
    durationMs: 96_300,
    scope,
    journeys: spec.doc.journeys.filter((j) => covered.some((c) => j.dir === c.dir)).map((j) => j.name),
    failing: { [`Waiting for the ${orders.objects[2]} to be approved :: ${orders.approver} approves the ${orders.objects[2]}`]: `Expected "Told the ${orders.objects[2]} was approved", but the card still says it is being checked` },
    flaky: { [`Reviewing the account details :: Submits the account details`]: 'The submit button was covered by a banner on the first attempt' },
    art: (state, tone) => ({ title: state.name, subtitle: state.chartId, color: colors.get(state.chartId) ?? '#475467', tone })
  });
  writeManifest(run.runDir, run.manifest);
  return spec;
}

// ---------------------------------------------------------------------------------------------

function dirSize(dir: string): number {
  return readdirSync(dir).reduce((sum, name) => {
    const full = path.join(dir, name);
    const stat = statSync(full);
    return sum + (stat.isDirectory() ? dirSize(full) : stat.size);
  }, 0);
}

function main() {
  const files = exampleFiles();
  const spec = loadSpec(files, 'specs');
  const mermaid = composedMachine(files, SPEC_DIR, TOP_CHART);
  log(`example spec: ${spec.doc.states.size} states, ${spec.doc.transitions.size} transitions, ${spec.doc.journeys.length} journeys`);
  makeSpecOnly(spec);
  makePartial(spec, mermaid);
  makeFull(spec, mermaid);
  makeFailures(spec, mermaid);
  makeRemoved(spec);
  makeMalformed(spec);
  const large = makeLarge();
  log(`large atlas: ${large.doc.states.size} states, ${large.doc.transitions.size} transitions, ${large.doc.journeys.length} journeys, ${large.doc.contexts.length} contexts`);
  for (const name of readdirSync(FIXTURES_ROOT).sort()) {
    const dir = path.join(FIXTURES_ROOT, name);
    if (statSync(dir).isDirectory()) log(`${name.padEnd(10)} ${(dirSize(dir) / 1024).toFixed(0).padStart(6)} KB`);
  }
  const total = dirSize(FIXTURES_ROOT);
  log(`total      ${(total / 1024).toFixed(0).padStart(6)} KB`);
  if (total > SIZE_BUDGET) throw new Error(`Fixtures are ${(total / 1024 / 1024).toFixed(1)} MB, over the ${SIZE_BUDGET / 1024 / 1024} MB budget`);
}

main();
