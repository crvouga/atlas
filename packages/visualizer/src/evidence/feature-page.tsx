import type { CheckSlot, SpecEvidence } from '@crvouga/atlas/reports/evidence-view';
import { Alert, Box, Container, List, Stack, Text, Title } from '@mantine/core';
import { useMemo } from 'react';
import type { SpecKind } from '../spec-kind';
import { CheckDetail, PlainSteps, ResultRow, type CheckSelection, type SelectCheck } from './check-detail';
import { featureModel, scenarioLabel, slotsByScenario, type FeatureModel, type FeatureScenario } from './gherkin';
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
function parse(text: string): {
  feature: FeatureModel | null;
  error: string | null;
} {
  try {
    return { feature: featureModel(text), error: null };
  } catch (error) {
    return { feature: null, error: error instanceof Error ? error.message : String(error) };
  }
}
/** A feature read as its rules and scenarios, each scenario with what was recorded when it ran. */
export function FeaturePage({ file, text, kind, entry, selection, select }: Props) {
  const { feature, error } = useMemo(() => parse(text), [text]);
  const slots = entry?.slots ?? [];
  const runningOnly = useRunningFilter();
  const filed = useMemo(
    () => (feature ? slotsByScenario(feature, slots) : { byScenario: new Map<string, CheckSlot[]>(), leftOver: slots }),
    [feature, slots]
  );
  const scenarios = feature?.rules.flatMap((rule) => rule.scenarios.filter((scenario) => !scenario.background)) ?? [];
  const planned =
    scenarios.reduce((count, scenario) => count + Math.max(1, filed.byScenario.get(scenario.name)?.length ?? 0), 0) + filed.leftOver.length;
  const toggle = (id: string) => select({ check: selection.check === id ? null : id, layer: null });
  const rows = (scenario: FeatureScenario) => {
    const written = <PlainSteps steps={scenario.steps} examples={scenario.examples} />;
    const recorded = (filed.byScenario.get(scenario.name) ?? []).filter((slot) => !runningOnly || slot.status === 'running');
    if (!recorded.length) {
      if (runningOnly) return null;
      const id = `scenario:${scenario.name}`;
      return (
        <ResultRow key={id} label={scenario.name} slot={null} open={selection.check === id} onToggle={() => toggle(id)}>
          <Text component="div" c="dimmed">
            No completed test report for this scenario yet.
          </Text>
          {written}
        </ResultRow>
      );
    }
    return recorded.map((slot) => (
      <ResultRow
        key={slot.key}
        label={scenarioLabel(feature!.name, slot.title)}
        slot={slot}
        open={selection.check === slot.id}
        onToggle={() => toggle(slot.id)}
      >
        <CheckDetail
          slot={slot}
          layerId={selection.check === slot.id ? selection.layer : undefined}
          select={(patch) => select({ check: slot.id, ...patch })}
          reads="steps"
          written={written}
        />
      </ResultRow>
    ));
  };
  return (
    <Container component="article" size="xl" w="100%" py="xl">
      <SpecHeader
        title={feature?.name || file.split('/').at(-1)!}
        file={file}
        kind={kind}
        entry={entry}
        planned={feature ? planned : undefined}
      >
        {feature?.description && (
          <Text component="div" c="dimmed">
            {feature.description}
          </Text>
        )}
      </SpecHeader>
      <SourceText text={text} file={file} withResults />
      <Box component="section" id="spec-results" aria-label="Recorded results" tabIndex={-1}>
        <TestFilter slots={slots} />
        {error && (
          <Alert role="alert" color={'red'} my="sm">
            This feature could not be parsed: {error}
          </Alert>
        )}
        {feature?.rules.map((rule, index) => (
          <Box key={index} component="section" mb="lg">
            {rule.name !== null && (
              <Title order={2} mb="sm">
                {rule.name}
              </Title>
            )}
            {rule.description && (
              <Text component="div" c="dimmed">
                {rule.description}
              </Text>
            )}
            {rule.scenarios
              .filter((scenario) => scenario.background)
              .map((scenario, at) => (
                <Stack key={at} gap="sm" miw={0}>
                  <Text component="div" c="dimmed">
                    Before each scenario{scenario.name ? `: ${scenario.name}` : ''}
                  </Text>
                  <PlainSteps steps={scenario.steps} />
                </Stack>
              ))}
            <List spacing="xs" listStyleType="none">
              {rule.scenarios.filter((scenario) => !scenario.background).map(rows)}
            </List>
          </Box>
        ))}
        {filed.leftOver.some((slot) => !runningOnly || slot.status === 'running') && (
          <Box component="section" mb="lg">
            <Title order={2} mb="sm">
              {feature ? 'Other recorded results' : 'Recorded results'}
            </Title>
            {feature && (
              <Text component="div" c="dimmed">
                Recorded against this file under a name no scenario has now.
              </Text>
            )}
            <List spacing="xs" listStyleType="none">
              <Bounded items={filed.leftOver.filter((slot) => !runningOnly || slot.status === 'running')} size={40} more="More results">
                {(slot) => (
                  <ResultRow
                    key={slot.key}
                    label={feature ? scenarioLabel(feature.name, slot.title) : slot.title}
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
          </Box>
        )}
      </Box>
    </Container>
  );
}
