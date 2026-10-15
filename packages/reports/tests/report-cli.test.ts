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

async function run(args: string[], env: Record<string, string> = {}, git: (args: readonly string[]) => string | null = () => null) {
  let output = '';
  const code = await reportMain(args, { out: text => { output += text; }, env, cwd: root, git, clock: () => 1_700_000_000_000 });
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
    expect(detectOrigin({ GITHUB_SHA: 'abc', GITHUB_REF_NAME: '12/merge', GITHUB_HEAD_REF: 'feat/x', GITHUB_SERVER_URL: 'https://github.com', GITHUB_REPOSITORY: 'o/r', GITHUB_RUN_ID: '9' }, () => 'git')).toEqual({ sha: 'abc', branch: 'feat/x', runUrl: 'https://github.com/o/r/actions/runs/9', ci: true });
    expect(detectOrigin({}, args => (args[0] === 'rev-parse' ? 'deadbeef' : 'main'))).toEqual({ sha: 'deadbeef', branch: 'main', runUrl: null, ci: false });
    expect(detectOrigin({}, () => null)).toEqual({ sha: null, branch: null, runUrl: null, ci: false });
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

    // Publishing with --specs also publishes the specs, so a checkout is not needed to know what to expect.
    const plain = JSON.parse((await run(['status', '--store', 'half', '--format', 'json'])).output) as ReportStatus;
    expect(plain.specsWithoutEvidence).toEqual(['specs/checkout.feature']);

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
    // With no directory given, the store's own spec set says what to expect; a store without one cannot.
    expect((await run(['status', '--store', 'half', '--require-all-specs'])).code).toBe(1);
    await expect(run(['status', '--store', 'node1', '--require-all-specs'])).rejects.toThrow('needs to know which specs to expect');
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

  test('merge says what it left behind', async () => {
    await file('mixed/versions/' + 'a'.repeat(40) + '.json', '{}');
    await run(['publish', '--store', 'mixed', '--producer', 'unit', '--ctrf', 'n1.json']);
    expect((await run(['merge', '--store', 'mixed', '--into', 'mixed-all'])).output).toContain('1 objects outside layers/ were not copied');
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
    expect(written.join('')).toContain('atlas report: Give --store <dir or s3://bucket/prefix>, or set ATLAS_STORE');
  });
});

describe('a store given as a URL or by the environment', () => {
  test('ATLAS_STORE is the default, so a developer sets it once', async () => {
    await file('env.xml', '<testsuites><testsuite name="s"><testcase classname="C" name="a"/></testsuite></testsuites>');
    const env = { ATLAS_STORE: path.join(root, 'from-env') };
    expect((await run(['publish', '--producer', 'unit', '--junit', 'env.xml'], env)).code).toBe(0);
    const status = JSON.parse((await run(['status', '--format', 'json'], env)).output) as ReportStatus;
    expect(status.checks.total).toBe(1);
    await expect(run(['publish', '--producer', 'unit', '--junit', 'env.xml'], { ATLAS_STORE: 'a,b' })).rejects.toThrow('Give one --store');
  });

  test('keys do not belong in a URL, and an unknown scheme is refused', async () => {
    await expect(run(['status', '--store', 's3://KEY:SECRET@bucket/p'])).rejects.toThrow('Keys do not belong in a store URL');
    await expect(run(['status', '--store', 'ftp://host/p'])).rejects.toThrow('Unsupported store');
    await expect(run(['status', '--store', 's3:///p'])).rejects.toThrow();
  });

  test('policy prints the least-privilege policy for the bucket and folder', async () => {
    const policy = JSON.parse((await run(['policy', '--store', 's3://my-bucket/atlas/shop', '--role', 'both'])).output) as { Statement: { Sid: string; Action: string | string[]; Resource: string; Condition?: unknown }[] };
    const byId = Object.fromEntries(policy.Statement.map(statement => [statement.Sid, statement]));
    expect(byId.AtlasPublish!.Resource).toBe('arn:aws:s3:::my-bucket/atlas/shop/layers/*');
    expect(byId.AtlasPublish!.Action).toEqual(['s3:PutObject', 's3:GetObject']);
    expect(byId.AtlasLiveRuns!.Resource).toBe('arn:aws:s3:::my-bucket/atlas/shop/server/live/*');
    expect(byId.AtlasLiveRuns!.Action).toEqual(['s3:GetObject', 's3:PutObject']);
    expect(byId.AtlasList!.Resource).toBe('arn:aws:s3:::my-bucket');
    expect(JSON.stringify(byId.AtlasList!.Condition)).toContain('atlas/shop/');
    // A HEAD of a missing layer carries no prefix: the condition must not apply to it, or S3 answers 403 instead of 404.
    expect(Object.keys(byId.AtlasList!.Condition as object)).toEqual(['StringLikeIfExists']);
    const reader = JSON.parse((await run(['policy', '--store', 's3://my-bucket/atlas/shop', '--role', 'reader'])).output) as { Statement: { Action: unknown }[] };
    expect(JSON.stringify(reader)).not.toContain('PutObject');
    await expect(run(['policy', '--store', 'somewhere'])).rejects.toThrow('policy needs one --store s3://');
  });
});

