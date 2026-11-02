import { expect, test } from 'bun:test';
import { formatVerdicts, judgeCatalog, judgeReports } from './workspace-verify';

const example = { check: 'examples/status/error', producer: 'todo-status-examples', status: 'failed', environment: 'desktop-web' };

test('intentional status examples never fail verification, but a real failed check does', () => {
  const checks = { passed: 72, failed: 1, total: 79 };
  expect(judgeReports({ checks, failing: [example] })).toMatchObject({ level: 'ok', detail: '72 passed of 79; 1 intentional status examples' });
  const real = { check: 'todo/active', producer: 'todo-statecharts', status: 'failed', environment: 'mobile-web' };
  expect(judgeReports({ checks, failing: [example, real] })).toMatchObject({ level: 'fail', detail: '1 failed: todo/active (mobile-web)' });
  // A reader that got nothing back must not call it a pass.
  expect(judgeReports(null, 'connection refused')).toMatchObject({ level: 'fail', detail: expect.stringContaining('connection refused') });
});

test('the UI catalog fails on a real problem or when nothing was captured', () => {
  const summary = { states: 10, coverage: { captured: 14, failed: 2 } };
  const intentional = { kind: 'failed', state: 'examples/status/error', profile: 'Desktop web' };
  expect(judgeCatalog({ summary, problems: [intentional] }).level).toBe('ok');
  expect(judgeCatalog({ summary, problems: [intentional, { kind: 'failed', state: 'todo/offline', profile: 'Mobile web' }] })).toMatchObject({
    level: 'fail',
    detail: '1 problems: failed todo/offline (Mobile web)'
  });
  expect(judgeCatalog({ summary: { states: 10, coverage: { captured: 0 } }, problems: [] }).level).toBe('fail');
  expect(judgeCatalog(null).level).toBe('fail');
});

test('the summary line says whether anything failed', () => {
  expect(formatVerdicts([{ check: 'server', level: 'ok', detail: 'up' }])).toEndWith('Verified.');
  expect(formatVerdicts([{ check: 'server', level: 'fail', detail: 'down' }])).toEndWith('1 check(s) failed.');
});
