import react from '@vitejs/plugin-react';
import type { StorybookConfig } from '@storybook/react-vite';
import { createReportsApp } from '../packages/reports/src/reports-route';
import { ReportIndex } from '../packages/reports/src/report-index';
import { catalogEntries } from '../packages/reports/src/ui-catalog-entries';
import { buildCritique } from '../packages/critics/src/critique';
import { publishCritiques } from '../packages/critics/src/publish';
import { readLayer } from '../packages/reports/src/layer-store';
import { specEntry } from '../packages/reports/src/spec-inventory';
import { uiCatalog } from '../packages/reports/src/ui-catalog';
import { catalogModel } from '../packages/reports/src/test-catalog';
import { combineEvidence } from '../packages/reports/src/layer-merge';
import { evidenceView } from '../packages/reports/src/evidence-view';
import { COVERAGE_ORDER } from '../packages/visualizer/src/evidence/behavior';
import { indexBehaviors } from '../packages/visualizer/src/evidence/behavior-index';
import type { ObjectStore } from '../packages/reports/src/object-store';
import type { EvidencePage, LayerEvidence } from '../packages/reports/src/evidence-types';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { publishChecks } from '../packages/reports/src/publish-checks';
import { uiPlanLayer, uiStateLayer } from '../packages/reports/src/ui-catalog-publish';
import { exampleReports } from '../packages/visualizer/vite/example-reports';

