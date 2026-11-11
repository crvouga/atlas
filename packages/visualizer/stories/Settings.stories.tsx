import type { Meta, StoryObj } from '@storybook/react-vite';
import { SettingsPage, installFixture, type SettingsFixture } from './fixture';
import { MOBILE, press, see, shown } from './support';
/** The administrator page is its own document (`/admin`), so it is rendered without the viewer's router. */
function Settings(_: { settings?: SettingsFixture }) { return <SettingsPage />; }
const meta = {
  title: 'Settings', component: Settings,
  beforeEach: ({ args }) => installFixture({ settings: args.settings }),
  parameters: { controls: { exclude: ['settings'] } }
} satisfies Meta<typeof Settings>;
export default meta;
type Story = StoryObj<typeof meta>;
const load = async () => { await press('button', 'Load settings'); await shown('button', 'Reload settings'); };
export const Access: Story = {};
export const Loaded: Story = { play: load };
export const SavedPolicy: Story = { args: { settings: { policy: true } }, play: load };
export const DeletionPreview: Story = { args: { settings: { policy: true } }, play: async () => { await load(); await press('button', 'Preview deletions'); await see('Preview finished. Nothing was deleted.'); } };
export const PolicySaved: Story = { play: async () => { await load(); await press('button', 'Save garbage collection policy'); await see(/Garbage collection policy saved to S3/); } };
export const ChangesSaved: Story = { play: async () => { await load(); await press('button', 'Save changes'); await see('Saved. Restart Atlas to apply.'); } };
export const JsonEditor: Story = { args: { settings: { policy: true } }, play: async () => { await load(); await press('button', 'Edit configuration as JSON'); } };
export const ActiveSettings: Story = { args: { settings: { policy: true } }, play: async () => { await load(); await press('button', 'View currently active settings'); } };
export const Unauthorized: Story = { args: { settings: { failure: 401 } }, play: async () => { await press('button', 'Load settings'); await see('The token is invalid or has expired.'); } };
export const Forbidden: Story = { args: { settings: { failure: 403 } }, play: async () => { await press('button', 'Load settings'); await see('This token may read reports but may not change settings.'); } };
export const Conflict: Story = { args: { settings: { failure: 409 } }, play: async () => { await load(); await press('button', 'Save changes'); await see('Settings changed on the server. Reload before saving.'); } };
export const Mobile: Story = { ...MOBILE };
export const MobileLoaded: Story = { ...MOBILE, args: { settings: { policy: true } }, play: load };
