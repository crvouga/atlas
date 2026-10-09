import { describe, expect, it } from 'vitest';

import { loadFixture } from '../data/testing/load-fixture';
import { ancestors, chartScope, journeyChart, journeyPath, stepFocus, visibleRepresentative } from './navigation';

const { view } = loadFixture('full');
const journey = view.journeys.find((j) => j.name === 'Orders a drink and pays by card')!;

describe('journey navigation across composition boundaries', () => {
  it('traces ancestors across invoked machines and nested regions', () => {
    expect(ancestors(view, 'Entering card details')).toContain('Checking out');
    expect(ancestors(view, 'Updates on')).toEqual(['Updates', 'Order in progress']);
    expect(visibleRepresentative(view, 'Entering card details', new Set(['Checking out']))).toBe('Checking out');
    expect(visibleRepresentative(view, 'Updates on', new Set(['Order in progress']))).toBe('Order in progress');
    expect(visibleRepresentative(view, 'Unknown', new Set(['Checking out']))).toBeNull();
  });

  it('highlights the full replay including active initial descendants and carried hand-offs', () => {
    const path = journeyPath(view, journey);
    expect(path.states.has('Updates on')).toBe(true);
    expect(path.states.has('Updates off')).toBe(false);
    expect(path.states.has('Checking out')).toBe(true);
    expect(path.transitions.get('Checking out :: Payment goes through')).toEqual(path.transitions.get('Paid :: Payment goes through'));
  });

  it('focuses every parallel branch without fitting huge ancestor containers', () => {
    const index = journey.steps.findIndex((s) => s.handOff);
    expect(stepFocus(view, journey, index).sort()).toEqual(['Paid, waiting for the barista', 'Updates on'].sort());
    expect(stepFocus(view, journey, undefined)).toEqual([]);
    expect(stepFocus(view, journey, 999)).toEqual([]);
  });

  it('retains every occurrence when a journey traverses an event again', () => {
    const repeated = { ...journey, steps: [journey.steps[0]!, journey.steps[0]!] };
    expect(journeyPath(view, repeated).transitions.get(repeated.steps[0]!.transitionIds[0]!)).toEqual([0, 1]);
  });

  it('returns to the composed root when navigation leaves a child chart', () => {
    const childStep = journey.steps.findIndex((step) => step.event === 'Picks card');
    const parentStep = journey.steps.findIndex((step) => step.handOff);
    expect(journeyChart(view, 'Checkout', journey, childStep)).toBe('Checkout');
    expect(journeyChart(view, 'Checkout', journey, parentStep)).toBe('Coffee order');
    expect(journeyChart(view, 'Coffee order', journey, childStep)).toBe('Coffee order');
  });

  it('includes child charts in navigation scope', () => {
    expect(chartScope(view, 'Coffee order')).toEqual(new Set(['Coffee order', 'Checkout']));
    expect(chartScope(view, 'Checkout')).toEqual(new Set(['Checkout']));
  });
});
