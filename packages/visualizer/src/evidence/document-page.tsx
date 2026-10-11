import type { SpecEvidence } from '@crvouga/atlas-reports/evidence-view';

import type { SpecKind } from '../spec-kind';
import { CheckDetail, ResultRow, type CheckSelection, type SelectCheck } from './check-detail';
import { DecisionTables } from './decision-table';
import styles from './evidence.module.css';
import { Bounded } from './marks';
import { SourceText, SpecHeader } from './spec-header';
import { SpecSnapshot } from './spec-snapshot';

type Props = { file: string; text: string; kind: SpecKind; entry: SpecEvidence | undefined; selection: CheckSelection; select: SelectCheck };

/** A decision table, structure or objective: what it says, and each check recorded against it. */
export function DocumentPage({ file, text, kind, entry, selection, select }: Props) {
  const slots = entry?.slots ?? [];
  const toggle = (id: string) => select({ check: selection.check === id ? null : id, layer: null });
  const name = file.split('/').at(-1)!.replace(/\.[^.]+$/, '').replace(/\.openslo$/, '');
  return (
    <article className={styles.page}>
      <SpecHeader title={name} file={file} kind={kind} entry={entry} />
      <SpecSnapshot title={name} text={text} kind={kind.one} />
      {slots.length > 0 && (
        <section className={styles.block}>
          <h2 className={styles.blockTitle}>Checks</h2>
          <ul className={styles.results}>
            <Bounded items={slots} size={40} more="More checks">
              {(slot) => (
                <ResultRow key={slot.key} label={slot.title} slot={slot} open={selection.check === slot.id} onToggle={() => toggle(slot.id)}>
                  <CheckDetail slot={slot} layerId={selection.check === slot.id ? selection.layer : undefined} select={(patch) => select({ check: slot.id, ...patch })} reads="steps" />
                </ResultRow>
              )}
            </Bounded>
          </ul>
        </section>
      )}
      {kind.id === 'dmn' && <DecisionTables text={text} />}
      <SourceText text={text} open={kind.id !== 'dmn'} />
    </article>
  );
}
