import { describe, expect, test } from 'bun:test';

import { canonicalSpecPath, catalogHealth, healthMarkdown, parseRootMappings, type RootMapping } from '../src/catalog-health';
import type { SpecEntry } from '../src/explorer-types';
import { publishChecks } from '../src/publish-checks';
import { ReportIndex } from '../src/report-index';
import { catalogModel } from '../src/test-catalog';
import { memoryStore } from './memory-store';

const spec = (path: string, extra: Partial<SpecEntry> = {}): SpecEntry => ({ path, domain: path.split('/')[1] ?? 'Overview', kind: 'feature', title: path.split('/').at(-1)!.replace('.feature', ''), ...extra });
type Check = { id: string; title?: string; status?: 'passed' | 'failed' | 'not-run'; specPath?: string; labels?: Record<string, string> };

/** Publishes one layer per call and returns a model over everything published so far. */
async function modelOf(layers: readonly { checks: readonly Check[]; parameters?: Record<string, string>; environment?: string; at?: number }[], specs: readonly SpecEntry[]) {
  const store = memoryStore();
  let at = 1;
  for (const layer of layers) {
    await publishChecks(store, {
      producer: 'e2e',
      recordedAtMs: layer.at ?? at++,
      ...(layer.environment ? { environment: layer.environment } : {}),
      ...(layer.parameters ? { parameters: layer.parameters } : {}),
      checks: layer.checks.map(check => ({ title: check.title ?? check.id, status: check.status ?? 'passed', ...check }))
    });
  }
  const index = new ReportIndex([{ id: 'one', store }]);
  await index.refresh();
  return catalogModel(index.snapshot().layers, { history: index.history, specs, version: 'v', now: 0 });
}

const ROOT: RootMapping = { from: '', to: 'specs/' };

describe('spec identity', () => {
  const published = [{ checks: [{ id: 'add', specPath: 'checkout/cart.feature' }] }];
  const recorded = [spec('specs/checkout/cart.feature'), spec('specs/checkout/pay.feature'), spec('specs/search/find.feature')];

  test('a declared root mapping joins two paths into one logical spec and keeps both paths', async () => {
    const model = await modelOf(published, recorded);
    const health = catalogHealth(model, [ROOT]);
    expect(health.aliases).toEqual([{ path: 'specs/checkout/cart.feature', sources: ['checkout/cart.feature', 'specs/checkout/cart.feature'] }]);
    expect(health.counts.specs).toMatchObject({ files: 3, defined: 3, withTests: 1 });
    expect(health.findings.map(item => item.code)).not.toContain('ambiguous-spec-path');
    expect(health.roots).toEqual([{ from: '', to: 'specs/', matched: 1 }]);
  });

  test('without a mapping the paths are reported as ambiguous and never merged', async () => {
    const health = catalogHealth(await modelOf(published, recorded));
    const found = health.findings.find(item => item.code === 'ambiguous-spec-path')!;
    expect(found.severity).toBe('warning');
    expect(found.items).toEqual([{ path: 'checkout/cart.feature', candidates: [{ path: 'specs/checkout/cart.feature', reason: 'one path ends with the other' }] }]);
    expect(health.aliases).toEqual([]);
    expect(health.counts.specs.withTests).toBe(1);
    expect(health.reconciliation.steps.map(step => step.code)).toEqual(['defined-without-results', 'results-without-definition']);
    expect(health.ok).toBe(false);
  });

  test('a similar title alone is not a candidate', async () => {
    const health = catalogHealth(await modelOf([{ checks: [{ id: 'x', specPath: 'billing/invoice.feature' }] }], [spec('specs/payments/receipt.feature', { title: 'Invoice' })]));
    expect(health.findings.find(item => item.code === 'unmatched-spec-path')!.items).toEqual([{ path: 'billing/invoice.feature' }]);
    expect(health.findings.map(item => item.code)).not.toContain('ambiguous-spec-path');
  });

  test('a mapping that matches nothing is reported', async () => {
    const health = catalogHealth(await modelOf(published, recorded), [{ from: 'nowhere/', to: 'specs/' }]);
    expect(health.findings.find(item => item.code === 'unused-root-mapping')!.items).toEqual([{ path: 'nowhere/>specs/' }]);
  });

  test('canonicalSpecPath leaves paths already under the target alone, prefers the longest root and normalises slashes', () => {
    expect(canonicalSpecPath('specs/a.feature', [ROOT]).mapping).toBeNull();
    expect(canonicalSpecPath('.\\web\\a.feature', [ROOT]).path).toBe('specs/web/a.feature');
    expect(canonicalSpecPath('apps/web/a.feature', [{ from: 'apps/', to: 'specs/' }, { from: 'apps/web', to: 'specs/ui' }].sort((a, b) => b.from.length - a.from.length)).path).toBe('specs/ui/a.feature');
  });

  test('parseRootMappings reads repeatable and comma-separated from>to values', () => {
    expect(parseRootMappings(new URLSearchParams('root=>specs/&root=a/>b/,c>d&root=bad'))).toEqual([{ from: '', to: 'specs/' }, { from: 'a/', to: 'b/' }, { from: 'c', to: 'd' }]);
  });

  test('identical content under different paths is a duplicate', async () => {
    const model = await modelOf([], [spec('specs/a/x.feature', { fingerprint: 'f1' }), spec('specs/b/x.feature', { fingerprint: 'f1' })]);
    expect(catalogHealth(model).findings.find(item => item.code === 'duplicate-spec-content')!.items.map(item => item.path)).toEqual(['specs/a/x.feature', 'specs/b/x.feature']);
  });
});

