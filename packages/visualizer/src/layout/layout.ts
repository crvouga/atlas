import type { LayoutFile } from '@crvouga/atlas-schema';
import ELK, { type ElkExtendedEdge, type ElkNode } from 'elkjs/lib/elk-api';
import elkWorkerUrl from 'elkjs/lib/elk-worker.min.js?url';

import { SIZES, type LayoutEdge, type LayoutInput, type LayoutNode } from './graph';

export type Point = { x: number; y: number };

export type PlacedNode = LayoutNode & { x: number; y: number; absX: number; absY: number };

export type PlacedEdge = LayoutEdge & {
  points: Point[];
  label: { x: number; y: number; width: number; height: number };
};

export type ChartLayout = {
  key: string;
  width: number;
  height: number;
  nodes: PlacedNode[];
  edges: PlacedEdge[];
  pinned: boolean;
};

const LAYOUT_VERSION = 3;
const STORAGE_PREFIX = `atlas-layout:v${LAYOUT_VERSION}:`;
const memory = new Map<string, ChartLayout>();

async function hash(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)]
    .slice(0, 12)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

let elk: InstanceType<typeof ELK> | null = null;

/** ELK's own worker script runs the layout, so the page stays responsive on large charts. */
function runElk(graph: ElkNode) {
  elk ??= new ELK({ workerFactory: () => new Worker(elkWorkerUrl) });
  return elk.layout(graph);
}

const ROOT_OPTIONS: Record<string, string> = {
  'elk.algorithm': 'layered',
  'elk.direction': 'RIGHT',
  'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
  'elk.json.edgeCoords': 'ROOT',
  'elk.json.shapeCoords': 'PARENT',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.layered.spacing.nodeNodeBetweenLayers': '84',
  'elk.layered.spacing.edgeNodeBetweenLayers': '28',
  'elk.layered.spacing.edgeEdgeBetweenLayers': '14',
  'elk.spacing.nodeNode': '56',
  'elk.spacing.edgeNode': '24',
  'elk.spacing.edgeEdge': '14',
  'elk.spacing.edgeLabel': '6',
  'elk.edgeLabels.inline': 'true',
  'elk.edgeLabels.placement': 'CENTER',
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
  'elk.layered.crossingMinimization.forceNodeModelOrder': 'false',
  'elk.layered.mergeEdges': 'false',
  'elk.randomSeed': '7',
  'elk.padding': '[top=24,left=24,bottom=24,right=24]'
};

function groupOptions(node: LayoutNode): Record<string, string> {
  const p = SIZES.groupPadding;
  return {
    'elk.padding': `[top=${p.top},left=${p.left},bottom=${p.bottom},right=${p.right}]`,
    'elk.direction': node.kind === 'parallel' ? 'DOWN' : 'RIGHT',
    ...(node.kind === 'parallel' ? { 'elk.layered.spacing.nodeNodeBetweenLayers': '36' } : {})
  };
}

function toElk(input: LayoutInput): ElkNode {
  const children = new Map<string | null, LayoutNode[]>();
  for (const n of input.nodes) children.set(n.parent, [...(children.get(n.parent) ?? []), n]);
  const build = (n: LayoutNode): ElkNode => {
    const kids = children.get(n.id) ?? [];
    if (kids.length === 0) return { id: n.id, width: n.width, height: n.height };
    return { id: n.id, layoutOptions: groupOptions(n), children: kids.map(build) };
  };
  return {
    id: '__root',
    layoutOptions: ROOT_OPTIONS,
    children: (children.get(null) ?? []).map(build),
    edges: input.edges.map(
      (e): ElkExtendedEdge => ({
        id: e.id,
        sources: [e.source],
        targets: [e.target],
        labels: [{ id: `${e.id}#label`, text: e.id, width: e.labelWidth, height: SIZES.chip.height }]
      })
    )
  };
}

