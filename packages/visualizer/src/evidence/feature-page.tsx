import type { CheckSlot, SpecEvidence } from '@crvouga/atlas/reports/evidence-view';
import { Alert, Box, Container, List, Stack, Text, Title } from '@mantine/core';
import { useMemo } from 'react';
import { outlinePath, type SpecKind } from '../spec-kind';
import { CheckDetail, PlainSteps, ResultRow, type CheckSelection, type SelectCheck } from './check-detail';
import { behaviorOf, coverageCounts, scenarioBehaviors, type Behavior, type RevisionSource } from './behavior';
import { BehaviorPanel, CoverageBadge, CoverageSummary } from './behavior-panel';
import { useEvidence } from './evidence-context';
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
    return {
      feature: null,
      error: error instanceof Error ? error.message : String(error)
    };
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
  const { specs, evidence } = useEvidence();
  const specPath = outlinePath(file);
  const revisions = useMemo<RevisionSource>(() => {
    const recorded = new Map(evidence.map((layer) => [layer.layer.id, layer.fingerprints[specPath]]));
    return {
      current: specs.find((spec) => spec.path === specPath)?.fingerprint ?? null,
      recorded: (id) => recorded.get(id)
    };
  }, [specs, evidence, specPath]);
  const behaviors = useMemo(() => {
    const byScenario = new Map<FeatureScenario, Behavior[]>();
    for (const scenario of feature?.rules.flatMap((rule) => rule.scenarios.filter((each) => !each.background)) ?? []) {
      byScenario.set(scenario, scenarioBehaviors(scenario, filed.byScenario.get(scenario.name) ?? [], feature!.name, revisions));
    }
    // A result no scenario claims is still a behavior that was checked, so it is counted.
    const stray: FeatureScenario = {
      keyword: 'Scenario',
      name: '',
      description: '',
      background: false,
      tags: [],
      steps: [],
      examples: []
    };
    const other = filed.leftOver.map((slot) => behaviorOf({ ...stray, name: slot.title }, slot, null, revisions, slot.key));
    return { byScenario, all: [...[...byScenario.values()].flat(), ...other] };
  }, [feature, filed, revisions]);
  const counts = useMemo(() => coverageCounts(behaviors.all), [behaviors]);
  const planned = behaviors.all.length;
  const toggle = (id: string) => select({ check: selection.check === id ? null : id, layer: null });
  const rows = (scenario: FeatureScenario) =>
    (behaviors.byScenario.get(scenario) ?? []).map((behavior) => {
      if (runningOnly && behavior.slot?.status !== 'running') return null;
      const { slot } = behavior;
      const written = <PlainSteps steps={scenario.steps} examples={scenario.examples} />;
      const id = slot ? slot.id : `scenario:${scenario.name}${behavior.example ? `:${behavior.example}` : ''}`;
      const label = slot
        ? scenarioLabel(feature!.name, slot.title)
        : behavior.example
          ? `${scenario.name} — ${behavior.example}`
          : scenario.name;
      return (
        <ResultRow
          key={id}
          label={label}
          slot={slot}
          badge={<CoverageBadge state={behavior.state} />}
          open={selection.check === id}
          onToggle={() => toggle(id)}
        >
          <BehaviorPanel
            behavior={behavior}
            start={selection.check === id && selection.layer ? 'inspect' : undefined}
            inspect={
              slot ? (
                <CheckDetail
                  slot={slot}
                  layerId={selection.check === id ? selection.layer : undefined}
                  select={(patch) => select({ check: id, ...patch })}
                  reads="steps"
                  written={written}
                />
              ) : (
                <>
                  <Text component="div" c="dimmed">
                    No completed test report for this scenario yet.
                  </Text>
                  {written}
                </>
              )
            }
          />
        </ResultRow>
      );
    });
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
      <CoverageSummary counts={counts} total={behaviors.all.length} />
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
                    Before each scenario
                    {scenario.name ? `: ${scenario.name}` : ''}
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
