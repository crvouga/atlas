import type { Preview } from '@storybook/react-vite';
import '@mantine/core/styles.css';
import '@mantine/code-highlight/styles.css';
import '@mantine/spotlight/styles.css';
import '@xyflow/react/dist/base.css';
import { AtlasThemeProvider } from '../packages/visualizer/src/ui/theme';
const preview: Preview = {
  decorators: [(Story, context) => <AtlasThemeProvider scheme={context.globals.scheme === 'dark' ? 'dark' : 'light'}><Story /></AtlasThemeProvider>],
  globalTypes: { scheme: { description: 'Color scheme', toolbar: { title: 'Scheme', icon: 'mirror', items: ['light', 'dark'], dynamicTitle: true } } },
  initialGlobals: { scheme: 'light' },
  parameters: {
    layout: 'fullscreen',
    a11y: { test: 'error' },
    options: { storySort: { order: [
      'Tests', ['Explorer', 'Test detail'], 'Runs', 'Recordings', ['Artifacts', 'Playlist'], 'Compare', 'Catalog health', 'Collections',
      'Behaviors', ['Index', 'Coverage states', 'Workspace'], 'Specs', ['Gherkin', 'Quint', 'DMN', 'Alloy', 'OpenSLO'], 'Statecharts', 'UI catalog', 'Needs polish',
      'Shell', 'States', ['Empty', 'Loading', 'Unavailable', 'Errors'], 'Settings', 'Foundations', ['Theme', 'Controls', 'Data display', 'Compositions']
    ] } },
    viewport: { options: {
      desktop: { name: 'Desktop', styles: { width: '1440px', height: '1000px' } },
      mobile: { name: 'Mobile', styles: { width: '390px', height: '844px' } }
    } }
  }
};
export default preview;
