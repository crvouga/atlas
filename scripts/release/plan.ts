/**
 * Print which public packages the next release would publish, and at which versions.
 *
 *   bun scripts/release/plan.ts
 *   bun scripts/release/plan.ts --github-output   (also writes has_changes and planned releases to $GITHUB_OUTPUT)
 */
import { appendFileSync } from 'node:fs';

import { computePlan } from './lib.ts';

const plan = await computePlan();

if (plan.releases.length === 0) {
  console.log('release:plan: nothing to release');
} else {
  console.log(`release:plan: ${plan.releases.length} package(s) to release`);
  for (const r of plan.releases) {
    const why =
      r.bump === 'initial'
        ? 'initial release'
        : [r.commits.length > 0 ? `${r.commits.length} commit(s)` : null, r.dependencyUpdates.length > 0 ? `deps: ${r.dependencyUpdates.join(', ')}` : null]
            .filter(Boolean)
            .join('; ');
    const label = r.bump === 'initial' ? why : `${r.bump}; ${why}`;
    console.log(`  ${r.pkg.name}: ${r.previous ?? '—'} → ${r.version} (${label})`);
  }
}

if (process.argv.includes('--github-output') && process.env.GITHUB_OUTPUT) {
  const releases = plan.releases.map(r => ({ name: r.pkg.name, version: r.version }));
  appendFileSync(process.env.GITHUB_OUTPUT, `has_changes=${releases.length > 0}\nreleases=${JSON.stringify(releases)}\n`);
}
