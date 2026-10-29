import { describe, expect, test } from 'bun:test';

import { assertNoLiteralCredentials, createRedactor, criticScopeViolation, findLiteralCredentials, parseCredentialRef, resolveCredential } from '../src/index';

describe('credential references', () => {
  test('parse env and file references and nothing else', () => {
    expect(parseCredentialRef('env:SOME_API_KEY')).toEqual({ scheme: 'env', name: 'SOME_API_KEY' });
    expect(parseCredentialRef('file:/run/secrets/key')).toEqual({ scheme: 'file', path: '/run/secrets/key' });
    expect(parseCredentialRef('sk-live-abcdef')).toBeNull();
    expect(parseCredentialRef('env:not a name')).toBeNull();
  });

  test('resolve at run time from the environment and from a file, and fail without echoing anything', async () => {
    expect(await resolveCredential('env:K', { env: { K: 'value' } })).toBe('value');
    expect(await resolveCredential('file:/k', { readFile: async () => 'from-file\n' })).toBe('from-file');
    await expect(resolveCredential('env:K', { env: {} })).rejects.toThrow('export K');
    await expect(resolveCredential('file:/k', { readFile: async () => { throw new Error('ENOENT secret-path-detail'); } })).rejects.toThrow('could not be read');
    await expect(resolveCredential('literal-secret-value')).rejects.toThrow('reference');
    await expect(resolveCredential('literal-secret-value')).rejects.not.toThrow('literal-secret-value');
  });
});

describe('configuration holds references only', () => {
  test('a configuration of references is accepted', () => {
    expect(() => assertNoLiteralCredentials({ provider: 'example', apiKey: 'env:SOME_API_KEY', nested: { token: 'file:/run/secrets/t' }, apiKeyEnv: 'SOME_API_KEY', model: 'm-1' })).not.toThrow();
  });

  test('a literal credential is refused with where it is and never what it is', () => {
    const config = { providers: [{ name: 'a', apiKey: 'plain-text-key-123' }], note: 'sk-abcdefghijklmnopqrstuvwxyz', headers: { Authorization: 'Bearer abcdefghijklmnopqrstuvwxyz0123' } };
    let message = '';
    try { assertNoLiteralCredentials(config); } catch (error) { message = (error as Error).message; }
    expect(message).toContain('providers[0].apiKey');
    expect(message).toContain('note');
    expect(message).toContain('headers.Authorization');
    expect(message).not.toContain('plain-text-key-123');
    expect(message).not.toContain('abcdefghijklmnopqrstuvwxyz');
    expect(findLiteralCredentials(config).map(item => item.path)).toEqual(['providers[0].apiKey', 'note', 'headers.Authorization']);
  });
});

describe('redaction', () => {
  test('removes secrets in every form they are likely to appear, and anything shaped like a key', () => {
    const secret = 'my-very-private-secret';
    const redact = createRedactor([secret, 'abc']);
    const text = `plain ${secret} url ${encodeURIComponent(secret + '/ ')} b64 ${Buffer.from(secret).toString('base64')} and sk-zzzzzzzzzzzzzzzzzzzzzz and abc`;
    const out = redact(text);
    expect(out).not.toContain(secret);
    expect(out).not.toContain('sk-zzzz');
    expect(out).not.toContain(Buffer.from(secret).toString('base64'));
    // Too short to be a credential: left alone rather than damaging ordinary text.
    expect(out.endsWith('and abc')).toBe(true);
  });
});

describe('the scope of a critic credential', () => {
  test('allows critic.* layers of critique parts only', () => {
    expect(criticScopeViolation({ producer: 'critic.uiclip', parts: [{ kind: 'critique' }, { kind: 'critique' }] })).toBeNull();
  });

  test.each([
    ['a producer outside critic.*', { producer: 'e2e', parts: [{ kind: 'critique' }] }, 'producer'],
    ['an empty critic name', { producer: 'critic.', parts: [{ kind: 'critique' }] }, 'producer'],
    ['a part of another kind', { producer: 'critic.uiclip', parts: [{ kind: 'critique' }, { kind: 'behavior' }] }, '"behavior"'],
    ['no parts', { producer: 'critic.uiclip', parts: [] }, 'no parts'],
    ['no producer', {}, 'producer']
  ])('refuses %s and names the rule', (_, layer, mention) => {
    expect(criticScopeViolation(layer)).toContain(mention);
  });
});
