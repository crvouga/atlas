/**
 * @module Project index
 *
 * The left index of a project without statecharts: its published spec kinds (when it has spec files), then every
 * domain and spec its tests were recorded against, with a tally each. Choosing a domain or a spec filters the explorer.
 */
import type { StatusCounts } from '@crvouga/atlas/reports/evidence-types';
import { Link } from '@tanstack/react-router';
import { useMemo, useState } from 'react';

import evidenceStyles from '../evidence/evidence.module.css';
import { useEvidence } from '../evidence/evidence-context';
import { StatusMark } from '../evidence/marks';
import { SPEC_KINDS } from '../spec-kind';
import { useTestCatalog } from './catalog';
import styles from './explorer.module.css';
import { patched, useExplorerSearch } from './navigate';
import { values } from './search';

/** Domains start open when the index has at most this many specs. */
const OPEN_SPECS = 80;

function statusOf(counts: StatusCounts) {
  return counts.failed ? 'failed' : counts.running ? 'running' : counts.passed ? 'passed' : 'not-run';
}

/** A tally for an index row: failures in red, otherwise how many tests, quietly. */
function Tally({ counts, tests }: { counts: StatusCounts; tests: number }) {
  if (counts.failed) return <span className={evidenceStyles.tally} data-status="failed">{counts.failed} failed</span>;
  if (counts.running) return <span className={evidenceStyles.tally} data-status="running">Running</span>;
  return <span className={evidenceStyles.tally} data-status={counts.passed === tests ? 'passed' : 'not-run'}>{counts.passed === tests ? `${tests} passed` : `${counts.passed}/${tests}`}</span>;
}

function add(a: StatusCounts, b: StatusCounts): StatusCounts {
  return { passed: a.passed + b.passed, failed: a.failed + b.failed, running: a.running + b.running, 'not-run': a['not-run'] + b['not-run'] };
}

/** The index beside the explorer. */
export function ProjectIndex() {
  const { files } = useEvidence();
  const { model } = useTestCatalog();
  const search = useExplorerSearch();
  const kinds = SPEC_KINDS.filter((kind) => files.some(kind.accepts));
  const domains = useMemo(() => {
    const byDomain = new Map<string, { specs: NonNullable<typeof model>['facets']['specs'][number][]; counts: StatusCounts; tests: number }>();
    for (const spec of model?.facets.specs ?? []) {
      const domain = spec.domain || '(no domain)';
      const entry = byDomain.get(domain) ?? { specs: [], counts: { passed: 0, failed: 0, running: 0, 'not-run': 0 }, tests: 0 };
      entry.specs.push(spec);
      entry.counts = add(entry.counts, spec.counts);
      entry.tests += spec.tests;
      byDomain.set(domain, entry);
    }
    return [...byDomain];
  }, [model]);
  const specCount = model?.facets.specs.length ?? 0;
  const chosenSpecs = values(search.spec);
  const chosenDomains = values(search.domain);
  const [toggled, setToggled] = useState<ReadonlyMap<string, boolean>>(new Map());
  const isOpen = (domain: string, specs: readonly { path: string }[]) => toggled.get(domain) ?? (specCount <= OPEN_SPECS || chosenDomains.includes(domain) || specs.some((spec) => chosenSpecs.includes(spec.path)));
  const everything = !search.spec && !search.domain;
  return (
    <nav className={evidenceStyles.index} aria-label="Project specs">
      {kinds.length > 0 && (
        <>
          <h2 className={styles.indexHeading}>Specs</h2>
          <ul>
            {kinds.map((kind) => (
              <li key={kind.id}>
                <Link className={evidenceStyles.indexRow} to="/specs/$kind" params={{ kind: kind.id }} search={{}}>{kind.label}</Link>
              </li>
            ))}
          </ul>
        </>
      )}
      {domains.length > 0 && (
        <section aria-label="Tests by spec">
          <h2 className={styles.indexHeading}>Tests</h2>
          <ul>
            <li>
              <Link className={evidenceStyles.indexRow} to="/" search={patched({ spec: undefined, domain: undefined, tab: undefined })} resetScroll={false} activeOptions={{ exact: true }} aria-current={everything ? 'page' : undefined}>
                <span className={evidenceStyles.indexName}>All tests</span>
                {model && <Tally counts={model.summary.counts} tests={model.summary.tests} />}
              </Link>
            </li>
          </ul>
          {domains.map(([domain, entry]) => {
            const open = isOpen(domain, entry.specs);
            return (
              <div key={domain} className={styles.indexDomain}>
                <div className={styles.indexDomainHead}>
                  <button type="button" className={styles.indexToggle} aria-expanded={open} aria-label={`${open ? 'Collapse' : 'Expand'} ${domain}`} onClick={() => setToggled(new Map(toggled).set(domain, !open))}>
                    <span className={styles.chevron} data-open={open || undefined} aria-hidden="true" />
                  </button>
                  <Link className={evidenceStyles.indexRow} to="/" search={patched({ domain, spec: undefined, tab: undefined })} resetScroll={false} activeOptions={{ exact: true }} aria-current={chosenDomains.length === 1 && chosenDomains[0] === domain && !search.spec ? 'page' : undefined}>
                    <span className={evidenceStyles.indexName}><strong>{domain}</strong></span>
                    <Tally counts={entry.counts} tests={entry.tests} />
                  </Link>
                </div>
                {open && (
                  <ul className={styles.indexSpecs}>
                    {entry.specs.map((spec) => (
                      <li key={spec.path}>
                        <Link className={evidenceStyles.indexRow} to="/" search={patched({ spec: spec.path, domain: undefined, tab: undefined })} resetScroll={false} activeOptions={{ exact: true }} title={spec.path} aria-current={chosenSpecs.length === 1 && chosenSpecs[0] === spec.path ? 'page' : undefined}>
                          <StatusMark status={statusOf(spec.counts)} size={14} />
                          <span className={evidenceStyles.indexName}>{spec.title}</span>
                          <Tally counts={spec.counts} tests={spec.tests} />
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </section>
      )}
    </nav>
  );
}
