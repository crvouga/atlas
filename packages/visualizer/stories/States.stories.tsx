import type { Meta, StoryObj } from '@storybook/react-vite';
import { Screen, installFixture } from './fixture';
const meta = { title: 'States/Atlas', component: Screen, args: { at: '/?view=tests', state: 'empty' }, beforeEach: ({ args }) => installFixture(args.state) } satisfies Meta<typeof Screen>;
export default meta;
type Story = StoryObj<typeof meta>;
export const EmptyTests: Story = {};
export const EmptyRuns: Story = { args: { at: '/?view=tests&tab=runs' } };
export const EmptyArtifacts: Story = { args: { at: '/?view=tests&tab=artifacts' } };
export const EmptyBehaviors: Story = { args: { at: '/behaviors' } };
export const EmptyCatalog: Story = { args: { at: '/catalog' } };
export const LoadingTests: Story = { args: { state: 'loading' } };
export const LoadingCatalog: Story = { args: { at: '/catalog', state: 'loading' } };
export const UnavailableReports: Story = { args: { state: 'error' } };
export const UnavailableBehaviors: Story = { args: { at: '/behaviors', state: 'error' } };
export const UnavailableCatalog: Story = { args: { at: '/catalog', state: 'error' } };
export const UnavailableSpec: Story = { args: { at: '/specs/gherkin?spec=coffee/ordering/ordering.feature', state: 'spec-error' } };
export const LoadingSpec: Story = { args: { at: '/specs/gherkin?spec=coffee/ordering/ordering.feature', state: 'loading' } };

export const IncompleteEvidence: Story = { args: { state: 'incomplete' } };
export const StalledSpec: Story = { args: { at: '/specs/gherkin?spec=coffee/ordering/ordering.feature', state: 'stalled' } };

export const EmptyCritiques: Story = { args: { at: '/critiques' } };
