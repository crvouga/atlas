/**
 * @module About this deployment
 *
 * Which viewer and which server are running, side by side: each build's version, source revision and build time (and the
 * server's image digest when the deployment supplied it), `unknown` where a build did not record one. A viewer and a server
 * deployed separately are named separately, never folded into one version. A copyable support summary carries only those
 * provenance facts (see `provenance.ts`). The server is asked only while the dialog is open.
 */
import { Alert, Button, CopyButton, Group, Modal, Skeleton, Stack, Table, Text, Title } from '@mantine/core';
import { IconCheck, IconCopy } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';

import { serverInfoUrl } from '../runtime';
import { differentRevisions, known, serverBuild, supportSummary, viewerBuild, type BuildFacts, type ServerFacts } from './provenance';

function BuildTable({ label, build, digest }: { label: string; build: BuildFacts; digest: boolean }) {
  const rows: [string, string | null][] = [['Version', build.version], ['Revision', build.revision], ['Built', build.builtAt], ...(digest ? [['Image digest', build.imageDigest ?? null] as [string, string | null]] : [])];
  return (
    <Table.ScrollContainer minWidth={420}>
    <Table aria-label={label} variant="vertical" withTableBorder>
      <Table.Tbody>
        {rows.map(([name, value]) => (
          <Table.Tr key={name}>
            <Table.Th w={130}>{name}</Table.Th>
            <Table.Td c={value ? undefined : 'dimmed'}>{known(value)}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
    </Table.ScrollContainer>
  );
}

/** The About dialog, opened from the header's view options. */
export function AboutDialog({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const url = serverInfoUrl();
  const info = useQuery({
    queryKey: ['server-info', url],
    enabled: opened && !!url,
    retry: false,
    staleTime: 30_000,
    queryFn: async ({ signal }): Promise<ServerFacts> => {
      const response = await fetch(url!, { signal, cache: 'no-store' });
      if (!response.ok) throw new Error(`The server could not be asked (${response.status}).`);
      return (await response.json()) as ServerFacts;
    }
  });
  const viewer = viewerBuild();
  const server = info.data ? serverBuild(info.data) : null;
  const summary = supportSummary(viewer, { reachable: !!url, info: info.data ?? null });
  return (
    <Modal opened={opened} onClose={onClose} title="About this deployment" size="lg" closeButtonProps={{ 'aria-label': 'Close about' }}>
      <Stack gap="md">
        <Stack gap="xs">
          <Title order={3}>Viewer</Title>
          <BuildTable label="Viewer build" build={viewer} digest={false} />
        </Stack>
        <Stack gap="xs">
          <Title order={3}>Server</Title>
          {!url && <Text c="dimmed" role="status">No server: this viewer reads a static export or a store directly.</Text>}
          {url && info.isPending && <Stack gap="xs" role="status" aria-label="Asking the server"><Skeleton h={14} /><Skeleton h={14} /><Skeleton h={14} /></Stack>}
          {url && info.isError && (
            <Alert role="alert" color="red" title="The server could not be asked">
              <Group gap="sm">
                <Text span inherit>{info.error.message}</Text>
                <Button type="button" variant="subtle" onClick={() => void info.refetch()}>Try again</Button>
              </Group>
            </Alert>
          )}
          {server && <BuildTable label="Server build" build={server} digest />}
          {server && differentRevisions(viewer, server) && (
            <Text c="dimmed" size="sm" role="status">The viewer and the server were built from different revisions; each is shown as it is.</Text>
          )}
        </Stack>
        <Group justify="space-between" gap="sm">
          <Text c="dimmed" size="sm" maw={360}>The support summary holds only these build facts: no tokens, storage settings or project data.</Text>
          <CopyButton value={summary}>
            {({ copied, copy }) => (
              <Button type="button" onClick={copy} leftSection={copied ? <IconCheck size={16} aria-hidden="true" /> : <IconCopy size={16} aria-hidden="true" />}>
                {copied ? 'Copied' : 'Copy support summary'}
              </Button>
            )}
          </CopyButton>
        </Group>
      </Stack>
    </Modal>
  );
}
