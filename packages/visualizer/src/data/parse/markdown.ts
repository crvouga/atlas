export type ParsedQuestion = {
  file: string;
  number: number;
  section: string;
  title: string;
  body: string;
  specToday: string | null;
  states: string[];
  transitions: { source: string; event: string }[];
};

export type ParsedNote = {
  file: string;
  title: string;
  body: string;
  states: string[];
  transitions: { source: string; event: string }[];
};

const NOT_MODELED = /^not modeled$/i;

function stripMarkdown(text: string) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`(.+?)`/g, '$1')
    .replace(/\[(.+?)\]\((.+?)\)/g, '$1')
    .trim();
}

function parseTransitionRef(text: string, eventOnly = false) {
  const [source, event] = text.split(/\s*→\s*/);
  if (source && event) return { source: source.trim(), event: event.trim().replace(/\.$/, '') };
  return eventOnly && source && !/^every\b/i.test(source) ? { source: '', event: source.trim().replace(/\.$/, '') } : null;
}

/** Comma-split names joined back where the joined name is a known state, like "Results in, review pending". */
function joinKnownNames(parts: string[], known: ReadonlySet<string> | undefined) {
  if (!known) return parts;
  const out: string[] = [];
  for (let i = 0; i < parts.length; ) {
    let j = parts.length;
    while (j > i + 1 && !known.has(parts.slice(i, j).join(', '))) j--;
    out.push(parts.slice(i, j).join(', '));
    i = j;
  }
  return out;
}

/** "S: A, B. T: X → e; Y → f." into its state and transition references. */
function parseRefs(line: string, knownStates?: ReadonlySet<string>) {
  const states: string[] = [];
  const transitions: { source: string; event: string }[] = [];
  const s = line.match(/(?:^|\s)S:\s*(.+?)(?=\s+T:|$)/)?.[1];
  const t = line.match(/(?:^|\s)T:\s*(.+)$/)?.[1];
  if (s) states.push(...joinKnownNames(s.replace(/\.$/, '').split(/,\s*/).map((name) => stripMarkdown(name).replace(/\s*\(.*\)$/, '')), knownStates));
  if (t) {
    for (const part of t.split(/;\s*/)) {
      const ref = parseTransitionRef(stripMarkdown(part), true);
      if (ref) transitions.push(ref);
    }
  }
  return { states: states.filter(Boolean), transitions };
}

/**
 * `open-questions.md`: numbered questions under `##` sections, each with `- S:` / `- T:` lines
 * naming what it affects, and a "Not modeled" section listing features outside the spec.
 */
export function parseOpenQuestions(file: string, text: string, knownStates?: ReadonlySet<string>) {
  const questions: ParsedQuestion[] = [];
  const excluded: string[] = [];
  let section = '';
  let current: ParsedQuestion | null = null;
  for (const line of text.split('\n')) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      section = heading[1]!;
      current = null;
      continue;
    }
    if (NOT_MODELED.test(section)) {
      const bullet = line.match(/^\s+-\s+(.+)$/)?.[1];
      if (bullet) excluded.push(stripMarkdown(bullet));
      continue;
    }
    const item = line.match(/^(\d+)\.\s+\*\*(.+?)\*\*\s*(.*)$/);
    if (item) {
      current = { file, number: Number(item[1]), section, title: stripMarkdown(item[2]!), body: stripMarkdown(item[3] ?? ''), specToday: null, states: [], transitions: [] };
      questions.push(current);
      continue;
    }
    if (!current) continue;
    const bullet = line.match(/^\s+-\s+(.+)$/)?.[1];
    if (bullet) {
      if (/^Spec today:/i.test(bullet)) current.specToday = stripMarkdown(bullet.replace(/^Spec today:\s*/i, ''));
      else {
        const refs = parseRefs(bullet, knownStates);
        current.states.push(...refs.states);
        current.transitions.push(...refs.transitions);
      }
      continue;
    }
    if (line.trim()) current.body = `${current.body} ${stripMarkdown(line)}`.trim();
  }
  return { questions, excluded };
}

/**
 * `known-issues.md`: `## <state>` or `## <from> → <event>` sections with the issues as bullets.
 * Bullets elsewhere that name a state in backticks attach to that state.
 */
export function parseKnownIssues(file: string, text: string, knownStates: ReadonlySet<string>) {
  const notes: ParsedNote[] = [];
  let heading: { states: string[]; transitions: { source: string; event: string }[] } | null = null;
  for (const line of text.split('\n')) {
    const h = line.match(/^##+\s+(.+?)\s*$/)?.[1];
    if (h) {
      const clean = stripMarkdown(h);
      const ref = parseTransitionRef(clean);
      heading = ref ? { states: [], transitions: [ref] } : knownStates.has(clean) ? { states: [clean], transitions: [] } : null;
      continue;
    }
    const bullet = line.match(/^\s*[-*]\s+(.+)$/)?.[1];
    if (!bullet) continue;
    const named = [...bullet.matchAll(/`([^`]+)`/g)].map((m) => m[1]!).filter((name) => knownStates.has(name));
    const states = [...(heading?.states ?? []), ...named];
    const transitions = heading?.transitions ?? [];
    if (states.length === 0 && transitions.length === 0) continue;
    const body = stripMarkdown(bullet);
    notes.push({ file, title: body.split(/(?<=[.!?])\s/)[0] ?? body, body, states, transitions });
  }
  return notes;
}
