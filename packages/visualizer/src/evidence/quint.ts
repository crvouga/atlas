import { flattenSteps } from '@crvouga/atlas-reports/frames';
import type { ReportStep } from '@crvouga/atlas-reports/report-types';

export const QUINT_GROUPS: readonly { readonly kind: string; readonly label: string }[] = [
  { kind: 'var', label: 'State' },
  { kind: 'action', label: 'Actions' },
  { kind: 'val', label: 'Values' },
  { kind: 'pure val', label: 'Pure values' },
  { kind: 'def', label: 'Definitions' },
  { kind: 'pure def', label: 'Pure definitions' },
  { kind: 'type', label: 'Types' },
  { kind: 'const', label: 'Constants' },
  { kind: 'import', label: 'Imports' }
];

export type QuintItem = { readonly kind: string; readonly name: string; readonly line: number; readonly text: string };

/** Declarations in source order. The rest of a line is the declaration, not an execution trace. */
export function quintOutline(text: string): QuintItem[] {
  return text.split('\n').flatMap((line, index) => {
    const match = /^\s*(module|import|var|const|type|action|val|def|pure val|pure def)\s+(\w+(?:::\w+)*)/.exec(line);
    return match ? [{ kind: match[1]!, name: match[2]!, line: index + 1, text: line.trim() }] : [];
  });
}

export type ModelState = Readonly<Record<string, unknown>>;

export function traceStates(value: unknown): ModelState[] | null {
  if (!value || typeof value !== 'object' || !('states' in value) || !Array.isArray(value.states)) return null;
  if (!value.states.every((state) => state !== null && typeof state === 'object' && !Array.isArray(state))) return null;
  return value.states as ModelState[];
}

/** Read recorded assignment text without evaluating Quint or inventing states. */
export function recordedModelStates(steps: readonly ReportStep[]) {
  return flattenSteps(steps)
    .filter(({ step }) => step.kind === 'quint' && step.detail)
    .map(({ step }) => {
      const state: Record<string, unknown> = { '#action': step.title };
      const assignments = [...step.detail!.matchAll(/^([A-Za-z_]\w*) = ([\s\S]*?)(?=^[A-Za-z_]\w* = |$(?![\s\S]))/gm)];
      for (const match of assignments) state[match[1]!] = match[2]!.trimEnd();
      return { step, state };
    })
    .filter(({ state }) => Object.keys(state).length > 1);
}
