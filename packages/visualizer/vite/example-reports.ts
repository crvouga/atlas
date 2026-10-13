// @io-wall-ok — example dev server reads the specs it is already serving
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import type { EvidenceCheck } from '@crvouga/atlas/reports/explorer-types';
import { specEntry } from '@crvouga/atlas/reports/spec-inventory';
import { publishLayer } from '@crvouga/atlas/reports/layer-store';
import type { LayerSummary } from '@crvouga/atlas/reports/layer-types';
import type { ObjectStore } from '@crvouga/atlas/reports/object-store';
import type { ReportFrame, ReportStep, RunReport } from '@crvouga/atlas/reports/report-types';
import { createReportsApp, type ReportsAppDeps } from '@crvouga/atlas/reports/reports-route';
import { ObjectStoreWithPrefix } from '@crvouga/atlas/reports/store-prefix';

import { listSpecFiles, resolveRoots } from './atlas-files';

/** The version the example calls current. Older layers stay in the report beside it. */
export const EXAMPLE_CURRENT = `c0ffee${'1'.repeat(34)}`;
export const EXAMPLE_PREVIOUS = `a11ce0${'0'.repeat(34)}`;
export const EXAMPLE_BRANCH = `b1a4c0${'2'.repeat(34)}`;

const EVIDENCE_FILE = /\.(feature|qnt|dmn|als)$/i;
const OPENSLO_FILE = /\.openslo\.ya?ml$/i;

const COFFEE_FEATURE = 'coffee/ordering/ordering.feature';
const TODO_FEATURE = 'share-a-list.feature';

const CSS = 'main { font-family: sans-serif; padding: 24px; } h1 { font-size: 20px; margin: 0 0 12px; } button { font: 16px sans-serif; padding: 8px 12px; }';

function memoryStore(): ObjectStore {
  const objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
  const store: ObjectStore = {
    async get(key) {
      const found = objects.get(key);
      if (!found) return null;
      return { body: new Blob([new Uint8Array(found.bytes)]).stream(), contentType: found.contentType, size: found.bytes.length };
    },
    async put(key, bytes, contentType) {
      objects.set(key, { bytes: new Uint8Array(bytes), contentType });
    },
    async head(key) {
      return objects.has(key);
    },
    async delete(key) {
      objects.delete(key);
    },
    async deleteMany(keys) {
      for (const key of keys) objects.delete(key);
    },
    async getUri() {
      return null;
    },
    async listKeys(prefix = '') {
      return [...objects.keys()].filter((key) => key.startsWith(prefix)).sort();
    },
    withPrefix(prefix) {
      return new ObjectStoreWithPrefix(store, prefix);
    }
  };
  return store;
}

/** Spec documents the evidence tabs read, relative to the specs root. */
export function readExampleSpecs(root: string): Record<string, string> {
  const specs: Record<string, string> = {};
  for (const file of listSpecFiles(root)) {
    if (!EVIDENCE_FILE.test(file) && !OPENSLO_FILE.test(file)) continue;
    specs[file] = readFileSync(path.join(root, file), 'utf8');
  }
  return specs;
}

/** The coffee fixture and the todo example are the specs this dev server can fill with layers. */
export function servesExampleReports(specsRoot: string): boolean {
  return existsSync(path.join(specsRoot, COFFEE_FEATURE)) || existsSync(path.join(specsRoot, TODO_FEATURE));
}

type Status = 'passed' | 'failed';
type BackendName = 'local' | 'shared' | 'device-lab';

type CheckSpec = {
  readonly id: string;
  readonly title: string;
  readonly spec: string;
  readonly status: Status;
  readonly detail?: string;
  readonly kind?: 'behavior' | 'performance';
  readonly runtime?: string;
  readonly steps?: readonly ReportStep[];
  readonly files?: readonly { readonly path: string; readonly body: string }[];
  readonly measurements?: EvidenceCheck['measurements'];
};

type LayerSpec = {
  readonly at: number;
  readonly sha: string;
  readonly branch: string;
  readonly environment?: string;
  readonly parameters?: Record<string, string>;
  readonly backend: BackendName;
  readonly packageDir: string;
  readonly checks: readonly CheckSpec[];
};

function at(iso: string) {
  return Date.parse(iso);
}

function picture(title: string, body: string) {
  return `<!doctype html><html><body><main><h1>${title}</h1>${body}</main></body></html>`;
}

