/**
 * @module Multi-client composition
 *
 * Lets one run drive several clients at once (a phone, a desktop browser, an API) by combining their
 * drivers into one driver whose context is a record keyed by client name, and their implementations
 * into one implementation. Each event and state records which client it acts on, which decides whose
 * screen is photographed and recorded. Owns no driver behaviour of its own; it only routes to the
 * drivers it is given.
 *
 * @see docs/statecharts.md
 */
import path from 'node:path';

import type { Driver, EventImplementation, Focus, Image, Implementation, StateImplementation, StepTools } from './types';

/** Options for `combineDrivers`. */
export type CombineDriversOptions = {
  /**
   * `focused` (default) screenshots the client a state is recognised on; `all` also screenshots
   * every other client at the same moment, kept in the image's `also`.
   */
  screens?: 'focused' | 'all';
};

const inClientDirectory = (file: string, client: string) => path.join(path.dirname(file), client, path.basename(file));

/**
 * Run several drivers as the clients of one run: a member on an iOS simulator (WebDriver/Appium
 * or Detox), an operator on a desktop browser (Playwright, Bun WebView), a partner system over
 * HTTP. Each client gets its own context, keyed by name; events and states say which client they
 * act on (`onClient`, `combineImplementations`), so screenshots and clips come from that client's
 * screen. Timeline entries are tagged with the client that made them.
 *
 * The combined driver's `concurrency` is the smallest of the drivers' (1 for any that give none),
 * its `pacing` is the first driver's that has one, and its name lists `<client>:<driver name>`.
 * If any client fails to open, the ones that did open are closed and the open throws naming that client.
 * Closing returns the first client's trace as `trace` and every client's in `traces`. Without
 * a `focus`, `screenshot` and `record` use the first driver that supports them and `text` joins every
 * client's text.
 *
 * @throws Error when `drivers` is empty.
 * @see docs/statecharts.md
 *
 * @example
 * const driver = combineDrivers<{ member: Page; api: HttpClient }>({
 *   member: playwrightDriver(),
 *   api: httpDriver('http://127.0.0.1:4000')
 * });
 */
