/**
 * @module `atlas critic watch`
 *
 * A worker: follows the catalog of an Atlas server and judges new or changed entries as they arrive, until it is stopped. It is
 * `atlas critic run` in a loop over `createCatalogClient(…).follow`, so it catches up on connecting, reads again after every
 * announcement and every reconnection, misses no entry and judges none twice (a picture a critic has judged is skipped by the cache
 * without a call). What it finished is published as it goes, kept in the spool when the server goes away, and sent by the next
 * invocation. Budgets are for the whole watch. It reports; it never gates.
 *
 * It ends when interrupted, when `--max-batches` batches have been handled, or when a budget is spent, and then prints what it did
 * and the report version to resume from (`--since`). The server never runs a model: the critic runs here.
 *
 * @see docs/critics.md#watching-the-catalog
 */
import path from 'node:path';

import { httpStore } from '../../reports/src/http-store';
import type { CatalogEntriesQuery } from '../../reports/src/ui-catalog-entries';
import { createCatalogClient } from './catalog-client';
import {
  connection, defaultAsk, judgeEntries, list, numberFlag, populationOf, print, redactIn, scopeOf, value, wantsJson,
  type CriticIo
} from './cli-common';
import type { LoadedConfig, BuiltCritic } from './registry';
import { buildCritic } from './registry';
import type { RunResult } from './runner';
import { flushSpool, pendingInSpool, spoolingStore } from './spool';

type Tally = { entries: number; judged: number; skipped: number; failed: number; spent: { images: number; tokens: number; costUsd: number }; layers: number; critiques: number; failures: { entry: string; reason: string }[] };

