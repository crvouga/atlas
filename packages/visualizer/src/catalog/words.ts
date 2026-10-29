/**
 * @module UI catalog wording
 *
 * The words the catalog uses for a cell's coverage. Only `captured` is called captured; a state that is expected and not yet
 * captured says so, and never looks like a picture exists.
 */
import type { UiCoverage } from '@crvouga/atlas/reports/ui-catalog';
import type { SpecStatus } from '@crvouga/atlas/reports/evidence-view';

const WORDS: Readonly<Record<UiCoverage, string>> = {
  captured: 'Captured',
  failed: 'Capture failed',
  capturing: 'Capturing',
  skipped: 'Skipped',
  missing: 'Not captured yet'
};

/** The words for a coverage value; an unknown one is shown as it is. */
export function coverageWord(value: string): string {
  return WORDS[value as UiCoverage] ?? value;
}

/** The outcome mark that stands for a coverage value: every one but `captured` is a different mark, never a pass. */
export function coverageStatus(value: UiCoverage): SpecStatus {
  return value === 'captured' ? 'passed' : value === 'failed' ? 'failed' : value === 'capturing' ? 'running' : value === 'skipped' ? 'not-run' : 'none';
}
