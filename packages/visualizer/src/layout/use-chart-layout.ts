import type { LayoutFile } from '@crvouga/atlas-schema';
import { useQuery } from '@tanstack/react-query';

import type { LayoutInput } from './graph';
import { layoutChart } from './layout';

/** The chart's layout; results changing never re-run it, only structure changing does. */
export function useChartLayout(input: LayoutInput | null, pinned: LayoutFile | null) {
  return useQuery({
    queryKey: ['layout', input?.chartId ?? '', input?.key ?? '', pinned ? JSON.stringify(pinned) : ''],
    queryFn: () => layoutChart(input!, pinned),
    enabled: input !== null,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: 30 * 60_000,
    placeholderData: (previous, previousQuery) => (previousQuery?.queryKey[1] === input?.chartId ? previous : undefined)
  });
}
