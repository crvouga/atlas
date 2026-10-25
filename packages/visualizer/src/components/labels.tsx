import type { EventKind } from '@crvouga/atlas/schema';

import {
  IconBoltFilled as BoltIcon,
  IconClock as ClockIcon,
  IconArrowBackUp as HandOffIcon,
  IconPlayerPlayFilled as PlayIcon
} from '@tabler/icons-react';

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

export function KindIcon({ kind, size = 16 }: { kind: EventKind; size?: number }) {
  const Icon = KIND_ICON[kind];
  return <Icon size={size} aria-hidden="true" />;
}