function frame(index: number, file: string | null): ReportFrame {
  return {
    index,
    capturedAtMs: index * 1000,
    snapshots: file ? [{ name: 'Customer', nodeId: 'customer', media: 'html', file }] : []
  };
}

/** One moment per line. A picture is kept so the recording has something to show. */
function timeline(lines: readonly { readonly title: string; readonly status?: Status; readonly error?: string; readonly picture?: string }[]) {
  const files: { path: string; body: string }[] = [];
  const steps: ReportStep[] = lines.map((line, index) => {
    const n = index + 1;
    const shot = line.picture ? `frames/m-${String(n).padStart(4, '0')}.html` : null;
    if (shot && line.picture) files.push({ path: shot, body: line.picture });
    return {
      index: n,
      title: line.title,
      kind: 'when',
      status: line.status ?? 'passed',
      startedAtMs: n * 1000,
      endedAtMs: n * 1000 + 400,
      durationMs: 400,
      frames: [frame(n, shot)],
      steps: [],
      ...(line.error ? { error: line.error } : {})
    };
  });
  return { steps, files };
}

function quintSteps(lines: readonly { readonly title: string; readonly detail: string }[]): ReportStep[] {
  return lines.map((line, index) => {
    const n = index + 1;
    return { index: n, title: line.title, kind: 'quint', status: 'passed', detail: line.detail, startedAtMs: n * 1000, endedAtMs: n * 1000 + 200, durationMs: 200, frames: [], steps: [] };
  });
}

function named(feature: string, scenario: string) {
  return `${feature}: ${scenario}`;
}

/** Five layers. Each one ran only its own checks, on one environment, from one version and backend. */
function coffeeLayers(): readonly LayerSpec[] {
  const feature = 'Order a drink';
  const spec = COFFEE_FEATURE;
  const quint = 'coffee/ordering/cart.qnt';
  const dmn = 'coffee/ordering/drink-price.dmn';
  const slo = 'coffee/ordering/checkout.openslo.yaml';
  const alloy = 'coffee/ordering/payment.als';
  const dir = 'examples/coffee';
  const card = timeline([
    { title: 'Given a drink in the cart' },
    { title: 'When the customer pays by card', picture: picture('Order', '<p>Oat latte, large</p><button data-testid="pay">Pay by card</button>') },
    { title: 'Then the barista can start the drink' }
  ]);
  const declined = timeline([
    { title: 'Given a drink in the cart' },
    { title: 'When the card is declined', status: 'failed', error: 'The wallet never confirmed the payment', picture: picture('Checkout', '<p>The card was declined.</p><button data-testid="wallet">Pay with wallet</button>') },
    { title: 'And the customer pays with a wallet' }
  ]);
  const iosCard = timeline([
    { title: 'Given a drink in the cart' },
    { title: 'When the customer pays by card', status: 'failed', error: 'The card form never appeared' },
    { title: 'Then the barista can start the drink' }
  ]);
  const scenario = (id: string, name: string, status: Status, extra: Partial<CheckSpec> = {}): CheckSpec => ({ id, title: named(feature, name), spec, status, ...extra });
  return [
    {
      at: at('2026-10-01T15:00:00.000Z'),
      sha: EXAMPLE_PREVIOUS,
      branch: 'main',
      environment: 'desktop-web',
      backend: 'shared',
      packageDir: dir,
      checks: [
        scenario('pays-by-card', 'Pays by card', 'passed', { steps: card.steps, files: card.files }),
        scenario('pays-with-wallet', 'Pays with a wallet', 'passed'),
        scenario('card-declined', 'Card declined, then a wallet works', 'passed'),
        scenario('slow-payment', 'Slow payment', 'passed'),
        scenario('leaves-checkout', 'Leaves checkout and comes back', 'passed'),
        scenario('drink-left', 'Drink left too long', 'passed'),
        { id: 'slow-payment', title: named(feature, 'Slow payment'), spec, status: 'passed', kind: 'performance', measurements: [{ name: 'Payment', value: 74, unit: 's', limit: 60 }] },
        { id: 'trace-1', title: 'cart · trace 1', spec: quint, status: 'passed', runtime: 'quint', steps: quintSteps([{ title: 'add(0)', detail: 'items = 1' }, { title: 'pay', detail: 'paid = true' }]) },
        { id: 'price-large', title: 'Drink price: large oat latte', spec: dmn, status: 'passed', runtime: 'dmn' },
        { id: 'checkout-latency', title: 'Checkout answers within a second', spec: slo, status: 'passed', runtime: 'openslo' },
        { id: 'one-payment', title: 'An order has one payment', spec: alloy, status: 'passed', runtime: 'alloy' }
      ]
    },
    {
      at: at('2026-10-06T15:00:00.000Z'),
      sha: EXAMPLE_PREVIOUS,
      branch: 'main',
      parameters: { environment: 'Android', device: 'phone' },
      backend: 'device-lab',
      packageDir: dir,
      checks: [
        scenario('pays-by-card', 'Pays by card', 'passed'),
        scenario('pays-with-wallet', 'Pays with a wallet', 'passed'),
        { id: 'checkout-latency', title: 'Checkout answers within a second', spec: slo, status: 'failed', runtime: 'openslo', detail: 'Checkout took 1.8 seconds' }
      ]
    },
    {
      at: at('2026-10-08T15:00:00.000Z'),
      sha: EXAMPLE_BRANCH,
      branch: 'feat/wallet',
      environment: 'mobile-web',
      backend: 'local',
      packageDir: dir,
      checks: [
        scenario('pays-by-card', 'Pays by card', 'passed'),
        scenario('pays-with-wallet', 'Pays with a wallet', 'failed', { detail: 'The wallet sheet did not open' }),
        scenario('card-declined', 'Card declined, then a wallet works', 'passed'),
        scenario('slow-payment', 'Slow payment', 'passed'),
        { id: 'price-large', title: 'Drink price: large oat latte', spec: dmn, status: 'failed', runtime: 'dmn', detail: 'Large oat latte was priced at 4' }
      ]
    },
    {
      at: at('2026-10-11T15:00:00.000Z'),
      sha: EXAMPLE_CURRENT,
      branch: 'main',
      environment: 'ios',
      backend: 'device-lab',
      packageDir: dir,
      checks: [scenario('pays-by-card', 'Pays by card', 'failed', { detail: 'The card form never appeared', steps: iosCard.steps, files: iosCard.files })]
    },
    {
      at: at('2026-10-12T16:00:00.000Z'),
      sha: EXAMPLE_CURRENT,
      branch: 'main',
      environment: 'desktop-web',
      backend: 'local',
      packageDir: dir,
      checks: [scenario('card-declined', 'Card declined, then a wallet works', 'failed', { detail: 'The wallet never confirmed the payment', steps: declined.steps, files: declined.files })]
    }
  ];
}

