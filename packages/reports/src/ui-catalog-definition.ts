/**
 * @module UI catalog definition
 *
 * What a UI catalog should contain, declared once by the project that owns it: the **states** (ids and declared facts, as a
 * `ui-plan` entry), the **profile matrix** (dimensions the project names, each a set of enum values, minus exclusions) and,
 * optionally, how items **group** into the work units a collector captures together. Atlas has no built-in dimension names
 * or values: `device`, `scheme` or `tenant` are the project's data, and a dimension value only labels a result.
 *
 * `defineCatalog` checks the shape of a definition; `resolveCatalog` runs its async parts once (values, states, inventory,
 * groups) and returns the stored document with its version, the SHA-256 of its canonical JSON, so every shard that resolves
 * the same definition names the same version. `expandCatalog` turns a document into profiles, items and units, refusing what
 * would be ambiguous (an exclusion that names an unknown dimension or value, two dimensions that both set the environment or
 * set one parameter differently). `catalogPlanLayers` writes the document as ordinary `ui-plan` layers, one per profile, so
 * the catalog expects every item without anything new in the layer format.
 *
 * Every dimension value is also a parameter of the profile, so each combination is its own slot, as for any layer.
 *
 * @see docs/ui-catalog.md#collecting-with-a-queue
 */
import type { PublishChecksInput } from '../../schema/src/layer';
import { UiCatalogDefinitionSchema, UI_CATALOG_QUEUE_VERSION, type UiCatalogDefinitionDocument } from '../../schema/src/ui-catalog-queue';
import { sha256Hex } from './sigv4';
import { uiProfile } from './ui-catalog';
import { uiPlanLayer, type UiStatePlan } from './ui-catalog-publish';

/** A list given directly, or produced (once, when the definition is resolved) by a function. */
export type Resolvable<T> = readonly T[] | (() => readonly T[] | Promise<readonly T[]>);

/** What one value of a dimension contributes to a profile: `environment` sets the client; every other key is a parameter. */
export type DimensionProfile = { readonly environment?: string } & { readonly [parameter: string]: string | undefined };

/** A dimension of the profile matrix: its enum values, and optionally what each value contributes to the profile. */
export type CatalogDimension = {
  readonly values: Resolvable<string>;
  /** What a value contributes: an `environment` and any parameters (`viewport`…). Without it, a value contributes only itself. */
  readonly profile?: (value: string) => DimensionProfile;
};

/** One item, as a `group` function sees it: a state, the dimension values of its profile, and its key. */
export type CatalogItem = { readonly state: UiStatePlan; readonly profile: Readonly<Record<string, string>>; readonly key: string };

/** A catalog definition as a project writes it (see {@link defineCatalog}). */
export type CatalogDefinition = {
  /** The catalog's name; its plan layers are published as the producer `ui-catalog:<name>`. */
  readonly name: string;
  /** The profile matrix. Without it there is one profile, with no environment and no parameters. */
  readonly matrix?: {
    readonly dimensions: Readonly<Record<string, CatalogDimension>>;
    /** Combinations no item is expected for, each a partial match on dimension values. */
    readonly exclude?: readonly Readonly<Record<string, string>>[];
  };
  /** The states to collect, from the project's own discovery. */
  readonly states: Resolvable<UiStatePlan>;
  /** Surfaces of the product, for coverage (as `inventory: true` plan entries). */
  readonly inventory?: Resolvable<{ readonly id: string; readonly title?: string }>;
  /** What a collector captures together: items with the same key are one work unit. Default: every item alone. */
  readonly group?: (item: CatalogItem) => string;
  /** A unit that failed this many times in a row within one collection is no longer handed out in it. Default 3. */
  readonly maxAttempts?: number;
  /** Hand out a captured item again once its result is older than this many milliseconds. */
  readonly staleAfterMs?: number;
};

/** A definition that cannot be used, with what is wrong and what was declared. */
export class CatalogDefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CatalogDefinitionError';
  }
}

