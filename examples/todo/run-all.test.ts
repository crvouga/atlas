import { expect, test } from 'bun:test';
import { runExampleWorkflow } from './run-all';

test('local population includes UI catalog and uploads even when earlier suites fail', async () => {
  const called: string[] = [];
  const status = await runExampleWorkflow({
    run: async args => {
      called.push(args.join(' '));
      if (args.includes('examples/todo/documents.ts')) throw new Error('documents failed');
      return args.includes('--mode') ? 9 : 0;
    },
    publish: async () => { called.push('publish'); }, error: () => {}
  });
  expect(status).toBe(1);
  expect(called).toEqual([
    '--cwd examples/todo ../../packages/core/bin/atlas.mjs run --mode showcase',
    'examples/todo/documents.ts', 'examples/todo/catalog.ts', 'examples/todo/statuses.ts', 'publish'
  ]);
});

test('catalog capture or upload failures fail the full workflow without discarding evidence', async () => {
  for (const failure of ['catalog', 'statuses', 'upload', 'none']) {
    let published = false;
    expect(await runExampleWorkflow({
      run: async args => args.includes(`examples/todo/${failure}.ts`) ? 1 : 0,
      publish: async () => { published = true; if (failure === 'upload') throw new Error('unavailable'); }, error: () => {}
    })).toBe(failure === 'none' ? 0 : 1);
    expect(published).toBe(true);
  }
});
