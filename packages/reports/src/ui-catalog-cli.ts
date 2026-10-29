/**
 * @module The `atlas ui-catalog` command
 *
 * `uiCatalogMain` is `atlas ui-catalog plan | publish | status | diff | export | collect`: the UI catalog ({@link ./ui-catalog}) without
 * a script. `plan` and `publish` turn a small JSON file (and the pictures beside it) into the layers of the expected set and of
 * the captures; `status` reads every store and says whether the catalog is complete and free of failures; `diff` sets two
 * commits against each other; `export` writes the catalog as one HTML file that needs no server; `collect` is one shard of
 * a collection shared through a server's queue ({@link ./ui-catalog-collect}). Like `atlas report`, it is
 * written so it can be called from code and tests: it takes its arguments, environment, working directory, clock and git as
 * parameters and returns the exit code, every command prints a JSON document with `--format json`, and a command that is wrong
 * throws, which `runUiCatalogCommand` turns into a message (or a JSON error) and exit code 2.
 *
 * Nothing here knows how a picture was taken: the files it reads are the same data any collector can write. Publishing a
 * catalog to a hosting platform is not a command: it would need that platform's credentials and API, which Atlas does not
 * hold. The file `export` writes, or a folder of them, is what to hand to whatever hosts static files.
 *
 * Exit codes: 0 it worked, 1 it ran and the answer is no (an incomplete catalog, a failed capture, an unreadable store, a
 * difference under `--fail-on-change`), 2 the command itself was wrong.
 *
 * @see docs/ui-catalog.md
 * @see docs/agents.md
 */
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod/v4';

import type { UiCatalogCollectResultSchema, UiCatalogDiffResultSchema, UiCatalogExportResultSchema, UiCatalogPublishResultSchema, UiCatalogStatusSchema } from '../../schema/src/cli-results';
import { readAttachmentFiles } from './attachment-files';
import { backendsOf, layerFilter, value, values, writeStoreOf } from './cli-stores';
import { readBackendLayers } from './compose';
import type { LayerEvidence } from './evidence-types';
import { distinctEvidence } from './layer-merge';
import { readLayerFile } from './layer-store';
import { parseWith } from './parse-with';
import { publishChecks } from './publish-checks';
import { detectFreshness, detectOrigin, executionOf, keyValue, parseTime, wantsJson, type ReportIo } from './report-cli';
import { filterUiCatalog, parseUiCatalogQuery, uiCatalog, uiCatalogMarkdown, type UiCatalog, type UiCatalogQuery } from './ui-catalog';
import { uiPlanLayer, uiStateLayer, type UiStateCapture, type UiStatePlan } from './ui-catalog-publish';
import { diffUiCatalogs, layersAtCommit, uiCatalogCommits, type UiCatalogDiff } from './ui-catalog-diff';
import { gatherUiPictures, uiCatalogHtml, uiPicturesWanted } from './ui-catalog-export';
import { AtlasHttpError } from './http-store';
import { collectCatalog, type CapturedItem, type CollectUnit } from './ui-catalog-collect';
import { CatalogDefinitionError, checkWhere, parseWhere, resolveCatalog, type CatalogDefinition } from './ui-catalog-definition';

