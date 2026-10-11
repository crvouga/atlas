import { Outlet, useLocation, useSearch } from '@tanstack/react-router';

import { Header } from '../components/Header';
import { EvidenceProvider } from '../evidence/evidence-context';
import { SourcesPanel } from '../evidence/sources-panel';
import { SpecIndex } from '../evidence/spec-index';
import { kindOfAddress } from '../spec-kind';
import styles from '../views/views.module.css';
import { AtlasProvider, useAtlas } from './atlas-context';
import { Gazetteer } from './gazetteer';
import { SearchQueryProvider } from './search-query';

function Index() {
  const { pathname } = useLocation();
  const kind = kindOfAddress(pathname);
  return kind ? <SpecIndex kind={kind} /> : pathname.startsWith('/specs/') ? <nav aria-label="Specs" /> : <Gazetteer />;
}

function Body() {
  const { view, spec } = useAtlas();
  const { pathname } = useLocation();
  if (!pathname.startsWith('/specs/') && !view && spec.error) {
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
      <EvidenceProvider>
        <SearchQueryProvider>
          <div className={styles.app}>
            <Header />
            <div className={styles.frame}>
              <Index />
              <main className={styles.main}>
                <Body />
              </main>
            </div>
            <SourcesPanel />
          </div>
        </SearchQueryProvider>
      </EvidenceProvider>
    </AtlasProvider>
  );
}
