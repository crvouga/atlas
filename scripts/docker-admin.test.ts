import { expect, test } from 'bun:test';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const repository = path.resolve(import.meta.dir, '..');

test('the runtime image copies the source closure needed to bundle settings', async () => {
  const runtime = await mkdtemp(path.join(os.tmpdir(), 'atlas-docker-admin-'));
  try {
    await symlink(path.join(repository, 'node_modules'), path.join(runtime, 'node_modules'), 'dir');
    // Docker supplies the compiled schema export in dist. Use its real source equivalent
    // so this regression also runs before the package build in a fresh checkout.
    await writeFile(path.join(runtime, 'package.json'), JSON.stringify({ name: '@crvouga/atlas', type: 'module', exports: { './schema': './schema.ts' } }));
    await writeFile(path.join(runtime, 'schema.ts'), `export * from ${JSON.stringify(path.join(repository, 'packages/schema/src/index.ts'))};`);
    const dockerfile = await readFile(path.join(repository, 'Dockerfile'), 'utf8');
    const copies = [...dockerfile.matchAll(/^COPY --from=build \/app\/(packages\/visualizer\/\S+) \.\/(\S+)$/gm)];
    expect(copies.length).toBeGreaterThan(0);
    for (const [, source, destination] of copies) {
      const target = path.join(runtime, destination!);
      await mkdir(path.dirname(target), { recursive: true });
      await cp(path.join(repository, source!), target, { recursive: true });
    }
    // Build from the runtime layout, not the repository's complete source tree.
    const bundle = await Bun.build({ entrypoints: [path.join(runtime, 'packages/visualizer/src/admin/main.tsx')], target: 'browser', minify: true });
    expect(bundle.success).toBe(true);
    expect(bundle.outputs.some(output => output.kind === 'entry-point')).toBe(true);
  } finally {
    await rm(runtime, { recursive: true, force: true });
  }
});
