import { Alert, Button, Container, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import { keys, specKey, useAdapter } from '../data/queries';
import { outlinePath, specFile, specKind } from '../spec-kind';
import type { SelectCheck } from './check-detail';
import { useEvidence } from './evidence-context';
import { Overview } from './overview';
// Each kind of spec has a page with a parser of its own (Gherkin, Quint, DMN); a page loads only the one it shows.
const DocumentPage = lazy(() => import('./document-page').then((m) => ({ default: m.DocumentPage })));
const FeaturePage = lazy(() => import('./feature-page').then((m) => ({ default: m.FeaturePage })));
const ModelPage = lazy(() => import('./model-page').then((m) => ({ default: m.ModelPage })));
const RecordingPage = lazy(() => import('./recording-page').then((m) => ({ default: m.RecordingPage })));
function Loading({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <Container>
          <Text role="status" c="dimmed">
            Loading…
          </Text>
        </Container>
      }
    >
      {children}
    </Suspense>
  );
}
/** One spec tab: its overview, one of its documents, or a recording opened from that document. */
export function SpecPage() {
  const params = useParams({ from: '/specs/$kind' });
  const search = useSearch({ from: '/specs/$kind' });
  const navigate = useNavigate({ from: '/specs/$kind' });
  const adapter = useAdapter();
  const evidence = useEvidence();
  const kind = specKind(params.kind);
  const file = search.spec ? specFile(search.spec) : '';
  const readable = kind !== null && file.length > 0 && kind.accepts(file);
  const text = useQuery({
    queryKey: keys.specFile(specKey(adapter), file),
    queryFn: () => adapter.specFile(file),
    enabled: readable,
    retry: false
  });
  if (!kind) {
    return (
      <Container component="article" size="xl" w="100%" py="xl">
        <Title order={1} mb="sm">
          No such kind of spec
        </Title>
        <Text component="div" c="dimmed">
          Pick a tab above.
        </Text>
      </Container>
    );
  }
  if (!file) return <Overview kind={kind} />;
  if (!readable) {
    return (
      <Container component="article" size="xl" w="100%" py="xl">
        <Title order={1} mb="sm">
          {kind.label}
        </Title>
        <Text component="div" c="dimmed">
          This file is not a {kind.one}.
        </Text>
      </Container>
    );
  }
  const entry = evidence.view.specs.get(outlinePath(file));
  const select: SelectCheck = (patch) => {
    const value = <T,>(next: T | null | undefined, current: T | undefined) => (next === undefined ? current : (next ?? undefined));
    void navigate({
      search: (prev) => ({
        ...prev,
        check: value(patch.check, prev.check),
        layer: value(patch.layer, prev.layer),
        view: value(patch.view, prev.view),
        // Opening or leaving a recording starts from its usual moment.
        moment: patch.view === undefined ? prev.moment : undefined
      })
    });
  };
  if (search.view === 'recording' && search.check) {
    const slot = entry?.slots.find((candidate) => candidate.id === search.check);
    // The way back already names the spec; the heading is the check itself.
    const spec = `${evidence.titleOf(file)}: `;
    const label = slot ? (slot.title.startsWith(spec) ? slot.title.slice(spec.length) : slot.title) : 'Recorded test';
    return (
      <Loading>
        <RecordingPage
          slot={slot}
          layerId={search.layer}
          label={label}
          back={evidence.titleOf(file)}
          moment={search.moment ?? null}
          onMoment={(moment, replace) => void navigate({ search: (prev) => ({ ...prev, moment }), replace })}
          onClose={() => select({ view: null })}
        />
      </Loading>
    );
  }
  if (text.isPending)
    return (
      <Container component="article" size="xl" w="100%" py="xl">
        <Text role="status" component="div" c="dimmed">
          Loading the {kind.one}…
        </Text>
      </Container>
    );
  if (text.isError) {
    return (
      <Container component="article" size="xl" w="100%" py="xl">
        <Alert role="alert" color={'red'} my="sm">
          The {kind.one} could not be read.{' '}
          <Button type="button" onClick={() => void text.refetch()} variant="subtle">
            Try again
          </Button>
        </Alert>
      </Container>
    );
  }
  const page = { file, text: text.data, kind, entry, selection: { check: search.check, layer: search.layer }, select };
  return (
    <Loading>
      {kind.id === 'gherkin' ? <FeaturePage {...page} /> : kind.id === 'quint' ? <ModelPage {...page} /> : <DocumentPage {...page} />}
    </Loading>
  );
}
