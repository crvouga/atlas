import { XMLBuilder, XMLParser } from 'fast-xml-parser';

import type { InvokeConfig, MachineConfig, StateConfig, StateMeta } from './types';
import { invokesOf, targetOf } from './types';

/**
 * W3C SCXML ↔ XState config, for the pure subset Atlas executes.
 *
 * - `<state>`, `<parallel>`, `<final>`, `initial`, `<transition event target>`.
 * - `<invoke type="scxml" src="other.scxml" id>` composes another chart; a transition on
 *   `done.invoke.<id>` (or `done.invoke`) becomes the invoke's `onDone`.
 * - Business metadata lives in a foreign namespace, as SCXML allows:
 *   `<atlas:meta><atlas:description>…</atlas:description><atlas:event>…</atlas:event></atlas:meta>`.
 *   A final state's `atlas:done-event` attribute names the event its parent receives. Meta values
 *   that are not strings are written as JSON in an element marked `type="json"`.
 */
export const ATLAS_NS = 'https://github.com/crvouga/atlas/ns/1';
const SCXML_NS = 'http://www.w3.org/2005/07/scxml';

type XmlNode = Record<string, unknown> & { ':@'?: Record<string, string> };

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  preserveOrder: true,
  trimValues: true
});

function tagOf(node: XmlNode) {
  return Object.keys(node).find((k) => k !== ':@') ?? '';
}

function local(tag: string) {
  return tag.includes(':') ? tag.slice(tag.indexOf(':') + 1) : tag;
}

function children(node: XmlNode): XmlNode[] {
  const value = node[tagOf(node)];
  return Array.isArray(value) ? (value as XmlNode[]) : [];
}

function text(node: XmlNode): string {
  return children(node)
    .map((c) => (typeof c['#text'] === 'string' || typeof c['#text'] === 'number' ? String(c['#text']) : text(c)))
    .join('')
    .trim();
}

function attrs(node: XmlNode) {
  return node[':@'] ?? {};
}

const META_LISTS = new Set(['event', 'source', 'check', 'hint']);
const META_LIST_KEYS: Record<string, keyof StateMeta> = { event: 'events', source: 'source', check: 'checks', hint: 'hints' };

function readMeta(node: XmlNode): StateMeta {
  const meta: StateMeta = {};
  for (const child of children(node)) {
    const key = local(tagOf(child));
    if (META_LISTS.has(key)) {
      const listKey = META_LIST_KEYS[key]!;
      meta[listKey] = [...((meta[listKey] as string[] | undefined) ?? []), text(child)];
    } else if (key === 'deadEnd' || key === 'dead-end') {
      meta.deadEnd = text(child);
    } else if (attrs(child).type === 'json') {
      try {
        meta[key] = JSON.parse(text(child)) as unknown;
      } catch {
        meta[key] = text(child);
      }
    } else {
      meta[key] = text(child);
    }
  }
  return meta;
}

/** SCXML ids are XML IDs and event attributes are token lists, so names travel in `atlas:name`. */
export function scxmlToken(name: string) {
  const token = name
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return /^[a-z_]/.test(token) ? token : `s-${token}`;
}

function collectNames(nodes: XmlNode[], names: Map<string, string>) {
  for (const node of nodes) {
    const tag = local(tagOf(node));
    if (tag === 'state' || tag === 'parallel' || tag === 'final') {
      const a = attrs(node);
      if (a.id) names.set(a.id, a['atlas:name'] ?? a.id);
    }
    collectNames(children(node), names);
  }
}

let currentNames = new Map<string, string>();
const nameOf = (id: string) => currentNames.get(id) ?? id;

