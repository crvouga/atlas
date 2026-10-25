import { CodeHighlightAdapterProvider, CodeHighlightTabs } from '@mantine/code-highlight';
import { Box, Button, Group, Text, Title } from '@mantine/core';
import { specHighlightAdapter, specLanguage } from '../ui/highlight';

/** The written specification is primary: complete, expanded and highlighted, with Mantine code controls. */
export function SourceText({ text, file, withResults = false }: { text: string; file: string; withResults?: boolean }) {
  return (
    <Box component="section" data-source aria-label={`Source of ${file}`} mb="lg" miw={0}>
      <Group justify="space-between" mb="sm">
        <Title order={2}>Source</Title>
        {withResults && (
          <Button
            variant="subtle"
            onClick={() => {
              const results = document.getElementById('spec-results');
              results?.scrollIntoView({ block: 'start' });
              results?.focus({ preventScroll: true });
            }}
          >
            Recorded results
          </Button>
        )}
      </Group>
      {text ? (
        <CodeHighlightAdapterProvider adapter={specHighlightAdapter}>
          <CodeHighlightTabs code={[{ fileName: file, code: text, language: specLanguage(file) }]} copyLabel={`Copy ${file}`} />
        </CodeHighlightAdapterProvider>
      ) : (
        <Text c="dimmed">This source file is empty.</Text>
      )}
    </Box>
  );
}
