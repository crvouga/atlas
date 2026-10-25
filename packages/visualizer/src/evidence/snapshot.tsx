import { PHONE_H, PHONE_W } from '@crvouga/atlas/reports/phone';
import type { ReportSnapshotBlob, ReportStepHit } from '@crvouga/atlas/reports/report-types';
import { createSnapshotHost, paintSnapshotHost, type HitResult } from '@crvouga/atlas/reports/snapshot-surface';
import { Accordion, Anchor, Box, Button, Code, Image, Stack, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { reportAssetUrl, reportResponse } from './api';
import { ModelTrace } from './model-trace';
import { traceStates } from './quint';
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
export function SnapshotPicture({
  file,
  html,
  css,
  hit,
  who
}: {
  file: string;
  html: string;
  css: string;
  hit: ReportStepHit | null;
  who: string;
}) {
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
      <Stack ref={frame} role="img" aria-label={`Recorded ${who}`} w={PHONE_W * SCALE} h={PHONE_H * SCALE} maw="100%" gap="sm" />
      {found === 'missing' && (
        <Text component="div" c="dimmed">
          The recorded control cannot be found in this picture.
        </Text>
      )}
    </>
  );
}
/** One captured picture or value, exactly as recorded. */
export function Snapshot({
  url,
  blob,
  css,
  hit,
  earlier = false
}: {
  url: string;
  blob: ReportSnapshotBlob;
  css: string;
  hit: ReportStepHit | null;
  earlier?: boolean;
}) {
  const content = useQuery({
    queryKey: ['evidence-blob', url],
    queryFn: ({ signal }) => readBlob(url, blob, signal),
    enabled: blob.media !== 'video',
    retry: false
  });
  const who = blob.nodeId ?? blob.name;
  const picture = blob.media === 'html' || blob.media === 'png' || blob.media === 'video';
  return (
    <Box data-picture={picture || undefined} component="figure" m={0}>
      <Box component="figcaption">
        <Text span inherit fw={600}>
          {who}
        </Text>
        {blob.nodeId && blob.name !== blob.nodeId && (
          <Text span inherit>
            {blob.name}
          </Text>
        )}
        {earlier && (
          <Text span inherit>
            Earlier picture
          </Text>
        )}
      </Box>
      {blob.media === 'video' && (
        <Box src={reportAssetUrl(url)} controls playsInline aria-label={`Recorded ${who}`} component="video" maw="100%" w="100%" />
      )}
      {blob.media !== 'video' && content.isPending && (
        <Text role="status" component="div" c="dimmed">
          Loading…
        </Text>
      )}
      {content.isError && (
        <Text role="alert" component="div" c="dimmed">
          {content.error.message}{' '}
          <Button type="button" onClick={() => void content.refetch()} variant="subtle">
            Try again
          </Button>
        </Text>
      )}
      {content.data !== undefined && blob.media === 'html' && (
        <SnapshotPicture file={blob.file} html={content.data} css={css} hit={hit} who={who} />
      )}
      {content.data !== undefined && blob.media === 'png' && <Image alt={`Recorded ${who}`} src={content.data} fit="contain" maw="100%" />}
      {content.data !== undefined && blob.media === 'bytes' && (
        <Anchor download={blob.file.split('/').at(-1)} href={content.data}>
          Download captured data
        </Anchor>
      )}
      {content.data !== undefined && (blob.media === 'json' || blob.media === 'text') && <SnapshotData text={content.data} />}
    </Box>
  );
}
/** A recorded value: a model trace when it is one, otherwise its fields. */
export function SnapshotData({ text }: { text: string }) {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return <Code block>{text}</Code>;
  }
  const states = traceStates(value);
  return states ? <ModelTrace states={states} /> : <DataValue value={value} />;
}
function DataValue({ value }: { value: unknown }) {
  if (value === null || typeof value !== 'object') return <Code>{JSON.stringify(value)}</Code>;
  const entries = Object.entries(value);
  if (!entries.length) return <Code>{Array.isArray(value) ? '[]' : '{}'}</Code>;
  return (
    <Box component="dl">
      {entries.map(([key, item]) => (
        <Stack key={key} gap="sm">
          <Box component="dt">{key}</Box>
          <Box component="dd" m={0}>
            {item !== null && typeof item === 'object' ? (
              <Accordion variant="separated" my="sm">
                <Accordion.Item value="content">
                  <Accordion.Control>
                    {Array.isArray(item) ? `${item.length} items` : `${Object.keys(item).length} fields`}
                  </Accordion.Control>
                  <Accordion.Panel>
                    <DataValue value={item} />
                  </Accordion.Panel>
                </Accordion.Item>
              </Accordion>
            ) : (
              <DataValue value={item} />
            )}
          </Box>
        </Stack>
      ))}
    </Box>
  );
}