const root = fileURLToPath(new URL('../', import.meta.url));
const fixtureRoot = path.join(root, 'packages/visualizer/fixtures/spec-only/specs');
const config: StorybookConfig = {
  framework: { name: '@storybook/react-vite', options: { builder: { viteConfigPath: fileURLToPath(new URL('./vite.config.ts', import.meta.url)) } } },
  stories: ['../packages/visualizer/stories/**/*.stories.tsx'],
  addons: ['@storybook/addon-a11y'],
  staticDirs: [{ from: '../packages/visualizer/fixtures/partial/runs/2026-10-06T15-05-00-000Z-showcase', to: '/story-assets' }],
  core: { disableTelemetry: true },
  async viteFinal(config) {
    const specs: Record<string, string> = {};
    for (const file of new Bun.Glob('**/*').scanSync({ cwd: fixtureRoot, onlyFiles: true })) specs[file] = readFileSync(path.join(fixtureRoot, file), 'utf8');
    const coverageNames = ['Demonstrated', 'Older recording', 'Recording missing', 'No recording', 'API only', 'Failed', 'Running', 'Skipped', 'Parked', 'Not executed'];
    const coveragePath = 'storybook/coverage.feature';
    specs[coveragePath] = 'Feature: Evidence states\n' + coverageNames.map(name => `  ${name === 'Parked' ? '@parked\n  ' : ''}Scenario: ${name}\n    When reviewing the evidence\n    Then its meaning is explicit\n`).join('\n');
    const deps = await exampleReports(specs);
    if (!deps) throw new Error('Storybook requires the coffee example report');
    const clip = new Uint8Array(readFileSync(path.join(root, 'packages/visualizer/fixtures/partial/runs/2026-10-06T14-40-00-000Z-showcase/media/clips/journey-1/01.mp4')));
    for (const [index, name] of coverageNames.entries()) {
      if (name === 'Parked' || name === 'Not executed') continue;
      const spec = specEntry(`specs/${coveragePath}`, specs[coveragePath]!);
      await publishChecks(deps.store!, {
        producer: 'storybook-behaviors', recordedAtMs: Date.parse('2026-10-14T12:00:00Z') + index,
        sha: 'c0ffee' + '1'.repeat(34), branch: 'main', kind: 'behavior',
        environment: name === 'API only' ? 'api' : 'desktop-web',
        specs: [{ ...spec, ...(name === 'Older recording' ? { fingerprint: 'earlier-revision' } : {}) }],
        checks: [{ id: name.toLowerCase().replaceAll(' ', '-'), title: `Evidence states: ${name}`, specPath: `specs/${coveragePath}`,
          status: name === 'Failed' ? 'failed' : name === 'Running' ? 'running' : name === 'Skipped' ? 'not-run' : 'passed',
          detail: name === 'Failed' ? 'The expected confirmation did not appear.' : '',
          ...(name === 'Recording missing' ? { recordingExpectation: 'required', attachments: [{ name: 'missing.mp4', role: 'video', contentType: 'video/mp4', omitted: 'policy' }] } : {}),
          ...(['Demonstrated', 'Older recording'].includes(name) ? { recordingExpectation: 'required', attachments: [{ name: 'order.mp4', role: 'video', contentType: 'video/mp4', data: clip }] } : {})
        }]
      });
    }
    const catalogStates = [
      { id: 'coffee/menu', title: 'Browse the coffee menu', area: 'Ordering', route: '/menu', kind: 'screen', covers: ['ordering'] },
      { id: 'coffee/cart', title: 'Review your order', area: 'Ordering', route: '/cart', kind: 'screen', covers: ['ordering'] },
      { id: 'coffee/loading', title: 'Submitting an order', area: 'Checkout', route: '/checkout', kind: 'loading', covers: ['checkout'] },
      { id: 'coffee/error', title: 'Payment could not be completed', area: 'Checkout', route: '/checkout', kind: 'error', covers: ['checkout'] },
      { id: 'coffee/empty', title: 'Your cart is empty', area: 'Ordering', route: '/cart', kind: 'empty', covers: ['ordering'] }
    ];
    for (const environment of ['desktop-web', 'mobile-web']) {
      const origin = { producer: 'storybook-capture', recordedAtMs: Date.parse('2026-10-14T12:00:00Z'), sha: 'c0ffee' + '1'.repeat(34), branch: 'main', environment, profile: { viewport: environment === 'desktop-web' ? '1280x800' : '390x844', scheme: 'light' } };
      await publishChecks(deps.store!, uiPlanLayer({ ...origin, states: catalogStates }));
      await publishChecks(deps.store!, uiStateLayer({ ...origin, states: [
        { ...catalogStates[0]!, screenshot: { data: new Uint8Array(readFileSync(path.join(root, 'packages/visualizer/fixtures/partial/runs/2026-10-06T15-05-00-000Z-showcase/media/paths/journey-1/02.png'))), width: 390, height: 844 } },
        { ...catalogStates[1]!, screenshot: { data: new Uint8Array(readFileSync(path.join(root, 'packages/visualizer/fixtures/partial/runs/2026-10-06T15-05-00-000Z-showcase/media/paths/journey-1/00-start-01.png'))), width: 390, height: 844 } },
        { ...catalogStates[2]!, status: 'running' },
        { ...catalogStates[3]!, status: 'failed', detail: 'The payment provider did not respond before the capture deadline.' }
      ] }));
    }
    const reading = new ReportIndex([{ id: 'shared', store: deps.store! }, { id: 'local', store: deps.localStore! }, ...deps.backends!]);
    await reading.refresh();
    const entries = catalogEntries(reading.snapshot().layers).entries;
    for (const name of ['storybook-design', 'storybook-accessibility']) {
      const critic = { name, version: '1.0.0', kind: 'model' };
      await publishCritiques(deps.store!, { critic, recordedAtMs: Date.parse('2026-10-14T13:00:00Z'), outcomes: entries.map((entry, index) => {
        const subject = { key: entry.key, title: entry.title, state: entry.state, imageSha256: index === 2 ? '0'.repeat(64) : entry.image.sha256 };
        return { entry: subject, critique: buildCritique(critic, { sendsImagesTo: null, needsSetup: false }, subject,
          index === 1 && name === 'storybook-design' ? { failure: { reason: 'rate-limited', message: 'Illustrative critic failure: retry this picture later.' } } : {
            verdict: { score: name === 'storybook-design' ? 0.3 + index * 0.15 : 0.8 - index * 0.1, label: index === 0 ? 'needs-polish' : 'ok', confidence: 0.8 },
            findings: index === 0 ? [{ id: 'spacing', category: 'spacing', severity: 'major', rationale: 'The action and supporting text are crowded.', suggestion: 'Give the action its own row.', region: { unit: 'px', x: 20, y: 30, w: 200, h: 60 } }] : []
          }) };
      }) });
    }
    const reports = createReportsApp(deps);
    const page = await (await reports.request('/evidence')).json() as EvidencePage;
    const layers: LayerEvidence[] = await Promise.all(page.layers.map(async layer => ({ layer, ...await (await reports.request(`/evidence/rows/${layer.backend}/${layer.id}`)).json() })));
    const assets = new Map<string, { bytes: Uint8Array; contentType: string }>();
    for (const state of uiCatalog(layers).states) for (const cell of state.cells) {
      const imagePath = cell.capture?.image?.path;
      if (imagePath && !assets.has('/api/reports' + imagePath)) {
        const response = await reports.request(imagePath);
        if (!response.ok) throw new Error(`Unreadable Storybook picture: ${imagePath}`);
        assets.set('/api/reports' + imagePath, { bytes: new Uint8Array(await response.arrayBuffer()), contentType: response.headers.get('content-type') ?? 'image/png' });
      }
    }
    for (const layer of layers) {
      const source = layer.layer.backend === 'local' ? deps.localStore : layer.layer.backend === 'shared' ? deps.store : deps.backends!.find(backend => backend.id === layer.layer.backend)?.store;
      if (!source) continue;
      const document = await readLayer(source, layer.layer.id);
      for (const key of Object.keys(document?.bundle ?? {})) {
        const address = `/layers/${layer.layer.id}/blobs/${key}`;
        const response = await reports.request(address);
        if (!response.ok) throw new Error(`Unreadable fixture attachment: ${address}`);
        assets.set('/api/reports' + address, { bytes: new Uint8Array(await response.arrayBuffer()), contentType: response.headers.get('content-type') ?? 'application/octet-stream' });
      }
    }
    const model = catalogModel(layers);
    const outline = await deps.outline!();
    const behaviors = indexBehaviors({ files: Object.keys(specs).filter(path => path.endsWith('.feature')), texts: new Map(Object.entries(specs)), specs: outline.specs, view: evidenceView(combineEvidence(outline, layers)), evidence: layers });
    const selection = {
      critique: entries[0]?.key ?? '',
      failedCritique: entries[1]?.key ?? '',
      olderCritique: entries[2]?.key ?? '',
      test: model.tests[0]?.key ?? '',
      failedTest: model.tests.find(test => test.status === 'failed')?.key ?? model.tests[0]?.key ?? '',
      run: model.tests[0]?.outcomes[0]?.run ?? '',
      behavior: behaviors.entries[0]?.id ?? '',
      behaviors: Object.fromEntries(behaviors.entries.map(entry => [entry.behavior.state, entry.id]))
    };
    for (const state of COVERAGE_ORDER) if (!selection.behaviors[state]) throw new Error(`Storybook is missing the ${state} behavior fixture`);
    const stores: Record<string, Record<string, { base64: string; contentType: string }>> = {};
    const sourceStores: [string, ObjectStore | null | undefined][] = [['local', deps.localStore], ['shared', deps.store], ...deps.backends!.map((backend): [string, ObjectStore] => [backend.id, backend.store])];
    for (const [id, store] of sourceStores) {
      if (!store) continue;
      const objects: Record<string, { base64: string; contentType: string }> = {};
      for (const key of await store.listKeys()) {
        const value = await store.get(key);
        if (value) objects[key] = { base64: Buffer.from(await new Response(value.body).arrayBuffer()).toString('base64'), contentType: value.contentType ?? 'application/octet-stream' };
      }
      stores[id] = objects;
    }
    config.esbuild = { ...config.esbuild, jsx: 'automatic' };
    config.plugins = [...(config.plugins ?? []), react(), {
      name: 'atlas-story-fixtures',
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          const asset = assets.get((request.url ?? '').split('?')[0]!);
          if (!asset) return next();
          response.setHeader('content-type', asset.contentType);
          response.setHeader('x-content-type-options', 'nosniff');
          response.end(asset.bytes);
        });
      },
      generateBundle() { for (const [address, asset] of assets) this.emitFile({ type: 'asset', fileName: address.slice(1), source: asset.bytes }); },
      resolveId(id) { if (id === 'virtual:atlas-stories') return '\0virtual:atlas-stories'; },
      load(id) { if (id === '\0virtual:atlas-stories') return `export default ${JSON.stringify({ specs, stores, selection })}`; }
    }];
    config.define = { ...config.define, 'import.meta.env.VITE_ATLAS_REPORTS_URL': JSON.stringify('/api/reports') };
    config.worker = { format: 'es' };
    config.build = { ...config.build, chunkSizeWarningLimit: 2500, rollupOptions: { onwarn(warning, warn) { if (warning.code !== 'MODULE_LEVEL_DIRECTIVE') warn(warning); } } };
    return config;
  }
};
export default config;
