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
import { catalogModel, runDetail, TestHistory } from '../packages/reports/src/test-catalog';
import { compareRuns } from '../packages/reports/src/run-compare';
import { recordReviewCollection } from '../packages/reports/src/review-collection-store';
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
    // Review recordings: three named executions of one producer on two commits, so runs compare, a playlist holds several
    // recordings, reliability has a history, a retried check is flaky and captions can be searched for words.
    const reviewPath = 'storybook/review.feature';
    const reviewNames = ['Opens the menu', 'Adds a drink', 'Pays at the counter', 'Shares a receipt'];
    const said = ['The menu lists every drink with its price', 'An oat latte is added to the cart', 'The card reader confirms the payment', 'The receipt is sent by email'];
    specs[reviewPath] = 'Feature: Review recordings\n' + reviewNames.map(name => `  Scenario: ${name}\n    Given a customer at the counter\n    When the customer ${name.toLowerCase()}\n    Then the screen confirms it\n`).join('\n');
    const media = (file: string) => new Uint8Array(readFileSync(path.join(root, 'packages/visualizer/fixtures/failures/runs/2026-10-06T14-40-00-000Z-showcase/media', file)));
    const reviewSpec = specEntry(`specs/${reviewPath}`, specs[reviewPath]!);
    const previous = 'a11ce0' + '0'.repeat(34), current = 'c0ffee' + '1'.repeat(34);
    const executions: { id: string; title: string; day: string; sha: string; environment: string; statuses: ('passed' | 'failed' | 'flaky' | null)[] }[] = [
      { id: 'storybook-nightly-1', title: 'Nightly review, 12 October', day: '2026-10-12', sha: previous, environment: 'desktop-web', statuses: ['passed', 'passed', 'passed', null] },
      { id: 'storybook-nightly-2', title: 'Nightly review, 13 October', day: '2026-10-13', sha: previous, environment: 'desktop-web', statuses: ['passed', 'failed', 'passed', 'passed'] },
      { id: 'storybook-nightly-3', title: 'Nightly review, 14 October', day: '2026-10-14', sha: current, environment: 'desktop-web', statuses: ['passed', 'flaky', 'failed', 'passed'] },
      { id: 'storybook-nightly-3', title: 'Nightly review, 14 October', day: '2026-10-14', sha: current, environment: 'mobile-web', statuses: ['passed', null, 'passed', null] }
    ];
    for (const [order, execution] of executions.entries()) {
      const startedAtMs = Date.parse(`${execution.day}T09:00:00Z`) + order * 60_000;
      await publishChecks(deps.store!, {
        producer: 'storybook-review', kind: 'behavior', recordedAtMs: startedAtMs + 240_000, sha: execution.sha, branch: 'main', environment: execution.environment,
        run: { id: execution.id, title: execution.title, startedAtMs: Date.parse(`${execution.day}T09:00:00Z`), endedAtMs: startedAtMs + 240_000 },
        specs: [reviewSpec], labels: { suite: 'review', browser: 'chromium' },
        scope: { surface: 'browser', deviceKind: 'desktop', syntheticData: true, dependencies: 'scripted', audioCaptured: false, pacing: 'paced', declaredBy: 'storybook-review' },
        checks: reviewNames.flatMap((name, index) => {
          const outcome = execution.statuses[index];
          if (!outcome) return [];
          const slug = name.toLowerCase().replaceAll(' ', '-');
          const failed = outcome === 'failed';
          const number = String(index + 1).padStart(2, '0');
          return [{
            id: slug, title: `Review recordings: ${name}`, specPath: `specs/${reviewPath}`, status: failed ? 'failed' as const : 'passed' as const,
            detail: failed ? 'The confirmation never appeared on the screen.' : '', durationMs: 3600 + index * 700 + order * 150, recordingExpectation: 'required',
            tags: index === 0 ? ['smoke'] : ['checkout'], labels: { owner: index < 2 ? 'storefront' : 'payments' },
            measurements: [{ name: 'Screen ready', value: 380 + index * 110 + order * 70, unit: 'ms', limit: 800, kind: 'product-latency', from: 'tap', to: 'screen visible', source: 'app-instrumentation', labels: { device: 'desktop', build: execution.sha.slice(0, 7) } }],
            steps: [
              { id: 'given', name: 'Given a customer at the counter', kind: 'given', status: 'passed', offsetMs: 0, durationMs: 500 },
              { id: 'when', name: `When the customer ${name.toLowerCase()}`, kind: 'when', status: failed ? 'failed' : 'passed', offsetMs: 500, durationMs: 1200, ...(failed ? { detail: 'The confirmation never appeared on the screen.' } : {}) },
              { id: 'then', name: 'Then the screen confirms it', kind: 'then', status: failed ? 'skipped' : 'passed', offsetMs: 1700, durationMs: 400 }
            ],
            ...(outcome === 'flaky' ? { attempts: [
              { index: 0, status: 'failed' as const, durationMs: 4100, detail: 'A banner covered the button on the first try.' },
              { index: 1, status: 'passed' as const, durationMs: 3900 }
            ] } : {}),
            ...(failed ? { annotations: [{ type: 'issue', level: 'error', message: 'The card reader stayed on "Waiting" for the whole recording.' }] } : {}),
            attachments: [
              { id: 'video', name: `${slug}.mp4`, role: 'video', contentType: 'video/mp4', data: media(`clips/journey-1/${number}.mp4`), captions: ['captions'], poster: 'poster', ...(index === 0 ? { tags: ['demo'] } : {}) },
              { id: 'captions', name: `${slug}.vtt`, role: 'captions', contentType: 'text/vtt', data: new TextEncoder().encode(`WEBVTT\n\n00:00.000 --> 00:01.000\n${said[index]}\n\n00:01.000 --> 00:02.000\n${failed ? 'The screen is still waiting' : 'The screen confirms it'}\n`) },
              { id: 'poster', name: `${slug}.png`, role: 'screenshot', contentType: 'image/png', data: media(`paths/journey-1/${number}.png`) },
              { id: 'log', name: 'console.log', role: 'log', contentType: 'text/plain', text: `[review] ${name}: ${outcome}\n` }
            ]
          }];
        })
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
    // An earlier capture of one state at the previous commit, so the catalog compares two commits and shows history.
    await publishChecks(deps.store!, uiStateLayer({ producer: 'storybook-capture', recordedAtMs: Date.parse('2026-10-07T12:00:00Z'), sha: previous, branch: 'main', environment: 'desktop-web', profile: { viewport: '1280x800', scheme: 'light' },
      states: [{ ...catalogStates[0]!, screenshot: { data: media('paths/journey-1/03.png'), width: 390, height: 844 } }] }));
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
    const history = new TestHistory();
    for (const entry of layers) history.add(entry.layer, entry.rows, [], entry.layer.backend, entry.fingerprints);
    const recorded = history.evidenceResults().map(entry => entry.result);
    const runOf = (id: string) => history.runs().find(run => run.runId === id)?.key ?? '';
    const [baselineRun, middleRun, candidateRun] = ['storybook-nightly-1', 'storybook-nightly-2', 'storybook-nightly-3'].map(runOf) as [string, string, string];
    const reviewed = (id: string, run = candidateRun, environment = 'desktop-web') => {
      const result = recorded.find(item => item.id === id && item.run === run && item.environment === environment);
      if (!result) throw new Error(`Storybook is missing the ${id} review recording`);
      return result;
    };
    const comparison = compareRuns(runDetail(history, 'storybook', baselineRun)!, runDetail(history, 'storybook', candidateRun)!);
    const regressed = reviewed('pays-at-the-counter'), flaky = reviewed('adds-a-drink'), steady = reviewed('opens-the-menu');
    // A curated review collection in two revisions, kept in the shared store exactly as a server keeps it.
    const find = (layer: string, check: string, kind: string | undefined) => recorded.filter(item => item.layer === layer && item.id === check && (kind === undefined || item.kind === kind));
    const firstRevision = await recordReviewCollection(deps.store!, {
      title: 'Checkout review, week 42', purpose: 'Decide whether the counter payment is ready to ship.', audience: 'Design review', tags: ['checkout'],
      entries: [{ layer: steady.layer, check: steady.id, caption: 'The menu, as a customer first sees it.' }, { layer: regressed.layer, check: regressed.id, caption: 'The payment that stopped confirming.' }],
      gaps: [{ note: 'No recording shows a refund yet.', after: 2 }]
    }, 'storybook', Date.parse('2026-10-15T09:00:00Z'), find);
    await recordReviewCollection(deps.store!, {
      title: 'Checkout review, week 42', purpose: 'Decide whether the counter payment is ready to ship.', audience: 'Design review', tags: ['checkout'], basedOn: { id: firstRevision.id, revision: firstRevision.revision },
      entries: [{ layer: steady.layer, check: steady.id, caption: 'The menu, as a customer first sees it.' }, { layer: flaky.layer, check: flaky.id, caption: 'Passed on the second try.' }, { layer: regressed.layer, check: regressed.id, caption: 'The payment that stopped confirming.' }],
      gaps: [{ note: 'No recording shows a refund yet.', after: 3 }]
    }, 'storybook', Date.parse('2026-10-16T09:00:00Z'), find);
    const profiles = uiCatalog(layers).profiles.map(profile => profile.key);
    const selection = {
      runs: { baseline: baselineRun, middle: middleRun, candidate: candidateRun },
      review: {
        test: steady.key, flaky: flaky.key, regressed: regressed.key, layer: regressed.layer, steadyLayer: steady.layer,
        clip: regressed.videos?.find(video => video.available)?.recording ?? '', pair: comparison.results.find(result => result.key === regressed.key)?.id ?? '',
        watchClip: `${flaky.layer}|${flaky.key}|${flaky.kind}|${flaky.producer}|${flaky.environment ?? ''}`
      },
      collection: firstRevision.id,
      commits: { previous, current },
      profiles: { desktop: profiles[0] ?? '', mobile: profiles[1] ?? '' },
      critique: entries[0]?.key ?? '',
      failedCritique: entries[1]?.key ?? '',
      olderCritique: entries[2]?.key ?? '',
      test: model.tests[0]?.key ?? '',
      failedTest: model.tests.find(test => test.status === 'failed')?.key ?? model.tests[0]?.key ?? '',
      run: model.tests[0]?.outcomes[0]?.run ?? '',
      behavior: behaviors.entries[0]?.id ?? '',
      // One behavior per coverage state, from the feature written to show them.
      behaviors: Object.fromEntries(behaviors.entries.filter(entry => entry.id.startsWith(coveragePath)).map(entry => [entry.behavior.state, entry.id]))
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
