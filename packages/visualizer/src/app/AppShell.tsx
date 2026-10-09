import { Outlet, useLocation, useSearch } from '@tanstack/react-router';

import { Header } from '../components/Header';
import { ReportActivity, Sidebar } from '../components/Sidebar';
import workspace from '../components/Workspace.module.css';
import styles from '../views/views.module.css';
import { AtlasProvider, useAtlas } from './atlas-context';

function Body() {
  const { view, spec } = useAtlas();
  const location = useLocation();
  if (!view && spec.error && location.pathname !== '/sources' && location.pathname !== '/runs') {
    return (
      <div className={styles.message} role="alert">
        <h1>The spec couldn’t be loaded</h1>
        <p>{spec.error}</p>
        <button type="button" className={styles.button} onClick={spec.retry}>
          Try again
        </button>
      </div>
    );
  }
  return <Outlet />;
}

export function AppShell() {
  const { run } = useSearch({ strict: false });
  return (
    <AtlasProvider run={run}>
      <div className={workspace.workspace}>
        <Sidebar />
        <div className={workspace.content}>
          <Header />
          <ReportActivity />
          <main className={styles.main}><Body /></main>
        </div>
      </div>
    </AtlasProvider>
  );
}