/** The text `atlas ui-catalog --help` prints: every subcommand, its flags, what each does and the exit codes. Also the source of its entry in `docs/reference/cli.md`. */
export const UI_CATALOG_USAGE = `atlas ui-catalog — a browsable inventory of captured UI states, from any collector

  atlas ui-catalog plan    --states <file.json> --producer <name> [--store <dir|s3://bucket/prefix|https://…>]
                           [--environment <name>] [--param key=value]... [--shard <label>]
                           [--branch <b>] [--sha <s>] [--run-url <u>] [--run-id <id>] [--run-title <t>] [--recorded-at <iso|ms>]
  atlas ui-catalog publish --captures <file.json> --producer <name> [the same flags as plan]
                           [--attach-root <dir>]... [--max-picture-mb <n>]
  atlas ui-catalog status  [--store <dir|s3://…|id=url>]... [--backends <module>] [filters] [--branch <name>]...
                           [--ignore-modified] [--format text|json|markdown]
  atlas ui-catalog diff    --from <commit> --to <commit> [--store …]... [--backends <module>] [filters]
                           [--fail-on-change] [--format text|json|markdown]
  atlas ui-catalog export  --out <file.html> [--store …]... [--backends <module>] [filters]
                           [--images inline|none] [--max-mb <n>] [--manifest <file.json>] [--title <t>]
  atlas ui-catalog collect --catalog <atlas.catalog.ts> --exec "<command>" [--store https://…] [--shard <name>]
                           [--where dimension=value]... [--batch-size <n>] [--lease-seconds <n>]
                           [--max-units <n>] [--max-minutes <n>] [--collection <id>] [--stale-before <iso|ms>]
                           [--producer <name>] [--attach-root <dir>]... [--max-picture-mb <n>]

  filters (status, diff, export): --q <words> --coverage a,b --profile <key|label>... --area a --route r --cohort c
                           --flag f --surface s --producer p --attribute name=value

  plan      Write one layer of kind ui-plan: the states (and with "inventory": true, the surfaces) that should exist under
            this profile. Every entry is not-run, so a plan never counts as a pass. The file is {"states":[{"id":…,
            "title"?,"route"?,"fixture"?,"cohort"?,"area"?,"kind"?,"flags"?,"covers"?,"attributes"?,"inventory"?}]} or just that list.
  publish   Write one layer of kind ui-state: the states one collector or shard captured under this profile. The file is
            {"states":[{"id":…,"title"?,"status"?:"passed|failed|running|not-run","detail"?,"route"?,"fixture"?,"cohort"?,
            "area"?,"kind"?,"flags"?,"covers"?,"attributes"?,"labels"?,"tags"?,"durationMs"?,"screenshot"?:"file.png"|{"path"|"uri",
            "width"?,"height"?,"contentType"?}}]}. A picture file is read from beside the file and each --attach-root, never
            from a hidden file or a link out. A passed state whose picture cannot be read is published as failed, with the
            reason: a state without its picture is not shown as captured.
            --environment and each --param key=value are the profile (a viewport, a color scheme, a device): another
            profile is another result side by side. --shard only describes the layer; it never splits a result.
            --recorded-at defaults to the modification time of the file, so publishing the same file twice is one layer.
  status    Read every store and print the catalog's summary. Exit 1 unless the catalog holds a state and there is nothing
            to attend to: a failed capture, a state a plan expects with nothing captured, a capture still in progress, a
            backend or layer that could not be read. Without a plan nothing is expected, so nothing is missing.
            --profile takes a profile's key or its label, as printed by status.
  diff      Set the catalog recorded at one commit (--from) against another (--to): each state in each profile is paired
            with itself and is unchanged, changed in coverage, changed in picture (the stored bytes differ), unverified (a
            side has no content hash), only in --to (added) or only in --from (removed). A commit is the whole id or at
            least 7 digits of it. Exit 0 unless a store could not be read, or, with --fail-on-change, anything differs.
  export    Write the catalog as one HTML file with its pictures embedded and its manifest in it: no server, no network.
            It is the catalog at the moment it was made. --images none leaves the pictures out. --max-mb (default 32) limits
            the embedded pictures; those past it are listed in the page as left out, and the manifest stays complete.
            --manifest writes the catalog's JSON manifest too.
  collect   Be one shard of a collection that any number of shards share through an Atlas server: publish the catalog's
            definition (the default export of --catalog, made with defineCatalog; the same definition is the same
            version), claim the most urgent work units (failed, then empty, then unknown, then stale), run --exec for each
            claim, publish its captures and claim again until nothing is left or a bound is reached. --exec runs in a shell
            with ATLAS_UI_BATCH (a JSON file: {"claimId","units",[…],"states":[{"item","id",…facts,"profile":{…}}]}) and
            ATLAS_UI_CAPTURES (where it writes {"states":[…]} as publish reads it, each state naming its "item"; pictures
            beside it). An item it wrote nothing for is failed. --where takes the project's own dimension names and
            values (repeatable; a dimension given twice takes either value); an unknown one is exit 2. --stale-before
            also collects captured items recorded before that time, oldest first. On SIGINT or SIGTERM the claim is
            released, so its units go back to the queue at once. Needs a server: there is no order other shards cannot
            see. Exit 0 when nothing collected failed, 1 when something did or the server could not be reached.

  --format json (alias --json)   every subcommand prints one JSON document instead of prose
                       (schemas: ui-catalog-publish-result, ui-catalog-status, ui-catalog-diff-result, ui-catalog-export-result,
                       ui-catalog-collect-result).
                       A command that is wrong is {"ok":false,"error":{"message":…,"code":"usage"}} on standard error.
  A store is a directory, s3://bucket/prefix or an Atlas server (https://…), exactly as for atlas report; select a project
  with --project <slug> or ATLAS_PROJECT. When no --store is given, ATLAS_STORE is used.

  Exit codes: 0 ok, 1 the answer is no (see each command), 2 the command was wrong.
`;

type PublishResult = z.infer<typeof UiCatalogPublishResultSchema>;
type StatusResult = z.infer<typeof UiCatalogStatusSchema>;
type DiffResult = z.infer<typeof UiCatalogDiffResultSchema>;
type ExportResult = z.infer<typeof UiCatalogExportResultSchema>;
type CollectResultDocument = z.infer<typeof UiCatalogCollectResultSchema>;

