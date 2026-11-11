import { CodeHighlightAdapterProvider, CodeHighlightTabs } from '@mantine/code-highlight';
import { Box, Button, Text } from '@mantine/core';
import { IconArrowDown } from '@tabler/icons-react';
import { Panel } from '../components/Page';
import { specHighlightAdapter, specLanguage } from '../ui/highlight';

/** The written specification is primary: complete, expanded and highlighted, with Mantine code controls. */
export function SourceText({ text, file, withResults = false }: { text: string; file: string; withResults?: boolean }) {
  return (
    <Box component="section" data-source aria-label={`Source of ${file}`} miw={0}>
      <Panel
        title="Source"
        actions={
          withResults && (
            <Button
              variant="subtle"
              size="compact-sm"
              rightSection={<IconArrowDown size={14} aria-hidden="true" />}
              onClick={() => {
                const results = document.getElementById('spec-results');
                results?.scrollIntoView({ block: 'start' });
                results?.focus({ preventScroll: true });
              }}
            >
              Recorded results
            </Button>
          )
        }
      >
        {text ? (
          <CodeHighlightAdapterProvider adapter={specHighlightAdapter}>
            <CodeHighlightTabs code={[{ fileName: file, code: text, language: specLanguage(file) }]} copyLabel={`Copy ${file}`} />
          </CodeHighlightAdapterProvider>
        ) : (
          <Text c="dimmed">This source file is empty.</Text>
        )}
      </Panel>
    </Box>
  );
}
