import { existsSync, readFileSync } from 'node:fs';

import type { DataIssue } from '@crvouga/atlas-schema';
import { describe, expect, it } from 'vitest';

import type { AtlasView, StateView, TransitionView } from './model/types';
import { loadFixture, mediaFile } from './testing/load-fixture';

const isScreen = (s: StateView) => s.kind === 'screen' || s.kind === 'final';
const screens = (view: AtlasView) => [...view.states.values()].filter(isScreen);
const counted = (view: AtlasView) => [...view.transitions.values()].filter((t) => !t.carriedBy);
const problems = (view: AtlasView) => view.issues.filter((i) => i.severity !== 'info');
const ZOD_JARGON = /invalid_type|invalid_value|ZodError|received|Expected \w+, got/i;

function expectPlain(issue: DataIssue | undefined) {
  expect(issue).toBeDefined();
  expect(issue!.file).not.toBe('');
  expect(issue!.message.length).toBeGreaterThan(10);
  expect(issue!.message).not.toMatch(ZOD_JARGON);
}

describe('spec-only fixture', () => {
  const { view, specDoc } = loadFixture('spec-only');

  it('shows the spec with no run', () => {
    expect(view.mode).toBe('spec-only');
    expect(view.run).toBeNull();
    expect(view.runs).toEqual([]);
    expect(view.states.size).toBe(25);
    expect(counted(view)).toHaveLength(28);
  });

  it('reads the XState root chart and the SCXML child it invokes', () => {
    expect(specDoc.charts.map((c) => [c.id, c.format, c.parent])).toEqual([
      ['Coffee order', 'xstate', null],
      ['Checkout', 'scxml', { chartId: 'Coffee order', state: 'Checking out' }]
    ]);
    expect(view.states.get('Checking out')).toMatchObject({ kind: 'chart-link', childChartId: 'Checkout' });
    expect(view.states.get('Order in progress')?.kind).toBe('parallel');
    expect(view.states.get('Updates')?.kind).toBe('region');
    expect(view.states.get('Choosing how to pay')?.hints).toEqual(['A card button', 'A wallet button', 'The order total']);
    expect(view.transitions.get('Waiting for the payment :: Payment takes longer than a minute')).toMatchObject({ kind: 'time', kindSource: 'spec', timeSpan: '1 minute' });
    expect(view.transitions.get('Paid :: Payment goes through')).toMatchObject({ kind: 'hand-off', handOff: true, target: 'Order in progress' });
    expect(view.transitions.get('Checking out :: Payment goes through')?.carriedBy).toBe('Paid :: Payment goes through');
  });

  it('marks every state, event and journey spec-only', () => {
    expect([...view.states.values()].filter((s) => s.status !== 'spec-only')).toEqual([]);
    expect([...view.transitions.values()].filter((t) => t.status !== 'spec-only')).toEqual([]);
    expect(view.journeys.filter((j) => j.status !== 'spec-only')).toEqual([]);
  });

  it('reports no problems', () => {
    expect(problems(view)).toEqual([]);
  });

  it('replays all 9 journeys, through the child chart and back', () => {
    expect(view.journeys).toHaveLength(9);
    expect(view.journeys.filter((j) => !j.replay.ok).map((j) => j.name)).toEqual([]);
    const card = view.journeys.find((j) => j.name === 'Orders a drink and pays by card')!;
    expect(card.chartIds.sort()).toEqual(['Checkout', 'Coffee order']);
    expect(card.steps.filter((s) => s.handOff).map((s) => s.event)).toEqual(['Payment goes through']);
  });

  it('links open questions to states whose names contain a comma', () => {
    const linked = [...view.questions.values()].flatMap((q) => q.states);
    expect(linked).toContain('Paid, waiting for the barista');
    expect(linked).toContain('Told the payment was declined');
    expect(view.excluded).toContain('gift cards and promo codes');
    expect(view.states.get('Updates off')?.knownIssues.map((n) => n.title)).toEqual(['Updates off shows the wrong icon.']);
  });
});