/** One profile of an expanded matrix. */
export type QueueProfile = {
  /** The UI catalog profile key (environment and sorted parameters): the same key a catalog cell has. */
  readonly key: string;
  readonly values: Readonly<Record<string, string>>;
  readonly environment: string | null;
  readonly parameters: Readonly<Record<string, string>>;
  readonly label: string;
};

/** One item: a state in a profile. */
export type QueueItem = { readonly key: string; readonly state: number; readonly profile: number };

/** One work unit: the items a shard claims and captures together. */
export type QueueUnit = { readonly key: string; readonly items: readonly number[] };

/** A definition laid out for the queue: its profiles, items and units. Units are sorted by key, the queue's tie-break. */
export type ExpandedCatalog = {
  readonly version: string;
  readonly document: UiCatalogDefinitionDocument;
  readonly profiles: readonly QueueProfile[];
  readonly items: readonly QueueItem[];
  readonly units: readonly QueueUnit[];
  /** The unit of each item key. */
  readonly unitOf: ReadonlyMap<string, number>;
};

const MAX_PROFILES = 10_000;
const MAX_ITEMS = 2_000_000;
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const listed = (values: Iterable<string>) => [...values].map(value => `"${value}"`).join(', ') || 'none';

/** The key of one item: a state id in a profile (as {@link QueueProfile.key}). It is how a result is matched to the queue. */
export function uiItemKey(stateId: string, profileKey: string): string {
  return JSON.stringify([stateId, profileKey]);
}

/** JSON with object keys sorted at every depth, so equal values always have the same text. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(item => canonicalJson(item === undefined ? null : item)).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([a], [b]) => compare(a, b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** The version of a stored definition: the SHA-256 of its canonical JSON, 64 hex digits. */
export function catalogVersion(document: UiCatalogDefinitionDocument): Promise<string> {
  return sha256Hex(canonicalJson(document));
}

/**
 * Checks the parts of a definition that need nothing resolved (a name, states and dimension values given as lists or
 * functions, `profile` and `group` as functions) and returns it unchanged, for a project's `atlas.catalog.ts`. Throws a
 * {@link CatalogDefinitionError} for a definition that could never be resolved.
 *
 * @example
 * ```ts
 * export default defineCatalog({
 *   name: 'web-app',
 *   matrix: {
 *     dimensions: {
 *       device: { values: ['mobile', 'desktop'], profile: device => ({ environment: `${device}-web`, viewport: device === 'mobile' ? '390x844' : '1440x1000' }) },
 *       scheme: { values: ['light', 'dark'] }
 *     },
 *     exclude: [{ device: 'desktop', scheme: 'dark' }]
 *   },
 *   states: async () => loadStatesFromMyCollector(),
 *   group: item => `${item.state.id}|${item.profile.device}`
 * });
 * ```
 */
export function defineCatalog<T extends CatalogDefinition>(definition: T): T {
  if (!definition || typeof definition !== 'object') throw new CatalogDefinitionError('defineCatalog takes an object: { name, matrix?, states, inventory?, group? }');
  if (typeof definition.name !== 'string' || !definition.name.trim()) throw new CatalogDefinitionError('A catalog needs a name: a stable word such as "web-app"');
  const resolvable = (value: unknown) => Array.isArray(value) || typeof value === 'function';
  if (!resolvable(definition.states)) throw new CatalogDefinitionError('states must be a list of { id, title?, route?… } or a function that returns one');
  if (definition.inventory !== undefined && !resolvable(definition.inventory)) throw new CatalogDefinitionError('inventory must be a list of { id, title? } or a function that returns one');
  if (definition.group !== undefined && typeof definition.group !== 'function') throw new CatalogDefinitionError('group must be a function of an item that returns its unit key');
  for (const [name, dimension] of Object.entries(definition.matrix?.dimensions ?? {})) {
    if (!dimension || !resolvable(dimension.values)) throw new CatalogDefinitionError(`The dimension "${name}" needs values: a list of words, or a function that returns one`);
    if (dimension.profile !== undefined && typeof dimension.profile !== 'function') throw new CatalogDefinitionError(`The profile of the dimension "${name}" must be a function of its value`);
  }
  return definition;
}

async function resolve<T>(value: Resolvable<T> | undefined): Promise<readonly T[]> {
  if (value === undefined) return [];
  return typeof value === 'function' ? await value() : value;
}