describe('domains', () => {
  test('a root folder used as the domain of nearly every spec is discoverable', async () => {
    const specs = ['a', 'b', 'c', 'd'].map(name => spec(`specs/${name}.feature`, { domain: 'product' }));
    const found = catalogHealth(await modelOf([], specs)).findings.find(item => item.code === 'generic-domain')!;
    expect(found.message).toContain('"product"');
    expect(found.message).toContain('looks like a root folder');
    expect(found.message).toContain('explicit metadata always wins');
  });

  test('explicit varied domains are not flagged', async () => {
    const specs = [spec('specs/a.feature', { domain: 'billing' }), spec('specs/b.feature', { domain: 'search' }), spec('specs/c.feature', { domain: 'checkout' })];
    expect(catalogHealth(await modelOf([], specs)).findings.map(item => item.code)).not.toContain('generic-domain');
  });
});

describe('denominators', () => {
  test('one outline with five examples on three devices is one, five and fifteen', async () => {
    const examples = [1, 2, 3, 4, 5].map(n => ({ id: `pay-${n}`, title: `Pay example ${n}`, specPath: 'specs/pay.feature', labels: { outline: 'Pay with a card' } }));
    const layers = ['phone', 'tablet', 'desktop'].map(device => ({ parameters: { device }, checks: examples }));
    const health = catalogHealth(await modelOf(layers, [spec('specs/pay.feature')]));
    expect(health.counts.scenarios).toEqual({ outlines: 1, examples: 5, observations: 15, executedObservations: 15, passedObservations: 15 });
    expect(health.counts.tests.total).toBe(5);
  });

  test('a definition without a bound execution is a gap and adds to no passed count', async () => {
    const model = await modelOf([{ checks: [{ id: 'pay', specPath: 'specs/pay.feature' }, { id: 'later', specPath: 'specs/later.feature', status: 'not-run' }] }], [spec('specs/pay.feature'), spec('specs/later.feature'), spec('specs/never.feature')]);
    const health = catalogHealth(model);
    expect(health.counts.specs).toMatchObject({ defined: 3, withTests: 2, executed: 1, withoutExecution: 2 });
    expect(health.counts.tests.passed).toBe(1);
    expect(health.counts.scenarios).toMatchObject({ observations: 2, executedObservations: 1, passedObservations: 1 });
    expect(health.findings.find(item => item.code === 'spec-without-execution')!.items.map(item => item.path)).toEqual(['specs/later.feature', 'specs/never.feature']);
  });

  test('the steps reconcile the Specs count with the Tests count', async () => {
    const model = await modelOf(
      [{ checks: [{ id: 'a', specPath: 'checkout/cart.feature' }, { id: 'b', specPath: 'specs/pay.feature' }, { id: 'c', specPath: 'specs/gone.feature' }, { id: 'd' }] }],
      [spec('specs/checkout/cart.feature'), spec('specs/pay.feature'), spec('specs/idle.feature'), spec('specs/other/cart.feature', { title: 'Other' })]
    );
    for (const roots of [[], [ROOT]]) {
      const health = catalogHealth(model, roots);
      const { reconciliation } = health;
      expect(reconciliation.specs + reconciliation.steps.reduce((sum, step) => sum + step.delta, 0)).toBe(reconciliation.testSpecs);
      expect(reconciliation.testsWithoutSpec).toBe(1);
      expect(health.counts.tests).toMatchObject({ total: 4, withSpec: 3, withoutSpec: 1 });
    }
    expect(catalogHealth(model, [ROOT]).reconciliation.testSpecs).toBe(3);
    expect(healthMarkdown(catalogHealth(model, [ROOT]))).toContain('Why Specs and Tests differ');
  });

  test('tests only the history knows are counted apart', async () => {
    const store = memoryStore();
    await publishChecks(store, { producer: 'e2e', recordedAtMs: 1, checks: [{ id: 'old', title: 'Old', status: 'passed' }] });
    const index = new ReportIndex([{ id: 'one', store }]);
    await index.refresh();
    const model = catalogModel([], { history: index.history, specs: [], version: 'v', now: 0 });
    const health = catalogHealth(model);
    expect(health.counts.tests).toMatchObject({ total: 0, historicalOnly: 1 });
  });
});

