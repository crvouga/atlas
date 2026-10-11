import type { DataIssue } from '@crvouga/atlas-schema';
import * as Dialog from '@radix-ui/react-dialog';
import { useMemo } from 'react';

import { useUiStore } from '../state/ui-store';
import styles from './DataIssues.module.css';
import { CloseIcon, NoteIcon, WarnIcon } from './icons';

const SEVERITY_LABEL = { error: 'Problem', warning: 'Warning', info: 'Note' } as const;

/**
 * A quiet count of what went wrong while reading the data. It never interrupts; the list opens
 * only when asked for.
 */
export function DataIssues({ issues }: { issues: DataIssue[] }) {
  const open = useUiStore((s) => s.issuesOpen);
  const setOpen = useUiStore((s) => s.setIssuesOpen);
  const problems = issues.filter((i) => i.severity !== 'info').length;
  const byFile = useMemo(() => {
    const groups = new Map<string, DataIssue[]>();
    for (const issue of issues) groups.set(issue.file, [...(groups.get(issue.file) ?? []), issue]);
    return [...groups.entries()].sort(([, a], [, b]) => severityRank(b) - severityRank(a));
  }, [issues]);
  if (issues.length === 0) return null;
  const label = problems ? `${problems} data ${problems === 1 ? 'problem' : 'problems'}` : `${issues.length} data ${issues.length === 1 ? 'note' : 'notes'}`;
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger className={styles.trigger} data-has-problems={problems > 0}>
        {problems ? <WarnIcon size={13} /> : <NoteIcon size={13} />}
        {label}
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content className={styles.sheet}>
          <div className={styles.head}>
            <Dialog.Title className={styles.title}>Parts of the data that couldn’t be read</Dialog.Title>
            <Dialog.Close className={styles.close} aria-label="Close">
              <CloseIcon size={16} />
            </Dialog.Close>
          </div>
          <Dialog.Description className={styles.lead}>
            Everything else on the map is shown as usual. These parts of the spec and the runs were skipped or guessed, listed by file.
          </Dialog.Description>
          <div className={styles.list}>
            {byFile.map(([file, list]) => (
              <section key={file} className={styles.file}>
                <h3 className={styles.fileName}>{file || 'General'}</h3>
                <ul className={styles.items}>
                  {list.map((issue, i) => (
                    <li key={i} className={styles.item} data-severity={issue.severity}>
                      <span className={styles.severity}>{SEVERITY_LABEL[issue.severity]}</span>
                      <span>
                        {issue.path && <span className={styles.path}>{issue.path}: </span>}
                        {issue.message}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function severityRank(list: DataIssue[]) {
  return Math.max(...list.map((i) => (i.severity === 'error' ? 2 : i.severity === 'warning' ? 1 : 0)));
}
