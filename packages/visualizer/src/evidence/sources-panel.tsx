import type { LayerHeader } from '@crvouga/atlas/reports/evidence-types';
import {
  ALL_SOURCES,
  branchOf,
  contributes,
  sourceFacets,
  sourceSelection,
  type SourceFacet,
  type SourceSelection
} from '@crvouga/atlas/reports/evidence-view';
import { environmentLabel } from '@crvouga/atlas/reports/layer-axes';
import { Alert, Button, Checkbox, Drawer, Group, List, Stack, Text, Title } from '@mantine/core';
import { useMemo } from 'react';
import { useUiStore } from '../state/ui-store';
import { useEvidence } from './evidence-context';
import { ago, plural, shortSha, useNow } from './format';
import { Bounded } from './marks';
function toggled(list: readonly string[], id: string) {
  return list.includes(id) ? list.filter((entry) => entry !== id) : [...list, id];
}
function counts(layer: LayerHeader) {
  const { passed, failed, running } = layer.counts;
  return (
    [failed ? `${failed} failed` : '', passed ? `${passed} passed` : '', running ? `${running} running` : ''].filter(Boolean).join(', ') ||
    'nothing completed'
  );
}
/** Number of disabled source facets, including individually excluded layers. */
export function excludedCount(excluded: Partial<SourceSelection>) {
  const s = sourceSelection(excluded);
  return s.backends.length + s.branches.length + s.versions.length + s.environments.length + s.layers.length;
}
function versionLabel(id: string) {
  return id === 'unknown' ? 'Unknown version' : id.slice(0, 7);
}
/** Every backend, environment, branch, version and layer contributes unless switched off here. */
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
    <Drawer opened={open} onClose={() => setOpen(false)} title="Sources" closeButtonProps={{ 'aria-label': 'Close sources' }}>
      <Stack gap="lg">
        <Text c="dimmed">
          {contributing} of {plural(layers.length, 'layer', 'layers')} contribute. For each check and environment, the newest completed
          result is shown. A layer fills only the checks it ran, so the rest of the report stays in place. Switch a source off to see an
          earlier result.
        </Text>
        {excludedCount(excluded) > 0 && <Button onClick={() => setExcluded(ALL_SOURCES)}>Use every source</Button>}
        {notices.map((notice) => (
          <Alert key={notice} role="status">
            {notice}{' '}
            <Button variant="subtle" onClick={retry}>
              Try again
            </Button>
          </Alert>
        ))}
        <Stack gap="sm">
          <Title order={3}>Backends</Title>
          {!backends.length && <Text c="dimmed">No report store is configured.</Text>}
          {backends.map((backend) => (
            <Checkbox
              key={backend.id}
              label={backend.label}
              description={backend.available ? plural(layerCount(backend.id), 'layer', 'layers') : 'Unavailable'}
              checked={!excluded.backends.includes(backend.id)}
              onChange={() => setExcluded({ ...excluded, backends: toggled(excluded.backends, backend.id) })}
            />
          ))}
        </Stack>
        <FacetGroup
          title="Environments"
          facets={facets.environments.filter((facet) => facets.environments.length > 1 || facet.id !== 'unspecified')}
          excluded={excluded.environments}
          label={(id) => environmentLabel(id === 'unspecified' ? null : id)}
          empty={null}
          now={now}
          onToggle={(id) => setExcluded({ ...excluded, environments: toggled(excluded.environments, id) })}
          onOnly={(id) =>
            setExcluded({ ...excluded, environments: facets.environments.map((facet) => facet.id).filter((facet) => facet !== id) })
          }
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
        <Stack gap="sm">
          <Title order={3}>Layers</Title>
          <List spacing="md" listStyleType="none">
            <Bounded items={layers} size={40} more="Earlier layers">
              {(layer) => {
                const off = !contributes(layer, { ...excluded, layers: [] });
                return (
                  <List.Item key={`${layer.backend}|${layer.id}`}>
                    <Checkbox
                      disabled={off}
                      checked={!off && !excluded.layers.includes(layer.id)}
                      onChange={() => setExcluded({ ...excluded, layers: toggled(excluded.layers, layer.id) })}
                      label={layer.packageDir ?? layer.producer}
                      description={
                        <>
                          {layer.live ? 'Running now' : ago(layer.recordedAtMs, now)} · {branchOf(layer)}
                          {layer.environment && ` · ${environmentLabel(layer.environment)}`}
                          {shortSha(layer.sha) && ` · ${shortSha(layer.sha)}`}
                          {layer.freshness === 'modified' && ' · local changes'} · {counts(layer)}
                        </>
                      }
                    />
                  </List.Item>
                );
              }}
            </Bounded>
          </List>
        </Stack>
      </Stack>
    </Drawer>
  );
}
function FacetGroup({
  title,
  facets,
  excluded,
  label,
  empty,
  now,
  onToggle,
  onOnly
}: {
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
    <Stack gap="sm">
      <Title order={3}>{title}</Title>
      {!facets.length && <Text c="dimmed">{empty}</Text>}
      {facets.map((facet) => (
        <Group key={facet.id} justify="space-between" wrap="nowrap">
          <Checkbox
            label={label(facet.id)}
            description={`${plural(facet.layers, 'layer', 'layers')} · ${ago(facet.latestAtMs, now)}`}
            checked={!excluded.includes(facet.id)}
            onChange={() => onToggle(facet.id)}
          />
          {facets.length > 1 && (
            <Button variant="subtle" onClick={() => onOnly(facet.id)}>
              Only
            </Button>
          )}
        </Group>
      ))}
    </Stack>
  );
}
