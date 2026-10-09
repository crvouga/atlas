# @crvouga/atlas-detox

A Detox driver for [Atlas](../../README.md): run statecharts against an iOS or Android app.

```sh
pnpm add -D @crvouga/atlas @crvouga/atlas-detox detox
```

Detox is an optional peer dependency: the driver types Detox's globals structurally, so the package
builds without it.

## Use

Run Atlas from inside a Detox test, where Detox's `device`, `element`, `by` and `waitFor` globals
exist:

```ts
import { defineConfig, runConfig } from '@crvouga/atlas';
import type { DetoxContext } from '@crvouga/atlas-detox';
import { detoxDriver, detoxScreen } from '@crvouga/atlas-detox';

const config = defineConfig<DetoxContext>({
  specs: './specs',
  driver: detoxDriver({ launchArgs: { resetData: true } }),
  implementation: {
    setup: async () => undefined,
    events: {
      'Adds a todo': {
        kind: 'user',
        how: 'Types a todo and taps "Add".',
        async run(ctx) {
          await ctx.type(ctx.by.id('new-todo'), 'Water the plants', 'New todo');
          await ctx.tap(ctx.by.text('Add'), 'Add');
        }
      }
    },
    states: {
      'No todos': detoxScreen({ all: [{ matcher: by.text('Nothing to do yet'), name: 'empty message' }] }),
      'Some todos open': detoxScreen({
        all: [{ matcher: by.id('todo-list'), name: 'todo list' }],
        none: [{ matcher: by.text('Nothing to do yet'), name: 'empty message' }]
      })
    }
  }
});

it('follows the todo statechart', async () => {
  const { ok } = await runConfig(config, { mode: 'fast' });
  expect(ok).toBe(true);
}, 30 * 60_000);
```

## What it provides

- **`detoxDriver({ api?, launchArgs? })`**: relaunches the app (`newInstance: true`) for every path
  attempt and terminates it afterwards; screenshots come from `device.takeScreenshot`. Pass `api` to
  use something other than the globals.
- **`DetoxContext`**: Detox's `device`, `element`, `by` and `waitFor`, plus `tap(matcher, label)` and
  `type(matcher, text, label)`, which log each action to the step's timeline. It is a
  `SignalContext` too (`goto` opens a deep link, `isVisible`, `user.tap`, `user.type`), so an
  implementation written against `@crvouga/atlas/signals` runs here unchanged; `detoxMatcher`
  maps a signal to `by.id`, `by.label` or `by.text`.

To combine a native app with other clients (a web dashboard, an API) from the `atlas` CLI rather
than from inside a Detox test, use `@crvouga/atlas-webdriver` with Appium.
- **`detoxScreen({ all, none, checks })`**: a state recogniser from Detox matchers.

Detox records video per test through its artifacts plugin rather than per call, so this driver does
not record a clip per transition; run Detox with `--record-videos` to keep a video of each attempt.

## License

MIT
