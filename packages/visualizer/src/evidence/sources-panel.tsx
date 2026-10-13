import type { LayerHeader } from '@crvouga/atlas/reports/evidence-types';
import { ALL_SOURCES, branchOf, contributes, sourceFacets, sourceSelection, type SourceFacet, type SourceSelection } from '@crvouga/atlas/reports/evidence-view';
import { environmentLabel } from '@crvouga/atlas/reports/layer-axes';
import * as Dialog from '@radix-ui/react-dialog';
import { useMemo } from 'react';

import { CloseIcon } from '../components/icons';
import { useUiStore } from '../state/ui-store';
import { useEvidence } from './evidence-context';
import { ago, exactTime, plural, shortSha, useNow } from './format';
import { Bounded } from './marks';
import styles from './sources.module.css';

function toggled(list: readonly string[], id: string) {
  return list.includes(id) ? list.filter((entry) => entry !== id) : [...list, id];
}

function counts(layer: LayerHeader) {
  const { passed, failed, running } = layer.counts;
  return [failed ? `${failed} failed` : '', passed ? `${passed} passed` : '', running ? `${running} running` : ''].filter(Boolean).join(', ') || 'nothing completed';
}

/** How many sources are switched off, for the button that opens the panel. */
export function excludedCount(excluded: Partial<SourceSelection>) {
  const selection = sourceSelection(excluded);
  return selection.backends.length + selection.branches.length + selection.versions.length + selection.environments.length + selection.layers.length;
}

function versionLabel(id: string) {
  return id === 'unknown' ? 'Unknown version' : id.slice(0, 7);
}

/**
 * Where the combined report comes from. Every backend, environment, branch, version and layer
 * contributes unless it is switched off here, which is also how an earlier result is brought back.
 */
