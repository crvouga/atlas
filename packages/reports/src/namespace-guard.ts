/**
 * @module Object key guards
 *
 * Throws on object-store keys that could escape their prefix. The checks are lexical only (empty, leading `/`, `..`,
 * missing namespace); they do not normalise a key or decide whether an object exists.
 */

/**
 * Validates a wire key before any remote object-store I/O. Every S3 command
 * for the shared bucket must pass this gate so projects cannot clobber
 * each other's prefixes.
 *
 * Throws `Error` when `key` is empty, starts with `/`, contains `..` anywhere, is exactly `namespace` (with or without
 * a trailing `/`), or does not start with `namespace`. Returns nothing when the key is acceptable.
 */
export function assertRemoteObjectKey(key: string, namespace: string): void {
  if (key.length === 0) {
    throw new Error('Remote object key must be non-empty');
  }
  if (key.startsWith('/')) {
    throw new Error(`Remote object key must not start with "/": ${key}`);
  }
  if (key.includes('..')) {
    throw new Error(`Remote object key must not contain "..": ${key}`);
  }
  const bareNamespace = namespace.endsWith('/')
    ? namespace.slice(0, -1)
    : namespace;
  if (key === namespace || key === bareNamespace) {
    throw new Error(
      `Remote object key must include a path after "${namespace}": ${key}`
    );
  }
  if (!key.startsWith(namespace)) {
    throw new Error(`Remote object key must start with "${namespace}": ${key}`);
  }
}

/**
 * Validates a logical key before {@link ObjectStoreWithPrefix} scopes it under
 * a namespace or feature prefix. Throws `Error` when `key` is empty, starts with `/`, or contains `..` anywhere.
 */
export function assertLogicalObjectKey(key: string): void {
  if (key.length === 0) {
    throw new Error('Object store key must be non-empty');
  }
  if (key.startsWith('/')) {
    throw new Error(`Object store key must not start with "/": ${key}`);
  }
  if (key.includes('..')) {
    throw new Error(`Object store key must not contain "..": ${key}`);
  }
}
