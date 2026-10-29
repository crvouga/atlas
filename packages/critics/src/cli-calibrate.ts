/**
 * @module `atlas critic calibrate`
 *
 * Measures a critic against labelled examples, per state kind, and proposes a threshold for each: the library function
 * `calibrate` behind a command. The examples are pictures in directories (`--good`, `--bad`, and `--heldout-good`, `--heldout-bad` for
 * pictures the threshold must not be chosen on; a subdirectory's name is the state kind of the pictures in it, else `--state`, else
 * `unknown`), and/or the whole-critique marks reviewers made (`--from-marks`: accepted means the UI needs polish, dismissed means it
 * does not). The critic judges the pictures here, with the same consent, timeouts and budgets as `run`. Nothing is published: the
 * calibration is a document (`--out`) that `atlas critic run --calibration` reads. Figures measured on the examples the threshold was
 * chosen on are labelled in-sample; only held-out figures can open `--mode gate`.
 *
 * @see docs/critics.md#state-aware-judging-calibration-and-modes
 */
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { markStanding } from '../../reports/src/critique-review';
import { sha256Hex } from '../../reports/src/sigv4';
import { createCatalogClient } from './catalog-client';
import { connection, defaultAsk, list, numberFlag, positionals, print, redactIn, value, wantsJson, type CriticIo } from './cli-common';
import type { JudgeableEntry } from './contract';
import { calibrate, gateDecision, type Calibration, type LabelledExample } from './judging';
import { buildCritic, type LoadedConfig } from './registry';
import { runCritic } from './runner';

const IMAGE = /\.(png|jpe?g|webp|gif)$/i;

type Group = 'good' | 'bad' | 'heldout-good' | 'heldout-bad';
const GROUPS: readonly Group[] = ['good', 'bad', 'heldout-good', 'heldout-bad'];

async function filesOf(directory: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (current: string) => {
    for (const entry of (await readdir(current, { withFileTypes: true })).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full); else if (IMAGE.test(entry.name)) found.push(full);
    }
  };
  await walk(directory);
  return found;
}