function fromElk(input: LayoutInput, result: ElkNode, key: string): ChartLayout {
  const byId = new Map(input.nodes.map((n) => [n.id, n]));
  const nodes: PlacedNode[] = [];
  const walk = (node: ElkNode, ox: number, oy: number) => {
    for (const child of node.children ?? []) {
      const base = byId.get(child.id);
      if (!base) continue;
      const x = child.x ?? 0;
      const y = child.y ?? 0;
      nodes.push({ ...base, width: child.width ?? base.width, height: child.height ?? base.height, x, y, absX: ox + x, absY: oy + y });
      walk(child, ox + x, oy + y);
    }
  };
  walk(result, 0, 0);
  const edgesById = new Map(input.edges.map((e) => [e.id, e]));
  const edges: PlacedEdge[] = [];
  const collect = (node: ElkNode) => {
    for (const edge of node.edges ?? []) {
      const base = edgesById.get(edge.id);
      if (!base) continue;
      const section = edge.sections?.[0];
      const points = section ? [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map((p) => ({ x: p.x, y: p.y })) : [];
      const label = edge.labels?.[0];
      const mid = midpoint(points);
      edges.push({
        ...base,
        points,
        label: {
          x: label?.x ?? mid.x - base.labelWidth / 2,
          y: label?.y ?? mid.y - SIZES.chip.height / 2,
          width: base.labelWidth,
          height: SIZES.chip.height
        }
      });
    }
    for (const child of node.children ?? []) collect(child);
  };
  collect(result);
  return { key, width: result.width ?? 0, height: result.height ?? 0, nodes, edges, pinned: false };
}

function midpoint(points: Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  let total = 0;
  const lengths = points.slice(1).map((p, i) => {
    const l = Math.hypot(p.x - points[i]!.x, p.y - points[i]!.y);
    total += l;
    return l;
  });
  let walked = 0;
  for (let i = 0; i < lengths.length; i++) {
    const l = lengths[i]!;
    if (walked + l >= total / 2) {
      const t = l === 0 ? 0 : (total / 2 - walked) / l;
      const a = points[i]!;
      const b = points[i + 1]!;
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    walked += l;
  }
  return points[0]!;
}

function boundaryPoint(node: PlacedNode, toward: Point): Point {
  const cx = node.absX + node.width / 2;
  const cy = node.absY + node.height / 2;
  const dx = toward.x - cx;
  const dy = toward.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const sx = Math.abs(dx) / (node.width / 2);
  const sy = Math.abs(dy) / (node.height / 2);
  const s = Math.max(sx, sy);
  return { x: cx + dx / s, y: cy + dy / s };
}

/**
 * A committed `<chart>.layout.json` wins for the nodes it names (absolute positions); edges that
 * touch a moved node are redrawn straight between the two nodes.
 */
function applyPinned(layout: ChartLayout, file: LayoutFile): ChartLayout {
  const moved = new Set<string>();
  const byId = new Map(layout.nodes.map((n) => [n.id, n]));
  const nodes = layout.nodes.map((n) => {
    const pos = file.positions[n.id];
    const size = file.sizes?.[n.id];
    if (!pos && !size) return n;
    moved.add(n.id);
    const parent = n.parent ? byId.get(n.parent) : null;
    const absX = pos?.x ?? n.absX;
    const absY = pos?.y ?? n.absY;
    return { ...n, absX, absY, x: absX - (parent?.absX ?? 0), y: absY - (parent?.absY ?? 0), width: size?.width ?? n.width, height: size?.height ?? n.height };
  });
  const placed = new Map(nodes.map((n) => [n.id, n]));
  const edges = layout.edges.map((e) => {
    if (!moved.has(e.source) && !moved.has(e.target)) return e;
    const s = placed.get(e.source)!;
    const t = placed.get(e.target)!;
    const sc = { x: s.absX + s.width / 2, y: s.absY + s.height / 2 };
    const tc = { x: t.absX + t.width / 2, y: t.absY + t.height / 2 };
    const points = [boundaryPoint(s, tc), boundaryPoint(t, sc)];
    const mid = midpoint(points);
    return { ...e, points, label: { ...e.label, x: mid.x - e.label.width / 2, y: mid.y - e.label.height / 2 } };
  });
  const width = Math.max(layout.width, ...nodes.map((n) => n.absX + n.width + 24));
  const height = Math.max(layout.height, ...nodes.map((n) => n.absY + n.height + 24));
  return { ...layout, nodes, edges, width, height, pinned: true };
}

function readStored(key: string) {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    return raw ? (JSON.parse(raw) as ChartLayout) : null;
  } catch {
    return null;
  }
}

function store(key: string, layout: ChartLayout) {
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(layout));
  } catch {
    // A full store only costs a fresh layout next time.
  }
}

/**
 * Positions for one chart, cached by its structure: the same states, nesting and events always
 * get the same layout, from memory, then local storage, then ELK in a worker.
 */
export async function layoutChart(input: LayoutInput, pinned: LayoutFile | null): Promise<ChartLayout> {
  const key = await hash(`${input.key}\n${JSON.stringify(SIZES)}\n${input.nodes.map((n) => n.id).join('|')}\n${input.edges.map((e) => `${e.source}>${e.target}`).join('|')}`);
  const cached = memory.get(key) ?? readStored(key);
  const base = cached ?? fromElk(input, await runElk(toElk(input)), key);
  if (!cached) store(key, base);
  memory.set(key, base);
  return pinned ? applyPinned(base, pinned) : base;
}
