import { PHONE_H, PHONE_W } from '@crvouga/atlas/reports/phone';
import type { ReportSnapshotBlob, ReportStepHit } from '@crvouga/atlas/reports/report-types';
import { createSnapshotHost, paintSnapshotHost, type HitResult } from '@crvouga/atlas/reports/snapshot-surface';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';

import { reportResponse } from './api';
import styles from './recording.module.css';
import { traceStates } from './quint';
import { ModelTrace } from './model-trace';

const SCALE = 0.72;

async function readBlob(url: string, blob: ReportSnapshotBlob, signal: AbortSignal) {
  const response = await reportResponse(url, signal);
  if (blob.media !== 'png' && blob.media !== 'bytes') return response.text();
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return `data:${response.headers.get('content-type') ?? 'application/octet-stream'};base64,${btoa(binary)}`;
}

/**
 * A captured page, placed in this page as it was recorded. It sits in a shadow tree so its
 * stylesheet and the viewer's never restyle each other; there is no frame to load.
 */
export function SnapshotPicture({ file, html, css, hit, who }: { file: string; html: string; css: string; hit: ReportStepHit | null; who: string }) {
  const frame = useRef<HTMLDivElement>(null);
  const [found, setFound] = useState<HitResult>('none');
  useEffect(() => {
    const parent = frame.current;
    if (!parent) return;
    const host = parent.querySelector<HTMLDivElement>(':scope > .sr-snap') ?? parent.appendChild(createSnapshotHost());
    host.style.transform = `scale(${SCALE})`;
    host.style.transformOrigin = 'top left';
    setFound(paintSnapshotHost(host, { key: file, html, css }, hit));
  }, [file, html, css, hit]);
  return (
    <>
      <div ref={frame} className={styles.phone} role="img" aria-label={`Recorded ${who}`} style={{ width: PHONE_W * SCALE, height: PHONE_H * SCALE }} />
      {found === 'missing' && <p className={styles.quietLine}>The recorded control cannot be found in this picture.</p>}
    </>
  );
}

/** One captured picture or value, exactly as recorded. */
export function Snapshot({ url, blob, css, hit, earlier = false }: { url: string; blob: ReportSnapshotBlob; css: string; hit: ReportStepHit | null; earlier?: boolean }) {
  const content = useQuery({ queryKey: ['evidence-blob', url], queryFn: ({ signal }) => readBlob(url, blob, signal), retry: false });
  const who = blob.nodeId ?? blob.name;
  const picture = blob.media === 'html' || blob.media === 'png';
  return (
    <figure className={styles.snapshot} data-picture={picture || undefined}>
      <figcaption>
        <strong>{who}</strong>
        {blob.nodeId && blob.name !== blob.nodeId && <span>{blob.name}</span>}
        {earlier && <span className={styles.earlier}>Earlier picture</span>}
      </figcaption>
      {content.isPending && <p className={styles.quietLine} role="status">Loading…</p>}
      {content.isError && (
        <p role="alert" className={styles.quietLine}>
          {content.error.message}{' '}
          <button type="button" className={styles.link} onClick={() => void content.refetch()}>Try again</button>
        </p>
      )}
      {content.data !== undefined && blob.media === 'html' && <SnapshotPicture file={blob.file} html={content.data} css={css} hit={hit} who={who} />}
      {content.data !== undefined && blob.media === 'png' && <img className={styles.image} alt={`Recorded ${who}`} src={content.data} />}
      {content.data !== undefined && blob.media === 'bytes' && <a download={blob.file.split('/').at(-1)} href={content.data}>Download captured data</a>}
      {content.data !== undefined && (blob.media === 'json' || blob.media === 'text') && <SnapshotData text={content.data} />}
    </figure>
  );
}

/** A recorded value: a model trace when it is one, otherwise its fields. */
export function SnapshotData({ text }: { text: string }) {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return <pre className={styles.pre}>{text}</pre>;
  }
  const states = traceStates(value);
  return states ? <ModelTrace states={states} /> : <DataValue value={value} />;
}

function DataValue({ value }: { value: unknown }) {
  if (value === null || typeof value !== 'object') return <code>{JSON.stringify(value)}</code>;
  const entries = Object.entries(value);
  if (!entries.length) return <code>{Array.isArray(value) ? '[]' : '{}'}</code>;
  return (
    <dl className={styles.data}>
      {entries.map(([key, item]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>
            {item !== null && typeof item === 'object' ? (
              <details>
                <summary>{Array.isArray(item) ? `${item.length} items` : `${Object.keys(item).length} fields`}</summary>
                <DataValue value={item} />
              </details>
            ) : (
              <DataValue value={item} />
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
