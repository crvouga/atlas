import type { Meta, StoryObj } from '@storybook/react-vite';
import { userEvent, within } from 'storybook/test';
import fixture from 'virtual:atlas-stories';
import { useUiStore } from '../src/state/ui-store';
import { setFinderOpen } from '../src/find/open';
import { Screen, installFixture } from './fixture';
const meta = {
  title: 'Screens/Atlas', component: Screen,
  args: { at: '/?view=tests', state: 'populated' },
  beforeEach: ({ args }) => installFixture(args.state),
  parameters: { controls: { exclude: ['state'] } }
} satisfies Meta<typeof Screen>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Tests: Story = {};
export const Runs: Story = { args: { at: '/?view=tests&tab=runs' } };
export const Artifacts: Story = { args: { at: '/?view=tests&tab=artifacts' } };
export const Compare: Story = { args: { at: '/?view=tests&tab=compare' } };
export const CatalogHealth: Story = { args: { at: '/?view=tests&tab=health' } };
export const Collections: Story = { args: { at: '/?view=tests&tab=collections' } };
export const FailedTests: Story = { args: { at: '/?view=tests&status=failed' } };
export const StaleEvidence: Story = { args: { at: '/?view=tests&evidence=stale&sort=evidence' } };
export const SearchNoResults: Story = { args: { at: '/?view=tests&q=does-not-exist-12345' } };
export const Statecharts: Story = { args: { at: '/' } };
export const Chart: Story = { args: { at: '/chart/Coffee%20order' } };
export const ChartScreen: Story = { args: { at: '/chart/Coffee%20order?screen=Browsing%20the%20menu' } };
export const ChartEvent: Story = { args: { at: '/chart/Coffee%20order?event=Picks%20a%20drink' } };
export const GherkinIndex: Story = { args: { at: '/specs/gherkin' } };
export const Gherkin: Story = { args: { at: '/specs/gherkin?spec=coffee/ordering/ordering.feature' } };
export const QuintIndex: Story = { args: { at: '/specs/quint' } };
export const Quint: Story = { args: { at: '/specs/quint?spec=coffee/ordering/cart.qnt' } };
export const DmnIndex: Story = { args: { at: '/specs/dmn' } };
export const Dmn: Story = { args: { at: '/specs/dmn?spec=coffee/ordering/drink-price.dmn' } };
export const AlloyIndex: Story = { args: { at: '/specs/alloy' } };
export const Alloy: Story = { args: { at: '/specs/alloy?spec=coffee/ordering/payment.als' } };
export const OpenSloIndex: Story = { args: { at: '/specs/openslo' } };
export const OpenSlo: Story = { args: { at: '/specs/openslo?spec=coffee/ordering/checkout.openslo.yaml' } };
export const Behaviors: Story = { args: { at: '/behaviors' } };
export const BehaviorsNoResults: Story = { args: { at: '/behaviors?q=does-not-exist-12345' } };
export const UiCatalog: Story = { args: { at: '/catalog' } };
export const UiCatalogCompare: Story = { args: { at: '/catalog?compare=profile' } };
export const Critiques: Story = { args: { at: '/critiques' } };
export const MissingSpec: Story = { args: { at: '/specs/gherkin?spec=missing.feature' } };
export const MissingChart: Story = { args: { at: '/chart/missing' } };
export const UnknownRoute: Story = { args: { at: '/missing' } };
export const MobileTests: Story = { globals: { viewport: { value: 'mobile', isRotated: false } } };
export const MobileFeature: Story = { args: { at: '/specs/gherkin?spec=coffee/ordering/ordering.feature' }, globals: { viewport: { value: 'mobile', isRotated: false } } };
export const MobileCatalog: Story = { args: { at: '/catalog' }, globals: { viewport: { value: 'mobile', isRotated: false } } };

const behaviorAddress = '/behaviors?behavior=' + encodeURIComponent(fixture.selection.behavior);
export const TestDetail: Story = { args: { at: '/?view=tests&test=' + encodeURIComponent(fixture.selection.test) } };
export const FailedTestDetail: Story = { args: { at: '/?view=tests&test=' + encodeURIComponent(fixture.selection.failedTest) } };
export const RunDetail: Story = { args: { at: '/?view=tests&tab=runs&openRun=' + encodeURIComponent(fixture.selection.run) } };
export const Sources: Story = { play: async () => { useUiStore.getState().setSourcesOpen(true); } };
export const SearchAndCommands: Story = { play: async () => { setFinderOpen(true); } };
export const BehaviorRead: Story = { args: { at: behaviorAddress }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await userEvent.click(await canvas.findByRole('tab', { name: 'Read' }));
} };
export const BehaviorWatch: Story = { args: { at: behaviorAddress }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await userEvent.click(await canvas.findByRole('tab', { name: 'Watch' }));
} };
export const BehaviorInspect: Story = { args: { at: behaviorAddress }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await userEvent.click(await canvas.findByRole('tab', { name: 'Inspect' }));
} };
export const BehaviorWorkspace: Story = { args: { at: behaviorAddress + '&workspace=true' } };
export const CatalogGallery: Story = { args: { at: '/catalog?state=coffee/menu' } };
export const CatalogFacts: Story = { args: { at: '/catalog?state=coffee/menu&panel=facts' } };
export const CatalogNoResults: Story = { args: { at: '/catalog?q=does-not-exist-12345' } };

const coverageAddress = (state: string) => '/behaviors?behavior=' + encodeURIComponent(fixture.selection.behaviors[state] ?? 'missing-coverage-' + state);
export const DemonstratedBehavior: Story = { args: { at: coverageAddress('demonstrated') }, play: async ({ canvasElement }) => { await userEvent.click(await within(canvasElement).findByRole('tab', { name: 'Watch' })); } };
export const OlderRecording: Story = { args: { at: coverageAddress('outdated-recording') }, play: async ({ canvasElement }) => { await userEvent.click(await within(canvasElement).findByRole('tab', { name: 'Watch' })); } };
export const RecordingMissing: Story = { args: { at: coverageAddress('recording-missing') } };
export const NoRecording: Story = { args: { at: coverageAddress('no-recording') } };
export const ApiOnlyBehavior: Story = { args: { at: coverageAddress('api-only') } };
export const FailedBehavior: Story = { args: { at: coverageAddress('failed') } };
export const RunningBehavior: Story = { args: { at: coverageAddress('running') } };
export const SkippedBehavior: Story = { args: { at: coverageAddress('skipped') } };
export const ParkedBehavior: Story = { args: { at: coverageAddress('parked') } };
export const UnexecutedBehavior: Story = { args: { at: coverageAddress('unexecuted') } };

export const CritiqueDetail: Story = { args: { at: '/critiques?critic=storybook-design&entry=' + encodeURIComponent(fixture.selection.critique) } };
export const CritiqueAgreement: Story = { args: { at: '/critiques?view=agreement' } };
export const CritiqueFailure: Story = { args: { at: '/critiques?critic=storybook-design&entry=' + encodeURIComponent(fixture.selection.failedCritique) } };
export const CritiqueOlderPicture: Story = { args: { at: '/critiques?critic=storybook-design&entry=' + encodeURIComponent(fixture.selection.olderCritique) } };
