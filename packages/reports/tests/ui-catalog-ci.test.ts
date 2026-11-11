import { describe, expect, test } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parse } from 'yaml';

import { UiMatrixPlanSchema } from '../../schema/src/ui-catalog-matrix';
import { attemptArtifactName, planMatrix, shellWord } from '../src/ui-catalog-ci';
import { expandCatalog, parseWhere, resolveCatalog, type CatalogDefinition } from '../src/ui-catalog-definition';

const catalog: CatalogDefinition = {
  name: 'app', states: [{ id: 'home' }, { id: 'settings' }],
  matrix: {
    dimensions: {
      device: { values: ['mobile', 'tablet', 'desktop'], profile: device => ({ environment: `${device}-web` }) },
      scheme: { values: ['light', 'dark'] },
      build: { values: ['isolated', 'shared'] }
    },
    exclude: [{ device: 'tablet', build: 'isolated' }]
  }
};

describe('#95 planMatrix', () => {
  test('1: device × scheme × isolated-build: every allowed combination is one job, exactly once, and none names a website', async () => {
    const resolved = await resolveCatalog(catalog);
    const plan = planMatrix(resolved, { maxParallel: 6 });
    expect(UiMatrixPlanSchema.safeParse(plan).success).toBe(true);
    const expanded = expandCatalog(resolved.document, resolved.version);
    expect(plan.jobs).toBe(expanded.profiles.length);
    expect(plan.jobs).toBe(3 * 2 * 2 - 2);
    const covered = plan.matrix.include.map(job => JSON.stringify(job.values)).sort();
    expect(new Set(covered).size).toBe(covered.length);
    expect(covered).toEqual(expanded.profiles.map(profile => JSON.stringify(profile.values)).sort());
    expect(covered.some(item => item.includes('"tablet"') && item.includes('"isolated"'))).toBe(false);
    expect(new Set(plan.participants).size).toBe(plan.jobs);
    expect(plan.items).toBe(plan.jobs * 2);
    expect(JSON.stringify(plan.matrix)).not.toMatch(/https?:/);
    // Each job's where, read back as collect reads it, selects exactly its own values.
    for (const job of plan.matrix.include) {
      expect(parseWhere(job.where.split(' ').filter(word => word !== '--where'))).toEqual(Object.fromEntries(Object.entries(job.values).map(([name, value]) => [name, [value]])));
    }
    expect(plan.definition.document).toEqual(resolved.document);
  });

  test('2: build modes shared across profiles build once per mode, and every job names the build it downloads', async () => {
    const plan = planMatrix(await resolveCatalog(catalog), { jobDimensions: ['device', 'build'], buildDimensions: ['build'] });
    expect(plan.builds.include.map(build => build.build).sort()).toEqual(['build-isolated', 'build-shared']);
    expect(plan.builds.include.reduce((sum, build) => sum + build.jobs, 0)).toBe(plan.jobs);
    for (const job of plan.matrix.include) expect(job.build).toBe(`build-${job.values.build}`);
    // Splitting jobs by fewer dimensions: each job covers both schemes; every profile is still covered once.
    expect(plan.matrix.include.reduce((sum, job) => sum + job.profiles, 0)).toBe(plan.profiles);
    expect(plan.jobs).toBe(5);
    expect(() => planMatrix(plan.definition, { jobDimensions: ['device'], buildDimensions: ['build'] })).toThrow(/must also split jobs/);
  });

  test('cost ceilings: max-parallel is copied (never raised), a plan over max-jobs is refused, never trimmed; where narrows', async () => {
    const resolved = await resolveCatalog(catalog);
    expect(planMatrix(resolved).maxParallel).toBe(4);
    expect(planMatrix(resolved, { maxParallel: 100 }).maxParallel).toBe(10);
    expect(() => planMatrix(resolved, { maxJobs: 3 })).toThrow(/more than 3/);
    expect(() => planMatrix(resolved, { maxParallel: 0 })).toThrow(/positive/);
    expect(() => planMatrix(resolved, { jobDimensions: ['os'] })).toThrow(/not a dimension/);
    const narrow = planMatrix(resolved, { jobDimensions: ['device'], where: { scheme: ['dark'] } });
    expect(narrow.profiles).toBe(5);
    expect(narrow.matrix.include.every(job => job.where.includes('scheme=dark'))).toBe(true);
  });

  test('a work unit that groups items of several jobs is refused: no job could claim it', async () => {
    const grouped = await resolveCatalog({ ...catalog, group: item => item.state.id });
    expect(() => planMatrix(grouped)).toThrow(/groups items of several jobs/);
    expect(planMatrix(grouped, { jobDimensions: [] }).jobs).toBe(1);
  });

  test('shell words are quoted only when they must be', () => {
    expect(shellWord('device=mobile')).toBe('device=mobile');
    expect(shellWord("name=it's here")).toBe(`'name=it'\\''s here'`);
  });
});

