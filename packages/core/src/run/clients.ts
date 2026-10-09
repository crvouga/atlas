import path from 'node:path';

import type { Driver, EventImplementation, Focus, Image, Implementation, StateImplementation, StepTools } from './types';

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
 *   combineDrivers({ member: webdriverDriver(appiumIos), operator: playwrightDriver(), api: httpDriver(url) })
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

/** A state implementation written for one client's context, lifted to a multi-client context. */
export function onClient<K extends string, C>(client: K, impl: StateImplementation<C>): StateImplementation<Record<K, C>>;
/** An event implementation written for one client's context, lifted to a multi-client context. */
export function onClient<K extends string, C>(client: K, impl: EventImplementation<C>): EventImplementation<Record<K, C>>;
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

/** Part of an implementation: what one client does and shows, or what spans clients. */
export type ImplementationPart<C> = Partial<Implementation<C>>;

/**
 * Merge per-client implementations into one. Each client's part is written against that client's
 * own context (a Playwright page, a WebDriver session, an HTTP client), so the helpers of every
 * driver work unchanged; `shared` holds what needs several clients at once (read an id on one
 * screen, act on it on another). `shared.setup` runs first (seed data), then each client's setup
 * in the order the clients are listed. An event or state implemented twice is an error.
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
  return {
    events,
    states,
    async setup(ctx, input) {
      await shared.setup?.(ctx, input);
      for (const client of clients) await parts[client]?.setup?.(ctx[client], { path: input.path, tools: scoped(input.tools, client) });
    },
    canStart(active) {
      for (const check of [shared.canStart, ...clients.map((c) => parts[c]?.canStart)]) {
        const verdict = check?.(active) ?? true;
        if (verdict !== true) return verdict;
      }
      return true;
    }
  };
}
