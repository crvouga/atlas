import { readFile } from 'node:fs/promises';
import path from 'node:path';

import type { EvidenceCheck, SpecEntry } from './explorer-types';
import type { IngestedChecks } from './ingest';
import { loadDirectoryOutline, specKindOf } from './directory-outline';
import { specPath, textFingerprint } from './layer-merge';

const words = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
/** A file's name without the extension of a spec: `user.profile.feature` is `user.profile`, `cart.openslo.yaml` is `cart`. */
const stem = (file: string) => path.posix.basename(file).replace(/(\.openslo|\.machine)?\.(feature|qnt|dmn|als|ya?ml|json|scxml|md|txt|xml)$/i, '');

export type SpecLinks = {
  /** Every file under this directory is a spec named `specs/<its path>`. */
  readonly specsDirectory?: string;
  /** Every check in the report belongs to this spec. */
  readonly spec?: string;
  readonly base: string;
};

/**
 * A test report rarely says which spec a test checks. Say so here, in the order of how sure it is:
 *
 * 1. `spec`: the whole report is one spec's checks (a report per feature file).
 * 2. A path the report gives that is one of the specs.
 * 3. A name the report gives for the suite, class or file that is a spec's title or file name
 *    (Cucumber writes the feature's title as the suite), or the first part of a check's title before
 *    ` > `.
 *
 * What cannot be linked stays unlinked, and is reported under no spec rather than a wrong one.
 * Returns the checks and the specs they now belong to, with fingerprints, so a later reader can warn
 * when a spec changed after the layer was recorded.
 */
export async function linkChecksToSpecs(ingested: IngestedChecks, links: SpecLinks): Promise<{ readonly checks: readonly EvidenceCheck[]; readonly specs: readonly SpecEntry[] }> {
  const outline = links.specsDirectory ? await loadDirectoryOutline(path.resolve(links.base, links.specsDirectory), { repoRoot: links.base }) : null;
  const known = new Map((outline?.specs ?? []).map(entry => [entry.path, entry]));
  const byName = new Map<string, string>();
  for (const entry of [...known.values()].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    for (const name of [words(entry.title), words(stem(entry.path))]) if (name && !byName.has(name)) byName.set(name, entry.path);
  }
  let explicit: string | null = null;
  if (links.spec) explicit = specPath(links.spec);

  const checks = ingested.checks.map((check, index): EvidenceCheck => {
    if (explicit) return { ...check, specPath: explicit };
    if (check.specPath && known.has(specPath(check.specPath))) return { ...check, specPath: specPath(check.specPath) };
    const first = check.title.split(/ [>›] /)[0] ?? '';
    for (const hint of [...(ingested.hints?.[index] ?? []), first]) {
      const found = byName.get(words(hint)) ?? byName.get(words(stem(hint)));
      if (found) return { ...check, specPath: found };
    }
    return check;
  });

  const used = [...new Set(checks.flatMap(check => (check.specPath ? [check.specPath] : [])))].sort();
  const specs: SpecEntry[] = [];
  for (const used_ of used) {
    const entry = known.get(used_);
    if (entry) { specs.push(entry); continue; }
    // An explicit spec outside a specs directory: read it where it is, if it is there. Nothing else
    // a report names is read: a report is data, and does not choose which files Atlas opens.
    if (used_ !== explicit || !links.spec) continue;
    const text = await readFile(path.resolve(links.base, links.spec), 'utf8').catch(() => null);
    if (text !== null) specs.push({ path: used_, domain: path.basename(links.base) || 'product', kind: specKindOf(used_), title: path.posix.basename(used_), fingerprint: textFingerprint(text) });
  }
  return { checks, specs };
}
