/**
 * Consumer smoke test: install the package the way a project using Atlas from npm would.
 *
 * Packs every public package exactly like `release:publish` (the published manifest, then
 * `bun pm pack`), `bun install`s the tarball into a fresh project outside the repository, then:
 *   1. imports every `exports` subpath under Bun and under plain Node (ESM, no loader),
 *   2. typechecks an import of every subpath with `moduleResolution: nodenext`,
 *   3. bundles one small named import and checks that the rest of the package was shaken out,
 *   4. runs every `bin` with `--help`, and plans a chart from a TypeScript config,
 *   5. builds the visualizer's static site from a bundled fixture, from inside node_modules.
 * Steps 4 and 5 run on both runtimes too. This repository is developed on Bun; Node appears here
 * and nowhere else, because projects that install Atlas may run it on Node.
 *
 * Catches what the repository cannot, because there every import resolves to `src`: an import Node
 * cannot resolve, a runtime import missing from `dependencies`, files left out of the tarball, a
 * module with side effects that defeats tree shaking.
 *
 *   bun run build && bun run release:smoke
 *   bun run release:smoke --keep     (leave the installed project behind to inspect)
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { must } from '../process.ts';
import { restoreOriginals } from './files.ts';
import { discoverPackages, type Manifest, missingEntryPoints, pack, packedFiles, packedManifest, publishManifest, unresolvablePins } from './lib.ts';

const SMOKE_VERSION = '0.0.0-smoke';
const keep = process.argv.includes('--keep');

// A check that cannot finish in time fails loudly; it never hangs a CI job.
const TOTAL_BUDGET_MS = 8 * 60_000;
const started = Date.now();
const watchdog = setTimeout(() => {
  console.error(`::error::consumer-smoke: exceeded its ${TOTAL_BUDGET_MS}ms budget; failing instead of hanging`);
  process.exit(1);
}, TOTAL_BUDGET_MS);
watchdog.unref();

/**
 * The tree-shaking probe: one export of the main entry point whose module needs nothing else. A
 * bundle of it that pulls in a dependency, or more than a few of the package's own modules, means
 * something on the way has (or claims) side effects.
 */
const SHAKE_PROBE = { from: '@crvouga/atlas', name: 'mergePrivacy', maxOwnModules: 4 };

const SHAKE_SCRIPT = `
import { build } from 'esbuild';
const [from, name, max] = process.argv.slice(2);
const bundle = async (source) => {
  const result = await build({ stdin: { contents: source, resolveDir: process.cwd() }, bundle: true, format: 'esm', platform: 'node', write: false, metafile: true, logLevel: 'silent' });
  const used = Object.entries(result.metafile.outputs).flatMap(([, out]) => Object.entries(out.inputs).filter(([, i]) => i.bytesInOutput > 0).map(([file]) => file));
  return { own: used.filter((f) => f.includes('@crvouga/atlas/')), deps: used.filter((f) => f.includes('node_modules/') && !f.includes('@crvouga/atlas/')) };
};
const one = await bundle(\`import { \${name} } from '\${from}'; console.log(\${name});\`);
const all = await bundle(\`import * as all from '\${from}'; console.log(all);\`);
console.log(\`\${name}: \${one.own.length} module(s), \${one.deps.length} dependency file(s); whole entry point: \${all.own.length} module(s), \${all.deps.length} dependency file(s)\`);
if (one.deps.length > 0 || one.own.length > Number(max)) {
  console.error('not shaken out:\\n  ' + [...one.own, ...one.deps].slice(0, 20).join('\\n  '));
  process.exit(1);
}
if (all.own.length <= one.own.length) {
  console.error('the probe is not smaller than the whole entry point, so it proves nothing');
  process.exit(1);
}
`;

/** The runtimes a project may run Atlas on, each with the arguments that make it run a script file. */
const RUNTIMES: [runtime: string, args: string[]][] = [
  ['bun', ['--bun']],
  ['node', []]
];

const SMOKE_CHART = {
  id: 'Flow',
  initial: 'Start',
  states: { Start: { meta: { description: 'Where it begins.' }, on: { Continue: 'Done' } }, Done: { type: 'final', meta: { description: 'Finished.' } } }
};

const SMOKE_CONFIG = `import { defineConfig, functionDriver } from '@crvouga/atlas';

export default defineConfig({ specs: './specs', driver: functionDriver(() => ({})), implementation: { states: {}, events: {} } });
`;