function todoLayers(): readonly LayerSpec[] {
  const feature = 'Share a list';
  const spec = TODO_FEATURE;
  const quint = 'list.qnt';
  const dmn = 'retry-delay.dmn';
  const slo = 'sync.openslo.yaml';
  const alloy = 'list.als';
  const dir = 'examples/todo';
  const weekend = timeline([
    { title: 'Given no list yet' },
    { title: 'When the customer names the list', picture: picture('Weekend chores', '<p>Water the plants</p><button data-testid="add">Add</button>') },
    { title: 'Then the list is clear and synced' }
  ]);
  const outage = timeline([
    { title: 'Given a list' },
    { title: 'When sync fails', status: 'failed', error: 'The retry never caught up', picture: picture('Weekend chores', '<p>Sync failed. The list is still here.</p>') },
    { title: 'Then the list is synced' }
  ]);
  const iosWeekend = timeline([
    { title: 'Given no list yet' },
    { title: 'When the customer names the list', status: 'failed', error: 'The list name field never appeared' },
    { title: 'Then the list is clear and synced' }
  ]);
  const scenario = (id: string, name: string, status: Status, extra: Partial<CheckSpec> = {}): CheckSpec => ({ id, title: named(feature, name), spec, status, ...extra });
  return [
    {
      at: at('2026-10-01T15:00:00.000Z'),
      sha: EXAMPLE_PREVIOUS,
      branch: 'main',
      environment: 'desktop-web',
      backend: 'shared',
      packageDir: dir,
      checks: [
        scenario('plans-a-weekend', 'Plans a weekend', 'passed', { steps: weekend.steps, files: weekend.files }),
        scenario('sync-outage', 'Keeps working through a sync outage', 'passed'),
        scenario('starts-over', 'Starts over', 'passed'),
        scenario('starts-over-offline', 'Starts over while offline', 'passed'),
        { id: 'starts-over-offline', title: named(feature, 'Starts over while offline'), spec, status: 'passed', kind: 'performance', measurements: [{ name: 'Sync', value: 2.4, unit: 's', limit: 1 }] },
        { id: 'trace-1', title: 'list · trace 1', spec: quint, status: 'passed', runtime: 'quint', steps: quintSteps([{ title: 'add(0)', detail: 'items = 1' }, { title: 'sync', detail: 'synced = true' }]) },
        { id: 'retry-second', title: 'Retry delay: second attempt', spec: dmn, status: 'passed', runtime: 'dmn' },
        { id: 'sync-latency', title: 'Sync finishes within a second', spec: slo, status: 'passed', runtime: 'openslo' },
        { id: 'list-owns-todos', title: 'A list has its todos', spec: alloy, status: 'passed', runtime: 'alloy' }
      ]
    },
    {
      at: at('2026-10-06T15:00:00.000Z'),
      sha: EXAMPLE_PREVIOUS,
      branch: 'main',
      parameters: { environment: 'Android', device: 'phone' },
      backend: 'device-lab',
      packageDir: dir,
      checks: [
        scenario('plans-a-weekend', 'Plans a weekend', 'passed'),
        scenario('starts-over', 'Starts over', 'passed'),
        { id: 'sync-latency', title: 'Sync finishes within a second', spec: slo, status: 'failed', runtime: 'openslo', detail: 'Sync took 1.8 seconds' }
      ]
    },
    {
      at: at('2026-10-08T15:00:00.000Z'),
      sha: EXAMPLE_BRANCH,
      branch: 'feat/offline',
      environment: 'mobile-web',
      backend: 'local',
      packageDir: dir,
      checks: [
        scenario('plans-a-weekend', 'Plans a weekend', 'passed'),
        scenario('sync-outage', 'Keeps working through a sync outage', 'passed'),
        scenario('starts-over', 'Starts over', 'failed', { detail: 'The list was still there' }),
        { id: 'retry-second', title: 'Retry delay: second attempt', spec: dmn, status: 'failed', runtime: 'dmn', detail: 'The second retry waited 10 seconds' }
      ]
    },
    {
      at: at('2026-10-11T15:00:00.000Z'),
      sha: EXAMPLE_CURRENT,
      branch: 'main',
      environment: 'ios',
      backend: 'device-lab',
      packageDir: dir,
      checks: [scenario('plans-a-weekend', 'Plans a weekend', 'failed', { detail: 'The list name field never appeared', steps: iosWeekend.steps, files: iosWeekend.files })]
    },
    {
      at: at('2026-10-12T16:00:00.000Z'),
      sha: EXAMPLE_CURRENT,
      branch: 'main',
      environment: 'desktop-web',
      backend: 'local',
      packageDir: dir,
      checks: [scenario('sync-outage', 'Keeps working through a sync outage', 'failed', { detail: 'The retry never caught up', steps: outage.steps, files: outage.files })]
    }
  ];
}