describe('#95 attempt artifacts', () => {
  test('5: attempts of a job never share an artifact name, and names are what artifact stores accept', () => {
    const names = ['1', '2', '3'].map(runAttempt => attemptArtifactName({ job: 'device-mobile.scheme-dark', runId: '987', runAttempt }));
    expect(new Set(names).size).toBe(3);
    expect(names[1]).toBe('atlas-ui-bundle-device-mobile.scheme-dark-987-2');
    expect(attemptArtifactName({ job: 'a/b:c', runId: '1', runAttempt: '1' })).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(() => attemptArtifactName({ job: '', runId: '1', runAttempt: '1' })).toThrow();
  });
});

describe('#95 the reusable workflow', () => {
  test('3, 4, 5: it parses; preflight gates capture and still uploads diagnostics; capture uploads attempt-unique bundles always; finalize merges, imports, exports and gates', async () => {
    const text = await readFile(path.join(import.meta.dir, '../../../examples/ci/ui-catalog.yml'), 'utf8');
    const workflow = parse(text) as { on: { workflow_call: { inputs: Record<string, unknown> } }; jobs: Record<string, { needs?: string[]; if?: string; strategy?: Record<string, unknown>; steps: { if?: string; run?: string; uses?: string; with?: Record<string, unknown> }[] }> };
    expect(Object.keys(workflow.jobs)).toEqual(['plan', 'build', 'preflight', 'capture', 'finalize']);
    expect(workflow.on.workflow_call.inputs['max-parallel']).toMatchObject({ default: 4 });
    const { preflight, capture, finalize } = workflow.jobs;
    expect(preflight!.steps.find(step => step.uses?.startsWith('actions/upload-artifact'))?.if).toBe('always()');
    expect(capture!.needs).toContain('preflight');
    expect(capture!.if).toContain("needs.preflight.result == 'success'");
    expect(capture!.strategy).toMatchObject({ 'fail-fast': false, 'max-parallel': '${{ fromJSON(needs.plan.outputs.max-parallel) }}' });
    const upload = capture!.steps.find(step => step.uses?.startsWith('actions/upload-artifact'))!;
    expect(upload.if).toBe('always()');
    expect(String(upload.with!.name)).toContain('${{ github.run_attempt }}');
    expect(String(upload.with!.name)).toContain('${{ matrix.job }}');
    const collect = capture!.steps.find(step => step.run?.includes('ui-catalog collect'))!.run!;
    for (const flag of ['--refresh', '--participant', '--attempt', '--journal', '${{ matrix.where }}']) expect(collect).toContain(flag);
    expect(finalize!.if).toContain('always()');
    const runs = finalize!.steps.map(step => step.run ?? '').join('\n');
    for (const command of ['bundle merge bundles --out merged --expect-from plan.json', 'bundle import merged', 'ui-catalog export --store merged/store', 'refresh finalize']) expect(runs).toContain(command);
    expect(text).not.toMatch(/max-parallel:\s*256/);
  });
});
