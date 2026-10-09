import type { Journey, MachineConfig, StateConfig } from '../spec/types';
import { targetOf } from '../spec/types';

type Section = { title: string; node: StateConfig; name: string; regions?: true };
type Entry = { name: string; node: StateConfig; trail: string[] };

/** GitHub's heading anchors: lowercase, punctuation dropped, spaces to hyphens, repeats numbered. */
function anchors() {
  const seen = new Map<string, number>();
  return (heading: string) => {
    const base = heading
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s_-]/gu, '')
      .replace(/\s/g, '-');
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count ? `${base}-${count}` : base;
  };
}

/** Top-level states, with every parallel state split into its regions, so each area reads alone. */
function sectionsOf(machine: MachineConfig) {
  const out: Section[] = [];
  const visit = (name: string, node: StateConfig, title: string) => {
    if (node.type === 'parallel' && node.states) {
      out.push({ title, node, name, regions: true });
      for (const [k, v] of Object.entries(node.states)) visit(k, v, `${title} › ${k}`);
      return;
    }
    out.push({ title, node, name });
  };
  for (const [k, v] of Object.entries(machine.states ?? {})) visit(k, v, k);
  return out;
}

function entriesOf(section: Section) {
  const out: Entry[] = [{ name: section.name, node: section.node, trail: [] }];
  if (section.regions) return out;
  const walk = (node: StateConfig, trail: string[]) => {
    for (const [k, v] of Object.entries(node.states ?? {})) {
      out.push({ name: k, node: v, trail });
      walk(v, [...trail, k]);
    }
  };
  walk(section.node, [section.name]);
  return out;
}

const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/\s*\n\s*/g, ' ');

/**
 * A readable map of a chart for the people who own the product: one section per area (parallel
 * regions apart), each state with what it means, what the user sees, and every event that can
 * happen there and where it leads, then the named journeys. Plain Markdown, so it renders on any
 * code host and diffs with the chart.
 */
export function toMarkdown(machine: MachineConfig, journeys: Journey[] = []) {
  const sections = sectionsOf(machine);
  const sectionOf = new Map<string, string>();
  const stateAnchor = new Map<string, string>();
  const sectionAnchors: string[] = [];
  const anchor = anchors();
  anchor(machine.id);
  anchor('Areas');
  sections.forEach((section) => {
    const own = anchor(section.title);
    sectionAnchors.push(own);
    for (const { name } of entriesOf(section)) {
      sectionOf.set(name, section.title);
      stateAnchor.set(name, name === section.name ? own : anchor(name));
    }
  });
  const journeysAnchor = journeys.length ? anchor('Journeys') : '';

  const link = (name: string, from: string) => {
    const where = sectionOf.get(name);
    const ref = stateAnchor.has(name) ? `[${name}](#${stateAnchor.get(name)})` : name;
    return where && where !== from ? `${ref} (${where})` : ref;
  };

  const lines: string[] = [`# ${machine.id}`, ''];
  if (machine.meta?.description) lines.push(machine.meta.description.trim(), '');
  const total = sections.reduce((n, s) => n + entriesOf(s).length, 0);
  const transitions = sections.reduce((n, s) => n + entriesOf(s).reduce((m, e) => m + Object.keys(e.node.on ?? {}).length, 0), 0);
  lines.push(`${sections.filter((s) => !s.regions).length} areas, ${total} states, ${transitions} transitions, ${journeys.length} journeys.`, '');
  lines.push('## Areas', '');
  sections.forEach((s, i) => lines.push(`- [${s.title}](#${sectionAnchors[i]})`));
  if (journeys.length) lines.push(`- [Journeys](#${journeysAnchor})`);
  lines.push('');

  const describe = (node: StateConfig, from: string) => {
    const meta = node.meta ?? {};
    const out: string[] = [];
    if (meta.confidence === 'assumed') out.push('_Assumed: not yet confirmed by the product owner._', '');
    if (meta.description) out.push(meta.description.trim(), '');
    if (meta.snapshot && /\s/.test(meta.snapshot.trim())) out.push(`**On screen:** ${meta.snapshot.trim()}`, '');
    if (meta.events?.length) out.push(`**Records:** ${meta.events.join('; ')}.`, '');
    if (node.type === 'final') out.push('**Final:** the flow ends here.', '');
    if (meta.deadEnd) out.push(`**Ends here:** ${meta.deadEnd.trim()}`, '');
    if (node.type === 'parallel' && node.states) {
      out.push(`**Runs side by side:** ${Object.keys(node.states).map((k) => link(k, from)).join(', ')}.`, '');
    } else if (node.states) {
      const initial = node.initial ?? Object.keys(node.states)[0];
      if (initial) out.push(`**Starts at:** ${link(initial, from)}.`, '');
    }
    const on = Object.entries(node.on ?? {});
    if (on.length) {
      out.push('| When | Goes to |', '| --- | --- |');
      for (const [event, t] of on) out.push(`| ${cell(event)} | ${cell(link(targetOf(t) ?? '', from))} |`);
      out.push('');
    }
    return out;
  };

  sections.forEach((section) => {
    lines.push(`## ${section.title}`, '');
    for (const entry of entriesOf(section)) {
      if (entry.name !== section.name) {
        lines.push(`### ${entry.name}`, '');
        if (entry.trail.length > 1) lines.push(`_In ${entry.trail.join(' › ')}_`, '');
      }
      lines.push(...describe(entry.node, section.title));
    }
  });

  if (journeys.length) {
    lines.push('## Journeys', '');
    for (const journey of journeys) {
      lines.push(`### ${journey.name}`, '');
      if (journey.description) lines.push(journey.description.trim(), '');
      lines.push(`**Ends in:** ${journey.endsIn.map((s) => link(s, '')).join(', ')}.`, '');
      lines.push('<details><summary>Steps</summary>', '');
      journey.events.forEach((event, i) => lines.push(`${i + 1}. ${event}`));
      lines.push('', '</details>', '');
    }
  }

  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}
