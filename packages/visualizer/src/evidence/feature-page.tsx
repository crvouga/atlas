import type { CheckSlot, SpecEvidence } from '@crvouga/atlas/reports/evidence-view';
import { useMemo } from 'react';

import type { SpecKind } from '../spec-kind';
import { CheckDetail, PlainSteps, ResultRow, type CheckSelection, type SelectCheck } from './check-detail';
import styles from './evidence.module.css';
import { featureModel, scenarioLabel, slotsByScenario, type FeatureModel, type FeatureScenario } from './gherkin';
import { Bounded } from './marks';
import { SourceText, SpecHeader } from './spec-header';
import { SpecSnapshot } from './spec-snapshot';

type Props = { file: string; text: string; kind: SpecKind; entry: SpecEvidence | undefined; selection: CheckSelection; select: SelectCheck };

function parse(text: string): { feature: FeatureModel | null; error: string | null } {
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
  const filed = useMemo(() => (feature ? slotsByScenario(feature, slots) : { byScenario: new Map<string, CheckSlot[]>(), leftOver: slots }), [feature, slots]);
  const scenarios = feature?.rules.flatMap((rule) => rule.scenarios.filter((scenario) => !scenario.background)) ?? [];
  const planned = scenarios.reduce((count, scenario) => count + Math.max(1, filed.byScenario.get(scenario.name)?.length ?? 0), 0) + filed.leftOver.length;
  const toggle = (id: string) => select({ check: selection.check === id ? null : id, layer: null });

  const rows = (scenario: FeatureScenario) => {
    const written = <PlainSteps steps={scenario.steps} examples={scenario.examples} />;
    const recorded = filed.byScenario.get(scenario.name) ?? [];
    if (!recorded.length) {
      const id = `scenario:${scenario.name}`;
      return (
        <ResultRow key={id} label={scenario.name} slot={null} open={selection.check === id} onToggle={() => toggle(id)}>
          <p className={styles.aside}>No completed test report for this scenario yet.</p>
          {written}
        </ResultRow>
      );
    }
    return recorded.map((slot) => (
      <ResultRow key={slot.key} label={scenarioLabel(feature!.name, slot.title)} slot={slot} open={selection.check === slot.id} onToggle={() => toggle(slot.id)}>
        <CheckDetail slot={slot} layerId={selection.check === slot.id ? selection.layer : undefined} select={(patch) => select({ check: slot.id, ...patch })} reads="steps" written={written} />
      </ResultRow>
    ));
  };

  return (
    <article className={styles.page}>
      <SpecHeader title={feature?.name || file.split('/').at(-1)!} file={file} kind={kind} entry={entry} planned={feature ? planned : undefined}>
        {feature?.description && <p className={styles.lead}>{feature.description}</p>}
      </SpecHeader>
      <SpecSnapshot title={feature?.name || file.split('/').at(-1)!} text={text} kind={kind.one} />
      {error && <p role="alert" className={styles.notice}>This feature could not be parsed: {error}</p>}
      {feature?.rules.map((rule, index) => (
        <section key={index} className={styles.block}>
          {rule.name !== null && <h2 className={styles.blockTitle}>{rule.name}</h2>}
          {rule.description && <p className={styles.blockLead}>{rule.description}</p>}
          {rule.scenarios.filter((scenario) => scenario.background).map((scenario, at) => (
            <div key={at} className={styles.background}>
              <p className={styles.aside}>Before each scenario{scenario.name ? `: ${scenario.name}` : ''}</p>
              <PlainSteps steps={scenario.steps} />
            </div>
          ))}
          <ul className={styles.results}>{rule.scenarios.filter((scenario) => !scenario.background).map(rows)}</ul>
        </section>
      ))}
      {filed.leftOver.length > 0 && (
        <section className={styles.block}>
          <h2 className={styles.blockTitle}>{feature ? 'Other recorded results' : 'Recorded results'}</h2>
          {feature && <p className={styles.blockLead}>Recorded against this file under a name no scenario has now.</p>}
          <ul className={styles.results}>
            <Bounded items={filed.leftOver} size={40} more="More results">
              {(slot) => (
                <ResultRow key={slot.key} label={feature ? scenarioLabel(feature.name, slot.title) : slot.title} slot={slot} open={selection.check === slot.id} onToggle={() => toggle(slot.id)}>
                  <CheckDetail slot={slot} layerId={selection.check === slot.id ? selection.layer : undefined} select={(patch) => select({ check: slot.id, ...patch })} reads="steps" />
                </ResultRow>
              )}
            </Bounded>
          </ul>
        </section>
      )}
      <SourceText text={text} label="Feature source" open={!feature} />
    </article>
  );
}
