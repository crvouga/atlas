import type { SpecEvidence } from '@crvouga/atlas/reports/evidence-view';
import { Box, List, Stack } from '@mantine/core';
import { Panel } from '../components/Page';
import type { SpecKind } from '../spec-kind';
import { CheckDetail, ResultRow, type CheckSelection, type SelectCheck } from './check-detail';
import { DecisionTables } from './decision-table';
import { Bounded } from './marks';
import { SpecHeader } from './spec-header';
import { SourceText } from './source-text';
import { TestFilter, useRunningFilter } from './test-filter';
type Props = {
  file: string;
  text: string;
  kind: SpecKind;
  entry: SpecEvidence | undefined;
  selection: CheckSelection;
  select: SelectCheck;
};
/** A decision table, structure or objective: what it says, and each check recorded against it. */
export function DocumentPage({ file, text, kind, entry, selection, select }: Props) {
  const slots = entry?.slots ?? [];
  const runningOnly = useRunningFilter();
  const visible = slots.filter((slot) => !runningOnly || slot.status === 'running');
  const toggle = (id: string) => select({ check: selection.check === id ? null : id, layer: null });
  const name = file
    .split('/')
    .at(-1)!
    .replace(/\.[^.]+$/, '')
    .replace(/\.openslo$/, '');
  return (
    <Stack component="article" gap="md">
      <SpecHeader title={name} file={file} kind={kind} entry={entry} />
      <SourceText text={text} file={file} withResults />
      <Box component="section" id="spec-results" aria-label="Recorded results" tabIndex={-1}>
        <Stack gap="md">
          {(slots.length > 0 || runningOnly) && (
            <Panel component="section" title={visible.length > 0 ? 'Checks' : undefined} actions={<TestFilter slots={slots} />}>
              {visible.length > 0 && (
                <List spacing="xs" listStyleType="none">
                  <Bounded items={visible} size={40} more="More checks">
                    {(slot) => (
                      <ResultRow
                        key={slot.key}
                        label={slot.title}
                        slot={slot}
                        open={selection.check === slot.id}
                        onToggle={() => toggle(slot.id)}
                      >
                        <CheckDetail
                          slot={slot}
                          layerId={selection.check === slot.id ? selection.layer : undefined}
                          select={(patch) => select({ check: slot.id, ...patch })}
                          reads="steps"
                        />
                      </ResultRow>
                    )}
                  </Bounded>
                </List>
              )}
            </Panel>
          )}
          {kind.id === 'dmn' && <DecisionTables text={text} />}
        </Stack>
      </Box>
    </Stack>
  );
}
