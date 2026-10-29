import {
  artifactRef,
  artifactTagsOf,
  displayTag,
  foldArtifactTags,
  hasArtifactTag,
  normalizeTag,
  normalizeTags,
  targetKey,
  type ArtifactTag,
  type ArtifactTagEntry,
  type ReviewerTag
} from '@crvouga/atlas/reports/artifact-tags';
import type { EvidenceHolder } from '@crvouga/atlas/reports/evidence-detail';
import type { Attachment } from '@crvouga/atlas/schema';
import { Alert, Badge, Button, Chip, CloseButton, Group, PasswordInput, Popover, Stack, Switch, Text, TextInput } from '@mantine/core';
import { IconTag } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { reportAssetUrl, reportJson, staticEvidence } from './api';
import { exactTime } from './format';

/** What the tags of attachments are filtered by: a tag, and whether tags inherited from the check and run count. */
type TagFilter = { readonly tag: string; readonly inherited: boolean };

type TagChange = { readonly add?: readonly string[]; readonly remove?: readonly string[] };

type TagsContext = {
  readonly layer: string;
  readonly check: string;
  readonly kind: string;
  readonly inherited: readonly string[];
  readonly reviewer: ReadonlyMap<string, readonly ReviewerTag[]>;
  /** True when the server records reviewer tags. Whether this visitor may is decided by the server when they try. */
  readonly editable: boolean;
  readonly filter: TagFilter | null;
  readonly setFilter: (filter: TagFilter | null) => void;
  readonly token: string;
  readonly setToken: (token: string) => void;
  readonly edit: (attachment: Attachment, change: TagChange) => Promise<void>;
};

const Tags = createContext<TagsContext | null>(null);

/** The tags an attachment shows here: its producer's, its reviewers' and those inherited from its check and run. */
function shownTags(attachment: Attachment, context: TagsContext | null): ArtifactTag[] {
  if (!context) return artifactTagsOf(attachment);
  const target = { layer: context.layer, check: context.check, kind: context.kind, artifact: artifactRef(attachment) };
  return artifactTagsOf(attachment, { reviewer: context.reviewer.get(targetKey(target)) ?? [], inherited: context.inherited });
}

/** Every attachment a holder carries, on its steps and attempts too. */
export function everyAttachment(holder: EvidenceHolder): Attachment[] {
  const out: Attachment[] = [...(holder.attachments ?? [])];
  for (const step of holder.steps ?? []) out.push(...(step.attachments ?? []));
  for (const attempt of holder.attempts ?? []) {
    out.push(...(attempt.attachments ?? []));
    for (const step of attempt.steps ?? []) out.push(...(step.attachments ?? []));
  }
  return out;
}

/** The reason a server gave for refusing a change (its problem document's `detail`), or a sentence naming the status. */
export async function readProblem(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { detail?: string; error?: string };
    return body.detail ?? body.error ?? `The server refused the change (${response.status}).`;
  } catch {
    return `The server refused the change (${response.status}).`;
  }
}

/**
 * Makes the tags of the attachments of one result live: reviewers' tags read from the server (when it has them),
 * the tags a result's attachments inherit from their check and run, the filter chosen by selecting a tag, and
 * the edit that records a reviewer's tag. Without this around them, attachments still show their producer's tags.
 */
export function ArtifactTagsProvider({ layer, kind, check, holders, children }: { layer: string; kind: string; check: string; holders: readonly EvidenceHolder[]; children: ReactNode }) {
  const client = useQueryClient();
  const [filter, setFilter] = useState<TagFilter | null>(null);
  const [token, setToken] = useState('');
  const overlay = useQuery({
    queryKey: ['artifact-tags'],
    queryFn: ({ signal }) => reportJson<{ entries: ArtifactTagEntry[] }>('/artifact-tags', signal),
    enabled: !staticEvidence,
    staleTime: 5000,
    retry: false
  });
  const reviewer = useMemo(() => foldArtifactTags(overlay.data?.entries ?? []), [overlay.data]);
  const inherited = useMemo(() => normalizeTags(holders.flatMap((holder) => holder.tags ?? [])), [holders]);
  const value = useMemo<TagsContext>(
    () => ({
      layer,
      check,
      kind,
      inherited,
      reviewer,
      editable: overlay.isSuccess,
      filter,
      setFilter,
      token,
      setToken,
      edit: async (attachment, change) => {
        const response = await fetch(reportAssetUrl('/artifact-tags'), {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify({ target: { layer, check, kind, artifact: artifactRef(attachment) }, ...change })
        });
        if (!response.ok) throw new Error(await readProblem(response));
        await client.invalidateQueries({ queryKey: ['artifact-tags'] });
      }
    }),
    [layer, check, kind, inherited, reviewer, overlay.isSuccess, filter, token, client]
  );
  return <Tags.Provider value={value}>{children}</Tags.Provider>;
}

/** The attachments that pass the chosen tag filter, or all of them when there is none. */
export function useFilteredAttachments(attachments: readonly Attachment[]): readonly Attachment[] {
  const context = useContext(Tags);
  const filter = context?.filter;
  if (!context || !filter) return attachments;
  return attachments.filter((attachment) => hasArtifactTag(shownTags(attachment, context), filter.tag, { inherited: filter.inherited }));
}