function layersFor(specs: Readonly<Record<string, string>>): readonly LayerSpec[] | null {
  if (COFFEE_FEATURE in specs) return coffeeLayers();
  if (TODO_FEATURE in specs) return todoLayers();
  return null;
}

function evidence(producer: string, check: CheckSpec): EvidenceCheck {
  return {
    id: `${producer}/${check.id}`,
    title: check.title,
    status: check.status,
    detail: check.detail ?? '',
    specPath: `specs/${check.spec}`,
    measurements: check.measurements ?? []
  };
}

function recorded(producer: string, check: CheckSpec): RunReport {
  const ended = check.steps?.at(-1)?.endedAtMs ?? 1;
  return {
    meta: {
      testId: check.id,
      runId: 'example',
      title: check.title,
      system: 'example',
      runtime: check.runtime ?? 'gherkin',
      seed: check.id,
      status: check.status,
      actorIds: ['customer'],
      startedAtMs: 0,
      endedAtMs: ended,
      durationMs: Math.max(1, ended),
      sourceFile: `specs/${check.spec}`,
      ...(check.detail ? { error: check.detail } : {})
    },
    steps: check.steps ?? []
  };
}

async function publishExampleLayer(store: ObjectStore, producer: string, layer: LayerSpec, specs: Readonly<Record<string, string>>) {
  const behavior = layer.checks.filter((check) => check.kind !== 'performance');
  const timings = layer.checks.filter((check) => check.kind === 'performance');
  const reports = behavior.filter((check) => check.steps);
  const referenced = [...new Set(layer.checks.map((check) => check.spec))];
  const summary: Omit<LayerSummary, 'id'> = {
    producer,
    recordedAtMs: layer.at,
    sha: layer.sha,
    branch: layer.branch,
    ...(layer.environment ? { environment: layer.environment } : {}),
    runUrl: null,
    parameters: layer.parameters ?? {},
    specs: referenced.map((file) => {
      const text = specs[file];
      if (text === undefined) throw new Error(`Example layer names a spec that was not loaded: ${file}`);
      return specEntry(`specs/${file}`, text);
    }),
    recording: { type: 'layer' },
    source: {
      source: producer,
      packageDir: layer.packageDir,
      bucket: 'all',
      status: behavior.some((check) => check.status === 'failed') ? 'failed' : 'passed',
      updatedAtMs: layer.at,
      ...(layer.environment ? { environment: layer.environment } : {}),
      ...(layer.parameters ? { parameters: layer.parameters } : {}),
      tests: reports.map((check) => recorded(producer, check).meta)
    },
    parts: [
      { sha: layer.sha, id: producer, kind: 'behavior', title: producer, recordedAtMs: layer.at, checks: behavior.map((check) => evidence(producer, check)) },
      ...(timings.length ? [{ sha: layer.sha, id: `${producer}-timing`, kind: 'performance', title: 'Timings', recordedAtMs: layer.at, checks: timings.map((check) => evidence(producer, check)) }] : [])
    ]
  };
  const files = behavior.flatMap((check) => check.files ?? []);
  async function* entries() {
    if (files.length) yield { key: 'frame.css', bytes: new TextEncoder().encode(CSS), contentType: 'text/css; charset=utf-8' };
    for (const check of reports) {
      yield { key: `tests/${check.id}/report.json`, bytes: new TextEncoder().encode(JSON.stringify(recorded(producer, check))), contentType: 'application/json' };
      for (const file of check.files ?? []) yield { key: `tests/${check.id}/files/${file.path}`, bytes: new TextEncoder().encode(file.body), contentType: 'text/html; charset=utf-8' };
    }
  }
  await publishLayer(store, summary, entries());
}