const Facts = {
  route: z.string().optional(), fixture: z.string().optional(), cohort: z.string().optional(), area: z.string().optional(),
  kind: z.string().optional(), flags: z.array(z.string()).optional(), covers: z.array(z.string()).optional(), attributes: z.record(z.string(), z.string()).optional()
};
const PlanState = z.strictObject({ id: z.string().min(1), title: z.string().optional(), inventory: z.boolean().optional(), ...Facts });
const Picture = z.union([
  z.string().min(1),
  z.strictObject({ path: z.string().min(1).optional(), uri: z.string().min(1).optional(), name: z.string().optional(), contentType: z.string().optional(), width: z.number().int().positive().optional(), height: z.number().int().positive().optional() })
    .refine(picture => (picture.path === undefined) !== (picture.uri === undefined), 'give exactly one of path and uri')
]);
const CaptureState = z.strictObject({
  id: z.string().min(1), title: z.string().optional(), status: z.enum(['passed', 'failed', 'running', 'not-run']).optional(), detail: z.string().optional(),
  durationMs: z.number().nonnegative().optional(), labels: z.record(z.string(), z.string()).optional(), tags: z.array(z.string()).optional(), screenshot: Picture.optional(), ...Facts
});
const ExecCapture = CaptureState.extend({ id: z.string().min(1).optional(), item: z.string().min(1) });
const ExecCaptureFile = z.union([z.array(ExecCapture), z.strictObject({ states: z.array(ExecCapture) }).transform(file => file.states)]);
const PlanFile = z.union([z.array(PlanState), z.strictObject({ states: z.array(PlanState) }).transform(file => file.states)]);
const CaptureFile = z.union([z.array(CaptureState), z.strictObject({ states: z.array(CaptureState) }).transform(file => file.states)]);

async function readJson(file: string, base: string): Promise<{ json: unknown; at: string; modifiedAtMs: number }> {
  const at = path.resolve(base, file);
  let text: string, info;
  try { [text, info] = await Promise.all([readFile(at, 'utf8'), stat(at)]); } catch { throw new Error(`Cannot read ${file}: it is not there, or not a file`); }
  try { return { json: JSON.parse(text), at, modifiedAtMs: Math.floor(info.mtimeMs) }; } catch { throw new Error(`${file} is not JSON`); }
}

/** The profile and provenance every layer of `plan` and `publish` carries, from the flags, the CI's variables and git. */
function layerOrigin(rest: readonly string[], env: Readonly<Record<string, string | undefined>>, io: ReportIo, recordedAtMs: number) {
  const producer = value(rest, 'producer');
  if (!producer) throw new Error('give --producer <name>: a stable name for this collector, such as "web-capture" or "ui-plan"');
  const origin = detectOrigin(env, io.git);
  const sha = value(rest, 'sha') ?? origin.sha;
  const freshness = detectFreshness({ sha, ci: origin.ci && !value(rest, 'sha') }, io.git);
  const environment = value(rest, 'environment');
  const run = executionOf(rest, env);
  const shard = value(rest, 'shard');
  return {
    producer, recordedAtMs, sha, branch: value(rest, 'branch') ?? origin.branch, runUrl: value(rest, 'run-url') ?? origin.runUrl,
    ...(environment ? { environment } : {}), profile: Object.fromEntries(values(rest, 'param').map(pair => keyValue(pair, '--param'))),
    ...(shard ? { shard } : {}), ...(run ? { run: { id: run.id, ...(run.title ? { title: run.title } : {}) } } : {}),
    freshness
  };
}

const FILTERS = ['coverage', 'profile', 'area', 'route', 'cohort', 'flag', 'surface', 'producer', 'attribute'] as const;

/** The catalog filters on the command line: `--q` and the lists. A profile may be named by key or by label. */
function queryOf(rest: readonly string[], catalog: UiCatalog): UiCatalogQuery {
  const params = new URLSearchParams();
  const q = value(rest, 'q');
  if (q) params.set('q', q);
  for (const name of FILTERS) for (const given of values(rest, name)) params.append(name, given);
  const query = parseUiCatalogQuery(params);
  const coverage = values(rest, 'coverage').flatMap(list => list.split(',')).map(item => item.trim()).filter(Boolean);
  const unknown = coverage.find(item => !['captured', 'failed', 'capturing', 'skipped', 'missing'].includes(item));
  if (unknown) throw new Error(`--coverage takes captured, failed, capturing, skipped or missing (got "${unknown}")`);
  if (!query.profile?.length) return query;
  const profiles = values(rest, 'profile').map(given => {
    const found = catalog.profiles.find(profile => profile.key === given || profile.label === given);
    if (!found) throw new Error(`--profile "${given}" is not a profile of this catalog. Profiles: ${catalog.profiles.map(profile => `"${profile.label}"`).join(', ') || 'none'}`);
    return found.key;
  });
  return { ...query, profile: profiles };
}

