import { IconArrowLeft } from '@tabler/icons-react';
import { ServerEditableSettingsSchema } from '@crvouga/atlas/schema';
/** @module Server settings interface
 * Administrator credentials live only in this component; the server validates every request.
 */
import {
  Accordion,
  Alert,
  Anchor,
  AppShell,
  Badge,
  Box,
  Button,
  Code,
  Container,
  Fieldset,
  Group,
  JsonInput,
  NativeSelect,
  NumberInput,
  PasswordInput,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Title
} from '@mantine/core';
import { useState } from 'react';

type Settings = Record<string, unknown>;
type Backend = { id: string; label?: string; url: string; write?: boolean };
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
  storage: [
    { id: 'data', label: 'Local data folder', path: ['data'], description: 'Relative paths start from the server configuration directory.' }
  ],
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
  const backends = (draft.backends as Backend[] | undefined) ?? [];
  const changeBackend = (index: number, patch: Partial<Backend>) =>
    change({ ...draft, backends: backends.map((b, i) => (i === index ? { ...b, ...patch } : b)) });
  const request = async (method: 'GET' | 'PUT') => {
    if (busy || (method === 'PUT' && (!revision || stale))) return;
    setBusy(true);
    if (method === 'GET') setRevision(undefined);
    try {
      const headers: Record<string, string> = token ? { authorization: `Bearer ${token}` } : {};
      let body: string | undefined;
      if (method === 'PUT') {
        const parsed = JSON.parse(json);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Settings must be a JSON object.');
        headers['content-type'] = 'application/json';
        headers['if-match'] = `"${revision}"`;
        body = JSON.stringify(parsed);
      }
      const response = await fetch('/api/settings', { method, headers, body, cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 409 || response.status === 428) setStale(true);
        throw new Error(data.detail || data.error || `Request failed (${response.status})`);
      }
      setRevision(data.revision);
      setStale(false);
      setActive(data.active);
      change(data.settings);
      setMessage({
        text:
          method === 'PUT' || data.restartRequired
            ? 'Saved. Restart Atlas to apply.'
            : 'Settings loaded. Blank fields use defaults after restart.',
        success: method === 'PUT' || data.restartRequired
      });
    } catch (error) {
      setMessage({
        text:
          error instanceof SyntaxError
            ? 'The JSON configuration is invalid. Fix it before saving.'
            : error instanceof Error
              ? error.message
              : String(error),
        error: true
      });
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
    <AppShell header={{ height: 64 }}>
      <AppShell.Header>
        <Group h="100%" px="lg" justify="space-between">
          <Group>
            <Anchor href={back} size="lg" fw={800}>
              Atlas
            </Anchor>
            <Text c="dimmed">Settings</Text>
          </Group>
          <Anchor href={back}>
            <Group gap="xs">
              <IconArrowLeft size={16} aria-hidden="true" />
              Back to reports
            </Group>
          </Anchor>
        </Group>
      </AppShell.Header>
      <AppShell.Main>
        <Container size="md" py="xl">
          <Stack gap="xl">
            <Box>
              <Title order={1}>Atlas server settings</Title>
              <Text c="dimmed" mt="xs">
                Configure how this Atlas node stores reports and tracks test runs. These settings apply to every project on this node.
              </Text>
            </Box>
            <Fieldset legend={<Group gap="xs">Administrator access {revision && <Badge color="green">Connected</Badge>}</Group>}>
              <Stack>
                <Text c="dimmed">
                  Enter an admin token to view and edit settings. For a local server without authentication, leave it blank.
                </Text>
                <PasswordInput
                  id="token"
                  label="Admin token"
                  autoComplete="off"
                  value={token}
                  onChange={(event) => setToken(event.currentTarget.value)}
                  description="Your token stays in this page and is never saved in browser storage."
                />
                <Button id="load" variant="filled" loading={busy} onClick={() => void request('GET')}>
                  {revision ? 'Reload settings' : 'Load settings'}
                </Button>
              </Stack>
            </Fieldset>
            {message && (
              <Alert
                id="status"
                color={message.error ? 'red' : message.success ? 'green' : 'blue'}
                role={message.error ? 'alert' : 'status'}
              >
                {message.text}
              </Alert>
            )}
            {revision && (
              <Box id="configuration">
                <Stack gap="lg">
                  <Alert title="Changes apply after a server restart.">
                    Environment variables and command-line flags can override saved settings. Current values are shown under each field.
                  </Alert>
                  <Box
                    component="form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void request('PUT');
                    }}
                  >
                    <Stack gap="lg">
                      <Fieldset legend="Storage" disabled={busy}>
                        <Stack>
                          {fields.storage!.map(input)}
                          <NativeSelect
                            id="write"
                            label="Upload destination"
                            description={`Current: ${active.write ?? 'data'}. Reports are read from all configured storage locations.`}
                            value={String(draft.write ?? '')}
                            onChange={(event) => {
                              const next = updated(draft, ['write'], event.currentTarget.value || undefined);
                              change({
                                ...next,
                                ...(draft.backends !== undefined ? { backends: backends.map(({ write, ...backend }) => backend) } : {})
                              });
                            }}
                          >
                            <option value="">Use default destination</option>
                            <option value="data">Local data folder</option>
                            {backends.map((backend, i) => (
                              <option key={i} value={backend.id}>
                                {backend.label || backend.id}
                              </option>
                            ))}
                            {typeof draft.write === 'string' && draft.write !== 'data' && !backends.some((b) => b.id === draft.write) && (
                              <option value={draft.write}>{draft.write}</option>
                            )}
                          </NativeSelect>
                          <Title order={3}>Additional storage</Title>
                          <Text c="dimmed">
                            Add a folder, S3-compatible bucket, or another Atlas server. Keep credentials in the server environment.
                          </Text>
                          {!backends.length && <Text c="dimmed">No additional storage configured. Atlas uses its local data folder.</Text>}
                          {backends.map((backend, i) => (
                            <Fieldset key={i} legend="Storage location">
                              <Stack gap="sm">
                                <TextInput
                                  label="Storage ID"
                                  required
                                  pattern="[a-z0-9-]+"
                                  value={backend.id}
                                  onChange={(event) => changeBackend(i, { id: event.currentTarget.value })}
                                />
                                <TextInput
                                  label="Display name (optional)"
                                  value={backend.label ?? ''}
                                  onChange={(event) => changeBackend(i, { label: event.currentTarget.value || undefined })}
                                />
                                <TextInput
                                  label="Location"
                                  required
                                  value={backend.url}
                                  placeholder="s3://reports/atlas"
                                  onChange={(event) => changeBackend(i, { url: event.currentTarget.value })}
                                />
                                <Button color="red" onClick={() => change({ ...draft, backends: backends.filter((_, at) => at !== i) })}>
                                  Remove
                                </Button>
                              </Stack>
                            </Fieldset>
                          ))}
                          <Button onClick={() => change({ ...draft, backends: [...backends, { id: '', url: '' }] })}>Add storage</Button>
                        </Stack>
                      </Fieldset>
                      <Fieldset legend="Live updates" disabled={busy}>
                        <SimpleGrid cols={{ base: 1, sm: 2 }}>{fields.live!.map(input)}</SimpleGrid>
                      </Fieldset>
                      <Fieldset legend="Report rules" disabled={busy}>
                        <Stack>{fields.rules!.map(input)}</Stack>
                      </Fieldset>
                      <Fieldset legend="Advanced" disabled={busy}>
                        <Stack>
                          <SimpleGrid cols={{ base: 1, sm: 2 }}>{fields.advanced!.map(input)}</SimpleGrid>
                          <Accordion variant="separated">
                            <Accordion.Item value="json">
                              <Accordion.Control>Edit configuration as JSON</Accordion.Control>
                              <Accordion.Panel>
                                <JsonInput
                                  id="settings"
                                  label="Storage and report settings (JSON)"
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
                              <Accordion.Control>View currently active settings</Accordion.Control>
                              <Accordion.Panel>
                                <Code block>{JSON.stringify(active, null, 2)}</Code>
                              </Accordion.Panel>
                            </Accordion.Item>
                          </Accordion>
                        </Stack>
                      </Fieldset>
                      <Group>
                        <Button id="save" type="submit" variant="filled" loading={busy} disabled={stale || !!jsonError}>
                          Save changes
                        </Button>
                        <Text size="xs" c="dimmed">
                          Saved to <Code>atlas.server.json</Code>. Restart Atlas to apply.
                        </Text>
                      </Group>
                    </Stack>
                  </Box>
                </Stack>
              </Box>
            )}
          </Stack>
        </Container>
      </AppShell.Main>
    </AppShell>
  );
}
