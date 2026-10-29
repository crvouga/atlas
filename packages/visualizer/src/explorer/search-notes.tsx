import { Alert, Button, Stack, Text } from '@mantine/core';
import { IconX } from '@tabler/icons-react';
/**
 * @module Search guidance
 *
 * What every search box in the explorer says beside its results, from one place: the filters typed in the box shown as
 * removable chips, the parts of the query that were not understood (never silently dropped), and whether meaning-based
 * matching is working, still refining, or off, so a search that is words only says so.
 */
import { withoutToken, type FilterKey, type ParsedSearch } from '../find/query';
import { semanticNote, type SemanticStatus } from '../find/semantic-search';

const FILTER_LABEL: Record<FilterKey, string> = {
  status: 'Status',
  env: 'Environment',
  producer: 'Producer',
  domain: 'Domain',
  spec: 'Spec',
  tag: 'Tag',
  branch: 'Branch',
  video: 'Has video'
};

/** The label of a typed filter chip: `Status: failed`, or `Has video`. */
export function filterLabel(key: FilterKey, value: string): string {
  return key === 'video' ? FILTER_LABEL.video : `${FILTER_LABEL[key]}: ${value}`;
}

/** The filters typed in the box, each a button that removes its text from the query. */
export function TypedFilters({ parsed, query, onChange }: { parsed: ParsedSearch; query: string; onChange: (next: string) => void }) {
  return (
    <>
      {parsed.tokens.map((token) => {
        const label = filterLabel(token.key, token.value);
        return (
          <Button key={`typed:${token.text}:${token.value}`} type="button" onClick={() => onChange(withoutToken(query, token))} aria-label={`Remove ${label}`} variant="light">
            {label}{' '}
            <Text aria-hidden="true" span inherit>
              <IconX size={16} aria-hidden="true" />
            </Text>
          </Button>
        );
      })}
    </>
  );
}

/** The parts of a query that could not be used, with what to type instead, and the meaning-based search's state. */
export function SearchNotes({ issues, semantic }: { issues: ParsedSearch['issues']; semantic: SemanticStatus }) {
  const note = semanticNote(semantic);
  return (
    <>
      {issues.length > 0 && (
        <Alert role="status" color="yellow" my="sm" title="Part of this search was not understood">
          <Stack gap="xs">
            {issues.map((issue) => (
              <Text key={issue.token + issue.message} size="sm">
                <Text span inherit fw={600}>
                  {issue.token}
                </Text>{' '}
                {issue.message}
              </Text>
            ))}
          </Stack>
        </Alert>
      )}
      {note && (
        <Text role="status" size="xs" c="dimmed">
          {note}
        </Text>
      )}
    </>
  );
}
