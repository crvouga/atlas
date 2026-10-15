import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { ReportStatus } from '../../schema/src/layer';
import { serveMain } from '../../server/src/main';
import { reportMain } from '../src/report-cli';
import type { EffectiveEvidence } from '../src/report-index';

/**
 * The whole workflow against a real S3-protocol server: developers and CI publish from their own
 * machines to one bucket, the gate reads it, and a node serves it. Off unless a server is named (see
 * s3-store.integration.test.ts).
 */
const endpoint = process.env.ATLAS_TEST_S3_ENDPOINT;
const suite = endpoint ? describe : describe.skip;

suite('one bucket, many publishers, one node', () => {
  let root: string;
  const bucket = process.env.ATLAS_TEST_S3_BUCKET ?? 'atlas-test';
  const store = () => `s3://${bucket}/flow-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}?endpoint=${endpoint}&region=us-east-1`;
  const env = { AWS_ACCESS_KEY_ID: process.env.ATLAS_TEST_S3_KEY ?? 'atlaskey', AWS_SECRET_ACCESS_KEY: process.env.ATLAS_TEST_S3_SECRET ?? 'atlassecret' };

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'atlas-flow-'));
    await mkdir(path.join(root, 'specs'), { recursive: true });
    await writeFile(path.join(root, 'specs', 'cart.feature'), 'Feature: Shopping cart\n  Scenario: Adds\n');
    await writeFile(path.join(root, 'specs', 'checkout.feature'), 'Feature: Checkout\n  Scenario: Pays\n');
    const junit = (suiteName: string, status: 'pass' | 'fail', at: string) => `<testsuites><testsuite name="${suiteName}" timestamp="${at}"><testcase classname="${suiteName}" name="Scenario">${status === 'fail' ? '<failure message="broken"/>' : ''}</testcase></testsuite></testsuites>`;
    await writeFile(path.join(root, 'cart.xml'), junit('Shopping cart', 'pass', '2026-10-14T10:00:00Z'));
    await writeFile(path.join(root, 'checkout-ci.xml'), junit('Checkout', 'pass', '2026-10-14T10:05:00Z'));
    await writeFile(path.join(root, 'checkout-laptop.xml'), junit('Checkout', 'fail', '2026-10-14T11:00:00Z'));
  });
  afterAll(async () => { await rm(root, { recursive: true, force: true }); });

  async function atlas(args: string[], git: (args: readonly string[]) => string | null = () => null, extraEnv: Record<string, string> = {}) {
    let output = '';
    const code = await reportMain(args, { out: text => { output += text; }, env: { ...env, ...extraEnv }, cwd: root, git, clock: () => 1_760_000_000_000 });
    return { code, output };
  }

  test('CI and a laptop publish into one bucket, and everyone sees one report', async () => {
    const url = store();
    const ci = { GITHUB_SHA: 'a'.repeat(40), GITHUB_REF_NAME: 'main' };
    expect((await atlas(['doctor', '--store', url])).code).toBe(0);
    expect((await atlas(['doctor', '--store', url, '--role', 'publisher'])).code).toBe(0);

    // CI, on main: both specs pass on ios.
    await atlas(['publish', '--store', url, '--producer', 'bdd', '--junit', 'cart.xml', '--specs', 'specs', '--environment', 'ios'], () => null, ci);
    await atlas(['publish', '--store', url, '--producer', 'bdd', '--junit', 'checkout-ci.xml', '--specs', 'specs', '--environment', 'ios'], () => null, ci);
    expect((await atlas(['status', '--store', url])).code).toBe(0);

    // A developer's worktree, with edits: checkout fails on their machine.
    const edited = (args: readonly string[]) => (args[0] === 'status' ? ' M specs/checkout.feature' : args[0] === 'rev-parse' ? 'b'.repeat(40) : args[0] === 'branch' ? 'feat/pay' : null);
    const laptop = await atlas(['publish', '--store', url, '--producer', 'bdd', '--junit', 'checkout-laptop.xml', '--specs', 'specs', '--environment', 'ios'], edited);
    expect(laptop.output).toContain('[from a modified checkout]');

    // Everything takes part by default, so the newest result, the laptop's, is shown. A gate can choose otherwise.
    const everything = JSON.parse((await atlas(['status', '--store', url, '--format', 'json'])).output) as ReportStatus;
    expect(everything.ok).toBe(false);
    expect(everything.failing.map(item => [item.spec, item.branch])).toEqual([['specs/checkout.feature', 'feat/pay']]);
    expect((await atlas(['status', '--store', url, '--ignore-modified', '--require-all-specs'])).code).toBe(0);
    expect((await atlas(['status', '--store', url, '--branch', 'main'])).code).toBe(0);

    // The outline came from the store: this checkout is not needed to know the specs.
    const noCheckout = JSON.parse((await atlas(['status', '--store', url, '--format', 'json'])).output) as ReportStatus;
    expect(noCheckout.specs.map(spec => spec.path)).toEqual(['specs/cart.feature', 'specs/checkout.feature']);
  }, 30_000);

  test('a server reads the bucket: the report in one request, specs and all, and sees what is published later', async () => {
    const url = store();
    const ci = { GITHUB_SHA: 'a'.repeat(40), GITHUB_REF_NAME: 'main' };
    await atlas(['publish', '--store', url, '--producer', 'bdd', '--junit', 'cart.xml', '--specs', 'specs', '--environment', 'ios'], () => null, ci);

    const controller = new AbortController();
    let output = '';
    // This exercises the API, so skip the unrelated cold client build on a fresh CI runner.
    const done = serveMain(['--data', path.join(root, 'server-data'), '--site', path.join(root, 'no-site'), '--store', url, '--port', '0', '--host', '127.0.0.1', '--refresh', '1', '--no-log'], { out: text => { output += text; }, env, cwd: root, signal: controller.signal });
    try {
      for (let i = 0; i < 200 && !output.includes('Atlas ready'); i++) await new Promise(resolve => setTimeout(resolve, 25));
      const base = /ready on (http:\/\/[^:]+:\d+)/.exec(output)?.[1]?.replace('localhost', '127.0.0.1');
      expect(base).toBeDefined();
      expect(output).toContain('Backends: data (uploads),');
      const effective = async () => (await (await fetch(`${base}/api/reports/evidence/effective`)).json()) as EffectiveEvidence;
      expect((await effective()).layers.length).toBe(1);
      expect(await (await fetch(`${base}/api/data/specs/cart.feature`)).text()).toContain('Shopping cart');

      await atlas(['publish', '--store', url, '--producer', 'bdd', '--junit', 'checkout-ci.xml', '--specs', 'specs', '--environment', 'ios'], () => null, ci);
      let layers = 1;
      for (let i = 0; i < 100 && layers < 2; i++) { await new Promise(resolve => setTimeout(resolve, 100)); layers = (await effective()).layers.length; }
      expect(layers).toBe(2);
      expect((await fetch(`${base}/readyz`)).status).toBe(200);
    } finally {
      controller.abort();
      expect(await done).toBe(0);
    }
  }, 30_000);

  test('merging a laptop folder up to the bucket is safe to repeat', async () => {
    const url = store();
    await atlas(['publish', '--store', path.join(root, 'laptop-store'), '--producer', 'bdd', '--junit', 'cart.xml', '--specs', 'specs']);
    const first = await atlas(['merge', '--store', path.join(root, 'laptop-store'), '--into', url]);
    expect(first.output).toMatch(/[1-9]\d* objects copied/);
    expect((await atlas(['merge', '--store', path.join(root, 'laptop-store'), '--into', url])).output).toContain('0 objects copied');
    expect(JSON.parse((await atlas(['status', '--store', url, '--format', 'json'])).output).checks.total).toBe(1);
  }, 30_000);
});
