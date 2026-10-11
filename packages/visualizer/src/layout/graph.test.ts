import { describe, expect, it } from 'vitest';

import { buildAtlasView } from '../data/model';
import { parseSpec } from '../data/parse/spec';
import { loadFixture } from '../data/testing/load-fixture';
import { MAP_PLACE_CAP, chartGraph, mapScope } from './graph';

function viewFrom(yaml: string) {
  const spec = parseSpec({ ref: null, files: [{ path: 'wide.machine.yaml', text: yaml }] });
  return buildAtlasView({ spec, specIssues: [], runs: [], run: null, runIssues: [], resolveMedia: () => '' });
}

function places(count: number, id: string) {
  const states = Array.from({ length: count }, (_, i) => `          P${i}: {}`).join('\n');
  return `id: ${id}\ninitial: Root\nstates:\n  Root:\n    initial: P0\n    states:\n${states}\n`;
}

function wideMachine() {
  const big = Array.from({ length: 30 }, (_, i) => (i === 0 ? `          B0:\n            on:\n              Goes:\n                target: '#B1'` : `          B${i}: {}`)).join('\n');
  return `id: Wide
initial: Root
states:
  Root:
    initial: Big
    states:
      Big:
        initial: B0
        states:
${big}
      Small:
        initial: S0
        states:
          S0:
            on:
              Leaves:
                target: '#B0'
              Leaves again:
                target: '#B1'
          S1: {}
      Alone:
        on:
          Waves:
            target: '#S0'
`;
}

describe('chart map scope', () => {
  const view = viewFrom(wideMachine());

  it('draws one layer of a large chart instead of every nested screen', () => {
    const graph = chartGraph(view, 'Wide');
    expect(graph?.mode).toBe('level');
    expect(graph?.focus).toBe('Root');
    expect(graph?.scoped).toBe(true);
    expect(graph?.nodes.map((node) => [node.id, node.kind, node.places])).toEqual([
      ['Big', 'summary', 30],
      ['Small', 'summary', 2],
      ['Alone', 'screen', undefined]
    ]);
    expect(graph?.nodes.some((node) => node.id === 'B0')).toBe(false);
    const bundle = graph?.edges.find((edge) => edge.bundle);
    expect(bundle).toMatchObject({ source: 'Small', target: 'Big', bundle: { label: '2 events', count: 2, group: 'Big', screen: null } });
    expect(graph?.edges.find((edge) => edge.transitionId)?.source).toBe('Alone');
  });

  it('opens a large section as its own layer and a small section in full', () => {
    const big = chartGraph(view, 'Wide', 'Big');
    expect(big?.mode).toBe('level');
    expect(big?.nodes).toHaveLength(30);
    expect(big?.nodes.every((node) => node.kind === 'screen')).toBe(true);
    expect(big?.nodes.map((node) => node.id)).toContain('B0');
    expect(big?.edges.map((edge) => edge.transitionId).filter(Boolean)).toEqual([expect.stringContaining('Goes')]);

    const small = chartGraph(view, 'Wide', 'Small');
    expect(small?.mode).toBe('subtree');
    expect(small?.nodes.map((node) => node.id)).toEqual(expect.arrayContaining(['Small', 'S0', 'S1', 'B0', 'B1']));
    expect(small?.nodes.map((node) => node.id)).not.toContain('B29');
    expect(small?.nodes.find((node) => node.id === 'B0')?.kind).toBe('context');
  });

  it('sends a place to the section that can draw it', () => {
    expect(mapScope(view, 'Wide', 'S0')).toBe('Small');
    expect(mapScope(view, 'Wide', 'B0')).toBe('Big');
    expect(mapScope(view, 'Wide', 'Small')).toBe('Small');
    expect(mapScope(view, 'Wide', 'Big')).toBe('Big');
    expect(chartGraph(view, 'Wide', 'missing')?.focus).toBe('Root');
  });

  it('keeps a chart at the place cap fully expanded', () => {
    const capped = viewFrom(places(MAP_PLACE_CAP, 'Cap'));
    const graph = chartGraph(capped, 'Cap');
    expect(graph?.mode).toBe('full');
    expect(graph?.scoped).toBe(false);
    expect(graph?.nodes.map((node) => node.id)).toContain('Root');
    expect(graph?.nodes.map((node) => node.id)).toContain(`P${MAP_PLACE_CAP - 1}`);
    expect(graph?.nodes.some((node) => node.kind === 'summary')).toBe(false);
  });
});

describe('coffee chart map', () => {
  const { view } = loadFixture('spec-only');

  it('still draws every state of a small chart', () => {
    const graph = chartGraph(view, 'Coffee order');
    const names = [...view.states.values()].filter((state) => state.chartId === 'Coffee order').map((state) => state.name);
    expect(graph?.mode).toBe('full');
    expect(graph?.scoped).toBe(false);
    expect(graph?.nodes.some((node) => node.kind === 'summary')).toBe(false);
    for (const name of names) expect(graph?.nodes.map((node) => node.id)).toContain(name);
    expect(graph?.edges.every((edge) => edge.bundle === null)).toBe(true);
    expect(mapScope(view, 'Coffee order', 'Browsing the menu')).toBeNull();
  });
});
