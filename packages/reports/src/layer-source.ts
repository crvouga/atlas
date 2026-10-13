import type { HtmlReportTest } from './recording-bundle';
import { writeBundle, type BundleIndex, type BundleEntry } from './bundle';
import { normalizeEnvironment } from './layer-axes';
import type { ObjectStore } from './object-store';
import type { SourceRecord } from './protocol';
import type { PublishSourceArgs } from './publish';
import { readCommit, readFrameCss } from './read';
import { readInventory } from './spec-inventory';
import { sourceParts } from './source-part';
import { sourceEntries } from './source-entries';
import { publishLayerBundle } from './layer-store';

export async function archiveSourceLayer(store: ObjectStore, args: PublishSourceArgs, source: SourceRecord, tests: readonly HtmlReportTest[], bundle?: BundleIndex) {
  const [commit, inventory, css] = await Promise.all([readCommit(store, args.sha), readInventory(store, args.sha), readFrameCss(store, args.sha)]);
  const recordedAtMs = Math.max(commit?.startedAtMs ?? 0, source.updatedAtMs);
  const runId = args.runId ?? 'latest';
  const prefix = `commits/${args.sha}/tests/${source.source}/`;
  const layerPath = (key: string) => {
    const tail = key.slice(prefix.length), slash = tail.indexOf('/');
    const test = tail.slice(0, slash), file = tail.slice(slash + 1);
    return `tests/${test}/${file === 'report.json' ? file : `files/${file}`}`;
  };
  async function* entries(): AsyncGenerator<BundleEntry> {
    if (css) yield { key: 'frame.css', bytes: new Uint8Array(await new Response(css.body).arrayBuffer()), contentType: css.contentType };
    if (bundle) return;
    for await (const entry of sourceEntries(args, source.source, tests, runId)) yield { ...entry, key: layerPath(entry.key) };
  }
  const index = await writeBundle(store, entries(), 'layers/blobs/');
  for (const [key, value] of Object.entries(bundle ?? {})) index[layerPath(key)] = value;
  const environment = normalizeEnvironment(args.environment ?? args.parameters?.environment);
  return publishLayerBundle(store, {
    ...(args.freshness ? { freshness: args.freshness } : {}), producer: source.source, recordedAtMs, sha: args.sha, branch: commit?.branch ?? null, runUrl: commit?.runUrl ?? null,
    ...(environment ? { environment } : {}),
    parameters: args.parameters ?? {}, specs: inventory?.entries ?? [], parts: sourceParts(args.sha, source), source, recording: { type: 'layer' },
  }, index);
}
