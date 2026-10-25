import { Loader } from '@mantine/core';
/** A named, reduced-motion-aware indicator for work in progress. */
export function ActivityIndicator({ label }: { label: string }) {
  return <Loader size="xs" aria-label={label} role="status" />;
}
