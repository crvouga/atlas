import { expect, test } from 'bun:test';
import { evidenceFile } from '@crvouga/atlas-reports/export-evidence';
import { selectedFrame, flattenFrames } from '@crvouga/atlas-reports/frames';
import { latestParts, partStatus } from '@crvouga/atlas-reports/report-parts';

test('static evidence paths preserve revision and encoded spec identity', () => {
  expect(evidenceFile('')).toBe('index.json');
  expect(evidenceFile('/one/spec?path=specs%2Flists%2Fadd.feature')).toBe('one/specs/specs%2Flists%2Fadd.feature.txt');
  expect(evidenceFile('/two/sources')).toBe('two/sources.json');
});
test('empty evidence cannot become a pass and failed tied results win', () => {
  const empty = { sha: '1'.repeat(40), id: 'model', kind: 'quint', title: 'List model', recordedAtMs: 0, checks: [] };
  expect(partStatus(empty)).toBe('not-run');
  const passed = { ...empty, checks: [{ id: 'check', title: 'Size remains positive', status: 'passed' as const, detail: '', measurements: [] }] };
  const failed = { ...passed, checks: [{ ...passed.checks[0]!, status: 'failed' as const }] };
  expect(partStatus(latestParts([failed, passed])[0]!)).toBe('failed');
});
test('an empty recording has no invented moment', () => {
  expect(selectedFrame(flattenFrames([]), { view: 'list', params: {} })).toBeNull();
});
