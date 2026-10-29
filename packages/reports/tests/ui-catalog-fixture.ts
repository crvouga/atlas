import { publishChecks } from '../src/publish-checks';
import { ReportIndex } from '../src/report-index';
import { uiCatalog, type UiCatalog } from '../src/ui-catalog';
import { uiPlanLayer, uiStateLayer } from '../src/ui-catalog-publish';
import { memoryStore } from './memory-store';

const png = (seed: string) => new TextEncoder().encode(`png:${seed}`);
const SHA = 'a'.repeat(40);

/**
 * The catalog `fixtures/ui-catalog-v1.json` was written from: two producers, two profiles, a failed capture, a state a plan expects
 * that nothing captured, a capture no plan names, a surface nothing covers, attributes and a picture given only by address.
 * Every time is fixed, so the same code writes the same document. If this changes, the fixture does not: see `ui-catalog-contract.test.ts`.
 */
export async function contractCatalog(): Promise<UiCatalog> {
  const store = memoryStore();
  const desktop = { environment: 'desktop-web', profile: { viewport: '1280x800', scheme: 'light' } } as const;
  const mobile = { environment: 'mobile-web', profile: { viewport: '390x844', scheme: 'dark' } } as const;
  const origin = { sha: SHA, branch: 'main', runUrl: 'https://ci.example.com/runs/1' } as const;
  for (const where of [desktop, mobile]) {
    await publishChecks(store, uiPlanLayer({
      producer: 'planner', recordedAtMs: 1_000, ...where, ...origin,
      states: [{ id: 'checkout/payment', covers: ['payment-form'] }, { id: 'checkout/receipt' }, { id: 'settings', inventory: true }, { id: 'payment-form', inventory: true }]
    }));
  }
  await publishChecks(store, uiStateLayer({
    producer: 'web-capture', recordedAtMs: 2_000, ...desktop, ...origin, shard: '1/2',
    states: [
      { id: 'checkout/payment', title: 'Payment', route: '/checkout', area: 'checkout', cohort: 'new-customer', kind: 'screen', flags: ['new-nav'], covers: ['payment-form'], attributes: { locale: 'en-US', brand: 'acme' }, screenshot: { data: png('payment-desktop'), width: 1280, height: 800 } },
      { id: 'account', title: 'Account', route: '/account', area: 'account', screenshot: { data: png('account-desktop'), width: 1280, height: 800 } }
    ]
  }));
  await publishChecks(store, uiStateLayer({
    producer: 'device-farm', recordedAtMs: 3_000, ...mobile, ...origin, shard: '2/2',
    states: [
      { id: 'checkout/payment', title: 'Payment', route: '/checkout', area: 'checkout', attributes: { locale: 'de-DE' }, status: 'failed', detail: 'The total never became visible', screenshot: { data: png('payment-mobile-failed'), width: 390, height: 844 } },
      { id: 'account', title: 'Account', route: '/account', area: 'account', screenshot: { uri: 'https://pictures.example.com/account-mobile.png', width: 390, height: 844 } }
    ]
  }));
  const index = new ReportIndex([{ id: 'ci', store }]);
  await index.refresh();
  const snapshot = index.snapshot();
  return uiCatalog(snapshot.layers, { backends: snapshot.backends, notices: snapshot.notices });
}
