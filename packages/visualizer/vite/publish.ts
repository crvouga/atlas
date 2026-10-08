import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { listSpecFiles, runsIndex, type AtlasRoots } from './atlas-files';

export type PublishOptions = {
  roots: AtlasRoots;
  /** The directory the static site reads as its data base URL (`./data/` by default). */
  out: string;
  /** How many of the newest complete runs to publish. */
  keep?: number;
  /** The branch or commit the specs came from; the git HEAD of the specs directory when omitted. */
  ref?: string | null;
};

export type PublishResult = { files: string[]; published: string[]; skipped: string[] };

function gitRef(cwd: string) {
  try {
    return execSync('git rev-parse HEAD', { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

function privacyPassed(manifestFile: string) {
  try {
    const manifest = JSON.parse(readFileSync(manifestFile, 'utf8')) as { privacy?: { passed?: unknown } };
    return manifest.privacy?.passed === true;
  } catch {
    return false;
  }
}

/**
 * Lays out the spec and the newest runs for a static host, in the layout the static adapter
 * reads: `specs/index.json`, `specs/<path>`, `runs/index.json`, `runs/<id>/...`. Only `specs/`
 * and `runs/` under `out` are replaced. A run whose privacy check failed or is missing is never
 * published.
 */
export function publishData({ roots, out, keep = 30, ref }: PublishOptions): PublishResult {
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

  const published = [];
  const skipped: string[] = [];
  for (const run of runsIndex(roots.runs).runs) {
    if (published.length >= keep) break;
    if (run.progress === 'running') continue;
    if (!privacyPassed(path.join(roots.runs, run.id, 'manifest.json'))) {
      skipped.push(run.id);
      continue;
    }
    cpSync(path.join(roots.runs, run.id), path.join(runsOut, run.id), {
      recursive: true,
      filter: (file) => !file.split(path.sep).some((part) => part === '.frames' || part === '.work')
    });
    published.push(run);
  }
  writeFileSync(path.join(runsOut, 'index.json'), `${JSON.stringify({ generatedAt: new Date().toISOString(), runs: published }, null, 2)}\n`);
  return { files, published: published.map((r) => r.id), skipped };
}