describe('publishing from a developer machine', () => {
  const ci = { GITHUB_SHA: 'a'.repeat(40), GITHUB_REF_NAME: 'main' };
  const layerOf = async (store: string) => {
    const opened = directoryStore(path.join(root, store));
    const [manifest] = await opened.listKeys('layers/manifests/');
    return JSON.parse(new TextDecoder().decode(new Uint8Array(await new Response((await opened.get(manifest!))!.body).arrayBuffer()))) as { freshness?: string; branch: string | null };
  };

  test('a worktree with edits to tracked files is marked modified; untracked files do not count', async () => {
    const edited = (args: readonly string[]) => (args[0] === 'status' ? ' M specs/join.feature' : args[0] === 'rev-parse' ? 'b'.repeat(40) : args[0] === 'branch' ? 'feat/x' : null);
    const out = await run(['publish', '--store', 'dev-edited', '--producer', 'unit', '--junit', 'env.xml'], {}, edited);
    expect(out.output).toContain('[from a modified checkout]');
    expect(await layerOf('dev-edited')).toMatchObject({ freshness: 'modified', branch: 'feat/x' });
    const clean = (args: readonly string[]) => (args[0] === 'rev-parse' ? 'b'.repeat(40) : args[0] === 'branch' ? 'feat/x' : null);
    await run(['publish', '--store', 'dev-clean', '--producer', 'unit', '--junit', 'env.xml'], {}, clean);
    expect((await layerOf('dev-clean')).freshness).toBeUndefined();
  });

  test('outside git the origin is unknown; in CI the checkout is the commit', async () => {
    await run(['publish', '--store', 'dev-nogit', '--producer', 'unit', '--junit', 'env.xml']);
    expect((await layerOf('dev-nogit')).freshness).toBe('unknown');
    await run(['publish', '--store', 'dev-ci', '--producer', 'unit', '--junit', 'env.xml'], ci);
    expect((await layerOf('dev-ci')).freshness).toBeUndefined();
  });

  test('--specs publishes the specs too, once per commit, and --upload-run sends the run for the viewer', async () => {
    const clean = (args: readonly string[]) => (args[0] === 'rev-parse' ? 'c'.repeat(40) : args[0] === 'branch' ? 'main' : args[0] === 'show' ? '1700000000' : null);
    await file('pspecs/cart.feature', 'Feature: Shopping cart\n  Scenario: Adds\n');
    await file('prun/2026-10-09T12-00-00-000Z-fast/manifest.json', JSON.stringify({ run: { id: 'r', startedAt: '2026-10-09T12:00:00.000Z', finishedAt: '2026-10-09T12:01:00.000Z', durationMs: 1, mode: 'fast', commit: 'c'.repeat(40) }, paths: [{ id: 'p', key: 'k1', name: 'Adds', kind: 'journey', status: 'passed', steps: [] }], privacy: { passed: true, findings: [] } }));
    const first = await run(['publish', '--store', 'dev-all', '--producer', 'statecharts', '--manifest', 'prun/2026-10-09T12-00-00-000Z-fast/manifest.json', '--specs', 'pspecs', '--upload-run'], {}, clean);
    expect(first.output).toContain('Published spec set');
    expect(first.output).toContain('Uploaded run 2026-10-09T12-00-00-000Z-fast');
    const again = await run(['publish', '--store', 'dev-all', '--producer', 'statecharts', '--manifest', 'prun/2026-10-09T12-00-00-000Z-fast/manifest.json', '--specs', 'pspecs', '--upload-run'], {}, clean);
    expect(again.output).toContain('was already in the store');
    const keys = await directoryStore(path.join(root, 'dev-all')).listKeys('layers/specs/sets/');
    expect(keys.length).toBe(1);
    await expect(run(['publish', '--store', 'dev-all', '--producer', 'x', '--junit', 'env.xml', '--upload-run'])).rejects.toThrow('--upload-run goes with --manifest');
  });
});