/** `atlas critic calibrate <name>`. */
export async function calibrateCommand(argv: readonly string[], io: CriticIo, loaded: LoadedConfig): Promise<number> {
  const env = io.env ?? process.env;
  const json = wantsJson(argv);
  const interactive = !argv.includes('--non-interactive') && !json && (io.interactive ?? Boolean(process.stdin.isTTY && process.stdout.isTTY));
  const ask = io.ask ?? defaultAsk;
  const dryRun = argv.includes('--dry-run');
  const cwd = io.cwd ?? process.cwd();
  const [name] = positionals(argv);
  if (!name) throw new Error(`calibrate needs the name of a critic: ${Object.keys(loaded.config.critics).join(', ') || 'none are configured in atlas.critics.json'}`);

  const dirs = Object.fromEntries(GROUPS.map(group => [group, list(argv, group)])) as Record<Group, string[]>;
  const fromMarks = argv.includes('--from-marks');
  const haveDirs = GROUPS.some(group => dirs[group].length > 0);
  if (!haveDirs && !fromMarks) throw new Error('calibrate needs labelled examples: --good <dir> and --bad <dir> (and --heldout-good / --heldout-bad for pictures the threshold must not be chosen on), or --from-marks to use the marks reviewers made on a server');
  const defaultState = value(argv, 'state') ?? 'unknown';
  const server = fromMarks ? await connection(argv, loaded, env) : null;
  if (fromMarks && !server) throw new Error('--from-marks needs --server <url> (or "server.url" in atlas.critics.json, or ATLAS_SERVER_URL)');

  // The pictures: each file is an example, labelled by the directory it is in.
  type Source = { key: string; group: Group; stateKind: string; file: string };
  const sources: Source[] = [];
  for (const group of GROUPS) for (const directory of dirs[group]) {
    const root = path.resolve(cwd, directory);
    let files: string[];
    try { files = await filesOf(root); } catch { throw new Error(`--${group} ${directory} cannot be read as a directory of pictures`); }
    if (!files.length) throw new Error(`--${group} ${directory} holds no pictures (png, jpg, webp or gif)`);
    for (const file of files) {
      const relative = path.relative(root, file).split(path.sep);
      sources.push({ key: `${group}/${path.basename(directory)}/${relative.join('/')}`, group, stateKind: relative.length > 1 ? relative[0]! : defaultState, file });
    }
  }

  const skipped: { source: string; reason: string }[] = [];
  const examples: LabelledExample[] = [];
  let version: string | null = value(argv, 'critic-version') ?? null;
  let model: { id: string; provider?: string } | undefined;
  let parameters: Record<string, unknown> | undefined;
  let sendsImagesTo: string | null = null;
  let fileExamples = 0;

  if (haveDirs) {
    const built = await buildCritic(loaded, name, io);
    const secrets = built.secrets;
    const description = built.critic.describe();
    version = built.critic.version;
    model = description.model ? { ...description.model } : undefined;
    parameters = description.parameters ? { ...description.parameters } : undefined;
    sendsImagesTo = description.sendsImagesTo;
    if (!dryRun && sendsImagesTo !== null && !argv.includes('--yes')) {
      if (!interactive) throw new Error(`${name} sends images to ${sendsImagesTo}: pass --yes to allow it (nothing was sent)`);
      const answer = await ask(`${name} will send ${sources.length} image${sources.length === 1 ? '' : 's'} to ${sendsImagesTo}. Continue? [y/N] `);
      if (!/^y(es)?$/i.test(answer.trim())) throw new Error(`Stopped: ${name} would send images to ${sendsImagesTo} and that was not confirmed (nothing was sent)`);
    }
    if (!dryRun) await built.ready();
    const bytes = new Map<string, Uint8Array>();
    const entries: JudgeableEntry[] = [];
    for (const source of sources) {
      const data = new Uint8Array(await readFile(source.file));
      bytes.set(source.key, data);
      entries.push({ key: source.key, title: path.basename(source.file), state: source.stateKind, imageSha256: await sha256Hex(data) });
    }
    const maxImages = numberFlag(argv, 'max-images', true), concurrency = numberFlag(argv, 'concurrency', true), timeoutMs = numberFlag(argv, 'timeout-ms', true);
    const result = await runCritic({
      critic: built.critic, entries, force: true, dryRun, loadImage: entry => Promise.resolve(bytes.get(entry.key)!), secrets,
      ...(maxImages ? { budget: { maxImages } } : {}), ...(concurrency ? { concurrency } : {}), ...(timeoutMs ? { timeoutMs } : {})
    });
    if (dryRun) {
      const document = { ok: true, dryRun, critic: { name, version }, sendsImagesTo, examples: { files: sources.length, marks: 0, used: 0, skipped }, calibration: null, written: null, gate: null, warnings: [] as string[] };
      if (json) print(io, document); else io.out(`Would judge ${sources.length} ${sources.length === 1 ? 'picture' : 'pictures'} with ${name}@${version}. ${sendsImagesTo ? `Images would go to ${sendsImagesTo}` : 'Images stay on this machine'}. Nothing was sent or written.\n`);
      return 0;
    }
    for (const outcome of result.outcomes) {
      const source = sources.find(candidate => candidate.key === outcome.entry.key)!;
      const score = outcome.critique.verdict?.score;
      if (outcome.critique.failure || score === undefined) { skipped.push({ source: source.key, reason: outcome.critique.failure ? `the critic could not judge it (${outcome.critique.failure.reason})` : 'the critic gave no score' }); continue; }
      examples.push({ score, stateKind: source.stateKind, bad: source.group.endsWith('bad'), ...(source.group.startsWith('heldout') ? { heldOut: true } : {}) });
      fileExamples += 1;
    }
    for (const source of sources) if (!result.outcomes.some(outcome => outcome.entry.key === source.key)) skipped.push({ source: source.key, reason: result.stoppedBy === 'budget' ? 'the budget was reached before it was judged' : 'it was not judged' });
  }

  // The marks: a whole-critique accept says the UI needs polish, a dismissal says it does not; findings are not examples.
  let markExamples = 0;
  if (fromMarks && server) {
    const client = createCatalogClient({ url: server.url, ...(server.token ? { token: server.token } : {}), ...(server.project ? { project: server.project } : {}), ...(io.fetch ? { fetch: io.fetch } : {}), ...(io.sleep ? { sleep: io.sleep } : {}) });
    const read = await client.read({});
    for (const entry of read.entries) {
      const found = entry.critiques.filter(item => item.currency === 'current' && item.critique.critic.name === name && !item.critique.failure && item.critique.verdict?.score !== undefined);
      const standing = markStanding(entry.marks, { critic: name });
      if (standing.state === 'unmarked' && !standing.earlier) continue;
      if (!found.length) { skipped.push({ source: entry.key, reason: `${name} has no current score for it` }); continue; }
      if (version === null) version = found[0]!.critique.critic.version;
      const critique = found.find(item => item.critique.critic.version === version);
      if (!critique) { skipped.push({ source: entry.key, reason: `${name} judged it as version ${found[0]!.critique.critic.version}, not ${version}` }); continue; }
      if (standing.state === 'unmarked') { skipped.push({ source: entry.key, reason: 'its marks were made about an earlier picture' }); continue; }
      if (standing.state === 'disputed') { skipped.push({ source: entry.key, reason: 'reviewers disagree' }); continue; }
      examples.push({ score: critique.critique.verdict!.score!, stateKind: entry.state, bad: standing.state === 'accepted' });
      markExamples += 1;
    }
    if (version === null) version = read.entries.flatMap(entry => entry.critiques).find(item => item.critique.critic.name === name)?.critique.critic.version ?? null;
  }
  if (version === null) throw new Error(`${name} has no critique on the server to calibrate (give --critic-version, or run it first)`);

  const measured = calibrate({ name, version }, examples);
  const calibration: Calibration = {
    ...measured,
    critic: { ...measured.critic, ...(model ? { model } : {}), ...(parameters ? { parameters } : {}) },
    createdAtMs: (io.clock ?? Date.now)()
  };
  const refusal = gateDecision({ mode: 'gate', critic: { name, version }, scores: calibration.kinds.map(kind => ({ entryKey: kind.stateKind, stateKind: kind.stateKind, score: null })), calibration }).refusal;
  const warnings: string[] = [];
  if (!examples.length) warnings.push('No example had a score, so there is nothing to measure');
  let written: string | null = null;
  const out = value(argv, 'out');
  if (out) {
    const target = path.resolve(cwd, out);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(calibration, null, 2)}\n`);
    written = path.relative(cwd, target) || target;
  }
  const document = {
    ok: true, dryRun, critic: { name, version }, sendsImagesTo,
    examples: { files: fileExamples, marks: markExamples, used: examples.length, skipped },
    calibration, written, gate: { eligible: refusal.length === 0 && examples.length > 0, reasons: refusal },
    warnings: warnings.map(warning => redactIn(warning, []))
  };
  if (json) { print(io, document); return 0; }
  io.out(`Calibration of ${name}@${version}: ${examples.length} ${examples.length === 1 ? 'example' : 'examples'} (${fileExamples} from pictures, ${markExamples} from marks)${skipped.length ? `, ${skipped.length} left out` : ''}\n`);
  for (const kind of calibration.kinds) {
    io.out(`  ${kind.stateKind.padEnd(12)} ${kind.samples} samples (${kind.positives} bad, ${kind.negatives} good)  threshold ${kind.threshold ?? 'none'}  precision ${kind.precision ?? 'n/a'}  recall ${kind.recall ?? 'n/a'}  ${kind.inSample ? 'IN-SAMPLE: measured on the examples the threshold was chosen on' : 'held-out'}\n`);
  }
  for (const item of skipped.slice(0, 10)) io.out(`  left out ${item.source}: ${item.reason}\n`);
  io.out(document.gate.eligible ? 'Gate mode would accept this calibration.\n' : `Gate mode would refuse this calibration:\n${refusal.map(line => `  - ${line}`).join('\n')}\n`);
  io.out(written ? `Written to ${written}. Use it with \`atlas critic run --mode gate --calibration ${written}\`.\n` : 'Not written: pass --out <file> to keep it.\n');
  for (const warning of document.warnings) io.out(`! ${warning}\n`);
  return 0;
}
