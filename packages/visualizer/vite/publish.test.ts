import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { publishData } from './publish';

const tmp = mkdtempSync(path.join(os.tmpdir(), 'atlas-publish-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function report(root: string, id: string, passed: boolean, finishedAt: string | null = null) {
  mkdirSync(path.join(root, id, 'media'), { recursive: true });
  writeFileSync(
    path.join(root, id, 'manifest.json'),
    JSON.stringify({ schemaVersion: 1, run: { id, startedAt: '2026-10-09T10:00:00Z', finishedAt }, privacy: { passed, findings: [] } })
  );
  writeFileSync(path.join(root, id, 'media', 'screen.png'), 'synthetic');
  mkdirSync(path.join(root, id, '.work'), { recursive: true });
  writeFileSync(path.join(root, id, '.work', 'private'), 'scratch');
}

describe('publishing multiple sources', () => {
  it('publishes privacy-checked running snapshots and extra directories with relative backend locations', () => {
    const roots = { specs: path.join(tmp, 'specs'), runs: path.join(tmp, 'runs'), label: 'test' };
    mkdirSync(roots.specs, { recursive: true });
    writeFileSync(path.join(roots.specs, 'machine.json'), '{}');
    const extra = path.join(tmp, 'extra');
    report(roots.runs, 'live', true);
    report(roots.runs, 'unsafe', false, '2026-10-09T10:01:00Z');
    report(extra, 'same', true, '2026-10-09T10:01:00Z');
    const out = path.join(tmp, 'data');
    const result = publishData({
      roots,
      out,
      sources: [
        { id: 'workspace', label: 'Workspace', type: 'directory', runs: roots.runs },
        { id: 'mobile', label: 'Mobile', type: 'directory', runs: extra },
        { id: 'ci', label: 'CI', type: 'api', baseUrl: 'https://ci.example.test/reports/' }
      ]
    });
    expect(result.published).toEqual(['live', 'mobile/same']);
    expect(result.skipped).toEqual(['unsafe']);
    expect(JSON.parse(readFileSync(path.join(out, 'runs/index.json'), 'utf8')).runs[0]).toMatchObject({ id: 'live', progress: 'running' });
    expect(existsSync(path.join(out, 'runs/live/.work'))).toBe(false);
    expect(existsSync(path.join(out, 'runs/unsafe'))).toBe(false);
    expect(existsSync(path.join(out, 'backends/mobile/runs/same/media/screen.png'))).toBe(true);
    const sources = JSON.parse(readFileSync(path.join(out, 'sources.json'), 'utf8')).sources;
    expect(sources[0]).toMatchObject({ baseUrl: './' });
    expect(sources[1]).toMatchObject({ baseUrl: './backends/mobile/' });
    expect(sources[2]).toMatchObject({ type: 'api', baseUrl: 'https://ci.example.test/reports/' });
  });
});