describe('doctor', () => {
  test('a healthy directory store passes every step; a reader and a publisher are checked for what they do', async () => {
    const all = await run(['doctor', '--store', 'node1']);
    expect(all.code).toBe(0);
    expect(all.output).toContain('✓ contents');
    expect(all.output).toContain('✓ write');
    expect(all.output).toContain('All good.');
    expect((await run(['doctor', '--store', 'node1', '--role', 'reader'])).output).not.toContain('write');
    expect((await run(['doctor', '--store', 'node1', '--role', 'publisher'])).output).toContain('wrote and found a scratch object');
    await expect(run(['doctor', '--store', 'node1', '--role', 'admin'])).rejects.toThrow('--role takes');
  });

  test('a store that cannot be reached says what to do about it', async () => {
    const dead = { store: { ...(await import('./memory-store')).memoryStore(), listKeys: async () => { throw new Error('connection refused'); } }, id: 'dead', label: 'Dead' };
    const { inspectStore } = await import('../src/doctor');
    const checks = await inspectStore(dead as never);
    expect(checks.find(check => !check.ok)).toMatchObject({ name: 'contents', detail: 'connection refused' });
  });
});

describe('narrowing a report', () => {
  test('a gate for a branch can leave out the rest, and work in progress from laptops', async () => {
    const edited = (args: readonly string[]) => (args[0] === 'status' ? ' M specs/join.feature' : args[0] === 'rev-parse' ? 'd'.repeat(40) : args[0] === 'branch' ? 'feat/wip' : null);
    const clean = (args: readonly string[]) => (args[0] === 'rev-parse' ? 'e'.repeat(40) : args[0] === 'branch' ? 'main' : null);
    await file('good.xml', '<testsuites><testsuite name="s" timestamp="2026-10-14T10:00:00Z"><testcase name="a" file="specs/x.feature"/></testsuite></testsuites>');
    await file('bad.xml', '<testsuites><testsuite name="s" timestamp="2026-10-14T11:00:00Z"><testcase name="a" file="specs/x.feature"><failure message="wip"/></testcase></testsuite></testsuites>');
    await run(['publish', '--store', 'narrow', '--producer', 'unit', '--junit', 'good.xml'], {}, clean);
    await run(['publish', '--store', 'narrow', '--producer', 'unit', '--junit', 'bad.xml'], {}, edited);
    // Everything takes part by default: the newest result is the laptop's.
    expect((await run(['status', '--store', 'narrow'])).code).toBe(1);
    expect((await run(['status', '--store', 'narrow', '--ignore-modified'])).code).toBe(0);
    expect((await run(['status', '--store', 'narrow', '--branch', 'main'])).code).toBe(0);
    expect((await run(['status', '--store', 'narrow', '--branch', 'feat/wip'])).code).toBe(1);
    expect((await run(['status', '--store', 'narrow'], { ATLAS_IGNORE_MODIFIED: '1' })).code).toBe(0);
  });
});

