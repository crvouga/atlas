import type { SpecEvidence } from '@crvouga/atlas/reports/evidence-view';
import { useMemo } from 'react';

import type { SpecKind } from '../spec-kind';
import { CheckDetail, ResultRow, type CheckSelection, type SelectCheck } from './check-detail';
import styles from './evidence.module.css';
import { Bounded } from './marks';
import { QUINT_GROUPS, quintOutline } from './quint';
import { SourceText, SpecHeader } from './spec-header';
import { SpecSnapshot } from './spec-snapshot';

type Props = { file: string; text: string; kind: SpecKind; entry: SpecEvidence | undefined; selection: CheckSelection; select: SelectCheck };

/** A model read as its state and actions, with every trace that was replayed against the app. */
export function ModelPage({ file, text, kind, entry, selection, select }: Props) {
  const items = useMemo(() => quintOutline(text), [text]);
  const moduleName = items.find((item) => item.kind === 'module')?.name;
  const slots = useMemo(() => [...(entry?.slots ?? [])].sort((a, b) => a.title.localeCompare(b.title, undefined, { numeric: true })), [entry]);
  const toggle = (id: string) => select({ check: selection.check === id ? null : id, layer: null });
  const label = (title: string) => (moduleName && title.startsWith(`${moduleName} · `) ? title.slice(moduleName.length + 3) : title);
  return (
    <article className={styles.page}>
      <SpecHeader title={moduleName ?? file.split('/').at(-1)!} file={file} kind={kind} entry={entry} />
      <SpecSnapshot title={moduleName ?? file.split('/').at(-1)!} text={text} kind={kind.one} />
      {slots.length > 0 && (
        <section className={styles.block}>
          <h2 className={styles.blockTitle}>Traces</h2>
          <ul className={styles.results}>
            <Bounded items={slots} size={40} more="More traces">
              {(slot) => (
                <ResultRow key={slot.key} label={label(slot.title)} slot={slot} open={selection.check === slot.id} onToggle={() => toggle(slot.id)}>
                  <CheckDetail slot={slot} layerId={selection.check === slot.id ? selection.layer : undefined} select={(patch) => select({ check: slot.id, ...patch })} reads="trace" />
                </ResultRow>
              )}
            </Bounded>
          </ul>
        </section>
      )}
      {QUINT_GROUPS.map((group) => {
        const declared = items.filter((item) => item.kind === group.kind);
        if (!declared.length) return null;
        return (
          <section key={group.kind} className={styles.block}>
            <h2 className={styles.blockTitle}>{group.label}</h2>
            <ul className={styles.declarations}>
              {declared.map((item) => (
                <li key={item.line}>
                  <a href={`#line-${item.line}`} onClick={(event) => { event.preventDefault(); const line = document.getElementById(`line-${item.line}`); line?.closest('details')?.setAttribute('open', ''); line?.scrollIntoView({ block: 'center' }); }}>
                    <code>{item.text}</code>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      <SourceText text={text} label="Model source" open={items.length === 0} />
    </article>
  );
}