function profileOf(dimension: string, value: string, contribution: DimensionProfile | undefined): { environment?: string; parameters: Record<string, string> } {
  if (contribution === undefined) return { parameters: {} };
  if (!contribution || typeof contribution !== 'object' || Array.isArray(contribution)) throw new CatalogDefinitionError(`The profile of ${dimension}="${value}" must return an object such as { environment?, viewport? }`);
  const parameters: Record<string, string> = {};
  let environment: string | undefined;
  for (const [key, given] of Object.entries(contribution)) {
    if (given === undefined) continue;
    if (typeof given !== 'string') throw new CatalogDefinitionError(`The profile of ${dimension}="${value}" sets "${key}" to a ${typeof given}; every profile value is a string`);
    if (key === 'environment') environment = given; else parameters[key] = given;
  }
  return { ...(environment !== undefined ? { environment } : {}), parameters };
}

/**
 * Runs a definition's async parts once and returns the document every shard shares, with its version. The resolved values,
 * states, inventory and groups are recorded in the document, so a shard that resolves later sees the same matrix. Throws a
 * {@link CatalogDefinitionError} naming what is wrong (a repeated state or value, an exclusion naming an unknown dimension
 * or value, two dimensions that set one environment or parameter differently in a profile).
 */
export async function resolveCatalog(definition: CatalogDefinition): Promise<{ readonly version: string; readonly document: UiCatalogDefinitionDocument }> {
  defineCatalog(definition);
  const dimensions = [];
  for (const [name, dimension] of Object.entries(definition.matrix?.dimensions ?? {})) {
    const values = await resolve(dimension.values);
    if (!values.length) throw new CatalogDefinitionError(`The dimension "${name}" has no values`);
    const seen = new Set<string>();
    const resolved = values.map(value => {
      if (typeof value !== 'string' || !value) throw new CatalogDefinitionError(`The dimension "${name}" has a value that is not a word: ${JSON.stringify(value)}`);
      if (seen.has(value)) throw new CatalogDefinitionError(`The dimension "${name}" lists "${value}" twice`);
      seen.add(value);
      return { value, ...profileOf(name, value, dimension.profile?.(value)) };
    });
    dimensions.push({ name, values: resolved });
  }
  const states = (await resolve(definition.states)).map(state => {
    const { inventory: _inventory, ...rest } = state as UiStatePlan & { inventory?: boolean };
    return Object.fromEntries(Object.entries(rest).filter(([, value]) => value !== undefined && !(Array.isArray(value) && value.length === 0))) as UiCatalogDefinitionDocument['states'][number];
  });
  const ids = new Set<string>();
  for (const state of states) {
    if (typeof state.id !== 'string' || !state.id) throw new CatalogDefinitionError('Every state needs an id');
    if (ids.has(state.id)) throw new CatalogDefinitionError(`The state "${state.id}" appears twice; give each state its own id`);
    ids.add(state.id);
  }
  const inventory = (await resolve(definition.inventory)).map(entry => ({ id: entry.id, ...(entry.title ? { title: entry.title } : {}) }));
  const base = {
    schemaVersion: UI_CATALOG_QUEUE_VERSION, name: definition.name.trim(), dimensions, exclude: (definition.matrix?.exclude ?? []).map(entry => ({ ...entry })), states, inventory,
    options: { maxAttempts: definition.maxAttempts ?? 3, ...(definition.staleAfterMs !== undefined ? { staleAfterMs: definition.staleAfterMs } : {}) }
  };
  const parsed = UiCatalogDefinitionSchema.safeParse(base);
  if (!parsed.success) throw new CatalogDefinitionError(`The definition is not valid: ${parsed.error.issues.slice(0, 3).map(issue => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ')}`);
  let document: UiCatalogDefinitionDocument = parsed.data;
  if (definition.group) {
    const expanded = expandCatalog(document, '');
    const groups = expanded.items.map(item => {
      const key = definition.group!({ state: document.states[item.state]!, profile: expanded.profiles[item.profile]!.values, key: item.key });
      if (typeof key !== 'string' || !key) throw new CatalogDefinitionError(`group returned ${JSON.stringify(key)} for ${item.key}; it must return a non-empty string`);
      return key;
    });
    document = { ...document, groups };
  }
  expandCatalog(document, '');
  return { version: await catalogVersion(document), document };
}

