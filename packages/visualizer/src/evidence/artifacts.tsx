import type { CheckDetail, EvidenceHolder } from '@crvouga/atlas/reports/evidence-detail';
import { roleOfType } from '@crvouga/atlas/reports/evidence-detail';
import type { LayerHeader, LayerRow } from '@crvouga/atlas/reports/evidence-types';
import { contentTypeOf } from '@crvouga/atlas/reports/media-types';
import type { Annotation, Attachment, Attempt, Step } from '@crvouga/atlas/schema';
import { Accordion, Alert, Anchor, Box, Code, Flex, Image, List, Stack, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useMemo, type ReactNode } from 'react';
import { reportAssetUrl, reportJson, reportText } from './api';
import { duration, plural } from './format';
import { StatusMark } from './marks';
/**
 * How one kind of attachment is shown. The first renderer that matches wins, so a new kind of artifact (a
 * flame graph, a HAR, a coverage map) is one more entry, and an attachment nobody has a renderer for is still
 * listed, with its name, what it is and a way to download it. Nothing here fails on what it does not know.
 */
export type ArtifactRenderer = {
  readonly id: string;
  readonly matches: (attachment: Attachment, type: string) => boolean;
  /** `url` is where the bytes are, if they are anywhere a browser can reach; `path` is the report API path of a stored file. */
  readonly render: (
    attachment: Attachment,
    context: {
      url: string | null;
      path: string | null;
      type: string;
    }
  ) => ReactNode;
  /** Wide renderers take a whole row of the gallery. */
  readonly wide?: boolean;
};
const mediaType = (attachment: Attachment) =>
  (attachment.contentType ?? contentTypeOf(attachment.name)).split(';')[0]!.trim().toLowerCase();
const label = (attachment: Attachment) => attachment.description ?? attachment.name;
/** Only addresses a browser may follow: never `javascript:` or `data:` from a producer. */
function safeUri(uri: string | undefined): string | null {
  if (!uri) return null;
  try {
    const url = new URL(uri, 'https://atlas.invalid/');
    return url.protocol === 'http:' || url.protocol === 'https:' ? uri : null;
  } catch {
    return null;
  }
}
function TextValue({ attachment, path }: { attachment: Attachment; path: string | null }) {
  const stored = useQuery({
    queryKey: ['artifact-text', path ?? ''],
    queryFn: ({ signal }) => reportText(path!, signal),
    enabled: attachment.text === undefined && path !== null,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false
  });
  const raw = attachment.text ?? stored.data;
  if (raw === undefined)
    return (
      <Text component="div" c="dimmed">
        {stored.isError ? 'Could not be read.' : 'Loading…'}
      </Text>
    );
  const shown = raw.length > 200000 ? raw.slice(0, 200000) : raw;
  const pretty = /json/.test(mediaType(attachment)) ? tryPretty(shown) : shown;
  return (
    <>
      <Code block>{pretty}</Code>
      {shown.length < raw.length && (
        <Text component="div" c="dimmed">
          Showing the first 200 000 characters.
        </Text>
      )}
    </>
  );
}
function tryPretty(text: string) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}
/** In order: the first that matches. Add to the front with {@link registerArtifactRenderer}. */
export const artifactRenderers: ArtifactRenderer[] = [
  {
    id: 'image',
    matches: (_, type) => type.startsWith('image/') && type !== 'image/svg+xml',
    render: (a, { url }) =>
      url ? (
        <Anchor href={url} target="_blank" rel="noreferrer">
          <Image src={url} alt={label(a)} loading="lazy" width={a.width} height={a.height} fit="contain" maw="100%" />
        </Anchor>
      ) : null
  },
  // SVG can carry script: shown as a picture only, never inlined.
  {
    id: 'svg',
    matches: (_, type) => type === 'image/svg+xml',
    render: (a, { url }) => (url ? <Image src={url} alt={label(a)} loading="lazy" fit="contain" maw="100%" /> : null)
  },
  {
    id: 'video',
    wide: true,
    matches: (_, type) => type.startsWith('video/'),
    render: (a, { url }) =>
      url ? <Box src={url} controls preload="metadata" aria-label={label(a)} component="video" maw="100%" w="100%" /> : null
  },
  {
    id: 'audio',
    matches: (_, type) => type.startsWith('audio/'),
    render: (a, { url }) => (url ? <audio src={url} controls preload="none" aria-label={label(a)} /> : null)
  },
  // A page snapshot runs nothing: the frame has no permissions and the file is served sandboxed.
  {
    id: 'snapshot',
    wide: true,
    matches: (_, type) => type === 'text/html' || type === 'application/xhtml+xml',
    render: (a, { url }) =>
      url ? <Box component="iframe" w="100%" h="32rem" bd="0" sandbox="" src={url} title={label(a)} loading="lazy" /> : null
  },
  {
    id: 'pdf',
    wide: true,
    matches: (_, type) => type === 'application/pdf',
    render: (a, { url }) =>
      url ? <Box component="iframe" w="100%" h="32rem" bd="0" sandbox="" src={url} title={label(a)} loading="lazy" /> : null
  },
  {
    id: 'text',
    wide: true,
    matches: (a, type) => a.text !== undefined || type.startsWith('text/') || /(json|xml|yaml|x-ndjson|x-diff)/.test(type),
    render: (a, { path }) => <TextValue attachment={a} path={path} />
  }
];
export function registerArtifactRenderer(renderer: ArtifactRenderer) {
  artifactRenderers.unshift(renderer);
}
function sizeOf(bytes: number | undefined) {
  if (bytes === undefined) return '';
  if (bytes < 1024) return `${bytes} B`;
  return bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(0)} KiB` : `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}
