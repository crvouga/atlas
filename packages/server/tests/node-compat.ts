import type { BackendInput } from '../../reports/src/compose';
import type { LayerHeader } from '../../reports/src/evidence-types';
import { createAtlasServer, type AtlasServer } from '../src/app';

export type Node = AtlasServer;

/** A server over some backends, the first of which takes uploads: what most tests want. */
export function createNode(options: { stores: readonly BackendInput[]; site?: string; authToken?: string; include?: (layer: LayerHeader) => boolean; refreshMs?: number; log?: (line: Record<string, unknown>) => void; now?: () => number }): Node {
  return createAtlasServer({
    backends: options.stores,
    write: options.stores[0]!.id,
    ...(options.site ? { site: options.site } : {}),
    ...(options.authToken ? { tokens: [{ name: 'test', role: 'admin', token: options.authToken }] } : {}),
    ...(options.include ? { include: options.include } : {}),
    ...(options.refreshMs ? { refreshMs: options.refreshMs } : {}),
    ...(options.log ? { log: options.log } : {}),
    ...(options.now ? { now: options.now } : {})
  });
}