async function layersOf(rest: readonly string[], base: string, env: Readonly<Record<string, string | undefined>>) {
  const backends = await backendsOf(rest, base, env);
  const read = await readBackendLayers(backends);
  const include = layerFilter(rest, env);
  const all = distinctEvidence(read.loaded.map(item => item.evidence)).filter(entry => !include || include(entry.layer));
  return { backends, layers: all as readonly LayerEvidence[], info: read.backends, notices: read.notices };
}

const sentence = (text: string) => text.replace(/\s+/g, ' ').trim();

/**
 * Captures read from a file, with each picture it names read from beside the file or an attach root. A `passed` state whose
 * picture cannot be read becomes `failed`, with the reason: a state without its picture is never shown as captured.
 */
async function withPictures<T extends Omit<z.infer<typeof CaptureState>, 'id'> & { readonly id?: string; readonly item?: string }>(parsed: readonly T[], roots: readonly string[], maxBytes: number): Promise<{ states: (Omit<T, 'screenshot'> & UiStateCapture)[]; warnings: string[]; pictures: number; pictureBytes: number }> {
  const states: (Omit<T, 'screenshot'> & UiStateCapture)[] = [];
  const warnings: string[] = [];
  let pictures = 0, pictureBytes = 0;
  for (const state of parsed) {
    const { screenshot, ...kept } = state;
    let capture = kept as Omit<T, 'screenshot'> & UiStateCapture;
    type Given = { path?: string; uri?: string; name?: string; contentType?: string; width?: number; height?: number };
    const picture: Given | undefined = typeof screenshot === 'string' ? { path: screenshot } : screenshot;
    if (picture?.uri !== undefined) capture = { ...capture, screenshot: { uri: picture.uri, ...(picture.contentType ? { contentType: picture.contentType } : {}), ...(picture.width ? { width: picture.width } : {}), ...(picture.height ? { height: picture.height } : {}) } };
    else if (picture?.path !== undefined) {
      const name = picture.name ?? path.basename(picture.path);
      const read = await readAttachmentFiles({ attachments: [{ name, role: 'screenshot', path: picture.path, ...(picture.contentType ? { contentType: picture.contentType } : {}) }] }, roots, { maxBytes });
      const data = (read.value.attachments as { data?: Uint8Array; contentType?: string }[])[0];
      if (data?.data) {
        pictures += 1; pictureBytes += data.data.length;
        capture = { ...capture, screenshot: { name, data: data.data, ...(data.contentType ? { contentType: data.contentType } : {}), ...(picture.width ? { width: picture.width } : {}), ...(picture.height ? { height: picture.height } : {}) } };
      } else {
        warnings.push(...read.warnings.map(warning => `${state.id ?? state.item}: ${warning}`));
        // A state whose picture is missing is not a capture: it is shown as failed, never as captured without a picture.
        if ((capture.status ?? 'passed') === 'passed') capture = { ...capture, status: 'failed', detail: sentence(`The picture could not be read: ${read.warnings[0] ?? picture.path}${capture.detail ? `. ${capture.detail}` : ''}`) };
      }
    }
    states.push(capture);
  }
  return { states, warnings, pictures, pictureBytes };
}

