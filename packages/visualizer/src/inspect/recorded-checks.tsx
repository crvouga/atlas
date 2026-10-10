import { combineLayers, distinctLayers } from '@crvouga/atlas-reports/layer-merge';
import type { LayerPage } from '@crvouga/atlas-reports/layer-types';
import { useQuery } from '@tanstack/react-query';
import { reportJson } from '../reports/api';
import { sameSpecFile } from '../spec-kind';
import styles from '../views/views.module.css';

export function RecordedChecks({ file, heading, openLabel, onOpen }: { file: string; heading: string; openLabel: string; onOpen: (layerId: string, testId: string) => void }) {
  const evidence = useQuery({ queryKey: ['report-layers', 'inspector'], queryFn: ({ signal }) => reportJson<LayerPage>('/layers', signal), staleTime: 30_000, retry: false });
  if (evidence.isError) return <p className={styles.lead}>Recorded results aren’t available from this server.</p>;
  const results = combineLayers({ specs: [], sha: null, changedFiles: [] }, distinctLayers(evidence.data?.layers ?? [])).unassigned.filter((result) => sameSpecFile(result.check.specPath, file) && result.testId);
  if (!results.length) return null;
  return (
    <section className={styles.placeGroup}>
      <h2>{heading}</h2>
      <ul className={styles.plateList}>
        {results.map((result) => (
          <li key={result.key}>
            <button type="button" className={styles.checkRow} data-status={result.check.status} aria-label={`${openLabel}: ${result.check.title}`} onClick={() => onOpen(result.layer.id, result.testId!)}>
              <span>{result.check.title}</span>
              <span>{result.check.status}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
