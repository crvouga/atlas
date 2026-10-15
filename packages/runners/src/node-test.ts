/** @module Node test runner reporter
 * Consumes Node's test event stream and publishes final leaf outcomes to the project Atlas server.
 */
import type { EvidenceCheck } from '../../reports/src/explorer-types';
import { testFile, runnerLive, finishRunner } from './publish';
type Event = { type: string; data: { name?: string; file?: string; nesting?: number; type?: string; skip?: boolean | string; todo?: boolean | string; details?: { type?: string; duration_ms?: number; error?: { stack?: string; message?: string; failureType?: string } } } };
/**
 * Async generator reporter. Use alongside Node's spec reporter to keep normal output.
 * Upload errors reject the stream; skips and TODOs never count as passed. Successful suite containers are excluded; hook failures are retained.
 * @example
 * // node --test --test-reporter=spec --test-reporter=@crvouga/atlas/node-test
 */
export default async function* atlasNodeReporter(source: AsyncIterable<Event>): AsyncGenerator<string> {
  const checks: EvidenceCheck[] = [];
  const live = runnerLive('node-test');
  const kinds = new Map<string, string>();
  try {
  const parents: string[] = [];
  for await (const { type, data } of source) {
    const nesting = data.nesting ?? 0;
    const identity = `${data.file ?? ''}|${nesting}|${data.name ?? ''}`;
    if (type === 'test:enqueue' && data.type) kinds.set(identity, data.type);
    if (type === 'test:start') {
      parents[nesting] = data.name ?? ''; parents.length = nesting + 1;
      if (kinds.get(identity) === 'test') live.check({ id: [testFile(data.file), ...parents.slice(0, nesting), data.name].filter(Boolean).join(' > '), title: data.name ?? 'test', status: 'running' });
    }
    if (type !== 'test:pass' && type !== 'test:fail') continue;
    if (data.details?.type === 'suite' && (type === 'test:pass' || data.details.error?.failureType === 'subtestsFailed')) continue;
    const file = testFile(data.file);
    const status = data.skip || data.todo ? 'not-run' : type === 'test:pass' ? 'passed' : 'failed';
    checks.push({ id: [file, ...parents.slice(0, nesting), data.name].filter(Boolean).join(' > '), title: data.name ?? 'test', status,
      detail: data.details?.error?.stack ?? data.details?.error?.message ?? '', measurements: [],
      ...(typeof data.details?.duration_ms === 'number' && Number.isFinite(data.details.duration_ms) && data.details.duration_ms >= 0 ? { durationMs: data.details.duration_ms } : {}) });
    live.check(checks.at(-1)!);
  }
  checks.forEach(check => live.check(check));
  await finishRunner(live, 'node-test', checks);
  yield `Atlas: uploaded ${checks.length} checks\n`;
  } catch (error) { await live.finish('interrupted', 'The test event stream ended unexpectedly.').catch(() => {}); throw error; }
}