/** Checks that every dimension and value `entry` names is declared; `where` says which entry it is, for the message. */
function checkNames(document: UiCatalogDefinitionDocument, entry: Readonly<Record<string, readonly string[] | string>>, where: string): void {
  for (const [name, given] of Object.entries(entry)) {
    const dimension = document.dimensions.find(item => item.name === name);
    if (!dimension) throw new CatalogDefinitionError(`${where} names the dimension "${name}", which the matrix does not declare. Dimensions: ${listed(document.dimensions.map(item => item.name))}`);
    for (const value of typeof given === 'string' ? [given] : given) {
      if (!dimension.values.some(item => item.value === value)) throw new CatalogDefinitionError(`${where} names ${name}="${value}", which the matrix does not declare. Values of "${name}": ${listed(dimension.values.map(item => item.value))}`);
    }
  }
}

/**
 * The profiles, items and units of a stored definition. Profiles are every combination of dimension values in declaration
 * order, less the excluded ones; items are every state in every profile, state by state; units are the definition's groups
 * (or one per item), sorted by key. Throws a {@link CatalogDefinitionError} for an exclusion that names an unknown dimension
 * or value, and for a profile in which two dimensions set the environment, or set one parameter to different values.
 */
export function expandCatalog(document: UiCatalogDefinitionDocument, version: string): ExpandedCatalog {
  document.exclude.forEach((entry, i) => checkNames(document, entry, `exclude[${i}]`));
  let combos: { values: Record<string, string>; picks: { dimension: string; value: UiCatalogDefinitionDocument['dimensions'][number]['values'][number] }[] }[] = [{ values: {}, picks: [] }];
  for (const dimension of document.dimensions) {
    combos = combos.flatMap(combo => dimension.values.map(value => ({ values: { ...combo.values, [dimension.name]: value.value }, picks: [...combo.picks, { dimension: dimension.name, value }] })));
    if (combos.length > MAX_PROFILES * 4) throw new CatalogDefinitionError(`The matrix has more than ${MAX_PROFILES} profiles`);
  }
  const excluded = (values: Record<string, string>) => document.exclude.some(entry => Object.entries(entry).every(([name, value]) => values[name] === value));
  const profiles: QueueProfile[] = [];
  const keys = new Set<string>();
  for (const combo of combos) {
    if (excluded(combo.values)) continue;
    let environment: { value: string; from: string } | null = null;
    const parameters: Record<string, { value: string; from: string }> = {};
    const set = (key: string, value: string, from: string) => {
      const prior = parameters[key];
      if (prior && prior.value !== value) throw new CatalogDefinitionError(`In the profile ${JSON.stringify(combo.values)}, ${prior.from} sets the parameter "${key}" to "${prior.value}" and ${from} sets it to "${value}". Make one dimension own it, or exclude the combination`);
      parameters[key] = { value, from };
    };
    for (const pick of combo.picks) set(pick.dimension, pick.value.value, `${pick.dimension}="${pick.value.value}"`);
    for (const pick of combo.picks) {
      const from = `${pick.dimension}="${pick.value.value}"`;
      if (pick.value.environment !== undefined) {
        if (environment) throw new CatalogDefinitionError(`In the profile ${JSON.stringify(combo.values)}, both ${environment.from} (environment "${environment.value}") and ${from} (environment "${pick.value.environment}") set the environment. Only one dimension may set it for a profile`);
        environment = { value: pick.value.environment, from };
      }
      for (const [key, value] of Object.entries(pick.value.parameters)) set(key, value, from);
    }
    const flat = Object.fromEntries(Object.entries(parameters).map(([key, item]) => [key, item.value]));
    const profile = uiProfile({ environment: environment?.value ?? null, parameters: flat });
    if (keys.has(profile.key)) throw new CatalogDefinitionError(`Two combinations make the same profile (${profile.label}); give each combination its own parameters`);
    keys.add(profile.key);
    profiles.push({ key: profile.key, values: combo.values, environment: profile.environment, parameters: flat, label: profile.label });
  }
  if (profiles.length > MAX_PROFILES) throw new CatalogDefinitionError(`The matrix has ${profiles.length} profiles; at most ${MAX_PROFILES}`);
  if (document.states.length * profiles.length > MAX_ITEMS) throw new CatalogDefinitionError(`The definition has ${document.states.length * profiles.length} items; at most ${MAX_ITEMS}`);
  const items: QueueItem[] = [];
  for (let state = 0; state < document.states.length; state++) {
    for (let profile = 0; profile < profiles.length; profile++) items.push({ key: uiItemKey(document.states[state]!.id, profiles[profile]!.key), state, profile });
  }
  if (document.groups && document.groups.length !== items.length) throw new CatalogDefinitionError(`groups has ${document.groups.length} entries for ${items.length} items`);
  const byKey = new Map<string, number[]>();
  items.forEach((item, i) => {
    const key = document.groups?.[i] ?? item.key;
    const list = byKey.get(key);
    if (list) list.push(i); else byKey.set(key, [i]);
  });
  const units: QueueUnit[] = [...byKey].sort(([a], [b]) => compare(a, b)).map(([key, members]) => ({ key, items: members }));
  const unitOf = new Map<string, number>();
  units.forEach((unit, u) => { for (const i of unit.items) unitOf.set(items[i]!.key, u); });
  return { version, document, profiles, items, units, unitOf };
}

