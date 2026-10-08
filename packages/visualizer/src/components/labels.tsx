import type { EventKind } from '@crvouga/atlas-schema';

import { BoltIcon, ClockIcon, HandOffIcon, PlayIcon } from './icons';

export const KIND_LABEL: Record<EventKind, string> = {
  user: 'User action',
  system: 'System event',
  time: 'Time passes',
  'hand-off': 'Hand-off'
};

export const KIND_ICON = {
  user: PlayIcon,
  system: BoltIcon,
  time: ClockIcon,
  'hand-off': HandOffIcon
} satisfies Record<EventKind, unknown>;

export function KindIcon({ kind, size }: { kind: EventKind; size?: number }) {
  const Icon = KIND_ICON[kind];
  return <Icon size={size} />;
}
