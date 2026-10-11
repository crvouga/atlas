import { describe, expect, it } from 'vitest';

import { loadFixture } from '../data/testing/load-fixture';
import { chartGraph, isolateJourney } from './graph';

const { view } = loadFixture('full');
const top = 'Coffee order';
const child = 'Checking out';

describe('progressive disclosure', () => {
  it('keeps a child machine collapsed by default and exposes its boundary hand-off', () => {
    const graph = chartGraph(view, top)!;
    expect(graph.nodes.find((n) => n.id === child)?.kind).toBe('chart-link');
    expect(graph.nodes.some((n) => n.id === 'Choosing how to pay')).toBe(false);
    expect(graph.edges.find((e) => e.transitionId === 'Checking out :: Payment goes through')?.source).toBe(child);
    expect(graph.edges.some((e) => e.transitionId === 'Paid :: Payment goes through')).toBe(false);
  });

  it('inlines the child and replaces the summary hand-off with the actual final-state hand-off', () => {
    const graph = chartGraph(view, top, { expanded: [child], collapsed: [] })!;
    expect(graph.nodes.find((n) => n.id === child)?.kind).toBe('group');
    expect(graph.nodes.find((n) => n.id === 'Choosing how to pay')?.parent).toBe(child);
    expect(graph.edges.some((e) => e.transitionId === 'Checking out :: Payment goes through')).toBe(false);
    expect(graph.edges.find((e) => e.transitionId === 'Paid :: Payment goes through')).toMatchObject({ source: 'Paid', target: 'Order in progress' });
    expect(graph.edges.some((e) => e.transitionId === 'Choosing how to pay :: Picks card')).toBe(true);
  });

  it('removes group interiors and reroutes inbound and outbound events to the summary', () => {
    const graph = chartGraph(view, top, { expanded: [], collapsed: ['Customizing the drink', 'Order in progress'] })!;
    expect(graph.nodes.find((n) => n.id === 'Order in progress')?.kind).toBe('collapsed');
    expect(graph.nodes.some((n) => n.id === 'Drink' || n.id === 'Updates on' || n.id === 'Choosing a size')).toBe(false);
    expect(graph.edges.find((e) => e.transitionId === 'Ready to add the drink :: Adds the drink to the cart')).toMatchObject({
      source: 'Customizing the drink',
      target: 'Reviewing the cart'
    });
    expect(graph.edges.find((e) => e.transitionId === 'Drink ready for pickup :: Picks up the drink')).toMatchObject({
      source: 'Order in progress',
      target: 'Order complete'
    });
    expect(graph.edges.some((e) => e.source === e.target)).toBe(false);
  });

  it('preserves boundaries between collapsed groups inside an expanded child machine', () => {
    const { view: large } = loadFixture('large');
    const graph = chartGraph(large, 'Order checkout', {
      expanded: ['Going through the payment'],
      collapsed: ['Handling the payment details', 'Handling the payment authorization', 'Handling the payment receipt']
    })!;
    expect(graph.edges.find((edge) => edge.transitionId === 'Told the payment details was approved :: Continues to the payment authorization')).toMatchObject({
      source: 'Handling the payment details',
      target: 'Handling the payment authorization'
    });
    expect(graph.edges.find((edge) => edge.transitionId === 'Told the payment authorization was approved :: Continues to the payment receipt')).toMatchObject({
      source: 'Handling the payment authorization',
      target: 'Handling the payment receipt'
    });
  });

  it('keys geometry by detail level and child structure, independently of run results', () => {
    const collapsed = chartGraph(view, top)!;
    const expanded = chartGraph(view, top, { expanded: [child], collapsed: [] })!;
    expect(expanded.key).not.toBe(collapsed.key);
    expect(chartGraph(loadFixture('spec-only').view, top)!.key).toBe(collapsed.key);
    const changed = { ...view, charts: new Map(view.charts) };
    changed.charts.set('Checkout', { ...view.charts.get('Checkout')!, structureKey: 'changed-child' });
    expect(chartGraph(changed, top)!.key).not.toBe(collapsed.key);
  });

  it('produces valid unique endpoints at all detail levels in the large atlas', () => {
    const { view: large } = loadFixture('large');
    for (const chart of large.charts.values()) {
      const own = [...large.states.values()].filter((s) => s.contextId === chart.contextId);
      for (const details of [
        undefined,
        { expanded: own.filter((s) => s.childChartId).map((s) => s.name), collapsed: [] },
        { expanded: [], collapsed: own.filter((s) => s.children.length).map((s) => s.name) }
      ]) {
        const graph = chartGraph(large, chart.id, details)!;
        const ids = new Set(graph.nodes.map((n) => n.id));
        expect(ids.size).toBe(graph.nodes.length);
        expect(new Set(graph.edges.map((e) => e.id)).size).toBe(graph.edges.length);
        for (const node of graph.nodes) if (node.parent) expect(ids.has(node.parent)).toBe(true);
        for (const edge of graph.edges) {
          expect(ids.has(edge.source)).toBe(true);
          expect(ids.has(edge.target)).toBe(true);
        }
      }
    }
  });
});

describe('path-only layouts', () => {
  const journey = view.journeys.find((j) => j.name === 'Orders a drink and pays by card')!;
  const graph = chartGraph(view, top, { expanded: [child], collapsed: [] })!;
  it('removes unrelated branches and events while preserving nesting and the hand-off', () => {
    const filtered = isolateJourney(view, graph, journey);
    expect(filtered.nodes.some((node) => node.id === 'Updates on')).toBe(true);
    expect(filtered.nodes.some((node) => node.id === 'Updates off')).toBe(false);
    expect(filtered.nodes.some((node) => node.id === 'Confirming with the wallet')).toBe(false);
    expect(filtered.edges.some((edge) => edge.transitionId === 'Paid :: Payment goes through')).toBe(true);
    const ids = new Set(filtered.nodes.map((node) => node.id));
    for (const node of filtered.nodes) if (node.parent) expect(ids.has(node.parent)).toBe(true);
    for (const edge of filtered.edges) {
      expect(ids.has(edge.source)).toBe(true);
      expect(ids.has(edge.target)).toBe(true);
    }
  });
  it('keeps an inspected off-path state or event visible with its ancestors', () => {
    const filtered = isolateJourney(view, graph, journey, { screen: 'Updates off', event: 'Choosing how to pay :: Picks wallet' });
    expect(filtered.nodes.some((node) => node.id === 'Updates off')).toBe(true);
    expect(filtered.nodes.some((node) => node.id === 'Confirming with the wallet')).toBe(true);
    expect(filtered.nodes.some((node) => node.id === child)).toBe(true);
    expect(filtered.edges.some((edge) => edge.transitionId === 'Choosing how to pay :: Picks wallet')).toBe(true);
  });
  it('retains collapsed representatives of steps inside a hidden child machine', () => {
    const filtered = isolateJourney(view, chartGraph(view, top)!, journey);
    expect(filtered.nodes.find((node) => node.id === child)?.kind).toBe('chart-link');
    expect(filtered.edges.find((edge) => edge.transitionId === 'Checking out :: Payment goes through')).toBeDefined();
  });
});
