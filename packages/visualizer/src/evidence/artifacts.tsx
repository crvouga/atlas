import type { LayerHeader, LayerRow } from '@crvouga/atlas/reports/evidence-types';
import type { CheckDetail, EvidenceHolder } from '@crvouga/atlas/reports/evidence-detail';
import { roleOfType } from '@crvouga/atlas/reports/evidence-detail';
import { contentTypeOf } from '@crvouga/atlas/reports/media-types';
import type { Annotation, Attachment, Attempt, Step } from '@crvouga/atlas/schema';
import { useQuery } from '@tanstack/react-query';
import { useMemo, type ReactNode } from 'react';

import { reportAssetUrl, reportJson, reportText } from './api';
import styles from './artifacts.module.css';
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
  readonly render: (attachment: Attachment, context: { url: string | null; path: string | null; type: string }) => ReactNode;
  /** Wide renderers take a whole row of the gallery. */
  readonly wide?: boolean;
};

const mediaType = (attachment: Attachment) => (attachment.contentType ?? contentTypeOf(attachment.name)).split(';')[0]!.trim().toLowerCase();
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
  const stored = useQuery({ queryKey: ['artifact-text', path ?? ''], queryFn: ({ signal }) => reportText(path!, signal), enabled: attachment.text === undefined && path !== null, staleTime: Number.POSITIVE_INFINITY, retry: false });
  const raw = attachment.text ?? stored.data;
  if (raw === undefined) return <p className={styles.where}>{stored.isError ? 'Could not be read.' : 'Loading…'}</p>;
  const shown = raw.length > 200_000 ? raw.slice(0, 200_000) : raw;
  const pretty = /json/.test(mediaType(attachment)) ? tryPretty(shown) : shown;
  return (
    <>
      <pre className={styles.text}>{pretty}</pre>
      {shown.length < raw.length && <p className={styles.where}>Showing the first 200 000 characters.</p>}
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
  { id: 'image', matches: (_, type) => type.startsWith('image/') && type !== 'image/svg+xml', render: (a, { url }) => (url ? <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={label(a)} loading="lazy" width={a.width} height={a.height} /></a> : null) },
  // SVG can carry script: shown as a picture only, never inlined.
  { id: 'svg', matches: (_, type) => type === 'image/svg+xml', render: (a, { url }) => (url ? <img src={url} alt={label(a)} loading="lazy" /> : null) },
  { id: 'video', wide: true, matches: (_, type) => type.startsWith('video/'), render: (a, { url }) => (url ? <video src={url} controls preload="metadata" aria-label={label(a)} /> : null) },
  { id: 'audio', matches: (_, type) => type.startsWith('audio/'), render: (a, { url }) => (url ? <audio src={url} controls preload="none" aria-label={label(a)} /> : null) },
  // A page snapshot runs nothing: the frame has no permissions and the file is served sandboxed.
  { id: 'snapshot', wide: true, matches: (_, type) => type === 'text/html' || type === 'application/xhtml+xml', render: (a, { url }) => (url ? <iframe sandbox="" src={url} title={label(a)} loading="lazy" /> : null) },
  { id: 'pdf', wide: true, matches: (_, type) => type === 'application/pdf', render: (a, { url }) => (url ? <iframe sandbox="" src={url} title={label(a)} loading="lazy" /> : null) },
  { id: 'text', wide: true, matches: (a, type) => a.text !== undefined || type.startsWith('text/') || /(json|xml|yaml|x-ndjson|x-diff)/.test(type), render: (a, { path }) => <TextValue attachment={a} path={path} /> }
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
  const path = attachment.bundleKey ? `/layers/${encodeURIComponent(layer)}/blobs/${attachment.bundleKey.split('/').map(encodeURIComponent).join('/')}` : null;
  const url = path ? reportAssetUrl(path) : safeUri(attachment.uri);
  const renderer = artifactRenderers.find((candidate) => candidate.matches(attachment, type));
  const body = renderer?.render(attachment, { url, path, type });
  return (
    <li className={styles.figure} data-wide={renderer?.wide || undefined} data-role={attachment.role ?? roleOfType(type)}>
      {body}
      <figcaption>
        <strong>{attachment.name}</strong>
        {attachment.role && <span className={styles.role}>{attachment.role}</span>}
        <span>{[type, sizeOf(attachment.bytes), attachment.durationMs ? duration(attachment.durationMs) : ''].filter(Boolean).join(' · ')}</span>
        {url && <a href={url} download={attachment.name} target="_blank" rel="noreferrer">{body ? 'Download' : 'Open'}</a>}
        {!url && attachment.text === undefined && <span>No file to show</span>}
      </figcaption>
    </li>
  );
}

export function Attachments({ attachments, layer }: { attachments: readonly Attachment[]; layer: string }) {
  if (!attachments.length) return null;
  return (
    <section aria-label="Attachments">
      <h4>{plural(attachments.length, 'attachment', 'attachments')}</h4>
      <ul className={styles.gallery}>
        {attachments.map((attachment, index) => <Artifact key={`${attachment.id ?? attachment.name}:${index}`} attachment={attachment} layer={layer} />)}
      </ul>
    </section>
  );
}

