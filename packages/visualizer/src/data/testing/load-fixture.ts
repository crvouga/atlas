import { readFileSync } from 'node:fs';
import path from 'node:path';

import { listSpecFiles, resolveRoots, runsIndex } from '../../../vite/atlas-files';
import { buildAtlasView } from '../model/build';
import { createIssueSink } from '../parse/issues';
import { parseManifest, parseRunsIndex, type ParsedRun } from '../parse/manifest';
import { parseSpec, type SpecFile } from '../parse/spec';
import { readStructured } from '../parse/structured';

export const MEDIA_PREFIX = '/__atlas/runs';

function readSpecFile(root: string, relative: string): SpecFile {
  try {
    return { path: relative, text: readFileSync(path.join(root, relative), 'utf8') };
  } catch (error) {
    return { path: relative, text: null, error: error instanceof Error ? error.message : 'unreadable' };
  }
}

/**
 * A fixture loaded the way the dev server serves it: the spec files it lists, the runs index it
 * builds, and the newest complete run's manifest (or the run named), parsed and built into a view.
 */
export function loadFixture(name: string, options: { runId?: string } = {}) {
  const roots = resolveRoots({ ATLAS_FIXTURE: name });
  const specSink = createIssueSink();
  const files = listSpecFiles(roots.specs).map((relative) => readSpecFile(roots.specs, relative));
  const specDoc = parseSpec({ ref: null, files }, specSink);

  const runSink = createIssueSink();
  const served: unknown = JSON.parse(JSON.stringify(runsIndex(roots.runs)));
  const index = parseRunsIndex('runs/index.json', served, runSink);
  const runId = options.runId ?? index.runs.find((r) => (r.progress ?? 'complete') === 'complete')?.id ?? null;
  let run: ParsedRun | null = null;
  if (runId) {
    const file = `runs/${runId}/manifest.json`;
    let text: string | null = null;
    try {
      text = readFileSync(path.join(roots.runs, runId, 'manifest.json'), 'utf8');
    } catch {
      runSink.add('error', file, [], 'This run has no manifest yet.');
    }
    const raw = text === null ? undefined : readStructured(file, text, runSink);
    run = raw === undefined ? null : parseManifest(runId, file, raw, runSink);
  }

  const view = buildAtlasView({
    spec: specDoc,
    specIssues: specSink.issues,
    runs: index.runs,
    run,
    runIssues: runSink.issues,
    runProgress: index.runs.find((r) => r.id === runId)?.progress,
    resolveMedia: (id, media) => `${MEDIA_PREFIX}/${id}/${media}`
  });
  return { view, specDoc, run, runs: index.runs, roots };
}

/** The file on disk behind a media URL the view resolved. */
export function mediaFile(runsRoot: string, url: string) {
  return path.join(runsRoot, url.slice(MEDIA_PREFIX.length + 1));
}
