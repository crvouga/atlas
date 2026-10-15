import { describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import { renderSummary, type JobResult } from './ci-summary';

const env = {
  GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: 'crvouga/atlas',
  GITHUB_RUN_ID: '123', GITHUB_RUN_NUMBER: '42', GITHUB_RUN_ATTEMPT: '2',
  GITHUB_SHA: 'a'.repeat(40), GITHUB_REF_NAME: 'main', GITHUB_EVENT_NAME: 'push'
};
const published = `ghcr.io/crvouga/atlas:${env.GITHUB_SHA}`;
const digest = `ghcr.io/crvouga/atlas@sha256:${'b'.repeat(64)}`;
const jobs = (image: JobResult, release: JobResult = { result: 'success', outputs: { planned: '[]' } }) => ({
  commitlint: { result: 'skipped' }, check: { result: 'success' }, s3: { result: 'success' },
  example: { result: 'success' }, image, release
});

describe('CI summary publication evidence', () => {
  test('insecure publication has independent evidence and token-free deployment instructions', () => {
    const image = 'ghcr.io/crvouga/atlas-insecure';
    const summary = renderSummary({
      ...jobs({ result: 'failure' }),
      'insecure-image': { result: 'success', outputs: {
        built: 'success', smoke: 'success', published: `${image}:${env.GITHUB_SHA}`,
        digest: `${image}@sha256:${'c'.repeat(64)}`, latest: 'updated'
      } }
    }, env);
    const section = summary.split('## Insecure Docker image for Railway')[1]!.split('## npm release')[0]!;
    expect(section).toContain(`\`\`\`text\n${image}:latest\n\`\`\``);
    expect(section).toContain(`${image}:${env.GITHUB_SHA}`);
    expect(section).toContain(`${image}@sha256:`);
    expect(section).toContain('No tokens needed');
    expect(section).toContain('Anyone who discovers the URL');
    expect(section).not.toContain('sign in with the token');
    expect(summary.split('## Insecure Docker image for Railway')[0]).toContain('No image publication confirmed');
  });

  test('an insecure build without publication never borrows the authenticated image evidence', () => {
    const summary = renderSummary(jobs({ result: 'success', outputs: { published, digest, latest: 'updated' } }), env);
    const section = summary.split('## Insecure Docker image for Railway')[1]!.split('## npm release')[0]!;
    expect(section).toContain('No image publication confirmed');
    expect(section).not.toContain(`ghcr.io/crvouga/atlas-insecure:${env.GITHUB_SHA}`);
    expect(section).not.toContain(published);
    expect(section).not.toContain(digest);
  });

  test('successful publication provides copyable URIs, provenance, release and deployment details', () => {
    const result = renderSummary(jobs({ result: 'success', outputs: { built: 'success', smoke: 'success', published, digest, latest: 'updated' } }, {
      result: 'success', outputs: { planned: JSON.stringify([{ name: '@crvouga/atlas', version: '1.2.3' }]) }
    }), env);
    for (const expected of [
      '```text\nghcr.io/crvouga/atlas:latest\n```', `\`\`\`text\n${published}\n\`\`\``, digest,
      'This run updated `latest`.', '/actions/runs/123#artifacts', '/commit/' + env.GITHUB_SHA,
      'https://www.npmjs.com/package/@crvouga/atlas/v/1.2.3', 'attempt 2', 'linux/amd64',
      'ATLAS_TOKEN', 'RAILWAY_RUN_UID=0', '/data', '/readyz', 'one replica', 'Configure Auto Updates'
    ]) expect(result).toContain(expected);
    expect(result).toContain('| Commit conventions | <code>skipped</code>');
    expect(result).not.toContain('not confirmed');
  });

  test('an older run offers its published revision without claiming it updated latest', () => {
    const result = renderSummary(jobs({ result: 'success', outputs: { published, digest, latest: 'superseded' } }), env);
    expect(result).toContain('A newer main commit owns `latest`');
    expect(result).toContain(published);
    expect(result).not.toContain('```text\nghcr.io/crvouga/atlas:latest\n```');
    expect(result).not.toContain('This run updated `latest`.');
  });

  test.each(['failure', 'cancelled', 'skipped', 'success'])('%s without publisher outputs never invents a published revision', result => {
    const summary = renderSummary(jobs({ result }, { result: 'skipped' }), { ...env, GITHUB_EVENT_NAME: 'pull_request' });
    expect(summary).toContain('No image publication confirmed for this run.');
    expect(summary).not.toContain(published);
    expect(summary).not.toContain('This run updated `latest`.');
    expect(summary).toContain('previous successful main publication');
    expect(summary).toContain('No release plan available.');
  });

  test('partial publication retains only evidence confirmed before failure', () => {
    const summary = renderSummary(jobs({ result: 'failure', outputs: { published } }, {
      result: 'failure', outputs: { planned: JSON.stringify([{ name: '@crvouga/atlas', version: '1.2.3' }]) }
    }), env);
    expect(summary).toContain(published);
    expect(summary).toContain('did not confirm updating `latest`');
    expect(summary).not.toContain('Exact registry digest');
    expect(summary).toContain('publication is not confirmed');
    expect(summary).not.toContain('Release job completed for:');
  });

  test('scheduled runs show skipped examples and completed release reconciliation', () => {
    const needs = jobs({ result: 'success', outputs: { published, digest, latest: 'updated' } });
    needs.example.result = 'skipped';
    const summary = renderSummary(needs, { ...env, GITHUB_EVENT_NAME: 'schedule' });
    expect(summary).toContain('| Browser examples | <code>skipped</code>');
    expect(summary).toContain('No new npm version planned; release reconciliation completed.');
  });

  test('missing evidence is unknown, and branch text cannot break the summary markup', () => {
    const summary = renderSummary({}, { ...env, GITHUB_REF_NAME: '<img>|oops\nnext' });
    expect(summary).toContain('| Repository checks | <code>unknown</code>');
    expect(summary).toContain('&lt;img&gt;&#124;oops next');
    expect(summary).not.toContain('<img>');
  });
});

test('the workflow always summarizes every other job and the script appends to GitHub’s summary file', () => {
  const workflow = YAML.parse(readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8'));
  expect(workflow.jobs.summary.if).toBe('always()');
  expect(workflow.jobs.summary.needs.toSorted()).toEqual(Object.keys(workflow.jobs).filter(id => id !== 'summary').sort());
  const step = workflow.jobs.summary.steps.find((step: { run?: string }) => step.run === 'bun scripts/ci-summary.ts');
  expect(step.env.CI_NEEDS).toBe('${{ toJSON(needs) }}');

  const dir = mkdtempSync(path.join(tmpdir(), 'atlas-ci-summary-'));
  try {
    const file = path.join(dir, 'summary.md');
    writeFileSync(file, 'Existing summary\n');
    const needs = jobs({ result: 'success', outputs: { published, digest, latest: 'updated' } });
    const result = Bun.spawnSync([process.execPath, path.join(import.meta.dir, 'ci-summary.ts')], {
      env: { ...process.env, ...env, CI_NEEDS: JSON.stringify(needs), GITHUB_STEP_SUMMARY: file }
    });
    expect(result.exitCode).toBe(0);
    expect(result.stderr.toString()).toBe('');
    expect(readFileSync(file, 'utf8')).toBe('Existing summary\n' + renderSummary(needs, env));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