function readState(node: XmlNode, invokeIds: Map<string, InvokeConfig>): [string, StateConfig] {
  const tag = local(tagOf(node));
  const a = attrs(node);
  const name = nameOf(a.id ?? '');
  const state: StateConfig = { id: name };
  if (tag === 'parallel') state.type = 'parallel';
  if (tag === 'final') state.type = 'final';
  const states: Record<string, StateConfig> = {};
  const invokes: InvokeConfig[] = [];
  for (const child of children(node)) {
    if (local(tagOf(child)) !== 'invoke') continue;
    const ca = attrs(child);
    const src = (ca.src ?? '').replace(/\.scxml$/, '').replace(/^.*\//, '');
    const invoke: InvokeConfig = { src: ca['atlas:name'] ?? src, ...(ca.id ? { id: ca.id } : {}) };
    invokes.push(invoke);
    if (ca.id) invokeIds.set(ca.id, invoke);
  }
  for (const child of children(node)) {
    const childTag = local(tagOf(child));
    const ca = attrs(child);
    if (childTag === 'state' || childTag === 'parallel' || childTag === 'final') {
      const [k, v] = readState(child, invokeIds);
      states[k] = v;
    } else if (childTag === 'transition') {
      const event = ca['atlas:name'] ?? ca.event;
      if (!event || !ca.target) continue;
      const target = nameOf(ca.target);
      const raw = ca['atlas:name'] ? '' : event;
      if (raw === 'done.invoke' || raw.startsWith('done.invoke.')) {
        const id = raw.slice('done.invoke.'.length);
        const invoke = invokes.find((i) => !id || i.id === id) ?? invokeIds.get(id);
        if (invoke) {
          invoke.onDone = { target: `#${target}` };
          continue;
        }
      }
      state.on = { ...state.on, [event]: { target: `#${target}` } };
    } else if (childTag === 'meta' || tagOf(child).startsWith('atlas:')) {
      state.meta = { ...state.meta, ...readMeta(child) };
    }
  }
  const doneEvent = a['atlas:done-event'];
  if (doneEvent) state.meta = { ...state.meta, doneEvent };
  if (a.initial) state.initial = nameOf(a.initial);
  else if (Object.keys(states).length && tag !== 'parallel') state.initial = Object.keys(states)[0];
  if (Object.keys(states).length) state.states = states;
  if (invokes.length) state.invoke = invokes.length === 1 ? invokes[0]! : invokes;
  return [name, state];
}

/** Read an SCXML document into an XState machine config. */
export function scxmlToMachine(xml: string, fallbackId = 'machine'): MachineConfig {
  const doc = parser.parse(xml) as XmlNode[];
  const root = doc.find((n) => local(tagOf(n)) === 'scxml');
  if (!root) throw new Error('Not an SCXML document: no <scxml> root element');
  const a = attrs(root);
  currentNames = new Map();
  collectNames(children(root), currentNames);
  const invokeIds = new Map<string, InvokeConfig>();
  const machine: MachineConfig = { id: a.name ?? fallbackId };
  const states: Record<string, StateConfig> = {};
  for (const child of children(root)) {
    const tag = local(tagOf(child));
    if (tag === 'state' || tag === 'parallel' || tag === 'final') {
      const [k, v] = readState(child, invokeIds);
      states[k] = v;
    } else if (tag === 'meta' || tagOf(child).startsWith('atlas:')) {
      machine.meta = { ...machine.meta, ...readMeta(child) };
    }
  }
  machine.initial = a.initial ? nameOf(a.initial) : Object.keys(states)[0];
  for (const [name, state] of Object.entries(states)) state.id = name;
  machine.states = states;
  return machine;
}

function metaToXml(meta: StateMeta | undefined): XmlNode[] {
  if (!meta) return [];
  const items: XmlNode[] = [];
  for (const [key, value] of Object.entries(meta)) {
    if (key === 'doneEvent' || value === undefined) continue;
    const listTag = Object.entries(META_LIST_KEYS).find(([, k]) => k === key)?.[0];
    if (listTag && Array.isArray(value)) {
      for (const v of value) items.push({ [`atlas:${listTag}`]: [{ '#text': String(v) }] });
    } else if (typeof value === 'string') {
      items.push({ [`atlas:${key}`]: [{ '#text': value }] });
    } else {
      items.push({ [`atlas:${key}`]: [{ '#text': JSON.stringify(value) }], ':@': { type: 'json' } });
    }
  }
  return items.length ? [{ 'atlas:meta': items }] : [];
}

function stateToXml(name: string, node: StateConfig): XmlNode {
  const tag = node.type === 'parallel' ? 'parallel' : node.type === 'final' ? 'final' : 'state';
  const kids: XmlNode[] = [...metaToXml(node.meta)];
  for (const [event, t] of Object.entries(node.on ?? {})) {
    kids.push({ transition: [], ':@': { event: scxmlToken(event), target: scxmlToken(targetOf(t)!), 'atlas:name': event } });
  }
  for (const [i, invoke] of invokesOf(node).entries()) {
    const id = scxmlToken(invoke.id ?? `${name} invoke ${i}`);
    kids.push({ invoke: [], ':@': { type: 'scxml', src: `${scxmlToken(invoke.src)}.scxml`, id, 'atlas:name': invoke.src } });
    if (invoke.onDone) kids.push({ transition: [], ':@': { event: `done.invoke.${id}`, target: scxmlToken(targetOf(invoke.onDone)!) } });
  }
  for (const [k, v] of Object.entries(node.states ?? {})) kids.push(stateToXml(k, v));
  const at: Record<string, string> = { id: scxmlToken(name), 'atlas:name': name };
  if (node.initial && node.type !== 'parallel') at.initial = scxmlToken(node.initial);
  if (typeof node.meta?.doneEvent === 'string') at['atlas:done-event'] = node.meta.doneEvent;
  return { [tag]: kids, ':@': at };
}

/** Write an XState machine config as an SCXML document. */
export function machineToScxml(machine: MachineConfig): string {
  const kids: XmlNode[] = [...metaToXml(machine.meta)];
  for (const [k, v] of Object.entries(machine.states ?? {})) kids.push(stateToXml(k, v));
  const at: Record<string, string> = {
    xmlns: SCXML_NS,
    'xmlns:atlas': ATLAS_NS,
    version: '1.0',
    name: machine.id,
    datamodel: 'null'
  };
  if (machine.initial) at.initial = scxmlToken(machine.initial);
  const builder = new XMLBuilder({ ignoreAttributes: false, attributeNamePrefix: '', preserveOrder: true, format: true, suppressEmptyNode: true });
  return `<?xml version="1.0" encoding="UTF-8"?>\n${String(builder.build([{ scxml: kids, ':@': at }])).trim()}\n`;
}