const STEP_STATUS: Record<string, 'passed' | 'failed' | 'running' | 'not-run'> = { passed: 'passed', pass: 'passed', ok: 'passed', failed: 'failed', fail: 'failed', error: 'failed', running: 'running', skipped: 'not-run', 'not-run': 'not-run', 'not-reached': 'not-run', pending: 'not-run' };

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
    <ol>
      {(tree.get(parent) ?? []).map((step, index) => {
        const status = STEP_STATUS[(step.status ?? '').toLowerCase()];
        return (
          <li key={`${step.id ?? step.name}:${index}`} className={styles.step} data-status={status ?? step.status ?? 'none'}>
            <div className={styles.stepRow}>
              <StatusMark status={status ?? 'none'} size={14} />
              <span className={styles.stepName}>{step.name}</span>
              {step.kind && <span className={styles.stepKind}>{step.kind}</span>}
              {step.status && !status && <span className={styles.stepKind}>{step.status}</span>}
              <span className={styles.spacer} />
              <span className={styles.stepTime}>{[step.offsetMs !== undefined ? `+${duration(step.offsetMs)}` : '', duration(step.durationMs)].filter(Boolean).join(' · ')}</span>
            </div>
            {step.detail && <p className={styles.stepDetail}>{step.detail}</p>}
            {step.annotations && <Notes notes={step.annotations} />}
            {step.attachments && <Attachments attachments={step.attachments} layer={layer} />}
            {step.id && tree.has(step.id) && render(step.id)}
          </li>
        );
      })}
    </ol>
  );
  return (
    <section aria-label="Timeline" className={styles.timeline}>
      <h4>{plural(steps.length, 'step', 'steps')}</h4>
      {render(null)}
    </section>
  );
}

export function Notes({ notes }: { notes: readonly Annotation[] }) {
  if (!notes.length) return null;
  return (
    <ul className={styles.notes} aria-label="Annotations">
      {notes.map((note, index) => (
        <li key={index} className={styles.note}>
          <span className={styles.level} data-level={note.level ?? 'info'}>{note.level && ['info', 'warning', 'error'].includes(note.level) ? note.level : note.type}</span>
          <span>
            {note.message}
            {note.source?.file && <span className={styles.where}> {note.source.file}{note.source.line ? `:${note.source.line}` : ''}</span>}
            {note.level && !['info', 'warning', 'error'].includes(note.level) && <span className={styles.where}> ({note.level})</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Tries({ attempts, layer }: { attempts: readonly Attempt[]; layer: string }) {
  if (!attempts.length) return null;
  return (
    <section aria-label="Tries">
      <h4>{plural(attempts.length, 'try', 'tries')}</h4>
      <ol className={styles.timeline}>
        {attempts.map((attempt) => (
          <li key={attempt.index} className={styles.step}>
            <div className={styles.stepRow}>
              <StatusMark status={attempt.status} size={14} />
              <span className={styles.stepName}>Try {attempt.index + 1}</span>
              <span className={styles.spacer} />
              <span className={styles.stepTime}>{duration(attempt.durationMs)}</span>
            </div>
            {attempt.detail && <p className={styles.stepDetail}>{attempt.detail}</p>}
            {attempt.attachments && <Attachments attachments={attempt.attachments} layer={layer} />}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** What is not known: kept, and shown as it is, so nothing a tool recorded is out of reach. */
function Raw({ extensions }: { extensions: Readonly<Record<string, unknown>> }) {
  const names = Object.keys(extensions);
  if (!names.length) return null;
  return (
    <details className={styles.raw}>
      <summary>{plural(names.length, 'extension', 'extensions')}: {names.join(', ')}</summary>
      <pre className={styles.text}>{JSON.stringify(extensions, null, 2)}</pre>
    </details>
  );
}

function Facts({ holder }: { holder: EvidenceHolder }) {
  const labels = Object.entries(holder.labels ?? {});
  const tags = holder.tags ?? [];
  const links = (holder.links ?? []).flatMap((link) => { const url = safeUri(link.url); return url ? [{ ...link, url }] : []; });
  if (!labels.length && !tags.length && !links.length) return null;
  return (
    <div>
      <ul className={styles.chips} aria-label="Facts">
        {tags.map((tag) => <li key={`t:${tag}`} className={styles.chip}>{tag}</li>)}
        {labels.map(([name, value]) => <li key={`l:${name}`} className={styles.chip}>{name}<b>{value}</b></li>)}
        {links.map((link) => <li key={`k:${link.url}`} className={styles.chip}><a href={link.url} target="_blank" rel="noreferrer">{link.name ?? link.rel ?? link.url}</a></li>)}
      </ul>
    </div>
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
    queryFn: ({ signal }) => reportJson<CheckDetail>(`/evidence/detail/${encodeURIComponent(layer.backend)}/${encodeURIComponent(layer.id)}?check=${encodeURIComponent(row.id)}&kind=${encodeURIComponent(row.kind)}`, signal),
    enabled: wanted && /^[0-9a-f]{64}$/.test(layer.id),
    staleTime: Number.POSITIVE_INFINITY,
    retry: false
  });
  if (!wanted) return null;
  if (detail.isLoading) return <p className={styles.where} role="status">Loading what this result carries…</p>;
  if (detail.isError || !detail.data) return <p className={styles.where} role="alert">What this result carries could not be read.</p>;
  const { check, run } = detail.data;
  const hasRun = Object.values(run).some((value) => (Array.isArray(value) ? value.length > 0 : value && typeof value === 'object' ? Object.keys(value).length > 0 : false));
  return (
    <div className={styles.panel} aria-label="Evidence">
      <Evidence holder={check} layer={layer.id} steps />
      {hasRun && (
        <section aria-label="From the run">
          <h4>From the run</h4>
          <Evidence holder={run} layer={layer.id} />
        </section>
      )}
    </div>
  );
}
