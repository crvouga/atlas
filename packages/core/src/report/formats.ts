import type { MachineConfig } from '../spec/types';
import type { TimelineEntry } from '../run/types';
import { targetOf } from '../spec/types';

type ManifestLike = {
  run: { id: string; startedAt: string; durationMs: number; mode: string };
  paths: {
    id: string;
    name: string;
    kind: string;
    status: string;
    steps: { event: string; status: string; reason: string | null }[];
    attempts: { error: string | null; trace: string | null }[];
  }[];
};

const xml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** JUnit XML (the format every CI system reads): one test case per path. */
export function toJUnit(manifest: ManifestLike) {
  const cases = manifest.paths.map((p) => {
    const body =
      p.status === 'failed'
        ? `<failure message="${xml(p.attempts.at(-1)?.error ?? 'failed')}"/>`
        : p.status === 'not-reached'
          ? `<skipped message="${xml(p.steps.find((s) => s.reason?.startsWith('Blocked'))?.reason ?? 'not reached')}"/>`
          : p.status === 'flaky'
            ? `<system-out>${xml('Passed on retry (flaky)')}</system-out>`
            : '';
    return `    <testcase classname="${xml(p.kind)}" name="${xml(p.name)}" id="${xml(p.id)}">${body}</testcase>`;
  });
  const failures = manifest.paths.filter((p) => p.status === 'failed').length;
  const skipped = manifest.paths.filter((p) => p.status === 'not-reached').length;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites name="atlas" tests="${manifest.paths.length}" failures="${failures}" skipped="${skipped}" time="${(manifest.run.durationMs / 1000).toFixed(3)}">`,
    `  <testsuite name="${xml(manifest.run.id)}" tests="${manifest.paths.length}" failures="${failures}" skipped="${skipped}" timestamp="${manifest.run.startedAt}">`,
    ...cases,
    '  </testsuite>',
    '</testsuites>',
    ''
  ].join('\n');
}

/** CTRF (Common Test Report Format, https://ctrf.io) JSON. */
export function toCtrf(manifest: ManifestLike) {
  const status = (s: string) => (s === 'passed' ? 'passed' : s === 'failed' ? 'failed' : s === 'flaky' ? 'passed' : 'skipped');
  const tests = manifest.paths.map((p) => ({
    name: p.name,
    status: status(p.status),
    duration: 0,
    suite: p.kind,
    flaky: p.status === 'flaky',
    ...(p.status === 'failed' ? { message: p.attempts.at(-1)?.error ?? undefined } : {}),
    ...(p.attempts.at(-1)?.trace ? { attachments: [{ name: 'trace', contentType: 'application/zip', path: p.attempts.at(-1)!.trace! }] } : {}),
    steps: p.steps.map((s) => ({ name: s.event, status: status(s.status) }))
  }));
  const start = Date.parse(manifest.run.startedAt);
  return {
    reportFormat: 'CTRF',
    specVersion: '0.0.0',
    results: {
      tool: { name: 'atlas' },
      summary: {
        tests: tests.length,
        passed: tests.filter((t) => t.status === 'passed').length,
        failed: tests.filter((t) => t.status === 'failed').length,
        pending: 0,
        skipped: tests.filter((t) => t.status === 'skipped').length,
        other: 0,
        start,
        stop: start + manifest.run.durationMs
      },
      tests
    }
  };
}

function vttTime(ms: number) {
  const d = new Date(Math.max(0, ms));
  const pad = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}`;
}

/** WebVTT captions for a clip, one cue per timeline entry. */
export function toWebVtt(timeline: TimelineEntry[], durationMs: number) {
  const cues = timeline.map((e, i) => {
    const end = Math.min(timeline[i + 1]?.atMs ?? durationMs, e.atMs + 4_000);
    const text = `${e.label}${e.text ? `: “${e.text}”` : ''}`;
    return `${i + 1}\n${vttTime(e.atMs)} --> ${vttTime(Math.max(end, e.atMs + 500))}\n${text}`;
  });
  return `WEBVTT\n\n${cues.join('\n\n')}\n`;
}

/** A Mermaid `stateDiagram-v2` of a machine, with nested and parallel states. */
export function toMermaid(machine: MachineConfig) {
  const ids = new Map<string, string>();
  const id = (name: string) => {
    if (!ids.has(name)) ids.set(name, `s${ids.size}`);
    return ids.get(name)!;
  };
  const label = (s: string) => s.replace(/"/g, "'");
  const lines = ['stateDiagram-v2', '  direction TB', `  [*] --> ${id(machine.initial ?? Object.keys(machine.states ?? {})[0] ?? '')}`];
  const edges: string[] = [];
  const emit = (name: string, node: MachineConfig['states'] extends Record<string, infer N> | undefined ? N : never, indent: string) => {
    for (const [event, t] of Object.entries(node.on ?? {})) {
      edges.push(`  ${id(name)} --> ${id(targetOf(t)!)} : ${event.replace(/[:;]/g, ' ')}`);
    }
    if (!node.states) {
      lines.push(`${indent}state "${label(name)}" as ${id(name)}`);
      if (node.type === 'final') lines.push(`${indent}${id(name)} --> [*]`);
      return;
    }
    lines.push(`${indent}state "${label(name)}" as ${id(name)} {`);
    const entries = Object.entries(node.states);
    if (node.type !== 'parallel') lines.push(`${indent}  [*] --> ${id(node.initial ?? entries[0]?.[0] ?? '')}`);
    entries.forEach(([k, v], i) => {
      if (node.type === 'parallel' && i > 0) lines.push(`${indent}  --`);
      emit(k, v, `${indent}  `);
    });
    lines.push(`${indent}}`);
  };
  for (const [k, v] of Object.entries(machine.states ?? {})) emit(k, v, '  ');
  return `${[...lines, ...edges].join('\n')}\n`;
}