export function combineDrivers<M extends Record<string, unknown>>(
  drivers: { [K in keyof M]: Driver<M[K]> },
  options: CombineDriversOptions = {}
): Driver<M> {
  const names = Object.keys(drivers) as (keyof M & string)[];
  if (!names.length) throw new Error('combineDrivers needs at least one client');
  const driverOf = <K extends keyof M & string>(name: K) => drivers[name];
  const pick = (focus: Focus | undefined, can: (name: keyof M & string) => boolean) => {
    const capable = names.filter(can);
    const focused = focus?.client && capable.includes(focus.client as keyof M & string) ? (focus.client as keyof M & string) : undefined;
    return { primary: focused ?? capable[0], capable };
  };
  const pacing = names.map((n) => driverOf(n).pacing).find(Boolean);

  return {
    name: names.map((n) => `${n}:${driverOf(n).name}`).join(' + '),
    clients: Object.fromEntries(names.map((n) => [n, driverOf(n).name])),
    ...(pacing ? { pacing } : {}),
    concurrency: Math.min(...names.map((n) => driverOf(n).concurrency ?? 1)),

    async open(input) {
      const settled = await Promise.allSettled(
        names.map(async (name) => [name, await driverOf(name).open({ ...input, directory: path.join(input.directory, name), timeline: input.timeline.for(name) })] as const)
      );
      const opened = settled.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []));
      const failure = settled.find((s): s is PromiseRejectedResult => s.status === 'rejected');
      if (failure) {
        await Promise.all(opened.map(([name, ctx]) => driverOf(name).close(ctx, { failed: true, traceFile: '' }).catch(() => undefined)));
        const reason = failure.reason instanceof Error ? failure.reason.message : String(failure.reason);
        const client = names[settled.indexOf(failure)];
        throw new Error(`The "${client}" client could not open: ${reason}`);
      }
      return Object.fromEntries(opened) as M;
    },

    async close(ctx, { failed, traceFile }) {
      const traces: Record<string, string> = {};
      await Promise.all(
        names.map(async (name) => {
          const closed = await driverOf(name)
            .close(ctx[name], { failed, traceFile: inClientDirectory(traceFile, name) })
            .catch(() => undefined);
          if (closed && closed.trace) traces[name] = closed.trace;
        })
      );
      const first = Object.values(traces)[0];
      return first ? { trace: first, traces } : undefined;
    },

    async screenshot(ctx, file, focus) {
      const { primary, capable } = pick(focus, (n) => Boolean(driverOf(n).screenshot));
      if (!primary) return null;
      const shoot = async (name: keyof M & string, target: string): Promise<Image | null> => {
        const image = await driverOf(name).screenshot!(ctx[name], target).catch(() => null);
        return image ? { ...image, client: name } : null;
      };
      const others = options.screens === 'all' ? capable.filter((n) => n !== primary) : [];
      const [main, ...rest] = await Promise.all([shoot(primary, file), ...others.map((n) => shoot(n, inClientDirectory(file, n)))]);
      if (!main) return null;
      const also = rest.filter((x): x is Image => Boolean(x));
      return also.length ? { ...main, also } : main;
    },

    async record(ctx, workDirectory, focus) {
      const { primary } = pick(focus, (n) => Boolean(driverOf(n).record));
      if (!primary) return { stop: async () => null };
      const recording = await driverOf(primary).record!(ctx[primary], workDirectory);
      return {
        async stop(output) {
          const clip = await recording.stop(output);
          return clip ? { ...clip, client: primary } : null;
        }
      };
    },

    async text(ctx, focus) {
      const { primary, capable } = pick(focus, (n) => Boolean(driverOf(n).text));
      const read = focus?.client && primary === focus.client ? [primary] : capable;
      const texts = await Promise.all(read.map((n) => driverOf(n).text!(ctx[n]).catch(() => '')));
      return texts.join('\n');
    },

    async hold(ctx, ms, focus) {
      const { primary } = pick(focus, (n) => Boolean(driverOf(n).hold));
      if (primary && (!focus?.client || primary === focus.client)) await driverOf(primary).hold!(ctx[primary], ms);
      else await new Promise((r) => setTimeout(r, ms));
    },

    async dispose() {
      await Promise.all(names.map((n) => driverOf(n).dispose?.().catch(() => undefined)));
    }
  };
}

const scoped = (tools: StepTools, client: string): StepTools => ({ ...tools, timeline: tools.timeline.for(client) });

/**
 * Lifts a state implementation written against one client's context to the combined context and
 * sets its `client`, so its screenshot comes from that client's screen.
 */
export function onClient<K extends string, C>(client: K, impl: StateImplementation<C>): StateImplementation<Record<K, C>>;
/**
 * Lifts an event implementation written against one client's context to the combined context and
 * sets its `client`, so its clip comes from that client's screen and its timeline entries are tagged with it.
 */
export function onClient<K extends string, C>(client: K, impl: EventImplementation<C>): EventImplementation<Record<K, C>>;
/** Lifts a state or an event implementation to a client of a multi-client context (see the overloads above); a value with `recognize` is a state. */
export function onClient<K extends string, C>(
  client: K,
  impl: StateImplementation<C> | EventImplementation<C>
): StateImplementation<Record<K, C>> | EventImplementation<Record<K, C>> {
  if ('recognize' in impl) {
    const { recognize, lookIn, settle, checks, ...rest } = impl;
    return {
      ...rest,
      client,
      recognize: (ctx) => recognize(ctx[client]),
      ...(lookIn ? { lookIn: (ctx: Record<K, C>) => lookIn(ctx[client]) } : {}),
      ...(settle ? { settle: (ctx: Record<K, C>) => settle(ctx[client]) } : {}),
      ...(checks ? { checks: (ctx: Record<K, C>) => checks(ctx[client]) } : {})
    };
  }
  const { run, prepare, ...rest } = impl;
  return {
    ...rest,
    client,
    run: (ctx, tools) => run(ctx[client], scoped(tools, client)),
    ...(prepare ? { prepare: (ctx: Record<K, C>, tools: StepTools) => prepare(ctx[client], scoped(tools, client)) } : {})
  };
}

