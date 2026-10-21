/**
 * @module Explorer parts
 *
 * Small pieces the explorer's list, its test detail and its runs view share: the project's title, a run's short name,
 * the chips that say where a test ran and how it went there, and the badges for what its results carry.
 */
import { environmentLabel } from '@crvouga/atlas/reports/layer-axes';
import type { TestSummary } from '@crvouga/atlas/reports/test-catalog';

import { plural } from '../evidence/format';
import { StatusMark } from '../evidence/marks';
import { currentProject } from '../runtime';
import styles from './explorer.module.css';
import { environmentStatuses } from './groups';

/** The project's name for its title: `?project=geviti-app` reads "Geviti App". */
export function projectTitle(): string {
  return currentProject()?.split('-').map((word) => (word[0]?.toUpperCase() ?? '') + word.slice(1)).join(' ') || 'Project reports';
}

/** A run key for a person: its CI run number, or `branch@sha` shortened. */
export function runName(key: string): string {
  const actions = /\/actions\/runs\/(\d+)/.exec(key);
  if (actions) return `#${actions[1]}`;
  if (/^https?:/.test(key)) return key.replace(/^https?:\/\//, '').slice(0, 40);
  const [branch, sha] = key.split('@');
  return [branch, sha?.slice(0, 7)].filter(Boolean).join(' @ ') || key;
}

/** Small badges for what a test's results carry: flaky, video, screenshots, a trace, steps. */
export function Badges({ test }: { test: TestSummary }) {
  const roles = test.evidence.roles;
  const badges = [
    test.stats.flaky ? { id: 'flaky', label: 'Flaky', title: test.stats.flakyReason } : null,
    roles.includes('video') ? { id: 'video', label: 'Video', title: 'Has a video' } : null,
    roles.includes('image') || roles.includes('screenshot') ? { id: 'image', label: 'Screenshots', title: 'Has screenshots' } : null,
    roles.includes('trace') ? { id: 'trace', label: 'Trace', title: 'Has a trace' } : null,
    test.evidence.steps > 0 ? { id: 'steps', label: plural(test.evidence.steps, 'step', 'steps'), title: 'Recorded steps' } : null,
    test.live ? { id: 'live', label: 'Running now', title: 'A run is in progress' } : null
  ].filter((badge): badge is { id: string; label: string; title: string } => badge !== null);
  if (!badges.length) return null;
  return <span className={styles.badges}>{badges.map((badge) => <span key={badge.id} data-badge={badge.id} title={badge.title}>{badge.label}</span>)}</span>;
}

/** Where a test ran and how it went there: one chip per environment. */
export function EnvironmentChips({ test }: { test: TestSummary }) {
  const environments = environmentStatuses(test);
  if (!environments.length) return null;
  return (
    <span className={styles.envChips}>
      {environments.map(({ environment, status }) => (
        <span key={environment ?? 'none'} data-status={status} title={`${environmentLabel(environment)}: ${status}`}>
          <StatusMark status={status} size={10} />
          {environmentLabel(environment)}
        </span>
      ))}
    </span>
  );
}
