import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { directoryStore } from '../src/directory-store';
import { detectOrigin, reportMain, runReportCommand } from '../src/report-cli';
import type { ReportStatus } from '../../schema/src/layer';
import { ReportStatusSchema } from '../../schema/src/layer';

let root: string;
beforeAll(async () => { root = await mkdtemp(path.join(tmpdir(), 'atlas-cli-')); });
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

async function run(args: string[], env: Record<string, string> = {}) {
  let output = '';
  const code = await reportMain(args, { out: text => { output += text; }, env, cwd: root, git: () => null });
  return { code, output };
}
const ctrf = (tests: object[], stop = 500) => JSON.stringify({ reportFormat: 'CTRF', results: { tool: { name: 'jest' }, summary: { stop }, tests } });
async function file(name: string, text: string) { await mkdir(path.dirname(path.join(root, name)), { recursive: true }); await writeFile(path.join(root, name), text); return name; }

describe('atlas report: publish partial runs on separate nodes, then aggregate and gate', () => {
  test('two nodes each run a shard, and the aggregate is the union', async () => {
    await file('n1.json', ctrf([{ name: 'a', status: 'passed', filePath: 'specs/x.feature' }, { name: 'b', status: 'passed', filePath: 'specs/x.feature' }]));
    await file('n2.json', ctrf([{ name: 'c', status: 'passed', filePath: 'specs/x.feature' }]));
    expect((await run(['publish', '--store', 'node1', '--producer', 'bdd', '--ctrf', 'n1.json', '--environment', 'ios'])).output).toContain('2 checks (2 passed, 0 failed, 0 not run) as "bdd" on ios');
    await run(['publish', '--store', 'node2', '--producer', 'bdd', '--ctrf', 'n2.json', '--environment', 'ios']);

    const alone = await run(['status', '--store', 'node1', '--format', 'json']);
    expect((JSON.parse(alone.output) as ReportStatus).checks.total).toBe(2);

    const both = await run(['status', '--store', 'node1', '--store', 'node2', '--format', 'json']);
    const status = ReportStatusSchema.parse(JSON.parse(both.output));
    expect(both.code).toBe(0);
    expect(status).toMatchObject({ ok: true, reasons: [], layers: 2, checks: { passed: 3, total: 3 } });

    const merged = await run(['merge', '--store', 'node1', '--store', 'node2', '--into', 'aggregate']);
    expect(merged.output).toContain('objects copied');
    expect((await run(['merge', '--store', 'node1', '--store', 'node2', '--into', 'aggregate'])).output).toContain('0 objects copied');
    const aggregate = JSON.parse((await run(['status', '--store', 'aggregate', '--format', 'json'])).output) as ReportStatus;
    expect({ ...aggregate, backends: [] }).toEqual({ ...status, backends: [] });
  });

  test('a later failing run of one shard fails the gate, names the check, and a fixing run clears it', async () => {
    await file('n2-bad.json', ctrf([{ name: 'c', status: 'failed', message: 'expected 3 saw 2', filePath: 'specs/x.feature' }], 900));
    await run(['publish', '--store', 'node2', '--producer', 'bdd', '--ctrf', 'n2-bad.json', '--environment', 'ios']);
    const failing = await run(['status', '--store', 'node1', '--store', 'node2']);
    expect(failing.code).toBe(1);
    expect(failing.output).toContain('FAIL');
    expect(failing.output).toContain('✗ specs/x.feature > c  (ios)');
    expect(failing.output).toContain('expected 3 saw 2');

    await file('n2-fixed.json', ctrf([{ name: 'c', status: 'passed', filePath: 'specs/x.feature' }], 950));
    await run(['publish', '--store', 'node2', '--producer', 'bdd', '--ctrf', 'n2-fixed.json', '--environment', 'ios']);
    expect((await run(['status', '--store', 'node1', '--store', 'node2'])).code).toBe(0);
  });

  test('a required environment with no results fails the gate', async () => {
    const result = await run(['status', '--store', 'node1', '--store', 'node2', '--require-environments', 'ios,android']);
    expect(result.code).toBe(1);
    expect(result.output).toContain('No checks on required environment "android"');
  });

  test('a layer nobody can read fails the gate instead of being ignored', async () => {
    await run(['publish', '--store', 'broken', '--producer', 'bdd', '--ctrf', 'n1.json']);
    const { listKeys } = (await import('../src/directory-store')).directoryStore(path.join(root, 'broken'));
    const manifest = (await listKeys('layers/manifests/'))[0]!;
    await writeFile(path.join(root, 'broken', manifest), '{"schemaVersion": 2}');
    const result = await run(['status', '--store', 'broken']);
    expect(result.code).toBe(1);
    expect(result.output).toContain('Upgrade @crvouga/atlas');
  });

  test('an empty report is not a pass', async () => {
    await mkdir(path.join(root, 'empty'), { recursive: true });
    const result = await run(['status', '--store', 'empty']);
    expect(result.code).toBe(1);
    expect(result.output).toContain('No checks were found');
  });

  test('stores can be named, and the markdown is ready for a pull request comment', async () => {
    const result = await run(['status', '--store', 'ci=node1', '--store', 'lab=node2', '--format', 'markdown']);
    expect(result.output).toStartWith('### ✅ Atlas report: 3 passed');
    expect(result.output).toContain('| ios | 3 | 0 | 0 | 0 |');
    await expect(run(['status', '--store', 'a=node1', '--store', 'a=node2'])).rejects.toThrow('Two stores are named "a"');
  });

  test('usage mistakes are errors with a way forward', async () => {
    await expect(run(['publish', '--store', 'x'])).rejects.toThrow('exactly one of --ctrf, --junit, --manifest or --checks');
    await expect(run(['publish', '--store', 'x', '--ctrf', 'n1.json'])).rejects.toThrow('--producer');
    await expect(run(['status'])).rejects.toThrow('at least one --store');
    await expect(run(['status', '--store', 'node1', '--format', 'xml'])).rejects.toThrow('--format takes');
    expect((await run(['nope'])).code).toBe(2);
    expect((await run(['--help'])).code).toBe(0);
  });

  test('--checks takes the whole contract, including the specs a layer was recorded against', async () => {
    await file('checks.json', JSON.stringify({ producer: 'quint', recordedAtMs: 5, kind: 'model', parameters: { seed: '7' }, checks: [{ id: 'invariant', title: 'No double booking', status: 'passed' }], specs: [{ path: 'specs/book.qnt', domain: 'book', kind: 'model', title: 'Booking' }] }));
    expect((await run(['publish', '--store', 'quint', '--checks', 'checks.json'])).output).toContain('as "quint"');
    const status = JSON.parse((await run(['status', '--store', 'quint', '--format', 'json'])).output) as ReportStatus;
    expect(status.specsWithoutEvidence).toEqual(['specs/book.qnt']);
  });

  test('the same publish twice is one layer: a retried CI step is harmless', async () => {
    await run(['publish', '--store', 'again', '--producer', 'bdd', '--ctrf', 'n1.json', '--environment', 'ios']);
    await run(['publish', '--store', 'again', '--producer', 'bdd', '--ctrf', 'n1.json', '--environment', 'ios']);
    expect((JSON.parse((await run(['status', '--store', 'again', '--format', 'json'])).output) as ReportStatus).layers).toBe(1);
  });
});

