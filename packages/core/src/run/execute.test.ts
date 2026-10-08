import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { CloudEvent } from '../events/cloudevents';
import type { Driver, EventSource, Implementation, StateImplementation } from './types';
import { defineConfig, prepare } from '../config';
import { runPaths } from './execute';
import { functionDriver } from './types';

/** A lamp: off, or on and either dim or bright. "On" is a compound state. */
const LAMP = {
  id: 'Lamp',
  initial: 'Off',
  meta: { description: 'A dimmable lamp.' },
  states: {
    Off: { meta: { description: 'Dark.' }, on: { 'Switches on': 'On' } },
    On: {
      meta: { description: 'Lit.' },
      initial: 'Dim',
      on: { 'Switches off': 'Off' },
      states: {
        Dim: { meta: { description: 'Low light.' }, on: { Brightens: 'Bright' } },
        Bright: { meta: { description: 'Full light.', events: ['Brightness raised'], checks: ['Shows full brightness'] }, on: { Dims: 'Dim' } }
      }
    }
  }
};

const JOURNEYS = `journeys:
  Reads at night:
    description: Turns the lamp up to read, then down, then off.
    events: [Switches on, Brightens, Dims, Switches off]
    endsIn: [Off]
`;

class Lamp {
  static sent = 0;
  power: 'off' | 'on' = 'off';
  level: 'dim' | 'bright' = 'dim';
  constructor(private readonly publish: (e: CloudEvent) => void) {}
  switchOn() {
    this.power = 'on';
    this.level = 'dim';
  }
  switchOff() {
    this.power = 'off';
  }
  brighten() {
    this.level = 'bright';
    this.publish({ specversion: '1.0', id: `brightened-${++Lamp.sent}`, source: '/lamp', type: 'Brightness raised' });
  }
  dim() {
    this.level = 'dim';
  }
}

let directory: string;
let published: CloudEvent[];

beforeAll(() => {
  directory = mkdtempSync(path.join(tmpdir(), 'atlas-run-'));
  writeFileSync(path.join(directory, 'lamp.machine.json'), JSON.stringify(LAMP));
  writeFileSync(path.join(directory, 'journeys.yaml'), JOURNEYS);
});

afterAll(() => rmSync(directory, { recursive: true, force: true }));

const is = (matches: (l: Lamp) => boolean): StateImplementation<Lamp> => ({
  recognize: async (l) => ({ matched: matches(l), signals: [{ signal: 'lamp', expected: 'visible', visible: matches(l) }] })
});

function implementation(overrides: Partial<Implementation<Lamp>['events']> = {}): Implementation<Lamp> {
  return {
    setup: async () => undefined,
    events: {
      'Switches on': { kind: 'user', how: 'switchOn()', run: async (l) => l.switchOn() },
      'Switches off': { kind: 'user', how: 'switchOff()', run: async (l) => l.switchOff() },
      Brightens: { kind: 'user', how: 'brighten()', run: async (l) => l.brighten() },
      Dims: { kind: 'user', how: 'dim()', run: async (l) => l.dim() },
      ...(overrides as Implementation<Lamp>['events'])
    },
    states: {
      Off: is((l) => l.power === 'off'),
      Dim: is((l) => l.power === 'on' && l.level === 'dim'),
      Bright: {
        ...is((l) => l.power === 'on' && l.level === 'bright'),
        checks: async (l) => [{ check: 'Shows full brightness', passed: l.level === 'bright' }]
      }
    }
  };
}

async function run(impl: Implementation<Lamp>, options: { retry?: boolean; driver?: Driver<Lamp> } = {}) {
  published = [];
  let mark = 0;
  const events: EventSource = {
    name: 'lamp-events',
    mark: () => {
      mark = published.length;
    },
    collect: async () => ({ events: published.slice(mark) })
  };
  const config = defineConfig<Lamp>({ specs: directory, driver: functionDriver(() => new Lamp((e) => published.push(e))), implementation: impl });
  const prepared = prepare(config);
  const result = await runPaths({
    bundle: prepared.bundle,
    composition: prepared.lint.composition,
    graph: prepared.lint.graph,
    scope: prepared.scope,
    paths: prepared.plan.paths,
    driver: options.driver ?? functionDriver(() => new Lamp((e) => published.push(e))),
    implementation: impl,
    mode: 'fast',
    outputRoot: path.join(directory, 'runs'),
    retry: options.retry,
    stepTimeoutMs: 300,
    eventSources: [events],
    log: () => undefined
  });
  return { ...result, prepared };
}