/** `./*` → one specifier per file the pattern matches in the tarball; anything else → itself. */
export function exportSpecifiers(name: string, manifest: Manifest, files: string[]): string[] {
  const specifiers: string[] = [];
  for (const [subpath, target] of Object.entries(manifest.exports ?? {})) {
    if (subpath === './package.json') continue;
    if (!subpath.includes('*')) {
      specifiers.push(subpath === '.' ? name : `${name}/${subpath.slice(2)}`);
      continue;
    }
    // Only code is importable: a pattern over data files (`./schemas/*`) is covered by the tarball check.
    const entry = typeof target === 'string' ? target : (target as { default?: string } | null)?.default;
    if (!entry?.endsWith('.js')) continue;
    const [before = '', after = ''] = entry.replace(/^\.\//, '').split('*');
    for (const file of files) {
      if (!file.startsWith(before) || !file.endsWith(after)) continue;
      const matched = file.slice(before.length, file.length - after.length);
      if (matched && !matched.includes('/')) specifiers.push(`${name}/${subpath.slice(2).replace('*', matched)}`);
    }
  }
  return specifiers.sort();
}

async function main(): Promise<void> {
  const pkgs = discoverPackages().filter((p) => p.isPublic);
  const work = mkdtempSync(path.join(tmpdir(), 'atlas-consumer-'));
  const tarballs = path.join(work, 'tarballs');
  const app = path.join(work, 'app');
  const originals = new Map<string, string | null>();

  try {
    const smokeVersions = new Map(pkgs.map((p) => [p.name, SMOKE_VERSION]));
    for (const pkg of pkgs) {
      const raw = readFileSync(pkg.manifestPath, 'utf8');
      originals.set(pkg.manifestPath, raw);
      writeFileSync(pkg.manifestPath, publishManifest(raw, SMOKE_VERSION, smokeVersions));
    }

    mkdirSync(tarballs, { recursive: true });
    const packed: { name: string; tarball: string; manifest: Manifest; files: string[] }[] = [];
    for (const pkg of pkgs) {
      const tarball = await pack(pkg.dir, tarballs);
      const manifest = await packedManifest(tarball);
      const files = await packedFiles(tarball);
      // The install below resolves every package name to a local tarball, which would also satisfy
      // a pin npm could never resolve. So assert the packed manifest directly: it is what a consumer gets.
      const bad = unresolvablePins(manifest);
      if (bad.length > 0) throw new Error(`${pkg.name} ships dependency pins no consumer could resolve:\n  ${bad.join('\n  ')}`);
      const missing = missingEntryPoints(manifest, files);
      if (missing.length > 0) throw new Error(`${pkg.name} names entry points its tarball does not contain (run bun run build):\n  ${missing.join('\n  ')}`);
      packed.push({ name: pkg.name, tarball, manifest, files });
    }

    // Restore before installing so a failure below never leaves pinned manifests behind.
    restoreOriginals(originals);
    originals.clear();

    const dependencies = Object.fromEntries(packed.map((p) => [p.name, p.tarball]));
    mkdirSync(app, { recursive: true });
    writeFileSync(
      path.join(app, 'package.json'),
      JSON.stringify(
        {
          name: 'atlas-consumer-smoke',
          private: true,
          type: 'module',
          dependencies,
          // playwright is an optional peer: a project that imports `@crvouga/atlas/playwright` installs it.
          devDependencies: { typescript: '5.9.3', '@types/node': '22.20.3', esbuild: '0.28.2', playwright: '1.60.0' }
        },
        null,
        2
      )
    );
    console.log(`consumer-smoke: bun install ${packed.length} tarball(s) into ${app}`);
    await must('bun', ['install'], { cwd: app });

    const specifiers = packed.flatMap((p) => exportSpecifiers(p.name, p.manifest, p.files));
    const importAll = specifiers.map((s, i) => `import * as m${i} from ${JSON.stringify(s)};`).join('\n');
    const touch = specifiers.map((_, i) => `m${i}`).join(', ');
    writeFileSync(path.join(app, 'smoke.mjs'), `${importAll}\nconst mods = [${touch}];\nconsole.log('imported ' + mods.length + ' entry points');\n`);
    writeFileSync(path.join(app, 'smoke.ts'), `${importAll}\nexport const all = [${touch}];\n`);
    writeFileSync(
      path.join(app, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: {
          target: 'ES2023',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          strict: true,
          noEmit: true,
          skipLibCheck: false,
          types: ['node'],
          lib: ['ES2023', 'DOM', 'DOM.Iterable']
        },
        include: ['smoke.ts']
      })
    );

    for (const [runtime, args] of RUNTIMES) {
      console.log(`consumer-smoke: ${runtime} import of ${specifiers.length} entry points`);
      await must(runtime, [...args, 'smoke.mjs'], { cwd: app });
    }

    console.log('consumer-smoke: tsc (nodenext) over every entry point');
    // skipLibCheck is off so the shipped .d.ts are checked; third-party typings are not ours to gate on.
    const tsc = await must('bun', ['x', 'tsc', '-p', 'tsconfig.json', '--pretty', 'false'], { cwd: app }).catch((error: Error) => error.message);
    const ours = tsc.split('\n').filter((line) => /^(smoke\.ts|node_modules\/@crvouga\/)/.test(line));
    if (ours.length > 0) throw new Error(`${ours.length} type error(s) in published packages:\n${ours.join('\n')}`);

    if (packed.some((p) => p.name === SHAKE_PROBE.from)) {
      writeFileSync(path.join(app, 'shake.mjs'), SHAKE_SCRIPT);
      const shaken = await must('bun', ['shake.mjs', SHAKE_PROBE.from, SHAKE_PROBE.name, String(SHAKE_PROBE.maxOwnModules)], { cwd: app });
      console.log(`consumer-smoke: tree shaking: ${shaken.trim()}`);
    }

    // Each bin by its file, so the runtime is the one named here and not the one in its shebang.
    const bins = new Map<string, string>();
    for (const p of packed) {
      const declared = typeof p.manifest.bin === 'string' ? { [p.name.split('/').pop() as string]: p.manifest.bin } : (p.manifest.bin ?? {});
      for (const [bin, file] of Object.entries(declared)) bins.set(bin, path.join(app, 'node_modules', p.name, file));
    }
    for (const [runtime, args] of RUNTIMES) {
      for (const [bin, file] of bins) {
        console.log(`consumer-smoke: ${runtime} ${bin} --help`);
        await must(runtime, [...args, file, '--help'], { cwd: app });
      }
    }

    const atlas = bins.get('atlas');
    if (atlas) {
      // A TypeScript config is what projects write: Bun loads it natively, Node through tsx.
      mkdirSync(path.join(app, 'specs'));
      writeFileSync(path.join(app, 'specs/flow.machine.json'), JSON.stringify(SMOKE_CHART));
      writeFileSync(path.join(app, 'atlas.config.ts'), SMOKE_CONFIG);
      for (const [runtime, args] of RUNTIMES) {
        console.log(`consumer-smoke: ${runtime} atlas plan --config atlas.config.ts`);
        const planned = await must(runtime, [...args, atlas, 'plan', '--config', 'atlas.config.ts'], { cwd: app });
        if (!/\d+ paths \(/.test(planned)) throw new Error(`atlas plan printed no plan under ${runtime}:\n${planned}`);
      }
    }

    if (atlas) {
      // The reports are the other way in: two nodes each publish part of a report, and the aggregate gates.
      const ctrf = (name: string) => JSON.stringify({ results: { tool: { name: 'smoke' }, summary: { stop: 1000 }, tests: [{ name, status: 'passed', filePath: 'specs/flow.feature' }] } });
      writeFileSync(path.join(app, 'node-1.ctrf.json'), ctrf('first'));
      writeFileSync(path.join(app, 'node-2.ctrf.json'), ctrf('second'));
      for (const [runtime, args] of RUNTIMES) {
        console.log(`consumer-smoke: ${runtime} atlas report publish, merge and status`);
        const store = (name: string) => `reports-${runtime}-${name}`;
        for (const node of ['1', '2']) {
          await must(runtime, [...args, atlas, 'report', 'publish', '--store', store(node), '--producer', 'smoke', '--ctrf', `node-${node}.ctrf.json`, '--environment', 'desktop-web', '--sha', 'a'.repeat(40), '--branch', 'main'], { cwd: app });
        }
        const gated = await must(runtime, [...args, atlas, 'report', 'status', '--store', store('1'), '--store', store('2'), '--format', 'json'], { cwd: app });
        const status = JSON.parse(gated) as { ok: boolean; checks: { passed: number } };
        if (!status.ok || status.checks.passed !== 2) throw new Error(`atlas report status under ${runtime} did not combine both nodes:\n${gated}`);
        await must(runtime, [...args, atlas, 'report', 'merge', '--store', store('1'), '--store', store('2'), '--into', store('all')], { cwd: app });
      }
    }

    const visualizer = bins.get('atlas-visualizer');
    if (visualizer) {
      for (const [runtime, args] of RUNTIMES) {
        const out = `site-${runtime}`;
        console.log(`consumer-smoke: ${runtime} atlas-visualizer build --fixture full`);
        await must(runtime, [...args, visualizer, 'build', '--fixture', 'full', '--out', out], { cwd: app });
        if (!existsSync(path.join(app, out, 'index.html'))) throw new Error(`atlas-visualizer build wrote no ${out}/index.html`);
        // Its stylesheet is a side-effect import: gone if the package wrongly declares the app side-effect free.
        if (!readdirSync(path.join(app, out, 'assets')).some((file) => file.endsWith('.css'))) throw new Error(`atlas-visualizer build dropped its stylesheet under ${runtime}`);
      }
    }

    console.log(`consumer-smoke: OK (${packed.length} packages)`);
  } catch (error) {
    console.error(`::error::consumer-smoke failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally {
    restoreOriginals(originals);
    if (keep) console.log(`consumer-smoke: kept ${work}`);
    else rmSync(work, { recursive: true, force: true });
  }
  console.log(`consumer-smoke: finished in ${Math.round((Date.now() - started) / 1000)}s`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  await main();
  // Exit explicitly: a socket or child left behind must not keep the CI step alive after the work is done.
  process.exit(process.exitCode ?? 0);
}