describe('when the checks ran', () => {
  test('a report that does not say falls back to its own file, so publishing it again is the same layer', async () => {
    await file('plain.xml', '<testsuites><testsuite name="s"><testcase classname="C" name="a"/></testsuite></testsuites>');
    await utimes(path.join(root, 'plain.xml'), 1_700_000_000, 1_700_000_000);
    await run(['publish', '--store', 'when', '--producer', 'unit', '--junit', 'plain.xml']);
    await run(['publish', '--store', 'when', '--producer', 'unit', '--junit', 'plain.xml']);
    const status = JSON.parse((await run(['status', '--store', 'when', '--format', 'json'])).output) as ReportStatus;
    expect(status.layers).toBe(1);
  });

  test('--recorded-at wins over the report', async () => {
    await run(['publish', '--store', 'when2', '--producer', 'unit', '--ctrf', 'n1.json', '--recorded-at', '2026-01-01T00:00:00Z']);
    const keys = await directoryStore(path.join(root, 'when2')).listKeys('layers/index/');
    expect(keys[0]).toContain(String(Number.MAX_SAFE_INTEGER - Date.parse('2026-01-01T00:00:00Z')).padStart(16, '0'));
  });
});

describe('where the checks ran', () => {
  test('the CI environment names it, git fills what is left, and a pull request reports its own branch', () => {
    expect(detectOrigin({ GITHUB_SHA: 'abc', GITHUB_REF_NAME: '12/merge', GITHUB_HEAD_REF: 'feat/x', GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: 'o/r', GITHUB_RUN_ID: '9' }, () => 'git')).toEqual({ sha: 'abc', branch: 'feat/x', runUrl: 'https://github.com/o/r/actions/runs/9' });
    expect(detectOrigin({}, args => (args[0] === 'rev-parse' ? 'deadbeef' : 'main'))).toEqual({ sha: 'deadbeef', branch: 'main', runUrl: null });
    expect(detectOrigin({}, () => null)).toEqual({ sha: null, branch: null, runUrl: null });
  });
});