function Artifact({ attachment, layer }: { attachment: Attachment; layer: string }) {
  const type = mediaType(attachment);
  const path = attachment.bundleKey
    ? `/layers/${encodeURIComponent(layer)}/blobs/${attachment.bundleKey.split('/').map(encodeURIComponent).join('/')}`
    : null;
  const url = path ? reportAssetUrl(path) : safeUri(attachment.uri);
  const renderer = artifactRenderers.find((candidate) => candidate.matches(attachment, type));
  const body = renderer?.render(attachment, { url, path, type });
  return (
    <List.Item data-wide={renderer?.wide || undefined} data-role={attachment.role ?? roleOfType(type)}>
      {body}
      <Box component="figcaption">
        <Text span inherit fw={600}>
          {attachment.name}
        </Text>
        {attachment.role && (
          <Text span inherit>
            {attachment.role}
          </Text>
        )}
        <Text span inherit>
          {[type, sizeOf(attachment.bytes), attachment.durationMs ? duration(attachment.durationMs) : ''].filter(Boolean).join(' · ')}
        </Text>
        {url && (
          <Anchor href={url} download={attachment.name} target="_blank" rel="noreferrer">
            {body ? 'Download' : 'Open'}
          </Anchor>
        )}
        {!url && attachment.text === undefined && (
          <Text span inherit>
            No file to show
          </Text>
        )}
      </Box>
    </List.Item>
  );
}
export function Attachments({ attachments, layer }: { attachments: readonly Attachment[]; layer: string }) {
  if (!attachments.length) return null;
  return (
    <Box aria-label="Attachments" component="section" mb="lg">
      <Title order={4} mb="sm">
        {plural(attachments.length, 'attachment', 'attachments')}
      </Title>
      <List spacing="xs" listStyleType="none">
        {attachments.map((attachment, index) => (
          <Artifact key={`${attachment.id ?? attachment.name}:${index}`} attachment={attachment} layer={layer} />
        ))}
      </List>
    </Box>
  );
}
const STEP_STATUS: Record<string, 'passed' | 'failed' | 'running' | 'not-run'> = {
  passed: 'passed',
  pass: 'passed',
  ok: 'passed',
  failed: 'failed',
  fail: 'failed',
  error: 'failed',
  running: 'running',
  skipped: 'not-run',
  'not-run': 'not-run',
  'not-reached': 'not-run',
  pending: 'not-run'
};
/** The timeline: ordered by when each step started, nested by `parentId`. A step whose parent is missing is shown at the top. */
export function Timeline({ steps, layer }: { steps: readonly Step[]; layer: string }) {
  const tree = useMemo(() => {
    const ids = new Set(steps.flatMap((step) => (step.id ? [step.id] : [])));
    const children = new Map<string | null, Step[]>();
    for (const step of steps) {
      const parent = step.parentId && ids.has(step.parentId) ? step.parentId : null;
      children.set(parent, [...(children.get(parent) ?? []), step]);
    }
    for (const list of children.values()) list.sort((a, b) => (a.offsetMs ?? 0) - (b.offsetMs ?? 0));
    return children;
  }, [steps]);
  const render = (parent: string | null): ReactNode => (
    <List spacing="xs" listStyleType="none" type="ordered">
      {(tree.get(parent) ?? []).map((step, index) => {
        const status = STEP_STATUS[(step.status ?? '').toLowerCase()];
        return (
          <List.Item data-evidence-step key={`${step.id ?? step.name}:${index}`} data-status={status ?? step.status ?? 'none'}>
            <Flex gap="xs" align="center" wrap="wrap">
              <StatusMark status={status ?? 'none'} size={14} />
              <Text span inherit>
                {step.name}
              </Text>
              {step.kind && (
                <Text span inherit>
                  {step.kind}
                </Text>
              )}
              {step.status && !status && (
                <Text span inherit>
                  {step.status}
                </Text>
              )}
              <Box flex={1} />
              <Text span inherit c="dimmed">
                {[step.offsetMs !== undefined ? `+${duration(step.offsetMs)}` : '', duration(step.durationMs)].filter(Boolean).join(' · ')}
              </Text>
            </Flex>
            {step.detail && <Text component="div">{step.detail}</Text>}
            {step.annotations && <Notes notes={step.annotations} />}
            {step.attachments && <Attachments attachments={step.attachments} layer={layer} />}
            {step.id && tree.has(step.id) && render(step.id)}
          </List.Item>
        );
      })}
    </List>
  );
  return (
    <Box aria-label="Timeline" component="section" mb="lg">
      <Title order={4} mb="sm">
        {plural(steps.length, 'step', 'steps')}
      </Title>
      {render(null)}
    </Box>
  );
}
export function Notes({ notes }: { notes: readonly Annotation[] }) {
  if (!notes.length) return null;
  return (
    <List aria-label="Annotations" spacing="xs" listStyleType="none">
      {notes.map((note, index) => (
        <Alert key={index} color={'blue'} my="sm">
          <Text data-level={note.level ?? 'info'} span inherit>
            {note.level && ['info', 'warning', 'error'].includes(note.level) ? note.level : note.type}
          </Text>
          <Text span inherit>
            {note.message}
            {note.source?.file && (
              <Text span inherit c="dimmed">
                {' '}
                {note.source.file}
                {note.source.line ? `:${note.source.line}` : ''}
              </Text>
            )}
            {note.level && !['info', 'warning', 'error'].includes(note.level) && (
              <Text span inherit c="dimmed">
                {' '}
                ({note.level})
              </Text>
            )}
          </Text>
        </Alert>
      ))}
    </List>
  );
}
function Tries({ attempts, layer }: { attempts: readonly Attempt[]; layer: string }) {
  if (!attempts.length) return null;
  return (
    <Box aria-label="Tries" component="section" mb="lg">
      <Title order={4} mb="sm">
        {plural(attempts.length, 'try', 'tries')}
      </Title>
      <List spacing="xs" listStyleType="none" type="ordered">
        {attempts.map((attempt) => (
          <List.Item key={attempt.index}>
            <Flex gap="xs" align="center" wrap="wrap">
              <StatusMark status={attempt.status} size={14} />
              <Text span inherit>
                Try {attempt.index + 1}
              </Text>
              <Box flex={1} />
              <Text span inherit c="dimmed">
                {duration(attempt.durationMs)}
              </Text>
            </Flex>
            {attempt.detail && <Text component="div">{attempt.detail}</Text>}
            {attempt.attachments && <Attachments attachments={attempt.attachments} layer={layer} />}
          </List.Item>
        ))}
      </List>
    </Box>
  );
}
/** What is not known: kept, and shown as it is, so nothing a tool recorded is out of reach. */
function Raw({ extensions }: { extensions: Readonly<Record<string, unknown>> }) {
  const names = Object.keys(extensions);
  if (!names.length) return null;
  return (
    <Accordion variant="separated" my="sm">
      <Accordion.Item value="content">
        <Accordion.Control>
          {plural(names.length, 'extension', 'extensions')}: {names.join(', ')}
        </Accordion.Control>
        <Accordion.Panel>
          <Code block>{JSON.stringify(extensions, null, 2)}</Code>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion>
  );
}
function Facts({ holder }: { holder: EvidenceHolder }) {
  const labels = Object.entries(holder.labels ?? {});
  const tags = holder.tags ?? [];
  const links = (holder.links ?? []).flatMap((link) => {
    const url = safeUri(link.url);
    return url ? [{ ...link, url }] : [];
  });
  if (!labels.length && !tags.length && !links.length) return null;
  return (
    <Stack gap="sm">
      <List aria-label="Facts" spacing="xs" listStyleType="none">
        {tags.map((tag) => (
          <List.Item key={`t:${tag}`}>{tag}</List.Item>
        ))}
        {labels.map(([name, value]) => (
          <List.Item key={`l:${name}`}>
            {name}
            <Text span inherit fw={600}>
              {value}
            </Text>
          </List.Item>
        ))}
        {links.map((link) => (
          <List.Item key={`k:${link.url}`}>
            <Anchor href={link.url} target="_blank" rel="noreferrer">
              {link.name ?? link.rel ?? link.url}
            </Anchor>
          </List.Item>
        ))}
      </List>
    </Stack>
  );
}
function Evidence({ holder, layer, steps }: { holder: EvidenceHolder; layer: string; steps?: boolean }) {
  return (
    <>
      <Facts holder={holder} />
      {holder.annotations && <Notes notes={holder.annotations} />}
      {steps && holder.steps && holder.steps.length > 0 && <Timeline steps={holder.steps} layer={layer} />}
      {holder.attempts && holder.attempts.length > 1 && <Tries attempts={holder.attempts} layer={layer} />}
      {holder.attachments && <Attachments attachments={holder.attachments} layer={layer} />}
      {holder.extensions && <Raw extensions={holder.extensions} />}
    </>
  );
}
/** Everything one result carries beyond its outcome, read when it is opened, and what the run around it carried. */
export function ResultEvidence({ layer, row }: { layer: LayerHeader; row: LayerRow }) {
  const wanted = row.evidence !== undefined || layer.evidence !== undefined;
  const detail = useQuery({
    queryKey: ['evidence-detail', layer.backend, layer.id, row.kind, row.id],
    queryFn: ({ signal }) =>
      reportJson<CheckDetail>(
        `/evidence/detail/${encodeURIComponent(layer.backend)}/${encodeURIComponent(layer.id)}?check=${encodeURIComponent(row.id)}&kind=${encodeURIComponent(row.kind)}`,
        signal
      ),
    enabled: wanted && /^[0-9a-f]{64}$/.test(layer.id),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false
  });
  if (!wanted) return null;
  if (detail.isLoading)
    return (
      <Text role="status" component="div" c="dimmed">
        Loading what this result carries…
      </Text>
    );
  if (detail.isError || !detail.data)
    return (
      <Text role="alert" component="div" c="dimmed">
        What this result carries could not be read.
      </Text>
    );
  const { check, run } = detail.data;
  const hasRun = Object.values(run).some((value) =>
    Array.isArray(value) ? value.length > 0 : value && typeof value === 'object' ? Object.keys(value).length > 0 : false
  );
  return (
    <Stack aria-label="Evidence" gap="sm" miw={0}>
      <Evidence holder={check} layer={layer.id} steps />
      {hasRun && (
        <Box aria-label="From the run" component="section" mb="lg">
          <Title order={4} mb="sm">
            From the run
          </Title>
          <Evidence holder={run} layer={layer.id} />
        </Box>
      )}
    </Stack>
  );
}
