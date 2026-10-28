import { AtlasThemeProvider } from '../src/ui/theme';
import { afterEach, expect, test } from 'bun:test';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import type { LayerHeader } from '@crvouga/atlas/reports/evidence-types';
import { Origin } from '../src/evidence/marks';

let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = '';
});

async function render(node: ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<AtlasThemeProvider env="test">{node}</AtlasThemeProvider>);
  });
  return host;
}

const layer = (extra: Partial<LayerHeader> = {}): LayerHeader => ({
  id: 'a'.repeat(64), backend: 'ci', producer: 'web-e2e', packageDir: null, recordedAtMs: 1, sha: null, branch: 'main', environment: null, runUrl: null,
  parameters: {}, recording: null, live: false, counts: { passed: 3, failed: 0, running: 0, 'not-run': 0 }, execution: 'x', ...extra
});
const backends = [{ id: 'ci', label: 'CI', live: false, available: true }];

test('a run with every expected recording published says so, beside its green results', async () => {
  const host = await render(<Origin layer={layer({ recordings: { expected: 3, uploaded: 3, referenced: 0, skipped: 0, unresolved: 0, notApplicable: 0 } })} backends={backends} now={2} />);
  expect(host.textContent).toContain('Recordings 3 of 3');
  expect(host.textContent).not.toContain('incomplete');
});

test('a run with a missing recording is marked incomplete in words, independent of its outcomes', async () => {
  const host = await render(<Origin layer={layer({ recordings: { expected: 3, uploaded: 2, referenced: 0, skipped: 0, unresolved: 1, notApplicable: 1 } })} backends={backends} now={2} />);
  expect(host.textContent).toContain('Recordings 2 of 3: incomplete');
});

test('an old run that declared no expectations claims nothing about recordings', async () => {
  const host = await render(<Origin layer={layer()} backends={backends} now={2} />);
  expect(host.textContent).not.toContain('Recordings');
});