describe('partial fixture', () => {
  const { view, run, roots } = loadFixture('partial');
  const checkoutScreens = screens(view).filter((s) => s.chartId === 'Checkout');
  const shots = checkoutScreens.map((s) => s.result?.screenshot.state ?? 'none');

  it('selects the complete run and lists the running one', () => {
    expect(view.mode).toBe('run');
    expect(view.run?.progress).toBe('complete');
    expect(view.runs).toHaveLength(2);
    const running = view.runs.find((r) => r.progress === 'running');
    expect(running?.id).toBe('2026-10-06T15-05-00-000Z-showcase');
    expect(run?.id).not.toBe(running?.id);
  });

  it('mixes available, missing and processing screenshots', () => {
    expect(shots).toContain('available');
    expect(shots).toContain('missing');
    expect(shots).toContain('processing');
    const available = shots.filter((s) => s === 'available').length;
    expect(available / checkoutScreens.length).toBeGreaterThan(0.25);
    expect(available / checkoutScreens.length).toBeLessThan(0.75);
  });

  it('mixes available, missing and processing clips', () => {
    const clips = [...view.transitions.values()].filter((t) => t.result?.status === 'passed').map((t) => t.result!.clip.state);
    expect(clips).toContain('available');
    expect(clips).toContain('missing');
    expect(clips).toContain('processing');
  });

  it('points available media and captions at files that exist', () => {
    for (const s of screens(view)) {
      if (s.result?.screenshot.state === 'available') {
        expect(existsSync(mediaFile(roots.runs, s.result.screenshot.full!))).toBe(true);
        expect(existsSync(mediaFile(roots.runs, s.result.screenshot.thumb!))).toBe(true);
      }
    }
    const clips = [...view.transitions.values()].flatMap((t) => (t.result?.clip.state === 'available' ? [t.result.clip] : []));
    expect(clips.length).toBeGreaterThan(0);
    for (const clip of clips) {
      expect(clip.captions).toMatch(/\.vtt$/);
      expect(readFileSync(mediaFile(roots.runs, clip.captions!), 'utf8')).toMatch(/^WEBVTT/);
    }
  });

  it('links the reports the run wrote', () => {
    expect(view.run?.reports.map((r) => r.label)).toEqual(['JUnit', 'CTRF', 'Mermaid']);
    for (const report of view.run!.reports) expect(existsSync(mediaFile(roots.runs, report.url))).toBe(true);
  });

  it('opens the running run without throwing', () => {
    const running = loadFixture('partial', { runId: '2026-10-06T15-05-00-000Z-showcase' });
    expect(running.run).toBeNull();
    expect(running.view.issues.some((i) => i.file.includes('2026-10-06T15-05-00-000Z-showcase'))).toBe(true);
  });
});