describe('the documentation is executable', () => {
  test('the checks file in docs/integrating.md publishes and gates exactly as the guide says', async () => {
    const guide = readFileSync(path.join(import.meta.dir, '..', '..', '..', 'docs', 'integrating.md'), 'utf8');
    const block = /```json\n(\{\n  "producer": "slo"[\s\S]*?\n\})\n```/.exec(guide)?.[1];
    expect(block).toBeDefined();
    await file('docs-checks.json', block!);
    expect((await run(['publish', '--store', 'docs-store', '--checks', 'docs-checks.json'])).output).toContain('2 checks (1 passed, 1 failed, 0 not run) as "slo"');
    const gated = await run(['status', '--store', 'docs-store', '--format', 'json']);
    expect(gated.code).toBe(1);
    expect((JSON.parse(gated.output) as ReportStatus).failing.map(item => item.check)).toEqual(['specs/latency.openslo.yaml > error budget']);
  });
});

describe('linking checks to the specs they check', () => {
  const junit = (suite: string, cases: string) => `<testsuites><testsuite name="${suite}">${cases}</testsuite></testsuites>`;

  test('a Cucumber suite is named after its feature, so --specs finds the spec; the layer records the spec it was run against', async () => {
    await file('lspecs/cart.feature', 'Feature: Shopping cart\n  Scenario: Adds\n');
    await file('lspecs/checkout.feature', 'Feature: Checkout\n  Scenario: Pays\n');
    await file('cart.xml', junit('Shopping cart', '<testcase classname="Shopping cart" name="Adds"/>'));
    await file('checkout.xml', junit('Checkout', '<testcase classname="Checkout" name="Pays"><failure message="no"/></testcase>'));
    await run(['publish', '--store', 'linked', '--producer', 'bdd', '--junit', 'cart.xml', '--specs', 'lspecs']);
    await run(['publish', '--store', 'linked', '--producer', 'bdd', '--junit', 'checkout.xml', '--specs', 'lspecs']);
    const status = JSON.parse((await run(['status', '--store', 'linked', '--format', 'json'])).output) as ReportStatus;
    expect(status.failing.map(item => [item.spec, item.check])).toEqual([['specs/checkout.feature', 'Checkout > Pays']]);
    // Both specs have results, so none is left without evidence.
    expect(status.specsWithoutEvidence).toEqual([]);
  });

  test('--spec says the whole report is one spec, over whatever path the runner wrote', async () => {
    await file('bun.xml', '<testsuites><testsuite name="t" file="tests/cart.test.ts"><testcase name="adds" file="tests/cart.test.ts"/></testsuite></testsuites>');
    await run(['publish', '--store', 'explicit', '--producer', 'unit', '--junit', 'bun.xml', '--spec', 'lspecs/cart.feature']);
    const status = JSON.parse((await run(['status', '--store', 'explicit', '--format', 'json'])).output) as ReportStatus;
    expect(status.specsWithoutEvidence).toEqual([]);
    const page = await import('../src/compose').then(module => module.combineBackends([{ id: 'x', store: directoryStore(path.join(root, 'explicit')) }]));
    expect(page.combined.unassigned).toEqual([]);
    expect(page.combined.specs.map(entry => [entry.spec.path, entry.results.length])).toEqual([['lspecs/cart.feature', 1]]);
  });

  test('a check that names nothing it can be linked by stays unlinked, never linked wrongly', async () => {
    await file('mystery.xml', junit('Something else', '<testcase classname="Unrelated" name="x"/>'));
    await run(['publish', '--store', 'unlinked', '--producer', 'unit', '--junit', 'mystery.xml', '--specs', 'lspecs']);
    const page = await import('../src/compose').then(module => module.combineBackends([{ id: 'x', store: directoryStore(path.join(root, 'unlinked')) }]));
    expect(page.combined.unassigned.map(result => result.row.specPath)).toEqual([null]);
  });
});

