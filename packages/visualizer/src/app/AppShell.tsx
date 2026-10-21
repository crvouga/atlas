import { Outlet, useLocation, useSearch } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';

import { LiveRunsProvider } from '../live/live-runs';
import { Header } from '../components/Header';
import { EvidenceProvider } from '../evidence/evidence-context';
import { SourcesPanel } from '../evidence/sources-panel';
import { SpecIndex } from '../evidence/spec-index';
import { kindOfAddress } from '../spec-kind';
import styles from '../views/views.module.css';
import { AtlasProvider, useAtlas } from './atlas-context';
import { Gazetteer } from './gazetteer';
import { useEvidence } from '../evidence/evidence-context';
import { isStatechartFile } from '@crvouga/atlas/schema';
import { Explorer } from '../explorer/Explorer';
import { ProjectIndex } from '../explorer/ExplorerIndex';
import { TestCatalogProvider } from '../explorer/catalog';

// The finder brings every spec parser with it. It loads as soon as the page has drawn, long before anyone presses ⌘K.
const loadFinder = () => import('../find/Finder').then((m) => ({ default: m.Finder }));
const Finder = lazy(loadFinder);
if (typeof window !== 'undefined') setTimeout(() => void loadFinder(), 0);

function Index() {
  const evidence = useEvidence();
  const { pathname } = useLocation();
  const kind = kindOfAddress(pathname);
  return kind ? <SpecIndex kind={kind} /> : pathname.startsWith('/specs/') ? <nav aria-label="Specs" /> : evidence.ready && !evidence.files.some(isStatechartFile) ? <ProjectIndex /> : <Gazetteer />;
}

function Body() {
  const evidence = useEvidence();
  const { view, spec } = useAtlas();
  const { pathname } = useLocation();
  if (pathname === '/' && evidence.ready && !evidence.filesPending && !evidence.files.some(isStatechartFile)) return <Explorer />;
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
    <LiveRunsProvider enabled={!run}>
      <AtlasProvider run={run}>
        <EvidenceProvider>
          <TestCatalogProvider>
          <div className={styles.app}>
            <Header />
            <div className={styles.frame}>
              <Index />
              <main className={styles.main}>
                <Body />
              </main>
            </div>
            <SourcesPanel />
            <Suspense fallback={null}>
              <Finder />
            </Suspense>
          </div>
          </TestCatalogProvider>
        </EvidenceProvider>
      </AtlasProvider>
    </LiveRunsProvider>
  );
}
