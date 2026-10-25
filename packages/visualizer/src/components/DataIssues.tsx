import type { DataIssue } from '@crvouga/atlas/schema';
import { Alert, Button, Code, Drawer, Stack, Text, Title } from '@mantine/core';
import { useMemo } from 'react';
import { useUiStore } from '../state/ui-store';
const SEVERITY_LABEL = { error: 'Problem', warning: 'Warning', info: 'Note' } as const;
/** File-by-file diagnostics; unreadable data never appears as a passing result. */
export function DataIssues({ issues }: { issues: DataIssue[] }) {
  const open = useUiStore((s) => s.issuesOpen);
  const setOpen = useUiStore((s) => s.setIssuesOpen);
  const problems = issues.filter((i) => i.severity !== 'info').length;
  const groups = useMemo(() => {
    const byFile = new Map<string, DataIssue[]>();
    for (const issue of issues) byFile.set(issue.file, [...(byFile.get(issue.file) ?? []), issue]);
    return [...byFile].sort(([, a], [, b]) => severityRank(b) - severityRank(a));
  }, [issues]);
  if (!issues.length) return null;
  const label = problems
    ? `${problems} data ${problems === 1 ? 'problem' : 'problems'}`
    : `${issues.length} data ${issues.length === 1 ? 'note' : 'notes'}`;
  return (
    <>
      <Button color={problems ? 'orange' : 'gray'} onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Drawer opened={open} onClose={() => setOpen(false)} title="What we couldn’t read">
        <Stack>
          <Text c="dimmed">
            Everything else on the map is shown as usual. These are the parts of the spec and the runs that were skipped or guessed, file by
            file.
          </Text>
          {groups.map(([file, list]) => (
            <Stack key={file} gap="xs">
              <Title order={3}>{file || 'General'}</Title>
              {list.map((issue, i) => (
                <Alert
                  key={i}
                  color={issue.severity === 'error' ? 'red' : issue.severity === 'warning' ? 'orange' : 'blue'}
                  title={SEVERITY_LABEL[issue.severity]}
                >
                  {issue.path && <Code>{issue.path}</Code>} {issue.message}
                </Alert>
              ))}
            </Stack>
          ))}
        </Stack>
      </Drawer>
    </>
  );
}
function severityRank(list: DataIssue[]) {
  return Math.max(...list.map((i) => (i.severity === 'error' ? 2 : i.severity === 'warning' ? 1 : 0)));
}
