import type { Meta } from '@storybook/react-vite';
import type { Screen } from './fixture';
import { MOBILE, press, screen, see, tests, type, type ScreenStory } from './support';
const meta = { ...screen, title: 'Recordings/Artifacts' } satisfies Meta<typeof Screen>;
export default meta;
type Story = ScreenStory;
const artifacts = (params: Record<string, string | number | boolean> = {}) => tests({ tab: 'artifacts', ...params });
export const Artifacts: Story = { args: { at: artifacts() } };
export const Videos: Story = { args: { at: artifacts({ type: 'video' }) } };
export const Images: Story = { args: { at: artifacts({ type: 'image' }) } };
export const Tagged: Story = { args: { at: artifacts({ artifactTag: 'demo' }) } };
export const TaggedWithInherited: Story = { args: { at: artifacts({ artifactTag: 'checkout', inherited: true }) } };
export const ByLabel: Story = { args: { at: artifacts({ label: 'owner=payments' }) } };
export const ByOutcome: Story = { args: { at: artifacts({ outcome: 'failed' }) } };
export const ByEnvironmentAndBranch: Story = { args: { at: artifacts({ env: 'mobile-web', branch: 'main' }) } };
export const InDateRange: Story = { args: { at: artifacts({ since: '2026-10-14', until: '2026-10-14' }) } };
export const ArtifactsNoResults: Story = { args: { at: artifacts({ q: 'does-not-exist-12345' }) } };
export const SearchInsideRecordings: Story = { args: { at: artifacts({ inside: 'card reader' }) } };
export const SearchInsideNoMatches: Story = { args: { at: artifacts({ inside: 'refund' }) } };
export const FreezeAsCollection: Story = { args: { at: artifacts({ producer: 'storybook-review', outcome: 'failed' }) }, play: async () => { await press('button', 'Freeze as review collection'); } };
export const FreezeRefused: Story = {
  args: { at: artifacts({ producer: 'storybook-review', outcome: 'failed' }), server: { readOnly: true } },
  play: async () => {
    await press('button', 'Freeze as review collection');
    await type('textbox', /^Title/, 'Failed payments');
    await press('button', /^Freeze \d+ results?$/);
    await see('This server needs a token that may publish.');
  }
};
export const MobileArtifacts: Story = { ...MOBILE, args: { at: artifacts() } };
export const MobileSearchInsideRecordings: Story = { ...MOBILE, args: { at: artifacts({ inside: 'card reader' }) } };
