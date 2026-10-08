import { describe, expect, it } from 'vitest';

import type { MachineConfig } from '../spec/types';
import { toCtrf, toJUnit, toMermaid, toWebVtt } from './formats';

const step = (event: string, status: string, reason: string | null = null) => ({ event, status, reason });
const attempt = (error: string | null, trace: string | null = null) => ({ error, trace });

const MANIFEST = {
  run: { id: 'run-1', startedAt: '2026-01-02T03:04:05.000Z', durationMs: 12_345, mode: 'fast' },
  paths: [
    { id: 'journey-1', name: 'Buys <one> thing', kind: 'journey', status: 'passed', steps: [step('Pays', 'passed')], attempts: [attempt(null)] },
    {
      id: 'journey-2',
      name: 'Pays twice',
      kind: 'journey',
      status: 'failed',
      steps: [step('Pays', 'failed', 'Expected "Paid"')],
      attempts: [attempt('Expected "Paid" & more'), attempt('Expected "Paid" & more', 'media/traces/journey-2-retry.zip')]
    },
    { id: 'generated-1', name: 'Covers: Cart → Pays', kind: 'generated', status: 'flaky', steps: [step('Pays', 'flaky')], attempts: [attempt('x'), attempt(null)] },
    {
      id: 'generated-2',
      name: 'Covers: Cart → Refunds',
      kind: 'generated',
      status: 'not-reached',
      steps: [step('Pays', 'not-reached', 'Run on another path.'), step('Refunds', 'not-reached', 'Blocked: refunds need a live processor.')],
      attempts: []
    }
  ]
};

describe('toJUnit', () => {
  const xml = toJUnit(MANIFEST);

  it('counts tests, failures and skips, with the run time in seconds', () => {
    expect(xml).toContain('<testsuites name="atlas" tests="4" failures="1" skipped="1" time="12.345">');
    expect(xml).toContain('<testsuite name="run-1" tests="4" failures="1" skipped="1" timestamp="2026-01-02T03:04:05.000Z">');
    expect(xml.match(/<testcase /g)).toHaveLength(4);
  });

  it('writes a failure, a skip with the blocking reason, and flaky output, all escaped', () => {
    expect(xml).toContain('name="Buys &lt;one&gt; thing" id="journey-1"></testcase>');
    expect(xml).toContain('<failure message="Expected &quot;Paid&quot; &amp; more"/>');
    expect(xml).toContain('<skipped message="Blocked: refunds need a live processor."/>');
    expect(xml).toContain('<system-out>Passed on retry (flaky)</system-out>');
  });
});

describe('toCtrf', () => {
  const report = toCtrf(MANIFEST);

  it('summarises the run, counting flaky as passed', () => {
    expect(report.reportFormat).toBe('CTRF');
    expect(report.results.tool).toEqual({ name: 'atlas' });
    const start = Date.parse('2026-01-02T03:04:05.000Z');
    expect(report.results.summary).toEqual({ tests: 4, passed: 2, failed: 1, pending: 0, skipped: 1, other: 0, start, stop: start + 12_345 });
  });

  it('marks flaky tests, carries failure messages and trace attachments', () => {
    const [passed, failed, flaky, skipped] = report.results.tests;
    expect(passed).toMatchObject({ name: 'Buys <one> thing', status: 'passed', suite: 'journey', flaky: false });
    expect(failed).toMatchObject({ status: 'failed', message: 'Expected "Paid" & more', attachments: [{ name: 'trace', contentType: 'application/zip', path: 'media/traces/journey-2-retry.zip' }] });
    expect(flaky).toMatchObject({ status: 'passed', flaky: true });
    expect(skipped).toMatchObject({ status: 'skipped', steps: [{ name: 'Pays', status: 'skipped' }, { name: 'Refunds', status: 'skipped' }] });
  });
});

describe('toWebVtt', () => {
  it('writes one cue per timeline entry, each lasting until the next (at most 4 s, at least 0.5 s)', () => {
    const vtt = toWebVtt(
      [
        { atMs: 0, kind: 'tap', label: 'Taps "Pay"' },
        { atMs: 200, kind: 'type', label: 'Card number', text: '4242' },
        { atMs: 1_500, kind: 'screen', label: 'Now: Paid' },
        { atMs: 3_723_456, kind: 'note', label: 'An hour later' }
      ],
      3_724_000
    );
    expect(vtt).toBe(
      [
        'WEBVTT',
        '',
        '1',
        '00:00:00.000 --> 00:00:00.500',
        'Taps "Pay"',
        '',
        '2',
        '00:00:00.200 --> 00:00:01.500',
        'Card number: “4242”',
        '',
        '3',
        '00:00:01.500 --> 00:00:05.500',
        'Now: Paid',
        '',
        '4',
        '01:02:03.456 --> 01:02:04.000',
        'An hour later',
        ''
      ].join('\n')
    );
  });

  it('writes an empty but valid file for an empty timeline', () => {
    expect(toWebVtt([], 1_000)).toBe('WEBVTT\n\n\n');
  });
});

describe('toMermaid', () => {
  const machine: MachineConfig = {
    id: 'Shop',
    initial: 'Cart',
    states: {
      Cart: { on: { 'Checks out: now': '#Checkout' } },
      Checkout: {
        initial: 'Card',
        on: { 'Gives up': '#Cart' },
        states: { Card: { on: { Pays: 'Paid' } }, Paid: { type: 'final' } }
      },
      'Order "placed"': {
        type: 'parallel',
        states: {
          Shipping: { initial: 'Packing', states: { Packing: {} } },
          Billing: { initial: 'Invoiced', states: { Invoiced: {} } }
        }
      }
    }
  };
  const text = toMermaid(machine);

  it('writes a stateDiagram-v2 starting at the initial state', () => {
    expect(text.startsWith('stateDiagram-v2\n  direction TB\n  [*] --> s0\n')).toBe(true);
    expect(text).toContain('  state "Cart" as s0');
  });

  it('nests compound states with their own initial state, and marks finals', () => {
    expect(text).toContain('  state "Checkout" as s1 {\n    [*] --> s2\n    state "Card" as s2\n    state "Paid" as s3\n    s3 --> [*]\n  }');
  });

  it('separates parallel regions with -- and has no initial arrow on the parallel state', () => {
    const parallel = text.slice(text.indexOf('state "Order \'placed\'"'));
    expect(parallel).toMatch(/^state "Order 'placed'" as s4 \{\n {4}state "Shipping" as s5 \{\n {6}\[\*\] --> s6\n/);
    expect(parallel).toContain('    }\n    --\n    state "Billing" as s7 {');
  });

  it('labels every transition, with Mermaid-breaking characters removed', () => {
    expect(text).toContain('  s0 --> s1 : Checks out  now');
    expect(text).toContain('  s1 --> s0 : Gives up');
    expect(text).toContain('  s2 --> s3 : Pays');
  });
});