describe('full fixture', () => {
  const { view, run, roots } = loadFixture('full');
  const timeline = counted(view).flatMap((t) => t.result?.timeline ?? []);

  it('selects the newest of three complete runs', () => {
    expect(view.runs).toHaveLength(3);
    expect(view.runs.every((r) => r.progress === 'complete')).toBe(true);
    expect(view.run?.id).toBe('2026-10-06T14-40-00-000Z-showcase');
    expect(problems(view)).toEqual([]);
  });

  it('passes every screen with an available screenshot on disk', () => {
    expect(screens(view).length).toBeGreaterThan(15);
    for (const s of screens(view)) {
      expect(s.status, s.name).toBe('passed');
      expect(s.result?.screenshot.state, s.name).toBe('available');
      expect(existsSync(mediaFile(roots.runs, s.result!.screenshot.full!))).toBe(true);
      expect(existsSync(mediaFile(roots.runs, s.result!.screenshot.thumb!))).toBe(true);
    }
    expect(view.totals.screens.passed).toBe(view.totals.screens.total);
  });

  it('passes every event with an available clip and captions on disk', () => {
    expect(counted(view)).toHaveLength(28);
    for (const t of counted(view)) {
      expect(t.status, t.id).toBe('passed');
      expect(t.result?.clip.state, t.id).toBe('available');
      expect(existsSync(mediaFile(roots.runs, t.result!.clip.src!))).toBe(true);
      expect(existsSync(mediaFile(roots.runs, t.result!.clip.poster!))).toBe(true);
      expect(existsSync(mediaFile(roots.runs, t.result!.clip.captions!))).toBe(true);
      expect(t.result!.timeline.length, t.id).toBeGreaterThan(0);
    }
    expect(run?.transitions.has('Paid :: Payment goes through')).toBe(true);
    expect(run?.transitions.has('Checking out :: Payment goes through')).toBe(false);
    expect(view.transitions.get('Checking out :: Payment goes through')?.status).toBe('passed');
  });

  it('passes every journey and adds generated paths', () => {
    expect(view.journeys).toHaveLength(9);
    expect(view.journeys.filter((j) => j.status !== 'passed').map((j) => j.name)).toEqual([]);
    expect(view.journeys.every((j) => j.runPaths.length === 1)).toBe(true);
    expect(run?.paths.filter((p) => p.kind === 'generated').length).toBeGreaterThanOrEqual(1);
  });

  it('records taps, typing, webhooks, time jumps, notifications and screens', () => {
    expect(timeline.some((e) => e.kind === 'tap' && e.x !== undefined && e.y !== undefined)).toBe(true);
    expect(timeline.some((e) => e.kind === 'type' && e.text)).toBe(true);
    expect(timeline.some((e) => e.kind === 'screen')).toBe(true);
    expect(timeline.some((e) => e.kind === 'notification' && e.notification?.title)).toBe(true);
    const approved = view.transitions.get('Waiting for the payment :: Payment provider approves the payment')!.result!.timeline;
    expect(approved.find((e) => e.kind === 'system')?.system).toMatchObject({
      source: expect.stringMatching(/webhook/),
      endpoint: expect.stringMatching(/^POST /),
      eventType: 'payment.approved',
      payload: expect.any(Object),
      responseStatus: 200
    });
  });

  it('keeps the CloudEvents a run observed', () => {
    const events = view.states.get('Order complete')!.result!.businessEvents!.events!;
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ specversion: '1.0', type: 'com.example.order.completed', source: expect.any(String), id: expect.any(String) });
  });

  it.each(['Waiting for the payment :: Payment takes longer than a minute', 'Drink ready for pickup :: Drink sits ready for ten minutes'])('shows %s as a time jump', (id) => {
    const t: TransitionView = view.transitions.get(id)!;
    expect(t.kind).toBe('time');
    const jump = t.result!.timeline.find((e) => e.kind === 'time')!.time!;
    expect(Date.parse(jump.to)).toBeGreaterThan(Date.parse(jump.from));
    expect(jump.fired?.length).toBeGreaterThan(0);
  });
});

describe('failures fixture', () => {
  const { view } = loadFixture('failures');
  const states = [...view.states.values()];
  const transitions = [...view.transitions.values()];

  it('has failed and flaky screens and events', () => {
    expect(states.some((s) => s.status === 'failed')).toBe(true);
    expect(states.some((s) => s.status === 'flaky')).toBe(true);
    expect(transitions.some((t) => t.status === 'failed')).toBe(true);
    expect(transitions.some((t) => t.status === 'flaky')).toBe(true);
    expect(view.totals.screens.failed).toBeGreaterThan(0);
  });

  it('exposes expected and actual for failing checks', () => {
    const failing = states.flatMap((s) => s.result?.checks ?? []).filter((c) => !c.passed);
    expect(failing.length).toBeGreaterThan(0);
    for (const check of failing) {
      expect(check.expected).toBeTruthy();
      expect(check.actual).toBeTruthy();
    }
  });

  it('reports missing business events', () => {
    const missing = states.filter((s) => (s.result?.businessEvents?.missing.length ?? 0) > 0).map((s) => s.name);
    expect(missing).toContain('Waiting for the payment');
    expect(missing).toContain('Paid');
  });

  it('shows failed and flaky journeys with their attempts', () => {
    const failed = view.journeys.find((j) => j.status === 'failed');
    expect(failed?.runPaths[0]?.stoppedAt).toBeTruthy();
    expect(failed?.runPaths[0]?.error).toBeTruthy();
    expect(view.journeys.some((j) => j.status === 'flaky')).toBe(true);
    expect(view.journeys.some((j) => j.status === 'passed')).toBe(true);
  });

  it('gives a reason for every event no path reached', () => {
    const notReached = transitions.filter((t) => t.status === 'not-reached');
    expect(notReached.length).toBeGreaterThan(0);
    for (const t of notReached) expect(t.result?.reason, t.id).toBeTruthy();
  });

  it('keeps the screenshot of a failed screen under the failed path', () => {
    const declined = view.states.get('Told the payment was declined')!;
    expect(declined.status).toBe('failed');
    expect(declined.result?.screenshot.state).toBe('missing');
    expect(declined.result?.screenshotsByPath[0]?.path.id).toMatch(/\(failed\)$/);
  });
});

