/**
 * @module `atlas critic review`
 *
 * Reads the ranked "needs polish" list from the server and lets a person mark what critics found: accept an opinion (it is right) or
 * dismiss it (it is not), as a whole or finding by finding. Without `--entry` it lists the entries one critic judged, lowest first, with
 * their findings and the marks already made; at a terminal it then walks through them and asks. With `--entry` and `--accept` or
 * `--dismiss` it records one decision, with no terminal needed. A mark is published as a layer under `critic.review.<reviewer>` (see
 * {@link ./marks}); it needs no more power than a critic's token has, is never counted, and never changes a status, a slot or the gate.
 * Nothing is marked when a flag names something that is not there: the command says what is.
 *
 * @see docs/critics.md#reviewing-and-marking
 */
import { httpStore } from '../../reports/src/http-store';
import { markStanding, rankCritiques, type MarkStanding } from '../../reports/src/critique-review';
import type { CatalogEntry, EntryCritique } from '../../reports/src/ui-catalog-entries';
import { createCatalogClient } from './catalog-client';
import { connection, defaultAsk, list, numberFlag, print, scopeOf, value, values, wantsJson, type CriticIo } from './cli-common';
import { publishMarks, reviewerName, type MarkRequest } from './marks';
import type { LoadedConfig } from './registry';

const DEFAULT_LIMIT = 20;

const standingJson = (standing: MarkStanding) => ({ state: standing.state, accepted: [...standing.accepted], dismissed: [...standing.dismissed], earlier: standing.earlier, notes: [...standing.notes] });

/** The critics that have a critique of any of the entries, most critiques first. */
function criticsOf(entries: readonly CatalogEntry[]): string[] {
  const tally = new Map<string, number>();
  for (const entry of entries) for (const found of entry.critiques) tally.set(found.critique.critic.name, (tally.get(found.critique.critic.name) ?? 0) + 1);
  return [...tally].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([name]) => name);
}

function describeEntry(entry: CatalogEntry, found: EntryCritique, rank: number | null) {
  const { critique } = found;
  return {
    rank, key: entry.key, title: entry.title, state: entry.state, imageSha256: entry.image.sha256,
    score: critique.verdict?.score ?? null, percentile: critique.verdict?.relative?.percentile ?? null, label: critique.verdict?.label ?? null,
    currency: found.currency,
    ...(critique.failure ? { failure: critique.failure.reason } : {}),
    marks: standingJson(markStanding(entry.marks, { critic: critique.critic.name })),
    findings: (critique.findings ?? []).map(finding => ({
      id: finding.id ?? null, category: finding.category ?? null, severity: finding.severity ?? null,
      ...(finding.region ? { region: { unit: finding.region.unit, x: finding.region.x, y: finding.region.y, w: finding.region.w, h: finding.region.h } } : {}),
      rationale: finding.rationale ?? null, suggestion: finding.suggestion ?? null,
      marks: finding.id ? standingJson(markStanding(entry.marks, { critic: critique.critic.name, finding: finding.id })) : null
    }))
  };
}

/** Looks up what a `--entry` flag names and which critique of it is being marked. Throws, saying what there is, when it is not there. */
function targetOf(entries: readonly CatalogEntry[], key: string, criticFlag: string | undefined): { entry: CatalogEntry; found: EntryCritique } {
  const entry = entries.find(candidate => candidate.key === key);
  if (!entry) throw new Error(`No entry "${key}" in the catalog. List them with \`atlas critic review\` (or \`atlas critic run --dry-run\`)`);
  const named = [...new Set(entry.critiques.map(found => found.critique.critic.name))];
  const criticName = criticFlag ?? (named.length === 1 ? named[0] : undefined);
  if (!criticName) throw new Error(named.length ? `${key} has critiques from ${named.join(', ')}: say whose opinion with --critic <name>` : `${key} has no critique to mark yet: run a critic on it first`);
  const mine = entry.critiques.filter(found => found.critique.critic.name === criticName);
  if (!mine.length) throw new Error(`${criticName} has not judged ${key}${named.length ? ` (judged by ${named.join(', ')})` : ''}`);
  const found = mine.find(candidate => candidate.currency === 'current');
  if (!found) throw new Error(`${criticName}'s critique of ${key} judged an earlier picture; the picture has changed. Run the critic again (\`atlas critic run --critic ${criticName} --all\`) and mark the new opinion`);
  if (found.critique.failure) throw new Error(`${criticName} could not judge ${key} (${found.critique.failure.reason}); there is no opinion to mark`);
  return { entry, found };
}

