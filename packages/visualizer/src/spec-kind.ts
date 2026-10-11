/** A kind of spec document with its own tab: what it is called, and which files belong to it. */
export type SpecKind = {
  readonly id: string;
  /** The tab, named after the notation. */
  readonly label: string;
  readonly one: string;
  readonly many: string;
  /** What one recorded check of this kind is called. */
  readonly check: string;
  readonly accepts: (path: string) => boolean;
};

function ending(pattern: RegExp) {
  return (path: string) => pattern.test(path.split('?')[0] ?? '');
}

/** Statecharts are the map; every other notation is a document tab from this list. */
export const SPEC_KINDS: readonly SpecKind[] = [
  { id: 'gherkin', label: 'Gherkin', one: 'feature', many: 'features', check: 'scenario', accepts: ending(/\.feature$/i) },
  { id: 'quint', label: 'Quint', one: 'model', many: 'models', check: 'trace', accepts: ending(/\.qnt$/i) },
  { id: 'dmn', label: 'DMN', one: 'decision table', many: 'decision tables', check: 'check', accepts: ending(/\.dmn$/i) },
  { id: 'alloy', label: 'Alloy', one: 'structure', many: 'structures', check: 'check', accepts: ending(/\.als$/i) },
  { id: 'openslo', label: 'OpenSLO', one: 'objective', many: 'objectives', check: 'check', accepts: ending(/\.openslo\.ya?ml$/i) },
];

export function specKind(id: string | undefined): SpecKind | null {
  return SPEC_KINDS.find((kind) => kind.id === id) ?? null;
}

/** The spec tab an address is in, or null on the statechart map. */
export function kindOfAddress(pathname: string): SpecKind | null {
  return pathname.startsWith('/specs/') ? specKind(pathname.split('/')[2]) : null;
}

export function kindOfFile(path: string): SpecKind | null {
  return SPEC_KINDS.find((kind) => kind.accepts(path)) ?? null;
}

/** The path a report names a spec by, from a file path relative to the specs folder. */
export function outlinePath(file: string) {
  const normal = file.replaceAll('\\', '/');
  return normal.startsWith('specs/') ? normal : `specs/${normal}`;
}

/** A file path relative to the specs folder, from either form. */
export function specFile(path: string) {
  return path.replaceAll('\\', '/').replace(/^specs\//, '');
}

export function fileName(path: string) {
  return path.split('/').at(-1) ?? path;
}

export function folderOf(path: string) {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
}
