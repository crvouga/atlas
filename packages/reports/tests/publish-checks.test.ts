import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { combineBackends } from '../src/compose';
import { checksFromCtrf, checksFromJunit, checksFromManifest } from '../src/ingest';
import { publishChecks } from '../src/publish-checks';
import { memoryStore } from './memory-store';

const check = (id: string, status: 'passed' | 'failed' = 'passed') => ({ id, title: id, status });
const base = { producer: 'gherkin', recordedAtMs: 100, sha: 'a'.repeat(40), branch: 'main' };

describe('publishChecks', () => {
  test('one call is the whole integration of a suite with no timelines', async () => {
    const store = memoryStore();
    await publishChecks(store, { ...base, environment: 'iOS', checks: [{ ...check('join'), specPath: 'specs/join.feature', measurements: [{ name: 'latency', value: 90, unit: 'ms', limit: 100 }] }, check('leave', 'failed')] });
    const report = await combineBackends([{ id: 'ci', store }]);
    expect(report.summary.checks).toMatchObject({ passed: 1, failed: 1, total: 2 });
    expect(Object.keys(report.summary.byEnvironment)).toEqual(['ios']);
  });

  test('publishing the same input again, from anywhere, is the same layer', async () => {
    const input = { ...base, checks: [check('join'), check('leave', 'failed')], parameters: { b: '2', a: '1' } };
    const one = await publishChecks(memoryStore(), input);
    const two = await publishChecks(memoryStore(), { ...input, parameters: { a: '1', b: '2' } });
    expect(two.id).toBe(one.id);
  });

  test('a check keeps its identity across runs, so the newer run replaces the older', async () => {
    const store = memoryStore();
    await publishChecks(store, { ...base, recordedAtMs: 1, checks: [check('join', 'failed')] });
    await publishChecks(store, { ...base, recordedAtMs: 2, checks: [check('join', 'passed')] });
    expect((await combineBackends([{ id: 'ci', store }])).summary.checks).toMatchObject({ passed: 1, failed: 0, total: 1 });
  });

  test('a producer that omits a check leaves the earlier result of that check in place', async () => {
    const store = memoryStore();
    await publishChecks(store, { ...base, recordedAtMs: 1, checks: [check('join'), check('leave', 'failed')] });
    await publishChecks(store, { ...base, recordedAtMs: 2, checks: [check('join')] });
    expect((await combineBackends([{ id: 'ci', store }])).summary.checks).toMatchObject({ passed: 1, failed: 1, total: 2 });
  });

  test.each([
    ['repeated check ids', { ...base, checks: [check('a'), check('a')] }, 'appears twice'],
    ['no producer', { ...base, producer: '', checks: [] }, 'producer'],
    ['an unknown status', { ...base, checks: [{ id: 'a', title: 'a', status: 'flaky' }] }, 'status'],
    ['no time', { producer: 'x', checks: [] }, 'recordedAtMs'],
    ['a measurement that is not a number', { ...base, checks: [{ ...check('a'), measurements: [{ name: 'm', value: Number.NaN, unit: 'ms' }] }] }, 'measurements.0.value'],
  ])('%s is refused with the reason', async (_, input, message) => {
    await expect(publishChecks(memoryStore(), input as never)).rejects.toThrow(message);
  });
});

