/**
 * @module UI catalog definition scope
 *
 * A catalog counts every state and profile any layer ever recorded or planned, so after a definition's matrix changes its
 * old profiles and removed states stay beside the current ones. `scopeUiCatalog` projects a catalog onto exactly one
 * definition version: the definition's states × profiles, each the catalog's own cell when one exists and `missing`
 * otherwise, with every cell outside it counted in `scope.excluded` and nothing deleted. A definition is named by its
 * version (the SHA-256 of its canonical JSON), so a link that pins one never drifts when another is published. A definition
 * that cannot be read gives an explicit unavailable scope with no state in it, never every layer's history in its place.
 *
 * The projection is one pass over the catalog and one over the definition's items. It reads no store: the caller finds the
 * definition (`GET /api/ui-catalog/definitions/{version}`, a stored definition file, or a `defineCatalog` module) and the
 * server, the CLI, the export and the viewer all project the same way, so the same scope gives the same totals.
 *
 * @see docs/ui-catalog.md#scoping-to-one-definition
 */
import type { UiCatalogDefinitionDocument } from '../../schema/src/ui-catalog-queue';
import { assembleUiCatalog, uiProfile, type UiCatalog, type UiCatalogScope, type UiCatalogState, type UiCell, type UiCoverage, type UiProfile } from './ui-catalog';
import { expandCatalog } from './ui-catalog-definition';

/** What a person chooses: every layer's history, or one definition version (with its document, or null when it could not be read). */
export type UiDefinitionSelection =
  | { readonly kind: 'all-history' }
  | { readonly kind: 'definition'; readonly version: string; readonly document: UiCatalogDefinitionDocument | null; readonly reason?: string };

/** The words `?definition=` and `--definition` take besides a version: `all` (every layer's history) and `latest` (the server's latest published definition, resolved to its version). */
export const UI_DEFINITION_WORDS = ['all', 'latest'] as const;

/** Whether a text is a definition version: 64 lowercase hex digits. */
export function isDefinitionVersion(text: string): boolean {
  return /^[a-f0-9]{64}$/.test(text);
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function emptyCoverage(): Record<UiCoverage, number> {
  return { captured: 0, failed: 0, capturing: 0, skipped: 0, missing: 0 };
}

/**
 * The catalog as one definition sees it, or as all history with the choice recorded. Under a definition: exactly its states
 * in exactly its profiles (cells it expects and nobody captured are `missing`, every kept cell is `expected: 'declared'`),
 * its inventory as the surfaces, and `scope.excluded` counting the recorded states, profiles and cells it leaves out. An
 * unavailable definition (`document: null`) gives a catalog with no state, `scope.status: 'unavailable'` and a notice. The
 * profiles, facets and summary are those of what is kept, so filters and totals agree with the scope. Throws a
 * `CatalogDefinitionError` only for a document that `expandCatalog` refuses.
 *
 * @example
 * ```ts
 * const whole = uiCatalog(layers);
 * const current = scopeUiCatalog(whole, { kind: 'definition', version, document });
 * current.summary.cells === current.scope!.expected!.cells; // exactly the definition's items
 * ```
 */
export function scopeUiCatalog(catalog: UiCatalog, selection: UiDefinitionSelection): UiCatalog {
  if (selection.kind === 'all-history') return { ...catalog, scope: { kind: 'all-history', status: 'applied' } };
  const excluded = { states: 0, profiles: 0, cells: 0, coverage: emptyCoverage() };
  const base = { ...(catalog.version ? { version: catalog.version } : {}) };
  if (!selection.document) {
    for (const state of catalog.states) for (const cell of state.cells) { excluded.cells += 1; excluded.coverage[cell.coverage] += 1; }
    excluded.states = catalog.states.length;
    excluded.profiles = catalog.profiles.length;
    const reason = selection.reason ?? `No definition ${selection.version} could be read`;
    const scope: UiCatalogScope = { kind: 'definition', status: 'unavailable', definition: { version: selection.version, name: null }, expected: { states: 0, profiles: 0, cells: 0 }, excluded, reason };
    return assembleUiCatalog([], {
      ...base, inventory: [], planned: false, profiles: [], scope,
      sources: { ...catalog.sources, notices: [...catalog.sources.notices, `${reason}: nothing is counted for this scope (it is not every layer's history).`] }
    });
  }
  const document = selection.document;
  const expanded = expandCatalog(document, selection.version);
  const known = new Map(catalog.profiles.map(profile => [profile.key, profile]));
  const profiles: UiProfile[] = expanded.profiles
    .map(profile => known.get(profile.key) ?? uiProfile({ environment: profile.environment, parameters: profile.parameters }))
    .sort((a, b) => compare(a.label, b.label) || compare(a.key, b.key));
  const wanted = new Set(profiles.map(profile => profile.key));
  const declared = new Map(document.states.map(state => [state.id, state]));
  for (const profile of catalog.profiles) if (!wanted.has(profile.key)) excluded.profiles += 1;

  const recorded = new Map<string, UiCatalogState>();
  for (const state of catalog.states) {
    if (!declared.has(state.id)) {
      excluded.states += 1;
      for (const cell of state.cells) { excluded.cells += 1; excluded.coverage[cell.coverage] += 1; }
      continue;
    }
    recorded.set(state.id, state);
    for (const cell of state.cells) if (!wanted.has(cell.profile.key)) { excluded.cells += 1; excluded.coverage[cell.coverage] += 1; }
  }

  const states: UiCatalogState[] = [];
  for (const id of [...declared.keys()].sort(compare)) {
    const plan = declared.get(id)!;
    const found = recorded.get(id);
    const byProfile = new Map((found?.cells ?? []).map(cell => [cell.profile.key, cell]));
    const cells: UiCell[] = profiles.map(profile => {
      const cell = byProfile.get(profile.key);
      if (!cell) return { profile, coverage: 'missing', expected: 'declared', capture: null, planned: null };
      return cell.expected === 'declared' ? cell : { ...cell, expected: 'declared' };
    });
    states.push(found ? { ...found, cells } : {
      id, title: plan.title ?? id, route: plan.route ?? null, fixture: plan.fixture ?? null, cohort: plan.cohort ?? null, area: plan.area ?? null, kind: plan.kind ?? null,
      flags: [...(plan.flags ?? [])].sort(compare), covers: [...(plan.covers ?? [])].sort(compare), attributes: {}, producers: [], cells
    });
  }
  const scope: UiCatalogScope = {
    kind: 'definition', status: 'applied', definition: { version: selection.version, name: document.name },
    expected: { states: states.length, profiles: profiles.length, cells: states.length * profiles.length }, excluded
  };
  return assembleUiCatalog(states, { ...base, inventory: document.inventory.map(entry => entry.id), planned: true, profiles, scope, sources: catalog.sources });
}
