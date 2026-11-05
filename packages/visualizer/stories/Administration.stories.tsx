import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, within } from 'storybook/test';
import { SettingsPage, installFixture } from './fixture';
const meta = { title: 'Administration/Settings', component: SettingsPage, beforeEach: () => installFixture() } satisfies Meta<typeof SettingsPage>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Access: Story = {};
export const Loaded: Story = { play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await userEvent.click(canvas.getByRole('button', { name: 'Load settings' }));
  await canvas.findByRole('button', { name: 'Reload settings' });
} };
export const Unauthorized: Story = {
  beforeEach: () => installFixture('populated', 401),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Load settings' }));
    await canvas.findByText('The token is invalid or has expired.');
  }
};
export const Mobile: Story = { globals: { viewport: { value: 'mobile', isRotated: false } } };

export const Conflict: Story = {
  beforeEach: () => installFixture('populated', 409),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Load settings' }));
    await canvas.findByRole('button', { name: 'Reload settings' });
    await userEvent.click(canvas.getByRole('button', { name: 'Save changes' }));
    await canvas.findByText('Settings changed on the server. Reload before saving.');
  }
};