/** Part of an implementation (any subset of its fields): what one client does and shows, or what spans clients. */
export type ImplementationPart<C> = Partial<Implementation<C>>;

/**
 * Merge per-client implementations into one. Each client's part is written against that client's
 * own context (a Playwright page, a WebDriver session, an HTTP client), so the helpers of every
 * driver work unchanged; `shared` holds what needs several clients at once (read an id on one
 * screen, act on it on another). `shared.setup` runs first (seed data), then each client's setup
 * in the order the clients are listed. An event or state implemented twice is an error.
 *
 * A seed with the same name in several parts runs `shared`'s first, then each client's; the combined
 * seed's `at` is the first one's and its `how` joins all of them. Correlation ids are pooled,
 * and `canStart` returns the first reason any part gives.
 *
 * @param parts the implementation of each client, against that client's own context.
 * @param shared events, states, seeds and setup that need several clients at once, against the combined context.
 * @throws Error when an event or state is implemented by more than one part (including `shared`).
 * @see docs/statecharts.md
 *
 * @example
 * const implementation = combineImplementations<{ member: SignalContext; api: HttpClient }>(
 *   { member: { events: {}, states: {} }, api: { events: {}, states: {} } },
 *   { setup: async ({ api }) => void (await api.post('/test/reset')) }
 * );
 */
export function combineImplementations<M extends Record<string, unknown>>(
  parts: { [K in keyof M]?: ImplementationPart<M[K]> },
  shared: ImplementationPart<M> = {}
): Implementation<M> {
  const clients = Object.keys(parts) as (keyof M & string)[];
  const events: Implementation<M>['events'] = { ...shared.events };
  const states: Implementation<M>['states'] = { ...shared.states };
  const owner = new Map<string, string>([
    ...Object.keys(shared.events ?? {}).map((k): [string, string] => [`event:${k}`, 'shared']),
    ...Object.keys(shared.states ?? {}).map((k): [string, string] => [`state:${k}`, 'shared'])
  ]);
  const claim = (key: string, client: string) => {
    const previous = owner.get(key);
    if (previous) throw new Error(`${key.replace(':', ' "')}" is implemented by both "${previous}" and "${client}"`);
    owner.set(key, client);
  };
  for (const client of clients) {
    const part = parts[client];
    for (const [name, ev] of Object.entries(part?.events ?? {})) {
      claim(`event:${name}`, client);
      events[name] = onClient(client, ev);
    }
    for (const [name, st] of Object.entries(part?.states ?? {})) {
      claim(`state:${name}`, client);
      states[name] = onClient(client, st);
    }
  }
  const seedNames = [...new Set([...Object.keys(shared.seeds ?? {}), ...clients.flatMap((c) => Object.keys(parts[c]?.seeds ?? {}))])];
  const seeds: NonNullable<Implementation<M>['seeds']> = {};
  for (const name of seedNames) {
    const shares = [shared.seeds?.[name], ...clients.map((c) => parts[c]?.seeds?.[name])].filter((s) => s !== undefined);
    const first = shares[0]!;
    const blocked = shares.find((s) => s.blocked)?.blocked;
    const shows = shares.find((s) => s.shows)?.shows;
    const variantOf = shares.find((s) => s.for)?.for;
    seeds[name] = {
      at: first.at,
      how: shares.map((s) => s.how).join('; '),
      ...(blocked ? { blocked } : {}),
      ...(shows ? { shows } : {}),
      ...(variantOf ? { for: variantOf } : {}),
      async run(ctx, input) {
        await shared.seeds?.[name]?.run(ctx, input);
        for (const client of clients) await parts[client]?.seeds?.[name]?.run(ctx[client], { path: input.path, tools: scoped(input.tools, client) });
      }
    };
  }
  const hasSetup = Boolean(shared.setup) || clients.some((c) => parts[c]?.setup);
  const correlators = [shared.correlate ? (ctx: M) => shared.correlate!(ctx) : null, ...clients.map((c) => (parts[c]?.correlate ? (ctx: M) => parts[c]!.correlate!(ctx[c]) : null))].filter(
    (f): f is (ctx: M) => string[] | Promise<string[]> => f !== null
  );
  return {
    events,
    states,
    ...(seedNames.length ? { seeds } : {}),
    ...(hasSetup
      ? {
          async setup(ctx: M, input: { path: Parameters<NonNullable<Implementation<M>['setup']>>[1]['path']; tools: StepTools }) {
            await shared.setup?.(ctx, input);
            for (const client of clients) await parts[client]?.setup?.(ctx[client], { path: input.path, tools: scoped(input.tools, client) });
          }
        }
      : {}),
    ...(correlators.length ? { correlate: async (ctx: M) => (await Promise.all(correlators.map((f) => f(ctx)))).flat() } : {}),
    canStart(active) {
      for (const check of [shared.canStart, ...clients.map((c) => parts[c]?.canStart)]) {
        const verdict = check?.(active) ?? true;
        if (verdict !== true) return verdict;
      }
      return true;
    }
  };
}