describe('runPaths', () => {
  it('passes every path, state and transition, and writes the manifest and reports', async () => {
    const { manifest, runDir, ok } = await run(implementation());
    expect(ok).toBe(true);
    expect(manifest.paths.map((p) => [p.id, p.status])).toEqual([['journey-1', 'passed']]);
    expect(manifest.coverage.overall).toEqual({
      states: { total: 4, passed: 4, failed: 0, flaky: 0, notReached: 0 },
      transitions: { total: 4, passed: 4, failed: 0, flaky: 0, notReached: 0 }
    });
    expect(manifest.states.On!.status).toBe('passed');
    expect(manifest.states.On!.reachedBy).toEqual(['journey-1']);
    expect(manifest.states.Bright!.checks).toEqual([{ check: 'Shows full brightness', passed: true }]);
    expect(manifest.states.Bright!.businessEvents).toMatchObject({ expected: ['Brightness raised'], observed: ['Brightness raised'], missing: [] });
    expect(manifest.transitions['Dim :: Brightens']).toMatchObject({ source: 'Dim', target: 'Bright', event: 'Brightens', kind: 'user', how: 'brighten()', status: 'passed' });
    expect(manifest.run).toMatchObject({ mode: 'fast', environment: { driver: 'function' }, scope: { chart: 'Lamp' } });
    expect(manifest.privacy).toEqual({ findings: [], passed: true });

    for (const file of ['manifest.json', 'junit.xml', 'ctrf.json', 'chart.mmd']) expect(existsSync(path.join(runDir, file)), file).toBe(true);
    expect(JSON.parse(readFileSync(path.join(runDir, 'manifest.json'), 'utf8'))).toMatchObject({ schemaVersion: 1, run: { id: manifest.run.id } });
    expect(readFileSync(path.join(runDir, 'junit.xml'), 'utf8')).toContain('tests="1" failures="0" skipped="0"');
  });

  it('retries a failed path once and calls it flaky when the retry passes', async () => {
    let calls = 0;
    const flakyBrighten = {
      kind: 'user' as const,
      how: 'brighten(), which misses the first time',
      run: async (l: Lamp) => {
        calls += 1;
        if (calls === 1) throw new Error('the button did not respond');
        l.brighten();
      }
    };
    const { manifest, ok } = await run(implementation({ Brightens: flakyBrighten }));
    expect(ok).toBe(true);
    const journey = manifest.paths[0]!;
    expect(journey.status).toBe('flaky');
    expect(journey.attempts.map((a) => a.status)).toEqual(['failed', 'passed']);
    expect(journey.attempts[0]!.error).toMatch(/"Brightens" could not be done \(the button did not respond\)/);
    expect(manifest.transitions['Dim :: Brightens']!.status).toBe('flaky');
    expect(manifest.states.Bright!.status).toBe('flaky');
    expect(manifest.coverage.overall!.transitions.flaky).toBe(4);
  });

  it('stops a path before a blocked event and reports what it could not reach', async () => {
    const { manifest, ok } = await run(implementation({ Dims: { kind: 'user', how: 'dim()', blocked: 'The dimmer is not wired up yet.', run: async () => undefined } }));
    expect(ok).toBe(true);
    const byId = Object.fromEntries(manifest.paths.map((p) => [p.id, p]));
    expect(byId['journey-1']!.status).toBe('not-reached');
    expect(byId['journey-1']!.steps.map((s) => [s.event, s.status])).toEqual([
      ['Switches on', 'passed'],
      ['Brightens', 'passed'],
      ['Dims', 'not-reached'],
      ['Switches off', 'not-reached']
    ]);
    expect(byId['journey-1']!.steps[2]!.reason).toBe('Blocked: The dimmer is not wired up yet.');
    expect(manifest.transitions['Bright :: Dims']).toMatchObject({ status: 'not-reached', reason: 'Blocked: The dimmer is not wired up yet.' });
    expect(manifest.transitions['On :: Switches off']!.status).toBe('passed');
    const skipped = manifest.paths.filter((p) => p.attempts.length === 0);
    expect(skipped.length).toBeGreaterThan(0);
    for (const p of skipped) expect(p.status).toBe('not-reached');
    expect(manifest.coverage.overall!.transitions).toMatchObject({ passed: 3, notReached: 1, failed: 0 });
  });

  it('fails a path whose screen does not change as the chart says, with what it looked like instead', async () => {
    const broken = { kind: 'user' as const, how: 'brighten(), which does nothing', run: async () => undefined };
    const { manifest, ok, runDir } = await run(implementation({ Brightens: broken }), { retry: false });
    expect(ok).toBe(false);
    const journey = manifest.paths[0]!;
    expect(journey.status).toBe('failed');
    expect(journey.attempts).toHaveLength(1);
    expect(journey.attempts[0]!.error).toBe('Expected "Bright", the app looks like "Dim"');
    expect(journey.stoppedAt).toBe('Bright');
    expect(journey.steps.map((s) => s.status)).toEqual(['passed', 'failed', 'not-reached', 'not-reached']);
    expect(manifest.transitions['Dim :: Brightens']!.status).toBe('failed');
    expect(manifest.states.Bright).toMatchObject({ status: 'failed', looksLike: ['Dim'] });
    expect(readFileSync(path.join(runDir, 'junit.xml'), 'utf8')).toContain('<failure message="Expected &quot;Bright&quot;, the app looks like &quot;Dim&quot;"/>');
  });

  it('fails the run when the screen shows personal data', async () => {
    const leaky: Driver<Lamp> = { ...functionDriver(() => new Lamp((e) => published.push(e))), text: async () => 'Owner: jane.doe@realmail.com' };
    const { manifest, ok } = await run(implementation(), { driver: leaky });
    expect(ok).toBe(false);
    expect(manifest.privacy.passed).toBe(false);
    expect(manifest.privacy.findings[0]).toMatch(/an email address outside the allowed domains \(j…@realmail\.com\)/);
    expect(JSON.stringify(manifest)).not.toContain('jane.doe@realmail.com');
  });
});
