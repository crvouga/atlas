import { configKey, type Config } from './graph';

/** Deterministic identity: changing scope, start or event order changes the path. */
export function pathKey(chart: string | undefined, start: Config, events: readonly string[]): string {
  return JSON.stringify([chart ?? null, configKey(start.value), events]);
}