/** `atlas critic review`. */
export async function reviewCommand(argv: readonly string[], io: CriticIo, loaded: LoadedConfig): Promise<number> {
  const env = io.env ?? process.env;
  const json = wantsJson(argv);
  const interactive = !argv.includes('--non-interactive') && !argv.includes('--list') && !json && (io.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY));
  const ask = io.ask ?? defaultAsk;
  const dryRun = argv.includes('--dry-run');
  const server = await connection(argv, loaded, env);
  if (!server) throw new Error('review needs --server <url> (or "server.url" in atlas.critics.json, or ATLAS_SERVER_URL)');
  const accept = argv.includes('--accept'), dismiss = argv.includes('--dismiss');
  if (accept && dismiss) throw new Error('--accept and --dismiss are opposites: give one');
  const entryKey = value(argv, 'entry');
  if ((accept || dismiss) && !entryKey) throw new Error(`--${accept ? 'accept' : 'dismiss'} needs --entry <key>, the entry whose opinion you are marking (list them with \`atlas critic review\`)`);
  if (!accept && !dismiss && (values(argv, 'finding').length || value(argv, 'note'))) throw new Error('--finding and --note go with --accept or --dismiss');
  const reviewer = reviewerName(value(argv, 'reviewer') ?? env.ATLAS_REVIEWER ?? 'reviewer');

  const { query } = scopeOf(argv);
  const client = createCatalogClient({ url: server.url, ...(server.token ? { token: server.token } : {}), ...(server.project ? { project: server.project } : {}), ...(io.fetch ? { fetch: io.fetch } : {}), ...(io.sleep ? { sleep: io.sleep } : {}) });
  const read = await client.read(query);
  const clock = io.clock ?? Date.now;
  const store = httpStore({ url: server.url, ...(server.token ? { token: server.token } : {}), ...(server.project ? { project: server.project } : {}), ...(io.fetch ? { fetch: io.fetch } : {}), ...(io.sleep ? { sleep: io.sleep } : {}) });

  const marked: { entry: string; critic: string; finding: string | null; decision: 'accept' | 'dismiss' }[] = [];
  let layer = null as string | null;
  const record = async (requests: MarkRequest[]) => {
    for (const request of requests) marked.push({ entry: request.entry.key, critic: request.critic.name, finding: request.finding ?? null, decision: request.decision });
    if (!dryRun && requests.length) layer = (await publishMarks(store, { reviewer, marks: requests, recordedAtMs: clock() }))?.id ?? null;
  };

  const criticFlag = value(argv, 'critic');
  let targetCritic: string | undefined;
  if (criticFlag && !criticsOf(read.entries).includes(criticFlag) && !entryKey) throw new Error(`No entry has a critique from "${criticFlag}". Critics with opinions: ${criticsOf(read.entries).join(', ') || 'none yet'}`);

  // One decision, by flag: no terminal needed.
  if (entryKey && (accept || dismiss)) {
    const { entry, found } = targetOf(read.entries, entryKey, criticFlag);
    targetCritic = found.critique.critic.name;
    const decision = accept ? 'accept' as const : 'dismiss' as const;
    const ids = list(argv, 'finding');
    const known = (found.critique.findings ?? []).map(finding => finding.id).filter((id): id is string => Boolean(id));
    for (const id of ids) if (!known.includes(id)) throw new Error(`${found.critique.critic.name}'s critique of ${entryKey} has no finding "${id}". ${known.length ? `Its findings: ${known.join(', ')}` : 'It has no findings with an id: mark the whole opinion by leaving out --finding'}`);
    const note = value(argv, 'note');
    const base = { entry: { key: entry.key, title: entry.title, imageSha256: entry.image.sha256 }, critic: { name: found.critique.critic.name, version: found.critique.critic.version }, decision, layer: found.layer, ...(note ? { note } : {}) };
    await record(ids.length ? ids.map(id => ({ ...base, finding: id })) : [base]);
  }

  const critics = criticsOf(read.entries);
  const critic = criticFlag ?? targetCritic ?? (entryKey ? read.entries.find(entry => entry.key === entryKey)?.critiques[0]?.critique.critic.name : undefined) ?? critics[0] ?? null;
  const ranking = rankCritiques(read.entries, critic, value(argv, 'state'));
  const limit = numberFlag(argv, 'limit', true) ?? DEFAULT_LIMIT;
  const everything = [...ranking.ranked.map((item, index) => describeEntry(item.entry, item.found, index + 1)), ...ranking.unranked.map(item => describeEntry(item.entry, item.found, null))];
  // One entry when one was named (so its findings and marks can be read before or after marking), else the top of the list.
  const shown = entryKey ? everything.filter(item => item.key === entryKey) : everything.slice(0, limit);

  // Walk the list and ask, at a terminal.
  if (!entryKey && interactive && critic) {
    const requests: MarkRequest[] = [];
    walk: for (const item of ranking.ranked.slice(0, limit)) {
      const { critique } = item.found;
      io.out(`\n${item.entry.title} (${item.entry.key}) — ${item.entry.state}, score ${critique.verdict?.score ?? 'none'}${critique.verdict?.label ? `, ${critique.verdict.label}` : ''}\n`);
      const base = { entry: { key: item.entry.key, title: item.entry.title, imageSha256: item.entry.image.sha256 }, critic: { name: critique.critic.name, version: critique.critic.version }, layer: item.found.layer };
      const targets = (critique.findings ?? []).length
        ? (critique.findings ?? []).filter(finding => finding.id).map(finding => ({ finding: finding.id!, text: `${finding.category ?? 'finding'} (${finding.severity ?? 'no severity'}): ${finding.rationale ?? ''}` }))
        : [{ finding: undefined, text: 'the opinion as a whole' }];
      for (const target of targets) {
        const answer = (await ask(`  ${target.text}\n  [a]ccept, [d]ismiss, [s]kip, [q]uit? `)).trim().toLowerCase();
        if (answer.startsWith('q')) break walk;
        if (answer.startsWith('a') || answer.startsWith('d')) requests.push({ ...base, ...(target.finding ? { finding: target.finding } : {}), decision: answer.startsWith('a') ? 'accept' : 'dismiss' });
      }
    }
    await record(requests);
  }

  const document = {
    ok: true, server: server.url, critic, critics, reviewer,
    rankedBy: ranking.rankedBy,
    summary: { ranked: ranking.ranked.length, unranked: ranking.unranked.length, unjudged: ranking.unjudged },
    entries: shown,
    ...(marked.length || accept || dismiss ? { marked: { dryRun, reviewer, layer, marks: marked } } : {})
  };
  if (json) { print(io, document); return 0; }
  if (marked.length) {
    io.out(`${dryRun ? 'Would mark' : 'Marked'} ${marked.length} ${marked.length === 1 ? 'opinion' : 'opinions'} as ${reviewer}:\n`);
    for (const mark of marked) io.out(`  ${mark.decision === 'accept' ? 'accepted' : 'dismissed'} ${mark.critic} on ${mark.entry}${mark.finding ? ` (${mark.finding})` : ''}\n`);
    if (layer) io.out(`Published as layer ${layer.slice(0, 12)}\n`);
    return 0;
  }
  if (!critic) { io.out('No critic has judged a captured state yet. Run `atlas critic run --critic <name> --all` first.\n'); return 0; }
  io.out(`Needs polish, by ${critic} (${ranking.rankedBy === 'standing-within-kind' ? 'lowest standing within its state kind first' : 'lowest score first'}):\n`);
  for (const entry of shown) {
    const marksText = entry.marks.state === 'unmarked' ? '' : `  [${entry.marks.state}]`;
    io.out(`  ${entry.rank === null ? '-' : String(entry.rank).padStart(2)}. ${entry.title} (${entry.key}) ${entry.state} score ${entry.score ?? 'none'}${entry.percentile === null ? '' : `, ${Math.round(entry.percentile)}th percentile in kind`}${entry.currency === 'earlier-image' ? ' — judged an earlier picture' : ''}${entry.failure ? ` — could not judge (${entry.failure})` : ''}${marksText}\n`);
    for (const finding of entry.findings) io.out(`        ${finding.id ?? '?'}: ${finding.category ?? 'finding'} (${finding.severity ?? 'no severity'}) ${finding.rationale ?? ''}${finding.marks && finding.marks.state !== 'unmarked' ? `  [${finding.marks.state}]` : ''}\n`);
  }
  if (ranking.unjudged) io.out(`${ranking.unjudged} not judged yet by ${critic}.\n`);
  io.out('Mark one with `atlas critic review --entry <key> --accept|--dismiss [--finding <id>] [--note <why>]`.\n');
  return 0;
}
