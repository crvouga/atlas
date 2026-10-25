import type { SpecEvidence } from '@crvouga/atlas/reports/evidence-view';
import { Anchor, Box, Code, Container, List, Title } from '@mantine/core';
import { useMemo } from 'react';
import type { SpecKind } from '../spec-kind';
import { CheckDetail, ResultRow, type CheckSelection, type SelectCheck } from './check-detail';
import { Bounded } from './marks';
import { QUINT_GROUPS, quintOutline } from './quint';
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
/** A model read as its state and actions, with every trace that was replayed against the app. */
export function ModelPage({ file, text, kind, entry, selection, select }: Props) {
  const items = useMemo(() => quintOutline(text), [text]);
  const moduleName = items.find((item) => item.kind === 'module')?.name;
  const slots = useMemo(
    () => [...(entry?.slots ?? [])].sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true })),
    [entry]
  );
  const runningOnly = useRunningFilter();
  const visible = slots.filter((slot) => !runningOnly || slot.status === 'running');
  const toggle = (id: string) => select({ check: selection.check === id ? null : id, layer: null });
  const label = (title: string) => (moduleName && title.startsWith(`${moduleName} · `) ? title.slice(moduleName.length + 3) : title);
  return (
    <Container component="article" size="xl" w="100%" py="xl">
      <SpecHeader title={moduleName ?? file.split('/').at(-1)!} file={file} kind={kind} entry={entry} />
      <SourceText text={text} file={file} withResults />
      <Box component="section" id="spec-results" aria-label="Recorded results" tabIndex={-1}>
        <TestFilter slots={slots} />
        {visible.length > 0 && (
          <Box component="section" mb="lg">
            <Title order={2} mb="sm">
              Traces
            </Title>
            <List spacing="xs" listStyleType="none">
              <Bounded items={visible} size={40} more="More traces">
                {(slot) => (
                  <ResultRow
                    key={slot.key}
                    label={label(slot.title)}
                    slot={slot}
                    open={selection.check === slot.id}
                    onToggle={() => toggle(slot.id)}
                  >
                    <CheckDetail
                      slot={slot}
                      layerId={selection.check === slot.id ? selection.layer : undefined}
                      select={(patch) => select({ check: slot.id, ...patch })}
                      reads="trace"
                    />
                  </ResultRow>
                )}
              </Bounded>
            </List>
          </Box>
        )}
        {QUINT_GROUPS.map((group) => {
          const declared = items.filter((item) => item.kind === group.kind);
          if (!declared.length) return null;
          return (
            <Box key={group.kind} component="section" mb="lg">
              <Title order={2} mb="sm">
                {group.label}
              </Title>
              <List spacing="xs" listStyleType="none">
                {declared.map((item) => (
                  <List.Item key={item.line}>
                    <Anchor
                      href={`#line-${item.line}`}
                      onClick={(event) => {
                        event.preventDefault();
                        const leading = (text.match(/^(?:[^\S\r\n]*\r?\n)+/)?.[0].match(/\n/g) ?? []).length;
                        const line = document.getElementById(`line-${item.line - leading}`) ?? document.querySelector('[data-source]');
                        line?.scrollIntoView({ block: 'center' });
                      }}
                    >
                      <Code>{item.text}</Code>
                    </Anchor>
                  </List.Item>
                ))}
              </List>
            </Box>
          );
        })}
      </Box>
    </Container>
  );
}
