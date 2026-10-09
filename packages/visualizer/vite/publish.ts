import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import type { ReportSource, RunSummary } from '@crvouga/atlas-schema';

import { listSpecFiles, resolveReportSources, runsIndex, summarizeRun, type AtlasRoots } from './atlas-files';

export type PublishOptions = {
  roots: AtlasRoots;
  /** The directory the static site reads as its data base URL (`./data/` by default). */
  out: string;
  /** How many of the newest complete runs to publish. */
  keep?: number;
  /** The branch or commit the specs came from; the git HEAD of the specs directory when omitted. */
  ref?: string | null;
  sources?: ReportSource[];
};

export type PublishResult = { files: string[]; published: string[]; skipped: string[] };

function gitRef(cwd: string) {
  try {
    return execSync('git rev-parse HEAD', { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function safeManifest(manifestFile: string) {
  try {
    const text = readFileSync(manifestFile, 'utf8');
    const manifest = JSON.parse(text) as { privacy?: { passed?: unknown } };
    return manifest?.privacy?.passed === true ? text : null;
  } catch {
    return null;
  }
}

function publishRuns(root: string, out: string, keep: number) {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const published: RunSummary[] = [];
  const skipped: string[] = [];
  for (const run of runsIndex(root).runs) {
    if (published.length >= keep) break;
    const manifest = safeManifest(path.join(root, run.id, 'manifest.json'));
    if (!manifest) {
      skipped.push(run.id);
      continue;
    }
    const target = path.join(out, run.id);
    cpSync(path.join(root, run.id), target, {
      recursive: true,
      filter: (file) => !path.relative(path.join(root, run.id), file).split(path.sep).some((part) => part.startsWith('.'))
    });
    writeFileSync(path.join(target, 'manifest.json'), manifest);
    published.push(summarizeRun(out, run.id) ?? run);
  }
  writeFileSync(path.join(out, 'index.json'), `${JSON.stringify({ generatedAt: new Date().toISOString(), runs: published }, null, 2)}\n`);
  return { published: published.map((run) => run.id), skipped };
}

/**
 * Lays out the spec and the newest runs for a static host, in the layout the static adapter
 * reads: `specs/index.json`, `specs/<path>`, `runs/index.json`, `runs/<id>/...`. Only `specs/`
 * and `runs/` under `out` are replaced. A run whose privacy check failed or is missing is never
 * published.
 */
export function publishData({ roots, out, keep = 30, ref, sources = resolveReportSources(roots) }: PublishOptions): PublishResult {
  const specsOut = path.join(out, 'specs');
  const runsOut = path.join(out, 'runs');
  rmSync(specsOut, { recursive: true, force: true });
  rmSync(runsOut, { recursive: true, force: true });
  mkdirSync(specsOut, { recursive: true });
  mkdirSync(runsOut, { recursive: true });

  const files = listSpecFiles(roots.specs);
  for (const file of files) {
    const target = path.join(specsOut, file);
    mkdirSync(path.dirname(target), { recursive: true });
    cpSync(path.join(roots.specs, file), target);
  }
  const index = { schemaVersion: 1, generatedAt: new Date().toISOString(), ref: ref === undefined ? gitRef(roots.specs) : ref, files };
  writeFileSync(path.join(specsOut, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);

  const result = publishRuns(roots.runs, runsOut, keep);
  const descriptors = sources.map((source) => {
    if (source.type !== 'directory') return { ...source, live: false };
    if (source.id !== 'workspace') {
      const published = publishRuns(source.runs, path.join(out, 'backends', source.id, 'runs'), keep);
      result.published.push(...published.published.map((id) => `${source.id}/${id}`));
      result.skipped.push(...published.skipped.map((id) => `${source.id}/${id}`));
    }
    return { id: source.id, label: source.label, type: 'http', baseUrl: source.id === 'workspace' ? './' : `./backends/${source.id}/` };
  });
  writeFileSync(path.join(out, 'sources.json'), `${JSON.stringify({ schemaVersion: 1, sources: descriptors }, null, 2)}\n`);
  return { files, ...result };
}
