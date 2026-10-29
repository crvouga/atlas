/** Populate durable status samples independently of the real browser suites. */
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { directoryStore } from '../../packages/reports/src/directory-store';
import { publishStatusExamples } from '../../packages/visualizer/vite/example-statuses';
import { gitOrigin } from './spec-outline';

await publishStatusExamples(directoryStore(path.join(import.meta.dir, 'atlas-reports')), {
  featureText: await readFile(path.join(import.meta.dir, 'specs/getting-started.feature'), 'utf8'),
  recordedAtMs: Date.now(), ...await gitOrigin(import.meta.dir)
});
console.log('Status examples populated: pending, running and errored (UI catalog, Tests, Runs and Behaviors).');