/**
 * Layers for the coffee example or the todo example, already written into three stores.
 * Any other spec set returns null, so a project's own reports are not replaced by this one.
 */
export async function exampleReports(specs: Readonly<Record<string, string>>): Promise<ReportsAppDeps | null> {
  const layers = layersFor(specs);
  if (!layers) return null;
  const producer = COFFEE_FEATURE in specs ? 'ordering' : 'lists';
  const localStore = memoryStore();
  const store = memoryStore();
  const lab = memoryStore();
  const backends = { local: localStore, shared: store, 'device-lab': lab } as const;
  for (const layer of layers) await publishExampleLayer(backends[layer.backend], producer, layer, specs);
  return {
    store,
    localStore,
    backends: [{ id: 'device-lab', label: 'Device lab', store: lab }],
    clock: { now: () => Date.now() },
    timers: {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
      setInterval: (fn, ms) => setInterval(fn, ms),
      clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>)
    },
    outline: async () => ({
      specs: Object.keys(specs).sort().map((file) => specEntry(`specs/${file}`, specs[file] ?? '')),
      sha: EXAMPLE_CURRENT,
      changedFiles: [],
      readSpec: async (specPath) => specs[specPath.replace(/^specs\//, '')] ?? null
    })
  };
}

let exampleApp: Promise<{ request: (path: string) => Promise<Response> } | null> | undefined;

async function appForProcess() {
  const specs = readExampleSpecs(resolveRoots().specs);
  const deps = await exampleReports(specs);
  return deps ? createReportsApp(deps) : null;
}

/** `GET /api/reports/...` for the visualizer dev server, when no host module is configured. */
export async function reportsDevFetch(request: Request, _repoRoot: string): Promise<Response> {
  exampleApp ??= appForProcess();
  const app = await exampleApp;
  if (!app) return Response.json({ error: 'not_found' }, { status: 404 });
  const url = new URL(request.url);
  const pathname = url.pathname.replace(/^\/api\/reports/, '') || '/';
  return app.request(pathname + url.search);
}
