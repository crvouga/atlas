import type { EventKind } from '@crvouga/atlas-schema';

import type { EventKindSource } from './types';

/** First words that read as something a person does in the product. */
const USER_VERBS = new Set(
  [
    'accepts', 'acknowledges', 'adds', 'answers', 'books', 'buys', 'cancels', 'changes', 'checks', 'chooses',
    'clicks', 'closes', 'confirms', 'continues', 'declines', 'deletes', 'dismisses', 'drags', 'edits', 'empties',
    'enters', 'finishes', 'gives', 'goes', 'keeps', 'leaves', 'logs', 'messages', 'opens', 'orders', 'pays',
    'picks', 'presses', 'reactivates', 'removes', 'requests', 'reschedules', 'returns', 'saves', 'searches',
    'selects', 'signs', 'skips', 'starts', 'submits', 'switches', 'taps', 'tries', 'updates', 'uploads',
    'views', 'turns', 'allows', 'denies', 'scans', 'types'
  ]
);

const TIME_PATTERNS = [
  /\btakes longer than\b/i,
  /\bpasses without\b/i,
  /\bperiod ends\b/i,
  /\b(expires|elapses|times out)\b/i,
  /\b(after|within|in|for) (a|an|one|two|three|five|ten|\d+) (seconds?|minutes?|hours?|days?|weeks?|months?|years?)\b/i,
  /\b(a|one|two|three|five|ten|\d+) (seconds?|minutes?|hours?|days?|weeks?|months?|years?) (pass|later|go by)\b/i
];

export function guessUserOrSystem(event: string): EventKind {
  const first = event.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  return USER_VERBS.has(first) ? 'user' : 'system';
}

/** Time passing on its own, never something a user does at a time. */
export function looksLikeTimeEvent(event: string) {
  return guessUserOrSystem(event) !== 'user' && TIME_PATTERNS.some((pattern) => pattern.test(event));
}

/**
 * Who or what sends an event, most trusted first: the spec says so, the chart's structure says
 * it's a hand-off, the spec names it a time event, the run drove it, then a guess from wording.
 */
export function resolveEventKind(input: {
  event: string;
  handOff: boolean;
  specKind: EventKind | undefined;
  specTimeSpan: string | undefined;
  runKind: EventKind | undefined;
}): { kind: EventKind; source: EventKindSource } {
  if (input.specKind) return { kind: input.specKind, source: 'spec' };
  if (input.handOff) return { kind: 'hand-off', source: 'structure' };
  if (input.specTimeSpan !== undefined) return { kind: 'time', source: 'spec' };
  if (input.runKind === 'time' || input.runKind === 'hand-off') return { kind: input.runKind, source: 'run' };
  if (looksLikeTimeEvent(input.event)) return { kind: 'time', source: 'guess' };
  if (input.runKind) return { kind: input.runKind, source: 'run' };
  return { kind: guessUserOrSystem(input.event), source: 'guess' };
}
