import { Alert, Anchor, Button, Card, Group, List, Skeleton, Stack, Text, Title } from '@mantine/core';
import { IconArrowLeft, IconFileOff, IconFileUnknown, IconRefresh } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import { keys, specKey, useAdapter } from '../data/queries';
import { outlinePath, resolveSpec, similarSpecs, specFile, specKind, type SpecKind } from '../spec-kind';
import type { SelectCheck } from './check-detail';
import { useEvidence } from './evidence-context';
import { isMissing, StateBlock, useStalled } from './load-state';
import { SpecHeader } from './spec-header';
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
        <Card>
          <StateBlock role="status">Loading…</StateBlock>
        </Card>
      }
    >
      {children}
    </Suspense>
  );
}
/** What a spec that cannot be shown still says: where it was looked for, what is recorded for it, and the ways on. */
function SpecUnavailable({
  kind,
  file,
  missing,
  detail,
  retry,
  run
}: {
  kind: SpecKind;
  file: string;
  missing: boolean;
  detail: string;
  retry: () => void;
  run: string | undefined;
}) {
  const evidence = useEvidence();
  const listed = evidence.files.filter(kind.accepts);
  const similar = similarSpecs(file, listed);
  const entry = evidence.view.specs.get(outlinePath(file));
  return (
    <Stack component="article" gap="md">
      <SpecHeader title={file.split('/').at(-1)!} file={file} kind={kind} entry={entry} />
      <Card>
        <StateBlock
          role={missing ? 'status' : 'alert'}
          icon={<IconFileOff size={22} />}
          title={missing ? `This ${kind.one} is not available` : `The ${kind.one} could not be read`}
          actions={
            <>
              <Button type="button" onClick={retry} variant="filled" leftSection={<IconRefresh size={16} aria-hidden="true" />}>
                Try again
              </Button>
              <Button leftSection={<IconArrowLeft size={16} aria-hidden="true" />} renderRoot={(props) => <Link {...props} to="/specs/$kind" params={{ kind: kind.id }} search={{ run }} />}>
                Back to {kind.label}
              </Button>
            </>
          }
        >
          <Stack gap="sm" align="center">
            <Text component="div">
              {missing ? `specs/${file} is not in this spec set. ` : ''}
              {detail}
              {evidence.filesPending || evidence.filesError ? '' : ` ${listed.length} ${listed.length === 1 ? kind.one : kind.many} are listed.`}
              {entry && entry.slots.length > 0 ? ' Results recorded against it are shown above.' : ''}
            </Text>
            {similar.length > 0 && (
              <Stack gap={4} align="center">
                <Text component="div">Did you mean:</Text>
                <List listStyleType="none" spacing={4}>
                  {similar.map((candidate) => (
                    <List.Item key={candidate}>
                      <Anchor ff="monospace" underline="always" renderRoot={(props) => <Link {...props} to="/specs/$kind" params={{ kind: kind.id }} search={{ run, spec: candidate }} />}>{candidate}</Anchor>
                    </List.Item>
                  ))}
                </List>
              </Stack>
            )}
          </Stack>
        </StateBlock>
      </Card>
    </Stack>
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
  // A link may name a spec by another form of its path (with the folder, in other letter case): the listed one is shown.
  const file = search.spec ? resolveSpec(specFile(search.spec), evidence.files) : '';
  const readable = kind !== null && file.length > 0 && kind.accepts(file);
  const text = useQuery({
    queryKey: keys.specFile(specKey(adapter), file),
    queryFn: () => adapter.specFile(file),
    enabled: readable,
    retry: false
  });
  const stalled = useStalled(text.isLoading, file);
  const client = useQueryClient();
  // A read that has not answered is dropped before asking again; asking again beside it would only wait for the same answer.
  const retryText = () => {
    void client.cancelQueries({ queryKey: keys.specFile(specKey(adapter), file) }).then(() => text.refetch());
  };
  if (!kind) {
    return (
      <Card component="article">
        <StateBlock icon={<IconFileUnknown size={22} />} title={<Title order={1}>No such kind of spec</Title>}>
          Pick a tab above.
        </StateBlock>
      </Card>
    );
  }
  if (!file) return <Overview kind={kind} />;
  if (!readable) {
    return (
      <Card component="article">
        <StateBlock icon={<IconFileUnknown size={22} />} title={<Title order={1}>{kind.label}</Title>}>
          This file is not a {kind.one}.
        </StateBlock>
      </Card>
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
  if (text.isPending || (text.isError && evidence.filesPending))
    return (
      <Stack component="article" gap="md">
        {stalled && (
          <Alert role="status" color="orange" title={`Reading the ${kind.one} is taking longer than expected`}>
            <Stack gap="sm">
              <Text span>
                specs/{file} has not arrived yet. Recorded results for other specs are not affected.
              </Text>
              <Group gap="xs">
                <Button type="button" onClick={retryText} variant="filled" leftSection={<IconRefresh size={16} aria-hidden="true" />}>
                  Try again
                </Button>
                <Button leftSection={<IconArrowLeft size={16} aria-hidden="true" />} renderRoot={(props) => <Link {...props} to="/specs/$kind" params={{ kind: kind.id }} search={{ run: search.run }} />}>
                  Back to {kind.label}
                </Button>
              </Group>
            </Stack>
          </Alert>
        )}
        <Card>
          <Stack gap="sm">
            <Text role="status" component="div" size="xs" c="dimmed" ff="monospace">
              Loading specs/{file}…
            </Text>
            <Skeleton h={28} w="40%" />
            <Skeleton h={8} />
            <Skeleton h={14} w="30%" />
          </Stack>
        </Card>
        <Card>
          <Stack gap="xs">
            <Skeleton h={20} w={120} />
            {[92, 64, 78, 55, 70, 48].map((width, at) => (
              <Skeleton key={at} h={12} w={`${width}%`} />
            ))}
          </Stack>
        </Card>
      </Stack>
    );
  if (text.isError) {
    const listedElsewhere = !evidence.filesPending && !evidence.filesError && !evidence.files.includes(file);
    const missing = isMissing(text.error) || listedElsewhere;
    return (
      <SpecUnavailable
        kind={kind}
        file={file}
        missing={missing}
        detail={text.error instanceof Error ? text.error.message : ''}
        retry={retryText}
        run={search.run}
      />
    );
  }
  const page = { file, text: text.data, kind, entry, selection: { check: search.check, layer: search.layer }, select };
  return (
    <Loading>
      {kind.id === 'gherkin' ? <FeaturePage {...page} /> : kind.id === 'quint' ? <ModelPage {...page} /> : <DocumentPage {...page} />}
    </Loading>
  );
}
