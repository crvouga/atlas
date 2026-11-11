/** What every route-level story shares: the real viewer at an address, over one fixture, in one viewport. */
import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, waitFor, within } from 'storybook/test';
import fixture from 'virtual:atlas-stories';
import { Screen, installFixture } from './fixture';

/** Spread into a stories file's meta, beside its `title`. */
export const screen = {
  component: Screen,
  args: { at: '/?view=tests', state: 'populated' },
  beforeEach: ({ args }) => installFixture({ state: args.state, server: args.server }),
  parameters: { controls: { exclude: ['state', 'server'] } }
} satisfies Meta<typeof Screen>;
export type ScreenStory = StoryObj<typeof screen>;

/** Pins the 390px viewport. A story that spreads it is named `Mobile…`, so its id contains `--mobile`. */
export const MOBILE = { globals: { viewport: { value: 'mobile', isRotated: false } } } as const;

/** The fixture's own keys (runs, tests, layers, profiles), derived by the production readers when Storybook starts. */
export const pick = fixture.selection;

type Params = Record<string, string | number | boolean>;
const query = (params: Params) => Object.entries(params).map(([name, value]) => `${name}=${encodeURIComponent(String(value))}`).join('&');
const address = (path: string, params: Params) => (Object.keys(params).length ? `${path}?${query(params)}` : path);
/** The test explorer (`/` with `view=tests`) and its tabs. */
export const tests = (params: Params = {}) => address('/', { view: 'tests', ...params });
export const catalog = (params: Params = {}) => address('/catalog', params);
export const behaviors = (params: Params = {}) => address('/behaviors', params);
export const critiques = (params: Params = {}) => address('/critiques', params);
export const spec = (kind: string, params: Params = {}) => address(`/specs/${kind}`, params);
export const chart = (params: Params = {}) => address('/chart/Coffee%20order', params);

/** The release the fixture's current commit is read against. */
export const RELEASE = { release: 90, releaseSha: pick.commits.current, releasePlatform: 'desktop-web' } as const;
export const FEATURE = 'coffee/ordering/ordering.feature';
export const REVIEW_FEATURE = 'storybook/review.feature';

/** Everything on the page, including dialogs, menus and drawers that render outside the story's root. */
const page = () => within(document.body);
/** Clicks the first control with that role and accessible name, once it is there. */
export async function press(role: 'button' | 'tab' | 'menuitem' | 'radio' | 'link' | 'checkbox', name: string | RegExp) {
  const found = await page().findAllByRole(role, { name }, { timeout: 8000 });
  await userEvent.click(found[0]!);
}
/** Waits until that text is on the page. */
export async function see(text: string | RegExp) {
  await waitFor(async () => { if (!(await page().findAllByText(text)).length) throw new Error(`Not shown: ${text}`); }, { timeout: 8000 });
}
/** Types into the first field with that role and accessible name. */
export async function type(role: 'textbox' | 'combobox' | 'searchbox', name: string | RegExp, words: string) {
  const found = await page().findAllByRole(role, { name }, { timeout: 8000 });
  await userEvent.type(found[0]!, words);
}
/** Waits for a control with that role and accessible name, without using it. */
export async function shown(role: 'button' | 'tab' | 'dialog', name: string | RegExp) {
  await page().findAllByRole(role, { name }, { timeout: 8000 });
}