/** `atlas critic watch`. */
export async function watchCommand(argv: readonly string[], io: CriticIo, loaded: LoadedConfig): Promise<number> {
  const env = io.env ?? process.env;
  const json = wantsJson(argv);
  const interactive = !argv.includes('--non-interactive') && !json && (io.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY));
  const ask = io.ask ?? defaultAsk;
  const dryRun = argv.includes('--dry-run');
  const clock = io.clock ?? Date.now;

  let names = list(argv, 'critic');
  let target = await connection(argv, loaded, env);
  const missing = () => [...(names.length ? [] : ['--critic <name>']), ...(target ? [] : ['--server <url>'])];
  if (missing().length && interactive) {
    if (!names.length) { const configured = Object.keys(loaded.config.critics); names = (await ask(`Which critic${configured.length ? ` (${configured.join(', ')})` : ''}? `)).split(/[,\s]+/).filter(Boolean); }
    if (!target) { const url = (await ask('Atlas server address? ')).trim(); if (url) target = { url: url.replace(/\/+$/, ''), ...(env.ATLAS_CRITIC_TOKEN || env.ATLAS_TOKEN ? { token: (env.ATLAS_CRITIC_TOKEN || env.ATLAS_TOKEN)! } : {}) }; }
  }
  if (missing().length) throw new Error(`watch needs ${missing().join(', ')}. Nothing was asked: ${interactive ? 'an answer was empty' : 'there is no terminal (or --non-interactive / --format json was given)'}`);
  const server = target!;

  const { query: scope, chosen } = scopeOf(argv);
  const { since: _since, ...filters } = scope;
  const query = filters as Omit<CatalogEntriesQuery, 'cursor' | 'since'>;
  const since = value(argv, 'since');
  const maxBatches = numberFlag(argv, 'max-batches', true);
  const total = { images: numberFlag(argv, 'max-images', true), tokens: numberFlag(argv, 'max-tokens', true), costUsd: numberFlag(argv, 'max-cost') };
  const concurrency = numberFlag(argv, 'concurrency', true), timeoutMs = numberFlag(argv, 'timeout-ms', true);

  const builts: BuiltCritic[] = [];
  for (const name of names) builts.push(await buildCritic(loaded, name, io));
  const secrets = builts.flatMap(built => built.secrets);

  // Images that leave the machine need a yes, once, before the worker starts: it cannot ask later, and it never sends silently.
  for (const built of builts) {
    const destination = built.critic.describe().sendsImagesTo;
    if (destination === null || dryRun || argv.includes('--yes')) continue;
    if (!interactive) throw new Error(`${built.critic.name} sends images to ${destination}: pass --yes to allow it (nothing was sent)`);
    const answer = await ask(`${built.critic.name} will send the picture of every new or changed entry to ${destination}, for as long as this runs. Continue? [y/N] `);
    if (!/^y(es)?$/i.test(answer.trim())) throw new Error(`Stopped: ${built.critic.name} would send images to ${destination} and that was not confirmed (nothing was sent)`);
  }
  if (!dryRun) for (const built of builts) await built.ready();

  const transport = { url: server.url, ...(server.token ? { token: server.token } : {}), ...(server.project ? { project: server.project } : {}), ...(io.fetch ? { fetch: io.fetch } : {}), ...(io.sleep ? { sleep: io.sleep } : {}) };
  const client = createCatalogClient(transport);
  const spoolDir = path.resolve(loaded.directory, value(argv, 'spool') ?? loaded.config.spool ?? '.atlas/critic-spool');
  const base = httpStore(transport);
  const warnings: string[] = [];
  let flushed = 0;
  if (!dryRun) {
    const sent = await flushSpool(base, spoolDir);
    flushed = sent.sent;
    if (sent.error) warnings.push(`${sent.remaining} spooled object${sent.remaining === 1 ? '' : 's'} could not be sent yet: ${redactIn(sent.error, secrets)}`);
  }
  const store = spoolingStore(base, spoolDir);

  // A score is read against the project's scores of its state kind: the whole catalog is read once when the watch is narrowed or resumed.
  const populations = new Map(builts.map(built => [built.critic.name, new Map<string, { stateKind: string; score: number }>()]));
  const seed = async () => {
    const whole = (await client.read({})).entries;
    for (const built of builts) for (const [key, item] of populationOf(whole, built.critic.name)) populations.get(built.critic.name)!.set(key, item);
  };
  if (Object.keys(filters).length > 0 || since) await seed();

  const tallies = new Map<string, Tally>(builts.map(built => [built.critic.name, { entries: 0, judged: 0, skipped: 0, failed: 0, spent: { images: 0, tokens: 0, costUsd: 0 }, layers: 0, critiques: 0, failures: [] }]));
  const controller = new AbortController();
  if (io.signal?.aborted) controller.abort(); else io.signal?.addEventListener('abort', () => controller.abort(), { once: true });
  let stoppedBy: 'interrupted' | 'max-batches' | 'budget' | 'dry-run' = 'interrupted';
  let version: string | null = since ?? null;
  let batches = 0;
  const spentTotal = () => [...tallies.values()].reduce((sum, tally) => ({ images: sum.images + tally.spent.images, tokens: sum.tokens + tally.spent.tokens, costUsd: sum.costUsd + tally.spent.costUsd }), { images: 0, tokens: 0, costUsd: 0 });
  const exhausted = () => { const spent = spentTotal(); return (total.images !== undefined && spent.images >= total.images) || (total.tokens !== undefined && spent.tokens >= total.tokens) || (total.costUsd !== undefined && spent.costUsd >= total.costUsd); };
  if (!json) io.out(dryRun ? 'Reading the catalog once (dry run: nothing is sent or published)\n' : `Watching ${server.url} with ${builts.map(built => `${built.critic.name}@${built.critic.version}`).join(', ')}. Press Ctrl-C to stop.\n`);

  for await (const batch of client.follow({ ...(since ? { since } : {}), query, signal: controller.signal })) {
    version = batch.version;
    batches += 1;
    const lines: string[] = [];
    for (const built of builts) {
      const name = built.critic.name;
      const tally = tallies.get(name)!;
      const population = populations.get(name)!;
      for (const [key, item] of populationOf(batch.entries, name)) population.set(key, item);
      const spent = spentTotal();
      const budget = {
        ...(total.images === undefined ? {} : { maxImages: Math.max(0, total.images - spent.images) }),
        ...(total.tokens === undefined ? {} : { maxTokens: Math.max(0, total.tokens - spent.tokens) }),
        ...(total.costUsd === undefined ? {} : { maxCostUsd: Math.max(0, total.costUsd - spent.costUsd) })
      };
      if (!batch.entries.length || (Object.keys(budget).length && Object.values(budget).some(left => left <= 0))) continue;
      const { result, outcomes, layer } = await judgeEntries({
        built, entries: batch.entries, client, store, population, dryRun, budget, secrets, clock, signal: controller.signal,
        ...(concurrency ? { concurrency } : {}), ...(timeoutMs ? { timeoutMs } : {})
      });
      const run: RunResult = result;
      tally.entries += batch.entries.length; tally.judged += run.judged; tally.skipped += run.skipped; tally.failed += run.failed;
      tally.spent.images += run.spent.images; tally.spent.tokens += run.spent.tokens; tally.spent.costUsd += run.spent.costUsd;
      if (layer) { tally.layers += 1; tally.critiques += outcomes.length; }
      for (const outcome of outcomes) if (outcome.critique.failure) tally.failures.push({ entry: outcome.entry.key, reason: outcome.critique.failure.reason });
      lines.push(`${name}: ${batch.entries.length} ${batch.entries.length === 1 ? 'entry' : 'entries'}, ${run.judged} judged, ${run.skipped} skipped, ${run.failed} failed`);
    }
    if (!json && lines.length) io.out(`${dryRun ? 'Would handle' : 'Handled'} ${batch.initial ? 'the catalog' : 'what arrived'} at version ${batch.version.slice(0, 12)}: ${lines.join('; ')}\n`);
    if (dryRun) { stoppedBy = 'dry-run'; controller.abort(); }
    else if (exhausted()) { stoppedBy = 'budget'; controller.abort(); }
    else if (maxBatches !== undefined && batches >= maxBatches) { stoppedBy = 'max-batches'; controller.abort(); }
  }

  const pending = await pendingInSpool(spoolDir);
  if (store.spooled() > 0) warnings.push(`The server could not be reached: ${store.spooled()} object${store.spooled() === 1 ? '' : 's'} of critiques were kept in ${path.relative(io.cwd ?? process.cwd(), spoolDir) || spoolDir} and will be sent by the next invocation`);
  const failed = [...tallies.values()].some(tally => tally.failed > 0);
  const ok = !failed;
  const document = {
    ok, dryRun, server: server.url, scope: chosen, stoppedBy, batches, version,
    critics: builts.map(built => {
      const tally = tallies.get(built.critic.name)!;
      return {
        critic: built.critic.name, version: built.critic.version, sendsImagesTo: built.critic.describe().sendsImagesTo,
        entries: tally.entries, judged: tally.judged, skipped: tally.skipped, failed: tally.failed, failures: tally.failures, spent: tally.spent,
        published: { layers: tally.layers, critiques: tally.critiques }
      };
    }),
    spool: { flushed, spooled: store.spooled(), pending },
    warnings: warnings.map(warning => redactIn(warning, secrets))
  };
  if (json) { print(io, document); return ok ? 0 : 1; }
  io.out(`Stopped (${stoppedBy === 'interrupted' ? 'interrupted' : stoppedBy === 'budget' ? 'the budget was reached' : stoppedBy === 'max-batches' ? `${batches} ${batches === 1 ? 'batch' : 'batches'} handled` : 'dry run'}) after ${batches} ${batches === 1 ? 'batch' : 'batches'}.\n`);
  for (const item of document.critics) io.out(`  ${item.critic}@${item.version}: ${item.judged} judged, ${item.skipped} skipped, ${item.failed} failed; published ${item.published.critiques} ${item.published.critiques === 1 ? 'critique' : 'critiques'} in ${item.published.layers} ${item.published.layers === 1 ? 'layer' : 'layers'}\n`);
  if (version && !dryRun) io.out(`Resume with --since ${version}\n`);
  for (const warning of document.warnings) io.out(`! ${warning}\n`);
  return ok ? 0 : 1;
}