/** `atlas ui-catalog …`. Returns the exit code. Throws on a mistake in the command (see {@link runUiCatalogCommand}). */
export async function uiCatalogMain(argv: readonly string[], io: ReportIo = { out: text => process.stdout.write(text) }): Promise<number> {
  const [command, ...rest] = argv;
  const base = io.cwd ?? process.cwd();
  const env: Readonly<Record<string, string | undefined>> = { ...(io.env ?? process.env), ...(value(rest, 'project') !== undefined ? { ATLAS_PROJECT: value(rest, 'project') } : {}) };
  const json = wantsJson(rest);
  const format = value(rest, 'format') ?? (rest.includes('--json') ? 'json' : 'text');
  if (!['text', 'json', 'markdown'].includes(format)) throw new Error(`--format takes text|json|markdown (got "${format}")`);

  if (command === 'plan' || command === 'publish') {
    const flag = command === 'plan' ? 'states' : 'captures';
    const file = value(rest, flag);
    if (!file) throw new Error(`${command} needs --${flag} <file.json>`);
    const target = writeStoreOf(value(rest, 'store'), base, env);
    const given = await readJson(file, base);
    const recordedAtMs = parseTime(value(rest, 'recorded-at')) ?? given.modifiedAtMs;
    const origin = layerOrigin(rest, env, io, recordedAtMs);
    const { freshness, ...layerFields } = origin;
    const warnings: string[] = [];
    let input;
    let counts = { states: 0, captured: 0, failed: 0, pictures: 0, pictureBytes: 0 };
    if (command === 'plan') {
      const states: UiStatePlan[] = parseWith(PlanFile, given.json, file);
      counts = { ...counts, states: states.length };
      input = uiPlanLayer({ ...layerFields, states });
    } else {
      const parsed = parseWith(CaptureFile, given.json, file);
      const roots = [path.dirname(given.at), ...values(rest, 'attach-root').map(root => path.resolve(base, root))];
      const read = await withPictures(parsed, roots, Number(value(rest, 'max-picture-mb') ?? 64) * 1024 * 1024);
      const states = read.states;
      warnings.push(...read.warnings);
      counts = { ...counts, pictures: read.pictures, pictureBytes: read.pictureBytes };
      counts = { ...counts, states: states.length, captured: states.filter(state => (state.status ?? 'passed') === 'passed').length, failed: states.filter(state => state.status === 'failed').length };
      input = uiStateLayer({ ...layerFields, states });
    }
    const layer = await publishChecks(target.store, { ...input, ...(freshness ? { freshness } : {}) });
    const result: PublishResult = {
      ok: true, store: target.label,
      layer: { id: layer.id, kind: command === 'plan' ? 'ui-plan' : 'ui-state', producer: origin.producer, environment: layer.environment ?? null, parameters: { ...origin.profile }, ...counts, shard: origin.shard ?? null },
      warnings
    };
    if (json) io.out(`${JSON.stringify(result, null, 2)}\n`);
    else {
      io.out(command === 'plan'
        ? `Published plan ${layer.id.slice(0, 12)}: ${counts.states} expected state${counts.states === 1 ? '' : 's'} as "${origin.producer}"${origin.environment ? ` on ${origin.environment}` : ''}\n`
        : `Published layer ${layer.id.slice(0, 12)}: ${counts.states} state${counts.states === 1 ? '' : 's'} (${counts.captured} captured, ${counts.failed} failed, ${counts.pictures} picture${counts.pictures === 1 ? '' : 's'}) as "${origin.producer}"${origin.environment ? ` on ${origin.environment}` : ''}\n`);
      for (const warning of warnings) io.out(`! ${warning}\n`);
    }
    return 0;
  }

  if (command === 'status') {
    const read = await layersOf(rest, base, env);
    const whole = uiCatalog(read.layers, { backends: read.info, notices: read.notices });
    const catalog = filterUiCatalog(whole, queryOf(rest, whole));
    const problems: StatusResult['problems'] = [];
    for (const state of catalog.states) for (const cell of state.cells) {
      if (cell.coverage === 'failed' || cell.coverage === 'missing' || cell.coverage === 'capturing') {
        problems.push({ kind: cell.coverage, state: state.id, profile: cell.profile.label, ...(cell.capture?.detail ? { detail: cell.capture.detail } : {}) });
      }
    }
    for (const backend of read.info) if (!backend.available) problems.push({ kind: 'unavailable', detail: `${backend.label} could not be read` });
    for (const notice of read.notices) if (!read.info.some(backend => !backend.available && notice.startsWith(`${backend.label} is unavailable`))) problems.push({ kind: 'unreadable', detail: notice });
    if (whole.states.length === 0) problems.push({ kind: 'empty', detail: 'No UI states have been recorded' });
    const result: StatusResult = {
      ok: problems.length === 0, summary: catalog.summary, profiles: whole.profiles.map(profile => ({ key: profile.key, label: profile.label })), problems,
      sources: { layers: catalog.sources.layers, backends: read.info.map(backend => ({ id: backend.id, label: backend.label, available: backend.available })), notices: [...read.notices] }
    };
    if (format === 'json') io.out(`${JSON.stringify(result, null, 2)}\n`);
    else if (format === 'markdown') io.out(uiCatalogMarkdown(catalog));
    else {
      const { summary } = catalog;
      io.out(`UI catalog: ${summary.states} state${summary.states === 1 ? '' : 's'} in ${summary.profiles} profile${summary.profiles === 1 ? '' : 's'}; ${(['captured', 'failed', 'capturing', 'skipped', 'missing'] as const).map(name => `${summary.coverage[name]} ${name === 'missing' ? 'not captured yet' : name}`).join(', ')}\n`);
      if (!summary.planned) io.out('No plan was published, so what should exist is unknown and nothing can be missing.\n');
      for (const problem of problems.slice(0, 50)) io.out(`! ${problem.kind}${problem.state ? `: ${problem.state}${problem.profile ? ` (${problem.profile})` : ''}` : ''}${problem.detail ? ` — ${problem.detail}` : ''}\n`);
      if (problems.length > 50) io.out(`! … and ${problems.length - 50} more (use --format json)\n`);
      io.out(result.ok ? 'Complete.\n' : 'Needs attention.\n');
    }
    return result.ok ? 0 : 1;
  }

  if (command === 'diff') {
    const from = value(rest, 'from'), to = value(rest, 'to');
    if (!from || !to) throw new Error('diff needs --from <commit> and --to <commit>');
    const read = await layersOf(rest, base, env);
    const commits = uiCatalogCommits(read.layers.map(entry => entry.layer));
    const options = { backends: read.info, notices: read.notices };
    let beforeLayers: LayerEvidence[], afterLayers: LayerEvidence[];
    try { beforeLayers = layersAtCommit(read.layers, from); afterLayers = layersAtCommit(read.layers, to); }
    catch (error) { throw new Error(`${error instanceof Error ? error.message : String(error)}. Commits with layers: ${commits.slice(0, 10).map(commit => commit.sha.slice(0, 12)).join(', ') || 'none'}`); }
    const before = uiCatalog(beforeLayers, options), after = uiCatalog(afterLayers, options);
    const query = queryOf(rest, uiCatalog(read.layers, options));
    const diff: UiCatalogDiff = diffUiCatalogs(filterUiCatalog(before, query), filterUiCatalog(after, query));
    const side = (layers: readonly LayerEvidence[], catalog: UiCatalog) => ({ sha: layers[0]!.layer.sha!, states: catalog.states.length, layers: catalog.sources.layers });
    const changes = diff.entries.filter(entry => entry.change !== 'unchanged').map(entry => ({
      state: entry.id, title: entry.title, profile: (entry.profile ?? entry.before?.profile ?? entry.after?.profile)!.label, change: entry.change as Exclude<typeof entry.change, 'unchanged'>,
      from: entry.before?.coverage ?? null, to: entry.after?.coverage ?? null
    }));
    const { total, ...counts } = diff.summary;
    const failing = rest.includes('--fail-on-change') && changes.length > 0;
    const result: DiffResult = { ok: read.notices.length === 0 && !failing, from: side(beforeLayers, before), to: side(afterLayers, after), summary: { ...counts, total }, changes, notices: [...read.notices] };
    if (format === 'json') io.out(`${JSON.stringify(result, null, 2)}\n`);
    else if (format === 'markdown') {
      io.out(`# UI catalog: ${result.from.sha.slice(0, 12)} to ${result.to.sha.slice(0, 12)}\n\n${changes.length} of ${total} state profiles differ.\n\n${changes.map(change => `- **${change.title}** (${change.state}, ${change.profile}): ${change.change}${change.from || change.to ? ` — ${change.from ?? 'absent'} to ${change.to ?? 'absent'}` : ''}`).join('\n')}${changes.length ? '\n' : ''}`);
    } else {
      io.out(`UI catalog ${result.from.sha.slice(0, 12)} (${result.from.states} states) to ${result.to.sha.slice(0, 12)} (${result.to.states} states): ${counts.coverage} coverage, ${counts.picture} picture, ${counts.unverified} unverified, ${counts.added} added, ${counts.removed} removed, ${counts.unchanged} unchanged\n`);
      for (const change of changes.slice(0, 50)) io.out(`  ${change.change.padEnd(10)} ${change.state} (${change.profile})${change.change === 'coverage' ? ` ${change.from} → ${change.to}` : ''}\n`);
      if (changes.length > 50) io.out(`  … and ${changes.length - 50} more (use --format json)\n`);
      for (const notice of read.notices) io.out(`! ${notice}\n`);
    }
    return result.ok ? 0 : 1;
  }

  if (command === 'export') {
    const out = value(rest, 'out');
    if (!out) throw new Error('export needs --out <file.html>');
    const images = value(rest, 'images') ?? 'inline';
    if (!['inline', 'none'].includes(images)) throw new Error(`--images takes inline|none (got "${images}")`);
    const maxMb = Number(value(rest, 'max-mb') ?? 32);
    if (!Number.isFinite(maxMb) || maxMb < 0) throw new Error(`--max-mb takes a number of megabytes (got "${value(rest, 'max-mb')}")`);
    const read = await layersOf(rest, base, env);
    const whole = uiCatalog(read.layers, { backends: read.info, notices: read.notices });
    const catalog = filterUiCatalog(whole, queryOf(rest, whole));
    const warnings = [...read.notices];
    const all = uiPicturesWanted(catalog);
    const gathered = await gatherUiPictures(images === 'none' ? [] : all, async want => {
      const backend = read.backends.find(item => item.id === want.backend);
      return backend ? (await readLayerFile(backend.store, want.layer, want.bundleKey))?.bytes ?? null : null;
    }, { maxBytes: maxMb * 1024 * 1024 });
    // With --images none every picture is left out, and the page says it was asked to.
    const left = images === 'none' ? new Map(all.map(want => [want.key, 'was left out because the export was made with --images none'] as const)) : gathered.left;
    if (images !== 'none') for (const [key, reason] of left) warnings.push(`picture ${key.slice(0, 12)}…: ${reason}`);
    const html = uiCatalogHtml(catalog, { pictures: gathered.pictures, left, ...(value(rest, 'title') ? { title: value(rest, 'title')! } : {}), generatedAtMs: (io.clock ?? Date.now)() });
    const target = path.resolve(base, out);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, html);
    const manifestFile = value(rest, 'manifest');
    if (manifestFile) {
      const manifest = path.resolve(base, manifestFile);
      await mkdir(path.dirname(manifest), { recursive: true });
      await writeFile(manifest, `${JSON.stringify(catalog, null, 2)}\n`);
    }
    const result: ExportResult = {
      ok: true, out, bytes: Buffer.byteLength(html), states: catalog.summary.states, cells: catalog.summary.cells,
      pictures: { embedded: gathered.pictures.size, embeddedBytes: gathered.bytes, left: left.size }, manifest: manifestFile ?? null, warnings
    };
    if (json) io.out(`${JSON.stringify(result, null, 2)}\n`);
    else {
      io.out(`Wrote ${out}: ${result.states} states, ${gathered.pictures.size} pictures embedded (${(gathered.bytes / 1024 / 1024).toFixed(1)} MiB), ${(result.bytes / 1024 / 1024).toFixed(1)} MiB in all\n`);
      for (const warning of warnings) io.out(`! ${warning}\n`);
    }
    return 0;
  }

  if (command === 'collect') return collect(rest, base, env, json, io);

  io.out(UI_CATALOG_USAGE);
  return command && command !== '--help' && command !== '-h' ? 2 : 0;
}

