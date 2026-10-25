import '@mantine/core/styles.css';
import { createRoot } from 'react-dom/client';
import { AtlasThemeProvider } from '../ui/theme';
import { SettingsPage } from './SettingsPage';
const root = document.getElementById('root');
if (root)
  createRoot(root).render(
    <AtlasThemeProvider>
      <SettingsPage />
    </AtlasThemeProvider>
  );