describe('removed fixture', () => {
  const { view } = loadFixture('removed');

  it('lists what the run checked that the spec no longer has', () => {
    expect(view.removed.states.map((s) => s.name).sort()).toEqual(['Choosing a tip', 'Told the card reader is offline']);
    expect(view.removed.transitions.length).toBeGreaterThanOrEqual(2);
    expect(view.removed.transitions.map((t) => t.id)).toContain('Entering card details :: Scans the card');
    expect(view.run?.outOfDate).toBe(true);
    expect(view.issues.some((i) => i.severity === 'info' && /no longer in the spec/.test(i.message))).toBe(true);
  });

  it('still annotates the states that exist', () => {
    expect(view.states.get('Choosing how to pay')?.status).toBe('passed');
    expect(view.removed.states.find((s) => s.name === 'Choosing a tip')?.screenshot.state).toBe('available');
  });
});

describe('malformed fixture', () => {
  const RUNS = {
    notJson: '2026-10-06T10-00-00-000Z-showcase',
    newerFormat: '2026-10-06T11-00-00-000Z-showcase',
    badRecords: '2026-10-06T12-00-00-000Z-showcase',
    noRunSection: '2026-10-06T13-00-00-000Z-showcase'
  };
  const { view } = loadFixture('malformed');
  const find = (predicate: (i: DataIssue) => boolean) => view.issues.find(predicate);

  it.each<[string, (i: DataIssue) => boolean]>([
    ['a YAML syntax error, with its line', (i) => i.severity === 'error' && i.file.endsWith('journeys.yaml') && /^line \d+$/.test(i.path)],
    ['confidence: maybe', (i) => i.path.endsWith('Drink being made › meta › confidence') && i.message.includes('"maybe"')],
    ['a transition with no target', (i) => i.path.endsWith('Told the drink was thrown away › on › Orders again') && /no destination/.test(i.message)],
    ['an SCXML target that is not a state', (i) => i.file.endsWith('checkout.scxml') && i.path.endsWith('Told the payment was declined › on › Tries another way to pay') && i.message.includes('choosing-a-tip')],
    ['meta.events as text', (i) => i.path.endsWith('Order complete › meta › events') && /should be a list/.test(i.message)],
    ['a journey whose events were broken by the syntax error', (i) => i.path.startsWith('journeys › Slow payment') && i.file.endsWith('journeys.yaml')],
    ['a journey event that cannot happen', (i) => i.path === 'journeys › Pays before ordering' && /can't happen/.test(i.message)]
  ])('reports %s', (_label, predicate) => {
    const issue = find(predicate);
    expectPlain(issue);
    expect(issue!.path).not.toBe('');
  });

  it('reports a file that is not SCXML and skips it', () => {
    const issue = find((i) => i.file.endsWith('loyalty.scxml'));
    expectPlain(issue);
    expect(issue?.severity).toBe('error');
    expect(issue?.message).toMatch(/could not be read/);
  });

  it('still renders the valid parts', () => {
    expect(view.states.size).toBe(25);
    expect(view.transitions.size).toBeGreaterThanOrEqual(26);
    expect(view.journeys.length).toBeGreaterThanOrEqual(9);
    expect(view.journeys.filter((j) => j.replay.ok).length).toBeGreaterThanOrEqual(6);
    expect(view.states.get('Drink being made')?.confidence).toBeNull();
    expect(view.states.get('Drink being made')?.description).not.toBe('');
  });

  it('skips a manifest that is not JSON and says so', () => {
    const loaded = loadFixture('malformed', { runId: RUNS.notJson });
    expect(loaded.run).toBeNull();
    expectPlain(loaded.view.issues.find((i) => i.severity === 'error' && i.file === `runs/${RUNS.notJson}/manifest.json` && /not valid JSON/.test(i.message)));
  });

  it('reads a newer format, ignoring unknown fields and showing unknown steps as notes', () => {
    const loaded = loadFixture('malformed', { runId: RUNS.newerFormat });
    expect(loaded.run?.schemaVersion).toBe(2);
    expect(loaded.run?.states.size).toBe(11);
    const newer = loaded.view.issues.find((i) => i.path === 'schemaVersion');
    expectPlain(newer);
    expect(newer?.severity).toBe('info');
    const step = loaded.view.issues.find((i) => /timeline › item \d+ › kind$/.test(i.path));
    expectPlain(step);
    expect(step?.message).toContain('"haptic"');
    expect([...loaded.run!.transitions.values()].flatMap((t) => t.timeline).some((e) => e.label === 'The phone buzzes' && e.kind === 'note')).toBe(true);
  });

  it('drops invalid state records and keeps the valid ones', () => {
    const loaded = loadFixture('malformed', { runId: RUNS.badRecords });
    expect(loaded.run?.states.size).toBe(8);
    const bad = loaded.view.issues.filter((i) => i.path.startsWith('states › ') && i.file.includes(RUNS.badRecords));
    expect(bad).toHaveLength(3);
    for (const issue of bad) expectPlain(issue);
    expect(bad.some((i) => i.message.includes('"great"'))).toBe(true);
  });

  it('fills in a missing run section from the folder name', () => {
    const loaded = loadFixture('malformed', { runId: RUNS.noRunSection });
    expect(loaded.run?.info.id).toBe(RUNS.noRunSection);
    expect(loaded.run?.info.startedAt).toBe('2026-10-06T13:00:00.000Z');
    const issue = loaded.view.issues.find((i) => i.path === 'run');
    expectPlain(issue);
  });

  it('never throws, whichever run is opened', () => {
    for (const runId of Object.values(RUNS)) expect(() => loadFixture('malformed', { runId })).not.toThrow();
  });
});

describe('large fixture', () => {
  const started = performance.now();
  const { view, specDoc } = loadFixture('large');
  const elapsed = performance.now() - started;

  it('loads and builds in under two seconds', () => {
    expect(elapsed).toBeLessThan(2000);
  });

  it('spans several hundred states across at least five contexts', () => {
    expect(view.states.size).toBeGreaterThan(300);
    expect(view.contexts.length).toBeGreaterThanOrEqual(5);
    expect(view.contexts.every((c) => c.chartIds.length === 2 && c.topChartIds.length === 1)).toBe(true);
    expect(view.handOffs.length).toBeGreaterThan(0);
    expect(problems(view)).toEqual([]);
  });

  it('composes child charts with invoke, SCXML and the legacy meta alike', () => {
    expect(new Set(specDoc.charts.map((c) => c.format))).toEqual(new Set(['xstate', 'scxml']));
    const links = [...specDoc.states.values()].filter((s) => s.childChartId);
    expect(links.some((s) => s.invoke)).toBe(true);
    expect(links.some((s) => !s.invoke && s.meta.childMachine)).toBe(true);
    expect(specDoc.charts.filter((c) => c.parent)).toHaveLength(6);
  });

  it('nests compound states, a parallel state and a child chart in every context', () => {
    for (const context of view.contexts) {
      const own = [...view.states.values()].filter((s) => s.contextId === context.id);
      expect(own.some((s) => s.kind === 'parallel'), context.id).toBe(true);
      expect(own.some((s) => s.kind === 'region'), context.id).toBe(true);
      expect(own.some((s) => s.kind === 'chart-link'), context.id).toBe(true);
      expect(own.some((s) => s.depth >= 2), context.id).toBe(true);
    }
    expect(specDoc.transitions.size).toBeGreaterThan(500);
  });

  it('replays every journey', () => {
    expect(view.journeys.length).toBeGreaterThan(30);
    expect(view.journeys.filter((j) => !j.replay.ok).map((j) => j.name)).toEqual([]);
    expect(view.journeys.some((j) => j.steps.some((s) => s.handOff))).toBe(true);
  });

  it('annotates only the part the run covered', () => {
    const statuses = new Set([...view.states.values()].map((s) => s.status));
    expect(statuses).toContain('passed');
    expect(statuses).toContain('failed');
    expect(statuses).toContain('not-yet-run');
    expect([...view.states.values()].filter((s) => s.result).every((s) => s.result!.screenshot.state === 'missing')).toBe(true);
  });

  it('uses chart-level event kinds and time events', () => {
    expect(view.transitions.get('Waiting for the shopping cart to be approved :: Approval of the shopping cart takes longer than a day')).toMatchObject({ kind: 'time', kindSource: 'spec', timeSpan: '1 day' });
    expect(view.transitions.get('Told the shopping cart is still under review :: Checks the shopping cart again')).toMatchObject({ kind: 'user', kindSource: 'spec' });
  });
});