const positive = (rest: readonly string[], name: string): number | undefined => {
  const given = value(rest, name);
  if (given === undefined) return undefined;
  const number = Number(given);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`--${name} takes a positive number (got "${given}")`);
  return number;
};

/** `atlas ui-catalog collect`: one shard of a collection shared through a server. */
async function collect(rest: readonly string[], base: string, env: Readonly<Record<string, string | undefined>>, json: boolean, io: ReportIo): Promise<number> {
  const catalogFile = value(rest, 'catalog');
  if (!catalogFile) throw new Error('collect needs --catalog <atlas.catalog.ts>: a module whose default export is a defineCatalog(...) definition');
  const command = value(rest, 'exec');
  if (!command) throw new Error('collect needs --exec "<command>": the collector that captures each batch (see atlas ui-catalog --help)');
  const target = writeStoreOf(value(rest, 'store'), base, env);
  if (!target.server) throw new Error(`collect needs an Atlas server (--store https://… or ATLAS_STORE), not ${target.label}: shards coordinate only through a server`);
  const where = parseWhere(values(rest, 'where'));
  const batchSize = positive(rest, 'batch-size');
  const leaseSeconds = positive(rest, 'lease-seconds');
  const maxUnits = positive(rest, 'max-units');
  const maxMinutes = positive(rest, 'max-minutes');
  const maxPictureMb = positive(rest, 'max-picture-mb') ?? 64;
  const staleBeforeMs = parseTime(value(rest, 'stale-before')) ?? undefined;
  const roots = values(rest, 'attach-root').map(root => path.resolve(base, root));
  let loaded: { default?: unknown; catalog?: unknown };
  try { loaded = await import(pathToFileURL(path.resolve(base, catalogFile)).href) as typeof loaded; }
  catch (error) { throw new Error(`Cannot load ${catalogFile}: ${error instanceof Error ? error.message : String(error)}`); }
  const definition = (loaded.default ?? loaded.catalog) as CatalogDefinition | undefined;
  if (!definition || typeof definition !== 'object') throw new Error(`${catalogFile} has no default export: export default defineCatalog({ name, matrix, states })`);
  let resolved: Awaited<ReturnType<typeof resolveCatalog>>;
  try {
    resolved = await resolveCatalog(definition);
    if (Object.keys(where).length) checkWhere(resolved.document, where);
  } catch (error) {
    if (error instanceof CatalogDefinitionError) throw new Error(error.message);
    throw error;
  }
  const origin = detectOrigin(env, io.git);
  const run = executionOf(rest, env);
  const shard = value(rest, 'shard') ?? `${hostname()}-${process.pid}`;
  const warnings: string[] = [];
  const childEnv = Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => entry[1] !== undefined));
  const captureBatch = async (units: readonly CollectUnit[], context: { readonly claimId: string; readonly signal: AbortSignal }): Promise<CapturedItem[]> => {
    const dir = await mkdtemp(path.join(tmpdir(), 'atlas-ui-batch-'));
    try {
      const batch = path.join(dir, 'batch.json'), captures = path.join(dir, 'captures.json');
      const states = units.flatMap(unit => unit.items.map(item => ({ item: item.key, unit: unit.key, ...item.state, profile: item.profile })));
      await writeFile(batch, `${JSON.stringify({ claimId: context.claimId, definition: resolved.version, units, states }, null, 2)}\n`);
      // The collector's own output goes to standard error, so standard output stays one JSON document.
      const code = await new Promise<number>((resolve, reject) => {
        const child = spawn(command, { shell: true, cwd: base, env: { ...childEnv, ATLAS_UI_BATCH: batch, ATLAS_UI_CAPTURES: captures, ATLAS_UI_CLAIM: context.claimId, ATLAS_UI_DIR: dir }, stdio: ['ignore', 2, 2], signal: context.signal });
        child.on('error', reject);
        child.on('exit', exit => resolve(exit ?? 1));
      });
      let written: unknown = null;
      try { written = JSON.parse(await readFile(captures, 'utf8')); } catch { /* nothing written, or not JSON: every item is failed below */ }
      const read = written === null ? { states: [], warnings: [] } : await withPictures(parseWith(ExecCaptureFile, written, 'the captures --exec wrote'), [dir, ...roots], maxPictureMb * 1024 * 1024);
      warnings.push(...read.warnings);
      const given = read.states.map(({ id: _id, ...state }) => state as unknown as CapturedItem);
      const answered = new Set(given.map(state => state.item));
      const reason = code !== 0 ? `The collector exited with code ${code}` : written === null ? 'The collector wrote no captures file' : 'The collector wrote no capture for this item';
      return [...given, ...states.filter(state => !answered.has(state.item)).map(state => ({ item: state.item, status: 'failed' as const, detail: reason }))];
    } finally { await rm(dir, { recursive: true, force: true }); }
  };

  const stop = new AbortController();
  const onSignal = () => stop.abort();
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  let document: CollectResultDocument;
  try {
    const result = await collectCatalog({
      store: target.server, catalog: resolved, shard: { id: shard, ...(Object.keys(where).length ? { where } : {}) }, signal: stop.signal, captureBatch,
      ...(batchSize !== undefined ? { batchSize: Math.floor(batchSize) } : {}), ...(leaseSeconds !== undefined ? { leaseSeconds: Math.floor(leaseSeconds) } : {}),
      ...(maxUnits !== undefined ? { maxUnits: Math.floor(maxUnits) } : {}), ...(maxMinutes !== undefined ? { maxMs: maxMinutes * 60_000 } : {}),
      ...(staleBeforeMs !== undefined ? { staleBeforeMs } : {}), ...(value(rest, 'collection') ?? run?.id ? { collection: (value(rest, 'collection') ?? run?.id)! } : {}),
      ...(value(rest, 'producer') ? { producer: value(rest, 'producer')! } : {}),
      origin: { sha: value(rest, 'sha') ?? origin.sha, branch: value(rest, 'branch') ?? origin.branch, runUrl: value(rest, 'run-url') ?? origin.runUrl, ...(run ? { run: { id: run.id, ...(run.title ? { title: run.title } : {}) } } : {}) },
      onEvent: event => {
        if (json) return;
        if (event.type === 'claim') io.out(`Claimed ${event.units} unit${event.units === 1 ? '' : 's'} (${event.claimId.slice(0, 8)})\n`);
        else if (event.type === 'lost') io.out(`! Lost claim ${event.claimId.slice(0, 8)}: its lease expired, so its ${event.units} units were not published\n`);
      },
      ...(io.clock ? { now: io.clock } : {})
    });
    const { ok, definition: _version, ...done } = result;
    document = { ...done, lostClaims: [...done.lostClaims], ok, store: target.label, definition: { version: resolved.version, name: resolved.document.name }, warnings };
  } catch (error) {
    if (!(error instanceof AtlasHttpError)) throw error;
    document = {
      ok: false, store: target.label, definition: { version: resolved.version, name: resolved.document.name }, shard, stoppedBy: 'unreachable', claims: 0,
      units: { claimed: 0, collected: 0, lost: 0, released: 0 }, items: { captured: 0, failed: 0, other: 0 }, lostClaims: [], layers: 0, warnings, error: error.message
    };
  } finally {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }
  if (json) io.out(`${JSON.stringify(document, null, 2)}\n`);
  else {
    const stops = { empty: 'nothing is left for this shard', 'max-units': '--max-units reached', 'max-minutes': '--max-minutes reached', signal: 'stopped by a signal', unreachable: 'the server could not be reached' } as const;
    if (document.error) io.out(`! ${document.error}\n`);
    io.out(`Collected ${document.units.collected} unit${document.units.collected === 1 ? '' : 's'} in ${document.claims} claim${document.claims === 1 ? '' : 's'} as "${shard}": ${document.items.captured} captured, ${document.items.failed} failed. Stopped: ${stops[document.stoppedBy]}.\n`);
    for (const warning of warnings) io.out(`! ${warning}\n`);
  }
  return document.ok ? 0 : 1;
}

/**
 * `atlas ui-catalog …` for a terminal: a mistake in the command or a path is a message on stderr and exit code 2, so a CI job can
 * tell a broken invocation (2) from a catalog that needs attention (1). With `--format json` the mistake is a JSON document.
 */
export async function runUiCatalogCommand(argv: readonly string[]): Promise<number> {
  try {
    return await uiCatalogMain(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(wantsJson(argv) ? `${JSON.stringify({ ok: false, error: { message, code: 'usage' } })}\n` : `atlas ui-catalog: ${message}\n`);
    return 2;
  }
}
