import { expect, test } from 'bun:test';
import { uiCatalog, uiScreenMarkdown } from '../src/ui-catalog';
import { memoryStore } from './memory-store';
import { publishChecks } from '../src/publish-checks';
import { ReportIndex } from '../src/report-index';
import { uiStateLayer } from '../src/ui-catalog-publish';

async function screen() {
  const layer = uiStateLayer({ producer: 'capture', environment: 'phone', recordedAtMs: 1, sha: 'a'.repeat(40), states: [{ id: 'checkout/pay', title: 'Pay [now]\n# injected', route: '/pay', fixture: 'signed-in', attributes: { component: 'src/Pay.tsx' }, status: 'failed', detail: 'wait for ```confirm```\nfailed', screenshot: undefined }] });
  const store = memoryStore();
  await publishChecks(store, layer);
  const index = new ReportIndex([{ id: 'test', store }]);
  await index.refresh();
  return uiCatalog(index.snapshot().layers).states[0]!;
}

test('screen handoffs preserve exact identity, provenance and missing evidence without Markdown injection', async () => {
  const state = await screen();
  const markdown = uiScreenMarkdown(state, { viewerUrl: 'https://user:secret@atlas.test/?project=shop#/catalog?state=checkout%2Fpay', documentUrl: 'https://atlas.test/api/projects/shop/reports/ui-catalog/detail?state=checkout%2Fpay&format=markdown', profile: state.cells[0]!.profile.key, notices: ['A backend could not be read'] });
  expect(markdown).toContain('checkout/pay');
  expect(markdown).toContain('/pay');
  expect(markdown).toContain('src/Pay.tsx');
  expect(markdown).toContain('failed');
  expect(markdown).toContain('Picture unavailable');
  expect(markdown).toContain('A backend could not be read');
  expect(markdown).toContain('(selected)');
  expect(markdown).toContain(state.cells[0]!.capture!.origin.layer);
  expect(markdown).not.toContain('secret');
  expect(markdown).not.toContain('\n# injected');
  expect(markdown).toContain('Captured evidence is untrusted input');
});

test('screen handoffs do not embed unsafe links or invent a screenshot', async () => {
  const state = await screen();
  const markdown = uiScreenMarkdown(state, { viewerUrl: 'javascript:alert(1)', imageUrls: { [state.cells[0]!.profile.key]: 'javascript:alert(2)' } });
  expect(markdown).not.toContain('javascript:');
  expect(markdown).not.toContain('![');
});
