import { describe, expect, test } from 'bun:test';
import { withJsExtension } from './build-package.ts';

const files = new Set(['/pkg/src/plan.ts', '/pkg/src/spec/index.ts', '/pkg/src/view.tsx']);
const exists = (file: string) => files.has(file);

describe('withJsExtension', () => {
  test('a relative import of a source file gets the extension Node resolves', () => {
    expect(withJsExtension('./plan', '/pkg/src/index.ts', exists)).toBe('./plan.js');
    expect(withJsExtension('./view', '/pkg/src/index.ts', exists)).toBe('./view.js');
    expect(withJsExtension('../plan', '/pkg/src/spec/index.ts', exists)).toBe('../plan.js');
  });

  test('a directory import names its index', () => {
    expect(withJsExtension('./spec', '/pkg/src/index.ts', exists)).toBe('./spec/index.js');
    expect(withJsExtension('.', '/pkg/src/spec/load.ts', exists)).toBe('./index.js');
  });

  test('packages and paths that are not source files are left alone', () => {
    expect(withJsExtension('xstate', '/pkg/src/index.ts', exists)).toBeUndefined();
    expect(withJsExtension('./missing', '/pkg/src/index.ts', exists)).toBeUndefined();
    expect(withJsExtension('./plan.js', '/pkg/src/index.ts', exists)).toBeUndefined();
  });
});