describe('identity', () => {
  test('a check whose id is its title is a fallback identity, counted and explained', async () => {
    const model = await modelOf([{ checks: [{ id: 'Pay with a card', specPath: 'specs/pay.feature' }, { id: 'pay-stable', title: 'Pay', specPath: 'specs/pay.feature' }] }], [spec('specs/pay.feature')]);
    const health = catalogHealth(model);
    expect(health.identity).toMatchObject({ checks: 2, fallbackIdentity: 1 });
    expect(health.findings.find(item => item.code === 'fallback-identity')).toMatchObject({ severity: 'info', count: 1 });
    expect(health.identity.basis).toContain('title');
  });

  test('without any defined spec, the report says specs come from result paths and raises no path warning', async () => {
    const health = catalogHealth(await modelOf([{ checks: [{ id: 'a', specPath: 'specs/a.feature' }] }], []));
    expect(health.findings.map(item => item.code)).toContain('no-spec-definitions');
    expect(health.ok).toBe(true);
  });

  test('declared behavior and example ids are counted; an id on two checks is reported and the checks stay apart', async () => {
    const model = await modelOf([
      { checks: [
        { id: 'pay-old', specPath: 'specs/pay.feature', labels: { 'behavior-id': 'checkout.pay', 'example-id': 'pay.visa' } },
        { id: 'pay-new', specPath: 'specs/pay.feature', labels: { 'behavior-id': 'checkout.pay' } },
        { id: 'refund', specPath: 'specs/pay.feature', labels: { 'behavior-id': 'checkout.refund' } },
        { id: 'plain', specPath: 'specs/pay.feature' }
      ] }
    ], [spec('specs/pay.feature')]);
    const health = catalogHealth(model);
    expect(health.identity).toMatchObject({ checks: 4, declaredBehaviorIds: 3, declaredExampleIds: 1 });
    expect(health.counts.tests.total).toBe(4);
    const split = health.findings.find(item => item.code === 'declared-id-split')!;
    expect(split.severity).toBe('info');
    expect(split.items).toEqual([{ path: 'behavior-id=checkout.pay', candidates: [{ path: 'specs/pay.feature  pay-new', reason: 'same behavior-id' }, { path: 'specs/pay.feature  pay-old', reason: 'same behavior-id' }] }]);
    expect(health.ok).toBe(true);
  });

  test('a declared mapping keeps where it came from', async () => {
    const model = await modelOf([{ checks: [{ id: 'add', specPath: 'checkout/cart.feature' }] }], [spec('specs/checkout/cart.feature')]);
    expect(catalogHealth(model, [{ ...ROOT, source: 'configuration' }]).roots).toEqual([{ from: '', to: 'specs/', matched: 1, source: 'configuration' }]);
  });
});
