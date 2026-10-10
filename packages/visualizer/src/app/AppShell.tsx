import { Outlet, useSearch, useLocation } from '@tanstack/react-router';

import { Header } from '../components/Header';
import { GherkinIndex } from '../gherkin/gherkin-page';
import { QuintIndex } from '../quint/quint-page';
import styles from '../views/views.module.css';
import { AtlasProvider, useAtlas } from './atlas-context';
import { Gazetteer, GazetteerQuery } from './gazetteer';

function Index() {
  const { pathname } = useLocation();
  if (pathname === '/gherkin') return <GherkinIndex />;
  if (pathname === '/quint') return <QuintIndex />;
  return <Gazetteer />;
}

function Body() {
  const { view, spec } = useAtlas();
  const location = useLocation();
  if (location.pathname === '/specs' || location.pathname === '/gherkin' || location.pathname === '/quint') return <Outlet />;
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
      <GazetteerQuery>
        <div className={styles.app}>
          <Header />
          <div className={styles.frame}>
            <Index />
            <main className={styles.main}>
              <Body />
            </main>
          </div>
        </div>
      </GazetteerQuery>
    </AtlasProvider>
  );
}