export function SourcesPanel() {
  const evidence = useEvidence();
  const { layers, backends, setExcluded, notices, retry } = evidence;
  const excluded = sourceSelection(evidence.excluded);
  const open = useUiStore((s) => s.sourcesOpen);
  const setOpen = useUiStore((s) => s.setSourcesOpen);
  const now = useNow();
  const facets = useMemo(() => sourceFacets(layers), [layers]);
  const contributing = layers.filter((layer) => contributes(layer, excluded)).length;
  const layerCount = (id: string) => facets.backends.find((facet) => facet.id === id)?.layers ?? 0;
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.sheet} aria-describedby={undefined}>
          <div className={styles.head}>
            <Dialog.Title className={styles.title}>Sources</Dialog.Title>
            <Dialog.Close className={styles.close} aria-label="Close">
              <CloseIcon size={16} />
            </Dialog.Close>
          </div>
          <p className={styles.lead}>
            {contributing} of {plural(layers.length, 'layer', 'layers')} contribute. For each check and environment, the newest completed result is shown. A layer fills only the checks it ran, so the rest of the report stays in place. Switch a source off to see an earlier result.
          </p>
          {excludedCount(excluded) > 0 && (
            <button type="button" className={styles.reset} onClick={() => setExcluded(ALL_SOURCES)}>
              Use every source
            </button>
          )}
          {notices.map((notice) => (
            <p key={notice} className={styles.notice} role="status">
              {notice}{' '}
              <button type="button" className={styles.link} onClick={retry}>Try again</button>
            </p>
          ))}

          <section className={styles.group}>
            <h3>Backends</h3>
            {backends.length === 0 && <p className={styles.empty}>No report store is configured.</p>}
            <ul>
              {backends.map((backend) => (
                <li key={backend.id}>
                  <label className={styles.option}>
                    <input type="checkbox" checked={!excluded.backends.includes(backend.id)} onChange={() => setExcluded({ ...excluded, backends: toggled(excluded.backends, backend.id) })} />
                    <span className={styles.optionName}>{backend.label}</span>
                    <span className={styles.optionMeta}>{backend.available ? plural(layerCount(backend.id), 'layer', 'layers') : 'Unavailable'}</span>
                  </label>
                </li>
              ))}
            </ul>
          </section>

          <FacetGroup
            title="Environments"
            facets={facets.environments.filter((facet) => facets.environments.length > 1 || facet.id !== 'unspecified')}
            excluded={excluded.environments}
            label={(id) => environmentLabel(id === 'unspecified' ? null : id)}
            empty={null}
            now={now}
            onToggle={(id) => setExcluded({ ...excluded, environments: toggled(excluded.environments, id) })}
            onOnly={(id) => setExcluded({ ...excluded, environments: facets.environments.map((facet) => facet.id).filter((facet) => facet !== id) })}
          />

          <FacetGroup
            title="Branches"
            facets={facets.branches}
            excluded={excluded.branches}
            label={(id) => id}
            empty="No layers yet."
            now={now}
            onToggle={(id) => setExcluded({ ...excluded, branches: toggled(excluded.branches, id) })}
            onOnly={(id) => setExcluded({ ...excluded, branches: facets.branches.map((facet) => facet.id).filter((facet) => facet !== id) })}
          />

          <FacetGroup
            title="Versions"
            facets={facets.versions}
            excluded={excluded.versions}
            label={versionLabel}
            empty={null}
            now={now}
            onToggle={(id) => setExcluded({ ...excluded, versions: toggled(excluded.versions, id) })}
            onOnly={(id) => setExcluded({ ...excluded, versions: facets.versions.map((facet) => facet.id).filter((facet) => facet !== id) })}
          />

          <section className={styles.group}>
            <h3>Layers</h3>
            <ul>
              <Bounded items={layers} size={40} more="Earlier layers">
                {(layer) => {
                  const off = !contributes(layer, { ...excluded, layers: [] });
                  return (
                    <li key={`${layer.backend}|${layer.id}`}>
                      <label className={styles.option} data-off={off || undefined}>
                        <input type="checkbox" disabled={off} checked={!off && !excluded.layers.includes(layer.id)} onChange={() => setExcluded({ ...excluded, layers: toggled(excluded.layers, layer.id) })} />
                        <span className={styles.optionName}>
                          {layer.packageDir ?? layer.producer}
                          <span className={styles.run}>
                            {layer.live ? 'Running now' : <time title={exactTime(layer.recordedAtMs)}>{ago(layer.recordedAtMs, now)}</time>} · {branchOf(layer)}
                            {layer.environment && <> · {environmentLabel(layer.environment)}</>}
                            {shortSha(layer.sha) && <> · <code>{shortSha(layer.sha)}</code></>}
                            {layer.freshness === 'modified' && ' · local changes'}
                          </span>
                        </span>
                        <span className={styles.optionMeta} data-failed={layer.counts.failed > 0 || undefined}>{counts(layer)}</span>
                      </label>
                    </li>
                  );
                }}
              </Bounded>
            </ul>
          </section>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function FacetGroup({ title, facets, excluded, label, empty, now, onToggle, onOnly }: {
  title: string;
  facets: readonly SourceFacet[];
  excluded: readonly string[];
  label: (id: string) => string;
  empty: string | null;
  now: number;
  onToggle: (id: string) => void;
  onOnly: (id: string) => void;
}) {
  if (!facets.length && empty === null) return null;
  return (
    <section className={styles.group}>
      <h3>{title}</h3>
      {facets.length === 0 && <p className={styles.empty}>{empty}</p>}
      <ul>
        {facets.map((facet) => (
          <li key={facet.id}>
            <label className={styles.option}>
              <input type="checkbox" checked={!excluded.includes(facet.id)} onChange={() => onToggle(facet.id)} />
              <span className={styles.optionName} title={facet.id}>{label(facet.id)}</span>
              <span className={styles.optionMeta}>
                {plural(facet.layers, 'layer', 'layers')} · {ago(facet.latestAtMs, now)}
              </span>
            </label>
            {facets.length > 1 && (
              <button type="button" className={styles.only} onClick={() => onOnly(facet.id)}>Only</button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
