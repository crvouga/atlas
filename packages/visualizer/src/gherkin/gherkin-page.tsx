import { useQuery } from '@tanstack/react-query';
import { useSearch } from '@tanstack/react-router';
import { keys, useAdapter } from '../data/queries';
import { RecordedChecks } from '../inspect/recorded-checks';
import { SpecFileIndex, useSpecFiles } from '../inspect/spec-file-index';
import { Recording } from '../reports/recording';
import { SpecDocument } from '../reports/document';
import { useReportLocation } from '../reports/location';
import { inspectorFor } from '../spec-kind';
import styles from '../views/views.module.css';
import '../reports/reports.css';

function specFile(path: string) {
  return path.replace(/^specs\//, '');
}

export function GherkinIndex() {
  const index = useSpecFiles((path) => inspectorFor(path) === 'gherkin');
  return <SpecFileIndex label="Features" files={index.files} pending={index.isPending} error={index.isError} empty="No Gherkin features in this spec set." to="/gherkin" />;
}

export function GherkinPage() {
  const adapter = useAdapter();
  const search = useSearch({ strict: false });
  const [location, updateLocation] = useReportLocation();
  const file = typeof search.spec === 'string' ? specFile(search.spec) : '';
  const text = useQuery({ queryKey: keys.specFile(file), queryFn: () => adapter.specFile(file), enabled: file.length > 0 && inspectorFor(file) === 'gherkin', retry: false });
  if (location.layer && location.test) {
    return (
      <section className="atlas-reports atlas-plate" aria-label="Recorded scenario">
        <Recording layer={location.layer} sha="" source="" id={location.test} />
        <button type="button" onClick={() => updateLocation({ layer: null, test: null, moment: null })}>Close recording</button>
      </section>
    );
  }
  if (!file) {
    return (
      <article className={styles.plateScroll}>
        <h1 className={styles.plateTitle}>Gherkin</h1>
        <p className={styles.lead}>Pick a feature in the index. Each feature is rules, scenarios, and steps.</p>
      </article>
    );
  }
  if (inspectorFor(file) !== 'gherkin') {
    return (
      <article className={styles.plateScroll}>
        <h1 className={styles.plateTitle}>Gherkin</h1>
        <p className={styles.lead}>This file is not a Gherkin feature.</p>
      </article>
    );
  }
  return (
    <article className={styles.plateScroll}>
      {text.isPending && <p className={styles.lead}>Loading the feature…</p>}
      {text.isError && <p role="alert">The feature could not be read.</p>}
      {text.data !== undefined && <SpecDocument path={file} text={text.data} />}
      <RecordedChecks file={file} heading="Scenarios that were run" openLabel="Open recording" onOpen={(layerId, testId) => updateLocation({ layer: layerId, test: testId, moment: null })} />
    </article>
  );
}