describe('ingesting the reports tools already write', () => {
  test('CTRF: skipped and pending are not-run, never a pass; ids are stable', () => {
    const result = checksFromCtrf({
      reportFormat: 'CTRF',
      results: {
        tool: { name: 'jest' },
        summary: { start: 10, stop: 20 },
        tests: [
          { name: 'joins', status: 'passed', duration: 12, filePath: 'specs/join.feature', suite: ['List'] },
          { name: 'leaves', status: 'failed', message: 'boom', filePath: 'specs/join.feature', suite: ['List'] },
          { name: 'later', status: 'skipped' },
          { name: 'waits', status: 'pending' },
          { name: 'joins', status: 'passed', filePath: 'specs/join.feature', suite: ['List'] }
        ]
      }
    });
    expect(result.tool).toBe('jest');
    expect(result.recordedAtMs).toBe(20);
    expect(result.checks.map(item => [item.id, item.status])).toEqual([
      ['specs/join.feature > List > joins', 'passed'],
      ['specs/join.feature > List > leaves', 'failed'],
      ['later', 'not-run'],
      ['waits', 'not-run'],
      ['specs/join.feature > List > joins #2', 'passed']
    ]);
    expect(result.checks[1]!.detail).toBe('boom');
    expect(result.checks[0]).toMatchObject({ durationMs: 12, specPath: 'specs/join.feature' });
  });

  test('CTRF without results.tests is refused', () => {
    expect(() => checksFromCtrf({ hello: 'world' })).toThrow('Not a CTRF report');
  });

  test('JUnit: failures, skips, timing and the time the suite ran', () => {
    const result = checksFromJunit(`<?xml version="1.0"?>
<testsuites><testsuite name="s" timestamp="2026-10-09T12:00:00Z" file="specs/list.feature">
  <testcase classname="List" name="joins" time="0.25"/>
  <testcase classname="List" name="leaves" time="1"><failure message="nope">stack &amp; trace</failure></testcase>
  <testcase classname="List" name="later"><skipped/></testcase>
</testsuite></testsuites>`);
    expect(result.recordedAtMs).toBe(Date.parse('2026-10-09T12:00:00Z'));
    expect(result.checks.map(item => [item.id, item.status, item.durationMs ?? null])).toEqual([
      ['specs/list.feature > joins', 'passed', 250],
      ['specs/list.feature > leaves', 'failed', 1000],
      ['specs/list.feature > later', 'not-run', null]
    ]);
    expect(result.checks[1]!.detail).toBe('stack & trace');
    expect(() => checksFromJunit('<html/>')).toThrow('Not a JUnit report');
  });

  test('an Atlas manifest: a path is a check, flaky passed, and a run in progress never reads as finished', () => {
    const manifest = JSON.parse(readFileSync(path.join(import.meta.dir, '..', '..', 'visualizer', 'fixtures', 'full', 'runs', '2026-10-02T09-10-00-000Z-fast', 'manifest.json'), 'utf8'));
    const done = checksFromManifest(manifest);
    expect(done.checks.length).toBe(manifest.paths.length);
    expect(done.recordedAtMs).toBe(Date.parse(manifest.run.finishedAt));
    const live = checksFromManifest({ run: { id: 'r', startedAt: '2026-10-09T12:00:00Z', finishedAt: null, durationMs: 0 }, paths: [
      { id: '1', key: 'k1', name: 'one', kind: 'journey', status: 'not-reached', progress: 'running', steps: [] },
      { id: '2', key: 'k2', name: 'two', kind: 'journey', status: 'not-reached', progress: 'queued', steps: [] },
      { id: '3', key: 'k3', name: 'three', kind: 'generated', status: 'flaky', steps: [] },
      { id: '4', key: 'k4', name: 'four', kind: 'generated', status: 'failed', attempts: [{ status: 'failed', error: 'no screen' }], steps: [] }
    ] });
    expect(live.checks.map(item => [item.id, item.status])).toEqual([['k1', 'running'], ['k2', 'not-run'], ['k3', 'passed'], ['k4', 'failed']]);
    expect(live.checks[3]!.detail).toBe('no screen');
    expect(() => checksFromManifest({})).toThrow('Not an Atlas manifest');
  });
});

describe('JUnit as real tools write it', () => {
  test('a self-closing empty suite does not swallow the suite after it', () => {
    const result = checksFromJunit('<testsuites><testsuite name="empty" tests="0"/><testsuite name="Login" file="specs/login.feature"><testcase name="a"/></testsuite></testsuites>');
    expect(result.checks.map(item => item.id)).toEqual(['specs/login.feature > a']);
    expect(result.hints).toEqual([['Login', 'specs/login.feature']]);
  });

  test('a time with no offset is read as UTC, so the layer is the same wherever Atlas runs', () => {
    const at = (stamp: string) => checksFromJunit(`<testsuites><testsuite name="s" timestamp="${stamp}"><testcase name="a"/></testsuite></testsuites>`).recordedAtMs;
    expect(at('2024-01-01T00:00:00')).toBe(Date.UTC(2024, 0, 1));
    expect(at('2024-01-01T00:00:00.250')).toBe(Date.UTC(2024, 0, 1) + 250);
    expect(at('2024-01-01T00:00:00Z')).toBe(Date.UTC(2024, 0, 1));
    expect(at('2024-01-01T02:00:00+02:00')).toBe(Date.UTC(2024, 0, 1));
  });
});

describe('linking checks by a dotted file name', () => {
  test('user.profile.feature is user.profile, not user: a different spec is never taken for it', async () => {
    const { linkChecksToSpecs } = await import('../src/spec-link');
    const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const root = await mkdtemp(path.join(tmpdir(), 'atlas-stem-'));
    try {
      await mkdir(path.join(root, 'specs'));
      await writeFile(path.join(root, 'specs', 'user.feature'), 'Feature: Account\n');
      await writeFile(path.join(root, 'specs', 'user.profile.feature'), 'Feature: Profile page\n');
      const linked = await linkChecksToSpecs({ checks: [{ id: 'a', title: 'a', status: 'passed', detail: '', measurements: [] }], hints: [['user.profile.feature']], recordedAtMs: null, tool: null }, { base: root, specsDirectory: 'specs' });
      expect(linked.checks[0]!.specPath).toBe('specs/user.profile.feature');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
