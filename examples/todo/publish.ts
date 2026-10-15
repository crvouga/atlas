import { mkdir, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { copyStore } from '../../packages/reports/src/copy-store';
import { directoryStore } from '../../packages/reports/src/directory-store';
import { reportMain } from '../../packages/reports/src/report-cli';
import { collectSpecFiles, publishSpecSet } from '../../packages/reports/src/spec-set';
import { openStore } from '../../packages/reports/src/store-url';
import { gitOrigin } from './spec-outline';

export const exampleRoot = path.dirname(fileURLToPath(import.meta.url));
export const exampleServerUrl = () => process.env.ATLAS_SERVER_URL ?? `http://localhost:${process.env.ATLAS_PORT ?? 5180}`;

/** Publish the local example's specs, completed statechart run, recordings and document layers through one store endpoint. */
export async function publishExampleReports(location: string, options: { root?: string; out?: (text: string) => void } = {}): Promise<void> {
  const root = options.root ?? exampleRoot;
  const out = options.out ?? (text => process.stdout.write(text));
  const env = { ...process.env, ATLAS_PROJECT: process.env.ATLAS_PROJECT ?? 'todo-app', ATLAS_TOKEN: process.env.ATLAS_PUBLISH_TOKEN ?? process.env.ATLAS_TOKEN };
  const target = openStore(location, { base: root, env }).store;
  const origin = await gitOrigin(root);
  await publishSpecSet(target, { files: await collectSpecFiles(path.join(root, 'specs')), ...origin, freshness: 'unknown', recordedAtMs: Date.now(), domain: 'Todo example' });
  const runs = path.join(root, 'atlas-runs');
  const names = await readdir(runs).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return []; throw error; });
  // A running directory must never displace the most recent completed, privacy-checked run.
  for (const name of names.sort().reverse()) {
    let manifest;
    try { manifest = JSON.parse(await readFile(path.join(runs, name, 'manifest.json'), 'utf8')); } catch { continue; }
    if (!manifest.run?.finishedAt || manifest.privacy?.passed !== true) continue;
    const code = await reportMain(['publish', '--store', location, '--producer', 'todo-statecharts', '--environment', 'desktop-web', '--manifest', path.join(runs, name, 'manifest.json'), '--specs', path.join(root, 'specs'), '--upload-run'], { cwd: root, env, out });
    if (code !== 0) throw new Error(`Publishing example statecharts failed (${code})`);
    break;
  }
  const documents = path.join(root, 'atlas-reports');
  await mkdir(documents, { recursive: true });
  const result = await copyStore(directoryStore(documents), target);
  out(`Reports published: ${result.copied} objects uploaded to ${location}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  await publishExampleReports(exampleServerUrl());
}
