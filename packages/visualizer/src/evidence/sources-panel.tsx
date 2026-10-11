import type { LayerHeader } from '@crvouga/atlas-reports/evidence-types';
import { branchOf, contributes, sourceFacets, type SourceSelection } from '@crvouga/atlas-reports/evidence-view';
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
export function excludedCount(excluded: SourceSelection) {
  return excluded.backends.length + excluded.branches.length + excluded.layers.length;
}

/**
 * Where the combined report comes from. Every backend, branch and run contributes unless it is
 * switched off here, which is also how an earlier result is brought back into view.
 */
export function SourcesPanel() {
  const { layers, backends, excluded, setExcluded, notices, retry } = useEvidence();
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
            {contributing} of {plural(layers.length, 'run', 'runs')} contribute. For each check the newest completed result is shown. Switch a source off to see what earlier runs recorded.
          </p>
          {excludedCount(excluded) > 0 && (
            <button type="button" className={styles.reset} onClick={() => setExcluded({ backends: [], branches: [], layers: [] })}>
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
                    <span className={styles.optionMeta}>{backend.available ? plural(layerCount(backend.id), 'run', 'runs') : 'Unavailable'}</span>
                  </label>
                </li>
              ))}
            </ul>
          </section>

          <section className={styles.group}>
            <h3>Branches</h3>
            {facets.branches.length === 0 && <p className={styles.empty}>No runs yet.</p>}
            <ul>
              {facets.branches.map((branch) => (
                <li key={branch.id}>
                  <label className={styles.option}>
                    <input type="checkbox" checked={!excluded.branches.includes(branch.id)} onChange={() => setExcluded({ ...excluded, branches: toggled(excluded.branches, branch.id) })} />
                    <span className={styles.optionName}>{branch.id}</span>
                    <span className={styles.optionMeta}>
                      {plural(branch.layers, 'run', 'runs')} · {ago(branch.latestAtMs, now)}
                    </span>
                  </label>
                  {facets.branches.length > 1 && (
                    <button type="button" className={styles.only} onClick={() => setExcluded({ ...excluded, branches: facets.branches.map((facet) => facet.id).filter((id) => id !== branch.id) })}>
                      Only
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>

          <section className={styles.group}>
            <h3>Runs</h3>
            <ul>
              <Bounded items={layers} size={40} more="Earlier runs">
                {(layer) => {
                  const off = excluded.backends.includes(layer.backend) || excluded.branches.includes(branchOf(layer));
                  return (
                    <li key={`${layer.backend}|${layer.id}`}>
                      <label className={styles.option} data-off={off || undefined}>
                        <input type="checkbox" disabled={off} checked={!off && !excluded.layers.includes(layer.id)} onChange={() => setExcluded({ ...excluded, layers: toggled(excluded.layers, layer.id) })} />
                        <span className={styles.optionName}>
                          {layer.packageDir ?? layer.producer}
                          <span className={styles.run}>
                            {layer.live ? 'Running now' : <time title={exactTime(layer.recordedAtMs)}>{ago(layer.recordedAtMs, now)}</time>} · {branchOf(layer)}
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