describe('a store named by the environment may have spaces in it', () => {
  test('ATLAS_STORE splits on commas and new lines, not on spaces', async () => {
    await file('My Reports/placeholder.txt', 'x');
    await file('env2.xml', '<testsuites><testsuite name="s"><testcase classname="C" name="a"/></testsuite></testsuites>');
    const env = { ATLAS_STORE: path.join(root, 'My Reports') };
    expect((await run(['publish', '--producer', 'unit', '--junit', 'env2.xml'], env)).code).toBe(0);
    expect(JSON.parse((await run(['status', '--format', 'json'], env)).output).checks.total).toBe(1);
    const two = { ATLAS_STORE: `${path.join(root, 'My Reports')},${path.join(root, 'node1')}` };
    expect(JSON.parse((await run(['status', '--format', 'json'], two)).output).backends.length).toBe(2);
  });
});

describe('atlas report --format json: every command answers in a document an agent can parse', () => {
  test('publish, merge, doctor and stream print documents that match their schemas', async () => {
    const { PublishResultSchema, MergeResultSchema, DoctorResultSchema, StreamResultSchema, CommandErrorSchema } = await import('../../schema/src/cli-results');
    await file('j1.json', ctrf([{ name: 'a', status: 'passed', filePath: 'specs/j.feature' }, { name: 'b', status: 'failed', filePath: 'specs/j.feature' }, { name: 'c', status: 'skipped' }]));
    const published = await run(['publish', '--store', 'jstore', '--producer', 'bdd', '--ctrf', 'j1.json', '--environment', 'ios', '--format', 'json']);
    expect(published.code).toBe(0);
    const result = PublishResultSchema.parse(JSON.parse(published.output));
    expect(result.layer).toMatchObject({ producer: 'bdd', environment: 'ios', checks: 3, passed: 1, failed: 1, notRun: 1 });
    expect(result.layer.id).toMatch(/^[0-9a-f]{64}$/);
    // Same input, same layer: a retry is invisible.
    expect(PublishResultSchema.parse(JSON.parse((await run(['publish', '--store', 'jstore', '--producer', 'bdd', '--ctrf', 'j1.json', '--environment', 'ios', '--json'])).output)).layer.id).toBe(result.layer.id);

    const merged = MergeResultSchema.parse(JSON.parse((await run(['merge', '--store', 'jstore', '--into', 'jall', '--format', 'json'])).output));
    expect(merged.copied).toBeGreaterThan(0);
    const doctor = await run(['doctor', '--store', 'jall', '--format', 'json']);
    expect(DoctorResultSchema.parse(JSON.parse(doctor.output)).ok).toBe(true);

    let said = '';
    const streamed = await reportMain(['stream', '--store', 'jstream', '--producer', 'live', '--format', 'json', '--flush-ms', '0'], { out: text => { said += text; }, env: {}, cwd: root, git: () => null, stdin: (async function* () { yield '{"id":"a","title":"a","status":"passed"}\nnot json\n'; })() });
    expect(streamed).toBe(0);
    expect(StreamResultSchema.parse(JSON.parse(said))).toMatchObject({ ok: true, checks: 1, lost: 0, warnings: [expect.stringContaining('line 2 skipped')] });
  });

  test('a command that is wrong is a document on standard error, and exit code 2', async () => {
    const { CommandErrorSchema } = await import('../../schema/src/cli-results');
    let err = '';
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((text: string) => { err += text; return true; }) as typeof process.stderr.write;
    try {
      expect(await runReportCommand(['publish', '--format', 'json'])).toBe(2);
    } finally {
      process.stderr.write = original;
    }
    expect(CommandErrorSchema.parse(JSON.parse(err))).toMatchObject({ ok: false, error: { code: 'usage' } });
  });
});
