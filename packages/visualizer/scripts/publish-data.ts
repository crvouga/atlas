import path from 'node:path';

import { APP_ROOT, resolveRoots } from '../vite/atlas-files';
import { publishData } from '../vite/publish';

/**
 * `pnpm publish-data`: the spec and the newest runs into `public/data` (or `ATLAS_OUT`), where
 * `pnpm build` picks them up. Roots come from `ATLAS_SPECS_ROOT` / `ATLAS_RUNS_ROOT` or
 * `ATLAS_FIXTURE`, as for the dev server.
 */
try {
  const roots = resolveRoots();
  const base = process.env.INIT_CWD || process.cwd();
  const out = process.env.ATLAS_OUT ? path.resolve(base, process.env.ATLAS_OUT) : path.join(APP_ROOT, 'public/data');
  const keep = Number(process.env.ATLAS_KEEP_RUNS ?? 30);
  const result = publishData({ roots, out, keep: Number.isFinite(keep) && keep >= 0 ? keep : 30 });
  process.stdout.write(`Published ${result.files.length} spec file(s) and ${result.published.length} run(s) to ${out} (${roots.label})\n`);
  if (result.skipped.length) process.stdout.write(`Not published, privacy check missing or failed: ${result.skipped.join(', ')}\n`);
} catch (error) {
  process.stderr.write(`publish-data failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