/** Says which tag the evidence is filtered by, how many attachments match, whether inherited tags count, and clears the filter. Nothing when no tag is chosen. */
export function TagFilterBar({ holders }: { holders: readonly EvidenceHolder[] }) {
  const context = useContext(Tags);
  const filter = context?.filter;
  if (!context || !filter) return null;
  const all = holders.flatMap(everyAttachment);
  const matching = all.filter((attachment) => hasArtifactTag(shownTags(attachment, context), filter.tag, { inherited: filter.inherited })).length;
  return (
    <Group aria-label="Tag filter" role="group" gap="sm" align="center">
      <Text role="status" component="div">
        {matching} of {all.length} {all.length === 1 ? 'attachment' : 'attachments'} tagged {displayTag(filter.tag)}
      </Text>
      <Switch
        label="Include tags inherited from the check and run"
        checked={filter.inherited}
        onChange={(event) => context.setFilter({ tag: filter.tag, inherited: event.currentTarget.checked })}
      />
      <Button type="button" variant="subtle" onClick={() => context.setFilter(null)}>
        Clear filter
      </Button>
    </Group>
  );
}

function Provenance({ tag }: { tag: ArtifactTag }) {
  if (tag.source === 'inherited')
    return (
      <Text span inherit c="dimmed">
        {' '}
        inherited
      </Text>
    );
  if (tag.source === 'reviewer')
    return (
      <Text span inherit c="dimmed">
        {' '}
        added by {tag.by}
        {tag.atMs !== undefined ? `, ${exactTime(tag.atMs)}` : ''}
      </Text>
    );
  return null;
}

function TagEditor({ attachment }: { attachment: Attachment }) {
  const context = useContext(Tags)!;
  const [opened, setOpened] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const normalized = normalizeTag(text);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (normalized === null || busy) return;
    setBusy(true);
    setError('');
    try {
      await context.edit(attachment, { add: [normalized] });
      setText('');
      setOpened(false);
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : 'The tag could not be saved.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Popover opened={opened} onChange={setOpened} position="bottom-start" trapFocus withArrow>
      <Popover.Target>
        <Button type="button" variant="subtle" size="compact-sm" leftSection={<IconTag size={16} aria-hidden="true" />} onClick={() => setOpened((now) => !now)}>
          Add tag
        </Button>
      </Popover.Target>
      <Popover.Dropdown>
        <form onSubmit={submit} aria-label={`Add a tag to ${attachment.name}`}>
          <Stack gap="sm">
            <TextInput
              label="Tag"
              description="demo and #demo are the same tag."
              value={text}
              onChange={(event) => setText(event.currentTarget.value)}
              data-autofocus
            />
            <PasswordInput
              label="Token"
              description="A token that may publish. Kept only in this tab. Not needed on a server without tokens."
              value={context.token}
              onChange={(event) => context.setToken(event.currentTarget.value)}
              autoComplete="off"
            />
            {error && (
              <Alert color="red" role="alert">
                {error}
              </Alert>
            )}
            <Group>
              <Button type="submit" variant="filled" loading={busy} disabled={normalized === null}>
                Save tag
              </Button>
            </Group>
          </Stack>
        </form>
      </Popover.Dropdown>
    </Popover>
  );
}

/**
 * The tags of one attachment, as chips under its card: `#demo` from its producer, from a reviewer (with who and
 * when) or inherited from its check and run (said so). Selecting a chip filters the evidence to the attachments
 * with that tag. A reviewer's tag can be removed, and any attachment tagged, when the server records reviewer tags.
 */
export function ArtifactTagList({ attachment }: { attachment: Attachment }) {
  const context = useContext(Tags);
  const error = useRemovalError();
  const tags = shownTags(attachment, context);
  if (!tags.length && !context?.editable) return null;
  return (
    <Stack gap="xs" aria-label={`Tags of ${attachment.name}`}>
      <Group gap="xs" align="center">
        {tags.map((tag) =>
          context ? (
            <Group key={tag.tag} gap={0} wrap="nowrap">
              <Chip
                size="xs"
                variant="light"
                checked={context.filter?.tag === tag.tag}
                onChange={() => context.setFilter(context.filter?.tag === tag.tag ? null : { tag: tag.tag, inherited: tag.source === 'inherited' })}
              >
                {displayTag(tag.tag)}
                <Provenance tag={tag} />
              </Chip>
              {tag.source === 'reviewer' && context.editable && (
                <CloseButton
                  size="sm"
                  aria-label={`Remove ${displayTag(tag.tag)} from ${attachment.name}`}
                  onClick={() => void context.edit(attachment, { remove: [tag.tag] }).catch((problem: unknown) => error.set(problem instanceof Error ? problem.message : 'The tag could not be removed.'))}
                />
              )}
            </Group>
          ) : (
            <Badge key={tag.tag} variant="light" tt="none">
              {displayTag(tag.tag)}
              <Provenance tag={tag} />
            </Badge>
          )
        )}
        {context?.editable && <TagEditor attachment={attachment} />}
      </Group>
      {error.message && (
        <Alert color="red" role="alert">
          {error.message}
        </Alert>
      )}
    </Stack>
  );
}

function useRemovalError() {
  const [message, set] = useState('');
  return { message, set };
}