/**
 * Merge parts of one implementation written against the same context, such as one file per area
 * of a large chart (sign-up, checkout, results). Events, states and seeds must each be
 * implemented once; setups run in order, `canStart` returns the first reason any part gives, and
 * correlation ids are pooled without duplicates.
 *
 * @throws Error when an event, state or seed appears in more than one part.
 */
export function mergeImplementations<C>(...parts: ImplementationPart<C>[]): Implementation<C> {
  const events: Implementation<C>['events'] = {};
  const states: Implementation<C>['states'] = {};
  const seeds: NonNullable<Implementation<C>['seeds']> = {};
  const owner = new Map<string, number>();
  const claim = (key: string, part: number) => {
    const previous = owner.get(key);
    if (previous !== undefined) throw new Error(`${key.replace(':', ' "')}" is implemented by part ${previous + 1} and part ${part + 1}`);
    owner.set(key, part);
  };
  parts.forEach((part, i) => {
    for (const [name, ev] of Object.entries(part.events ?? {})) (claim(`event:${name}`, i), (events[name] = ev));
    for (const [name, st] of Object.entries(part.states ?? {})) (claim(`state:${name}`, i), (states[name] = st));
    for (const [name, seed] of Object.entries(part.seeds ?? {})) (claim(`seed:${name}`, i), (seeds[name] = seed));
  });
  const setups = parts.flatMap((p) => (p.setup ? [p.setup] : []));
  const checks = parts.flatMap((p) => (p.canStart ? [p.canStart] : []));
  const correlators = parts.flatMap((p) => (p.correlate ? [p.correlate] : []));
  return {
    events,
    states,
    ...(Object.keys(seeds).length ? { seeds } : {}),
    ...(setups.length
      ? {
          async setup(ctx: C, input: { path: Parameters<NonNullable<Implementation<C>['setup']>>[1]['path']; tools: StepTools }) {
            for (const setup of setups) await setup(ctx, input);
          }
        }
      : {}),
    ...(checks.length
      ? {
          canStart(active: string[]) {
            for (const check of checks) {
              const verdict = check(active);
              if (verdict !== true) return verdict;
            }
            return true;
          }
        }
      : {}),
    ...(correlators.length ? { correlate: async (ctx: C) => [...new Set((await Promise.all(correlators.map((f) => f(ctx)))).flat())] } : {})
  };
}
