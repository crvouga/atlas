import { PageCommandPalette } from '../find/PageCommandPalette';
import { IconAlertTriangle, IconArrowLeft, IconBraces, IconCircleCheck, IconDatabase, IconEye, IconInfoCircle, IconKey, IconLock, IconMap2 } from '@tabler/icons-react';
import { ServerEditableSettingsSchema } from '@crvouga/atlas/schema';
/** @module Server settings interface
 * Administrator credentials live only in this component; the server validates every request.
 */
import {
  Accordion,
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Card,
  Code,
  Container,
  Divider,
  Fieldset,
  Group,
  JsonInput,
  NativeSelect,
  NumberInput,
  Paper,
  PasswordInput,
  SimpleGrid,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  ThemeIcon
} from '@mantine/core';
import { useState } from 'react';
import { PageHeader, Panel } from '../components/Page';
import { GROUND } from '../ui/theme';

type Settings = Record<string, unknown>;
type GcPolicy = { enabled: boolean; maxAgeDays: number; keepLatest: number; intervalHours: number };
type GcRun = { project: string; dryRun: boolean; at: string; candidates: number; deletedLayers: number; deletedBlobs: number; keptLayers: number; error?: string };
/** What to suggest when no policy has been saved yet. Nothing is deleted until the person saves it with "Enabled" on. */
const SUGGESTED_POLICY: GcPolicy = { enabled: false, maxAgeDays: 90, keepLatest: 20, intervalHours: 24 };
type Field = {
  id: string;
  label: string;
  path: string[];
  description?: string;
  min?: number;
  max?: number;
  type?: 'number' | 'boolean' | 'branches';
};
const fields: Record<string, Field[]> = {
  live: [
    {
      id: 'runTimeoutSeconds',
      label: 'Missing heartbeat timeout (seconds)',
      path: ['runTimeoutSeconds'],
      type: 'number',
      min: 10,
      max: 3600,
      description: 'Interrupt a run when its producer stops checking in. Default: 30 seconds.'
    },
    {
      id: 'runStallSeconds',
      label: 'No-progress timeout (seconds)',
      path: ['runStallSeconds'],
      type: 'number',
      min: 0,
      max: 86400,
      description: 'Interrupt stalled runs. Use 0 to disable. Default: 900 seconds.'
    },
    {
      id: 'refreshSeconds',
      label: 'Storage refresh interval (seconds)',
      path: ['refreshSeconds'],
      type: 'number',
      min: 1,
      description: 'Check for reports written outside this node. Default: 10 seconds.'
    },
    {
      id: 'heartbeatSeconds',
      label: 'Client keepalive interval (seconds)',
      path: ['heartbeatSeconds'],
      type: 'number',
      min: 1,
      description: 'Keep browser connections open between updates. Default: 15 seconds.'
    }
  ],
  rules: [
    {
      id: 'outlineBranch',
      label: 'Preferred specification branch',
      path: ['outlineBranch'],
      description: 'Leave blank to prefer main, then master, then the newest available specs.'
    },
    {
      id: 'branches',
      label: 'Include branches',
      path: ['include', 'branches'],
      type: 'branches',
      description: 'Comma-separated branch names. Leave blank to include every branch.'
    },
    { id: 'ignoreModified', label: 'Results from modified checkouts', path: ['include', 'ignoreModified'], type: 'boolean' }
  ],
  advanced: [
    { id: 'maxObjectMiB', label: 'Maximum upload size (MiB)', path: ['limits', 'maxObjectMiB'], type: 'number', min: 0.001 },
    { id: 'maxJsonMiB', label: 'Maximum JSON size (MiB)', path: ['limits', 'maxJsonMiB'], type: 'number', min: 0.001 },
    { id: 'maxStreams', label: 'Maximum live connections', path: ['limits', 'maxStreams'], type: 'number', min: 1 },
    { id: 'log', label: 'Request logging', path: ['log'], type: 'boolean' }
  ]
};
function at(value: Settings, path: string[]): unknown {
  return path.reduce<unknown>((held, key) => (held && typeof held === 'object' ? (held as Settings)[key] : undefined), value);
}
function updated(draft: Settings, path: string[], value: unknown): Settings {
  const next = structuredClone(draft);
  let held = next;
  for (const key of path.slice(0, -1)) {
    held[key] = held[key] && typeof held[key] === 'object' ? held[key] : {};
    held = held[key] as Settings;
  }
  if (value === undefined) delete held[path.at(-1)!];
  else held[path.at(-1)!] = value;
  for (const key of ['include', 'limits']) if (next[key] && !Object.keys(next[key] as object).length) delete next[key];
  return next;
}
/** Complete settings editor with revision conflicts, raw JSON, default values, and storage selection. */
export function SettingsPage() {
  const [token, setToken] = useState('');
  const [revision, setRevision] = useState<string>();
  const [draft, setDraft] = useState<Settings>({});
  const [active, setActive] = useState<Settings>({});
  const [json, setJson] = useState('{}');
  const [jsonError, setJsonError] = useState('');
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean; success?: boolean }>();
  const params = new URLSearchParams(window.location.search);
  const project = params.get('project');
  const back =
    project && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(project) && project.length <= 64
      ? `/?project=${encodeURIComponent(project)}#/`
      : '/';
  const change = (next: Settings) => {
    setDraft(next);
    setJson(JSON.stringify(next, null, 2));
    setJsonError('');
  };
  const [policy, setPolicy] = useState<GcPolicy>(SUGGESTED_POLICY);
  const [policySaved, setPolicySaved] = useState(false);
  const [runs, setRuns] = useState<GcRun[]>([]);
  const [preview, setPreview] = useState<GcRun[]>();
  const authorization = (): Record<string, string> => (token ? { authorization: `Bearer ${token}` } : {});
  const failure = (error: unknown) =>
    setMessage({
      text:
        error instanceof SyntaxError
          ? 'The JSON configuration is invalid. Fix it before saving.'
          : error instanceof Error
            ? error.message
            : String(error),
      error: true
    });
  const readJson = async (response: Response) => {
    const data = await response.json();
    if (!response.ok) {
      if (response.status === 409 || response.status === 428) setStale(true);
      throw new Error(data.detail || data.error || `Request failed (${response.status})`);
    }
    return data;
  };
  const applyGc = (data: { revision: string; policy: GcPolicy | null; saved: boolean; lastRuns: GcRun[] }) => {
    setPolicy(data.policy ?? SUGGESTED_POLICY);
    setPolicySaved(data.saved);
    setRuns(data.lastRuns);
  };
  /** The garbage collection policy lives in the user state in S3: this reads and writes it through the server, never the browser. */
  const gcRequest = async (action: 'save' | 'preview') => {
    if (busy || !revision || (action === 'save' && stale)) return;
    setBusy(true);
    try {
      if (action === 'save') {
        const data = await readJson(
          await fetch('/api/settings/gc', {
            method: 'PUT',
            headers: { ...authorization(), 'content-type': 'application/json', 'if-match': `"${revision}"` },
            body: JSON.stringify(policy),
            cache: 'no-store'
          })
        );
        setRevision(data.revision);
        setStale(false);
        applyGc(data);
        setMessage({
          text: data.policy.enabled
            ? 'Garbage collection policy saved to S3. It applies on the next scheduled pass.'
            : 'Garbage collection policy saved to S3 but disabled: nothing will be deleted.',
          success: true
        });
      } else {
        const data = await readJson(
          await fetch('/api/settings/gc/run?dryRun=1', { method: 'POST', headers: authorization(), cache: 'no-store' })
        );
        setPreview(data.runs);
        setMessage({ text: 'Preview finished. Nothing was deleted.' });
      }
    } catch (error) {
      failure(error);
    } finally {
      setBusy(false);
    }
  };
  const request = async (method: 'GET' | 'PUT') => {
    if (busy || (method === 'PUT' && (!revision || stale))) return;
    setBusy(true);
    if (method === 'GET') setRevision(undefined);
    try {
      const headers: Record<string, string> = authorization();
      let body: string | undefined;
      if (method === 'PUT') {
        const parsed = JSON.parse(json);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Settings must be a JSON object.');
        headers['content-type'] = 'application/json';
        headers['if-match'] = `"${revision}"`;
        body = JSON.stringify(parsed);
      }
      const data = await readJson(await fetch('/api/settings', { method, headers, body, cache: 'no-store' }));
      // After a load, read the policy too. After a save, the revision (of the whole user state) changed under it.
      const gc = method === 'GET' ? await readJson(await fetch('/api/settings/gc', { headers: authorization(), cache: 'no-store' })) : null;
      setRevision(gc ? gc.revision : data.revision);
      setStale(false);
      setActive(data.active);
      change(data.settings);
      if (gc) { applyGc(gc); setPreview(undefined); }
      setMessage({
        text:
          method === 'PUT' || data.restartRequired
            ? 'Saved. Restart Atlas to apply.'
            : 'Settings loaded. Blank fields use defaults after restart.',
        success: method === 'PUT' || data.restartRequired
      });
    } catch (error) {
      failure(error);
    } finally {
      setBusy(false);
    }
  };
  const input = (field: Field) => {
    const saved = at(draft, field.path),
      current = at(active, field.path);
    const description = (
      <>
        {field.description}
        {current !== undefined && (
          <Text component="span" display="block" size="xs">
            Current: {Array.isArray(current) ? current.join(', ') || 'All branches' : String(current)}
          </Text>
        )}
      </>
    );
    const props = { id: field.id, label: field.label, description };
    if (field.type === 'number')
      return (
        <NumberInput
          key={field.id}
          {...props}
          value={typeof saved === 'number' ? saved : ''}
          min={field.min}
          max={field.max}
          allowDecimal={field.id !== 'maxStreams'}
          onChange={(value) => change(updated(draft, field.path, value === '' ? undefined : Number(value)))}
        />
      );
    if (field.type === 'boolean')
      return (
        <NativeSelect
          key={field.id}
          {...props}
          value={saved === undefined ? '' : String(saved)}
          onChange={(event) =>
            change(updated(draft, field.path, event.currentTarget.value === '' ? undefined : event.currentTarget.value === 'true'))
          }
          data={
            field.id === 'ignoreModified'
              ? [
                  { value: '', label: 'Use default (include)' },
                  { value: 'false', label: 'Include' },
                  { value: 'true', label: 'Exclude' }
                ]
              : [
                  { value: '', label: 'Use default (enabled)' },
                  { value: 'true', label: 'Enabled' },
                  { value: 'false', label: 'Disabled' }
                ]
          }
        />
      );
    return (
      <TextInput
        key={field.id}
        {...props}
        value={Array.isArray(saved) ? saved.join(', ') : String(saved ?? '')}
        onChange={(event) => {
          const text = event.currentTarget.value;
          change(
            updated(
              draft,
              field.path,
              text === ''
                ? undefined
                : field.type === 'branches'
                  ? text
                      .split(',')
                      .map((item) => item.trim())
                      .filter(Boolean)
                  : text
            )
          );
        }}
      />
    );
  };
  return (
    <Box bg={GROUND} mih="100dvh">
      <Container size="md" px={{ base: 'sm', sm: 'md' }} py={{ base: 'sm', sm: 'md' }}>
        <Stack gap="md">
          <Paper component="header" withBorder shadow="xs" radius="lg" px="md" py="xs">
            <Group justify="space-between" wrap="nowrap" gap="xs">
              <Group gap="sm" wrap="nowrap">
                <Anchor href={back} c="inherit" fw={700} size="md" underline="never">
                  <Group gap={6} wrap="nowrap" component="span">
                    <IconMap2 size={20} aria-hidden="true" />
                    Atlas
                  </Group>
                </Anchor>
                <Divider orientation="vertical" visibleFrom="xs" />
                <Text c="dimmed" fw={500} visibleFrom="xs">
                  Settings
                </Text>
              </Group>
              <Group gap={4} wrap="nowrap">
                <PageCommandPalette />
                <Button component="a" href={back} variant="subtle" px={{ base: 'xs', sm: 'sm' }} leftSection={<IconArrowLeft size={16} aria-hidden="true" />}>
                  Back to reports
                </Button>
              </Group>
            </Group>
          </Paper>
          <Box component="main">
            <Stack gap="md">
              <Box px={{ base: 4, sm: 'xs' }} pt="xs">
                <PageHeader
                  title="Atlas server settings"
                  description="Define the garbage collection policy and configure how this Atlas node tracks test runs. Everything here is saved to S3 and applies to every project on this node."
                />
              </Box>
              <Panel
                component="section"
                aria-label="Administrator access"
                title="Administrator access"
                description="Enter an admin token to view and edit settings. For a local server without authentication, leave it blank."
                actions={
                  revision && (
                    <Badge color="green" leftSection={<IconCircleCheck size={12} aria-hidden="true" />}>
                      Connected
                    </Badge>
                  )
                }
              >
                <Group align="flex-start" gap="sm">
                  <PasswordInput
                    id="token"
                    label="Admin token"
                    autoComplete="off"
                    flex={1}
                    miw={{ base: '100%', xs: 260 }}
                    leftSection={<IconKey size={16} aria-hidden="true" />}
                    value={token}
                    onChange={(event) => setToken(event.currentTarget.value)}
                    description="Your token stays in this page and is never saved in browser storage."
                  />
                  {/* The input's label and description are two lines above the field; this lines the button up with the field. */}
                  <Button id="load" variant="filled" loading={busy} mt={{ base: 0, xs: 44 }} onClick={() => void request('GET')}>
                    {revision ? 'Reload settings' : 'Load settings'}
                  </Button>
                </Group>
              </Panel>
              {message && (
                <Alert
                  id="status"
                  color={message.error ? 'red' : message.success ? 'green' : 'blue'}
                  role={message.error ? 'alert' : 'status'}
                  icon={message.error ? <IconAlertTriangle size={18} aria-hidden="true" /> : message.success ? <IconCircleCheck size={18} aria-hidden="true" /> : <IconInfoCircle size={18} aria-hidden="true" />}
                >
                  {message.text}
                </Alert>
              )}
              {!revision && !message && (
                <Card>
                  <Stack align="center" gap="xs" py="xl" ta="center">
                    <ThemeIcon variant="light" color="gray" size={48} radius="xl">
                      <IconLock size={24} aria-hidden="true" />
                    </ThemeIcon>
                    <Text fw={600}>Settings are not loaded yet</Text>
                    <Text c="dimmed" maw={420}>
                      Load the settings to see storage, garbage collection, live updates, report rules and limits.
                    </Text>
                  </Stack>
                </Card>
              )}
              {revision && (
                <Box id="configuration">
                  <Stack gap="md">
                    <Alert color="gray" icon={<IconInfoCircle size={18} aria-hidden="true" />} title="Changes apply after a server restart.">
                      The configuration file, environment variables and command-line flags can override saved settings. Current values are shown under each field.
                    </Alert>
                    <Panel component="section" aria-label="Storage" title="Storage">
                      <Group gap="md" align="flex-start" wrap="nowrap">
                        <ThemeIcon variant="light" color="gray" size={36} radius="md" visibleFrom="xs">
                          <IconDatabase size={18} aria-hidden="true" />
                        </ThemeIcon>
                        <Stack gap="xs" flex={1} miw={0}>
                          <Text>
                            All reports and all user state, including the garbage collection policy below, are stored in S3-compatible
                            object storage and nowhere else. The bucket and credentials are set by the server&apos;s required{' '}
                            <Code>ATLAS_S3_*</Code> environment variables and cannot be changed here.
                          </Text>
                          <Text size="sm" c="dimmed">
                            The settings on this page are saved as JSON in the same bucket, in <Code>server/state.json</Code>.
                          </Text>
                        </Stack>
                      </Group>
                    </Panel>
                    <Box
                      id="garbage-collection"
                      component="form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void gcRequest('save');
                      }}
                    >
                      <Panel
                        component="section"
                        aria-label="Garbage collection"
                        title="Garbage collection"
                        description={
                          <Text size="sm" c="dimmed">
                            Only report layers that no longer decide any result (newer layers replaced all their checks) are ever deleted, and never
                            the newest layers you choose to keep. Everything else, including specs and runs, is kept.
                          </Text>
                        }
                      >
                        <Fieldset variant="unstyled" disabled={busy} p={0} m={0} bd={0} miw={0}>
                          <Stack gap="md">
                            {policySaved ? (
                              <Text size="sm" c="dimmed">
                                This policy is saved in S3 (<Code>server/state.json</Code>) and the server reads it from there each time it collects.
                              </Text>
                            ) : (
                              <Alert id="gc-empty" color="orange" icon={<IconAlertTriangle size={18} aria-hidden="true" />} title="No policy has been saved yet">
                                Garbage collection is off and nothing is deleted. The values below are suggestions; they take effect only after you
                                turn collection on and save.
                              </Alert>
                            )}
                            <Switch
                              id="gc-enabled"
                              label="Delete eligible layers on a schedule"
                              checked={policy.enabled}
                              onChange={(event) => setPolicy({ ...policy, enabled: event.currentTarget.checked })}
                            />
                            <SimpleGrid cols={{ base: 1, sm: 3 }}>
                              <NumberInput
                                id="gc-maxAgeDays"
                                label="Delete layers older than (days)"
                                min={1}
                                max={3650}
                                allowDecimal={false}
                                value={policy.maxAgeDays}
                                onChange={(value) => setPolicy({ ...policy, maxAgeDays: Number(value) })}
                              />
                              <NumberInput
                                id="gc-keepLatest"
                                label="Always keep the newest layers"
                                min={0}
                                allowDecimal={false}
                                value={policy.keepLatest}
                                onChange={(value) => setPolicy({ ...policy, keepLatest: Number(value) })}
                              />
                              <NumberInput
                                id="gc-intervalHours"
                                label="Run every (hours)"
                                min={1}
                                max={720}
                                value={policy.intervalHours}
                                onChange={(value) => setPolicy({ ...policy, intervalHours: Number(value) })}
                              />
                            </SimpleGrid>
                            {(preview ?? runs).length > 0 && (
                              <Table.ScrollContainer minWidth={480}>
                                <Table id="gc-runs">
                                  <Table.Caption>{preview ? 'Preview (nothing deleted)' : 'Last collection pass per project'}</Table.Caption>
                                  <Table.Thead>
                                    <Table.Tr>
                                      <Table.Th>Project</Table.Th>
                                      <Table.Th>{preview ? 'Would delete' : 'Deleted layers'}</Table.Th>
                                      <Table.Th>Kept layers</Table.Th>
                                      <Table.Th>Result</Table.Th>
                                    </Table.Tr>
                                  </Table.Thead>
                                  <Table.Tbody>
                                    {(preview ?? runs).map((run) => (
                                      <Table.Tr key={`${run.project}-${run.at}`}>
                                        <Table.Td>{run.project}</Table.Td>
                                        <Table.Td>{preview ? run.candidates : run.deletedLayers}</Table.Td>
                                        <Table.Td>{run.keptLayers}</Table.Td>
                                        <Table.Td>{run.error ? `Failed: ${run.error}` : `OK at ${run.at}`}</Table.Td>
                                      </Table.Tr>
                                    ))}
                                  </Table.Tbody>
                                </Table>
                              </Table.ScrollContainer>
                            )}
                            <Divider />
                            <Group gap="xs">
                              <Button id="gc-save" type="submit" variant="filled" loading={busy} disabled={stale}>
                                Save garbage collection policy
                              </Button>
                              <Button id="gc-preview" disabled={!policySaved} loading={busy} onClick={() => void gcRequest('preview')}>
                                Preview deletions
                              </Button>
                            </Group>
                          </Stack>
                        </Fieldset>
                      </Panel>
                    </Box>
                    <Box
                      component="form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void request('PUT');
                      }}
                    >
                      <Stack gap="md">
                        <Panel component="section" aria-label="Live updates" title="Live updates" description="When a run counts as interrupted, and how often this node and its viewers check in.">
                          <Fieldset variant="unstyled" disabled={busy} p={0} m={0} bd={0} miw={0}>
                            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md" verticalSpacing="md">{fields.live!.map(input)}</SimpleGrid>
                          </Fieldset>
                        </Panel>
                        <Panel component="section" aria-label="Report rules" title="Report rules" description="Which specs and which results the combined report is built from.">
                          <Fieldset variant="unstyled" disabled={busy} p={0} m={0} bd={0} miw={0}>
                            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md" verticalSpacing="md">{fields.rules!.map(input)}</SimpleGrid>
                          </Fieldset>
                        </Panel>
                        <Panel component="section" aria-label="Advanced" title="Advanced" description="Upload limits, live connections and request logging.">
                          <Fieldset variant="unstyled" disabled={busy} p={0} m={0} bd={0} miw={0}>
                            <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md" verticalSpacing="md">{fields.advanced!.map(input)}</SimpleGrid>
                          </Fieldset>
                        </Panel>
                        <Panel component="section" aria-label="Configuration as JSON" title="Configuration as JSON" description="The same settings as one document, and what the server is running with now.">
                          <Fieldset variant="unstyled" disabled={busy} p={0} m={0} bd={0} miw={0}>
                            <Accordion>
                              <Accordion.Item value="json">
                                <Accordion.Control icon={<IconBraces size={16} aria-hidden="true" />}>Edit configuration as JSON</Accordion.Control>
                                <Accordion.Panel>
                                  <JsonInput
                                    id="settings"
                                    label="Report and live-run settings (JSON)"
                                    autosize
                                    minRows={10}
                                    formatOnBlur
                                    value={json}
                                    error={jsonError || undefined}
                                    onChange={(value) => {
                                      setJson(value);
                                      try {
                                        const parsed = ServerEditableSettingsSchema.parse(JSON.parse(value));
                                        setDraft(parsed);
                                        setJsonError('');
                                      } catch {
                                        setJsonError('Settings must be a valid JSON object.');
                                      }
                                    }}
                                  />
                                </Accordion.Panel>
                              </Accordion.Item>
                              <Accordion.Item value="active">
                                <Accordion.Control icon={<IconEye size={16} aria-hidden="true" />}>View currently active settings</Accordion.Control>
                                <Accordion.Panel>
                                  <Code block>{JSON.stringify(active, null, 2)}</Code>
                                </Accordion.Panel>
                              </Accordion.Item>
                            </Accordion>
                          </Fieldset>
                        </Panel>
                        <Card padding="md">
                          <Group justify="space-between" gap="sm">
                            <Text size="xs" c="dimmed">
                              Saved to S3 (<Code>server/state.json</Code>). Restart Atlas to apply.
                            </Text>
                            <Button id="save" type="submit" variant="filled" loading={busy} disabled={stale || !!jsonError}>
                              Save changes
                            </Button>
                          </Group>
                        </Card>
                      </Stack>
                    </Box>
                  </Stack>
                </Box>
              )}
            </Stack>
          </Box>
        </Stack>
      </Container>
    </Box>
  );
}