describe('which specs have results', () => {
  test('--specs lays results over the spec files, so a spec nobody has run is listed and can fail the gate', async () => {
    await file('sspecs/cart.feature', 'Feature: Shopping cart\n  Scenario: Adds\n');
    await file('sspecs/checkout.feature', 'Feature: Checkout\n  Scenario: Pays\n');
    await file('only-cart.xml', '<testsuites><testsuite name="Shopping cart"><testcase classname="Shopping cart" name="Adds"/></testsuite></testsuites>');
    await run(['publish', '--store', 'half', '--producer', 'bdd', '--junit', 'only-cart.xml', '--specs', 'sspecs']);

    const plain = JSON.parse((await run(['status', '--store', 'half', '--format', 'json'])).output) as ReportStatus;
    // Without the spec files, only the specs a layer mentioned are known.
    expect(plain.specsWithoutEvidence).toEqual([]);

    const lit = await run(['status', '--store', 'half', '--specs', 'sspecs', '--format', 'json']);
    const status = JSON.parse(lit.output) as ReportStatus;
    expect(lit.code).toBe(0);
    expect(status.specsWithoutEvidence).toEqual(['specs/checkout.feature']);
    expect(status.specs.map(spec => [spec.path, spec.title, spec.kind, spec.checks.total])).toEqual([['specs/cart.feature', 'Shopping cart', 'gherkin', 1], ['specs/checkout.feature', 'Checkout', 'gherkin', 0]]);
    expect(status.specs[0]!.byEnvironment).toEqual({ unspecified: expect.objectContaining({ passed: 1, total: 1 }) });
    ReportStatusSchema.parse(status);

    const strict = await run(['status', '--store', 'half', '--specs', 'sspecs', '--require-all-specs']);
    expect(strict.code).toBe(1);
    expect(strict.output).toContain('1 spec has no results: specs/checkout.feature');
    await expect(run(['status', '--store', 'half', '--require-all-specs'])).rejects.toThrow('--require-all-specs needs --specs');
  });
});

describe('mistakes that would otherwise be silent', () => {
  test('a store directory that does not exist is an error, never an empty store', async () => {
    await expect(run(['status', '--store', 'node1', '--store', 'no-such-node'])).rejects.toThrow('Store directory not found: no-such-node');
    await expect(run(['merge', '--store', 'no-such-node', '--into', 'somewhere'])).rejects.toThrow('Store directory not found');
  });

  test('publish says how many checks were linked to a spec, and how to link the rest', async () => {
    await file('hint.xml', '<testsuites><testsuite name="t"><testcase name="a"/><testcase name="b"/></testsuite></testsuites>');
    expect((await run(['publish', '--store', 'hinted', '--producer', 'unit', '--junit', 'hint.xml'])).output).toContain('; 0 of 2 linked to a spec (pass --specs <dir> or --spec <path>');
    expect((await run(['publish', '--store', 'hinted2', '--producer', 'unit', '--junit', 'hint.xml', '--spec', 'specs/x.feature'])).output).toContain('; 2 of 2 linked to a spec\n');
  });
});

describe('what the gate refuses to call a pass', () => {
  test('a report where everything was skipped has no evidence, so it does not pass', async () => {
    await file('skipped.json', ctrf([{ name: 'a', status: 'skipped' }, { name: 'b', status: 'pending' }]));
    await run(['publish', '--store', 'skipped', '--producer', 'unit', '--ctrf', 'skipped.json']);
    const result = await run(['status', '--store', 'skipped']);
    expect(result.code).toBe(1);
    expect(result.output).toContain('No check has completed');
  });

  test('required environments are spelled the way layers are: iOS and ios are one', async () => {
    const ok = await run(['status', '--store', 'node1', '--store', 'node2', '--require-environments', 'iOS']);
    expect(ok.code).toBe(0);
    const missing = await run(['status', '--store', 'node1', '--store', 'node2', '--require-environments', 'Desktop Web']);
    expect(missing.output).toContain('No checks on required environment "Desktop Web"');
  });
});

describe('a broken command is not a failed gate', () => {
  test('the terminal command returns 2 and says what is wrong, where a failed gate returns 1', async () => {
    const written: string[] = [];
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((text: string) => { written.push(String(text)); return true; }) as typeof process.stderr.write;
    try {
      expect(await runReportCommand(['status', '--store', path.join(root, 'no-such-store')])).toBe(2);
      expect(await runReportCommand(['publish'])).toBe(2);
    } finally {
      process.stderr.write = original;
    }
    expect(written.join('')).toContain('atlas report: Store directory not found');
    expect(written.join('')).toContain('atlas report: publish needs --store <dir>');
  });
});
