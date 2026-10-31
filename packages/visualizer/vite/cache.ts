import { createHash } from 'node:crypto';
import path from 'node:path';

/**
 * Keep independently configured viewers from replacing a live server's optimized dependency graph.
 * Vite holds optimization metadata in memory, so sharing the files between server/preview or consumer
 * contexts can mix two React runtimes when a dependency is discovered after startup.
 */
export function viewerCacheDir(appRoot: string, context: readonly (string | undefined)[]): string {
  const key = createHash('sha256').update(JSON.stringify(context)).digest('hex').slice(0, 20);
  return path.resolve(appRoot, '../../node_modules/.vite/atlas', key);
}
