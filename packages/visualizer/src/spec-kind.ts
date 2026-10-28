/** A kind of spec document with its own tab: what it is called, and which files belong to it. */
export type SpecKind = {
  readonly id: 'gherkin' | 'quint' | 'dmn' | 'alloy' | 'openslo';
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
  { id: 'openslo', label: 'OpenSLO', one: 'objective', many: 'objectives', check: 'check', accepts: ending(/\.openslo\.ya?ml$/i) }
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

/**
 * A file path relative to the specs folder, from any form a link may name it by: with or without the `specs/` folder,
 * with a leading `./` or `/`, with backslashes. Nothing here can leave the folder; `..` parts are kept for the reader to refuse.
 */
export function specFile(path: string) {
  return path
    .replaceAll('\\', '/')
    .replace(/^(\.?\/)+/, '')
    .replace(/^specs\//, '')
    .replace(/\/{2,}/g, '/');
}

/**
 * The listed spec a link means. An exact entry wins; otherwise the one listed spec that differs only in letter case, or that
 * the link names by a trailing part of its path. More than one candidate, or none, leaves the link as written.
 */
export function resolveSpec(file: string, listed: readonly string[]): string {
  if (listed.includes(file)) return file;
  const lower = file.toLowerCase();
  const sameCase = listed.filter((candidate) => candidate.toLowerCase() === lower);
  if (sameCase.length === 1) return sameCase[0]!;
  const tail = listed.filter((candidate) => candidate.toLowerCase().endsWith(`/${lower}`));
  return tail.length === 1 ? tail[0]! : file;
}

/** The listed specs with the same file name as `file`, to offer when a link names one that is not there. */
export function similarSpecs(file: string, listed: readonly string[], limit = 5): string[] {
  const name = fileName(file).toLowerCase();
  return listed.filter((candidate) => fileName(candidate).toLowerCase() === name).slice(0, limit);
}

export function fileName(path: string) {
  return path.split('/').at(-1) ?? path;
}

export function folderOf(path: string) {
  return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
}
