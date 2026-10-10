export type Inspector = 'gherkin' | 'quint' | 'statechart';

/** Which inspector owns a file. Anything else stays with the statechart product and is not opened as a document. */
export function inspectorFor(path: string): Inspector {
  const file = path.toLowerCase().split('?')[0] ?? '';
  if (file.endsWith('.feature')) return 'gherkin';
  if (file.endsWith('.qnt')) return 'quint';
  return 'statechart';
}

export function sameSpecFile(specPath: string | undefined, file: string) {
  if (!specPath || !file) return false;
  const normal = specPath.replaceAll('\\', '/').replace(/^specs\//, '');
  const target = file.replace(/^specs\//, '');
  return normal === target || normal.endsWith(`/${target}`);
}