/** Reads `--where dimension=value` pairs (repeatable; a dimension given twice takes either value). Throws on a pair without `=`. */
export function parseWhere(pairs: readonly string[]): Record<string, string[]> {
  const where: Record<string, string[]> = {};
  for (const pair of pairs) {
    const at = pair.indexOf('=');
    if (at <= 0 || at === pair.length - 1) throw new CatalogDefinitionError(`--where takes dimension=value (got "${pair}")`);
    const name = pair.slice(0, at), value = pair.slice(at + 1);
    (where[name] ??= []).includes(value) || where[name]!.push(value);
  }
  return where;
}

/** Throws a {@link CatalogDefinitionError} when `where` names a dimension or value the definition does not declare, listing the declared ones. `label` names the filter in the message. */
export function checkWhere(document: UiCatalogDefinitionDocument, where: Readonly<Record<string, readonly string[]>>, label = '--where'): void {
  checkNames(document, where, label);
}

/** Whether every item of a unit has, in each dimension `where` names, one of the values it lists. */
export function unitMatches(expanded: ExpandedCatalog, unit: QueueUnit, where: Readonly<Record<string, readonly string[]>> | undefined): boolean {
  if (!where) return true;
  const wanted = Object.entries(where);
  if (!wanted.length) return true;
  return unit.items.every(i => {
    const values = expanded.profiles[expanded.items[i]!.profile]!.values;
    return wanted.every(([name, accepted]) => accepted.includes(values[name]!));
  });
}

/** The producer of a definition's plan layers. Stable across versions, so a newer definition's plan replaces an older one's. */
export function catalogProducer(document: Pick<UiCatalogDefinitionDocument, 'name'>): string {
  return `ui-catalog:${document.name}`;
}

/**
 * A definition as the input of `publishChecks`: one `ui-plan` layer per profile expecting every state, and, when the
 * definition lists an inventory, one more for its surfaces. Publishing them is what makes the catalog expect every item.
 */
export function catalogPlanLayers(expanded: ExpandedCatalog, recordedAtMs: number): PublishChecksInput[] {
  const producer = catalogProducer(expanded.document);
  const states = expanded.document.states.map(state => ({ ...state }));
  const layers = expanded.profiles.map(profile => uiPlanLayer({
    producer, recordedAtMs, ...(profile.environment ? { environment: profile.environment } : {}), profile: profile.parameters, states
  }));
  if (expanded.document.inventory.length) layers.push(uiPlanLayer({ producer, recordedAtMs, states: expanded.document.inventory.map(entry => ({ ...entry, inventory: true })) }));
  return layers;
}
