import { EventKindSchema, type EventKind } from '@crvouga/atlas-schema';
import { describe, expect, it } from 'vitest';

import { guessUserOrSystem, looksLikeTimeEvent, resolveEventKind } from './event-kind';
import type { EventKindSource } from './types';

type Input = Parameters<typeof resolveEventKind>[0];
const base: Input = { event: 'Payment provider approves the payment', handOff: false, specKind: undefined, specTimeSpan: undefined, runKind: undefined };

describe('resolveEventKind precedence', () => {
  it.each<[string, Partial<Input>, EventKind, EventKindSource]>([
    ['the spec beats everything', { specKind: 'user', handOff: true, specTimeSpan: '5 minutes', runKind: 'time' }, 'user', 'spec'],
    ['structure beats a time span and the run', { handOff: true, specTimeSpan: '5 minutes', runKind: 'system' }, 'hand-off', 'structure'],
    ['a spec time span beats the run', { specTimeSpan: '5 minutes', runKind: 'user' }, 'time', 'spec'],
    ['an empty time span still counts', { specTimeSpan: '' }, 'time', 'spec'],
    ['the run saying time', { runKind: 'time' }, 'time', 'run'],
    ['the run saying hand-off', { runKind: 'hand-off' }, 'hand-off', 'run'],
    ['time wording beats a run that says system', { event: 'Payment takes longer than a minute', runKind: 'system' }, 'time', 'guess'],
    ['the run beats user wording', { event: 'Taps place order', runKind: 'system' }, 'system', 'run'],
    ['user wording with nothing else', { event: 'Taps place order' }, 'user', 'guess'],
    ['system wording with nothing else', { event: 'Payment provider approves the payment' }, 'system', 'guess']
  ])('%s', (_label, input, kind, source) => {
    expect(resolveEventKind({ ...base, ...input })).toEqual({ kind, source });
  });
});

describe('wording guesses', () => {
  it.each<[string, EventKind]>([
    ['Tries another way to pay', 'user'],
    ['Starts checkout', 'user'],
    ['Opens the cart', 'user'],
    ['Submits the card', 'user'],
    ['taps   place order', 'user'],
    ['Payment takes longer than a minute', 'time'],
    ['Drink sits ready for ten minutes', 'time'],
    ['Trial period ends', 'time'],
    ['Session expires', 'time'],
    ['Reminder is sent after 3 days', 'time'],
    ['Two weeks pass', 'time'],
    ['Barista finishes the drink', 'system'],
    ['Card is declined at checkout', 'system'],
    ['Payment provider approves the payment after the trial ended', 'system'],
    ['', 'system']
  ])('"%s" is %s', (event, kind) => {
    expect(resolveEventKind({ ...base, event })).toEqual({ kind, source: 'guess' });
  });

  it('never calls something a user does a time event', () => {
    expect(guessUserOrSystem('Checks again after five minutes')).toBe('user');
    expect(looksLikeTimeEvent('Checks again after five minutes')).toBe(false);
  });
});

describe('event kinds from older specs', () => {
  it('reads the former "member" kind as "user"', () => {
    expect(EventKindSchema.parse('member')).toBe('user');
    expect(EventKindSchema.safeParse('customer').success).toBe(false);
  });
});
