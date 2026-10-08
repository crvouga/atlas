import { Outlet, useSearch } from '@tanstack/react-router';

import { Header } from '../components/Header';
import styles from '../views/views.module.css';
import { AtlasProvider, useAtlas } from './atlas-context';

function Body() {
  const { view, spec } = useAtlas();
  if (!view && spec.error) {
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
      <div className={styles.app}>
        <Header />
        <main className={styles.main}>
          <Body />
        </main>
      </div>
    </AtlasProvider>
  );
}
