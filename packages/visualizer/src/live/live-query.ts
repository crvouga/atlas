import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { throttled } from './live-stream';

/** Coalesce bursts without cancelling useful work; an event during a fetch guarantees one trailing read. */
export function liveInvalidator(client: QueryClient, queryKey: QueryKey, ms = 150) {
  let dirty = false;
  let reading = false;
  let stopped = false;
  const drain = throttled(() => {
    if (stopped || reading || !dirty) return;
    dirty = false;
    reading = true;
    void client.invalidateQueries({ queryKey }, { cancelRefetch: false }).finally(() => {
      reading = false;
      if (dirty && !stopped) drain();
    });
  }, ms);
  const refresh = () => { if (!stopped) { dirty = true; drain(); } };
  refresh.cancel = () => { stopped = true; dirty = false; drain.cancel(); };
  return refresh;
}
