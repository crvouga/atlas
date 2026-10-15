/**
 * @module Executable consumer quickstart
 *
 * Run the literal marked shell blocks from the shipped guide against a supplied CLI, both in repository tests
 * and in the packed consumer smoke. Check schemas and the promised repeat-publish, failure and recovery results.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { PublishResultSchema } from '../../packages/schema/src/cli-results';
import { ReportStatusSchema } from '../../packages/schema/src/layer';
import { must } from '../process';

const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

/** Execute the guide in a scratch consumer directory using the requested runtime and CLI entry point. */
export async function probeQuickstart(options: { guide: string; command: readonly string[]; cwd: string }): Promise<void> {
  const guide = readFileSync(options.guide, 'utf8');
  const blocks = [...guide.matchAll(/<!-- smoke:begin -->\n```sh\n([\s\S]*?)\n```\n<!-- smoke:end -->/g)].map(match => match[1]!);
  if (blocks.length !== 3) throw new Error('quickstart: expected publish, failure and recovery shell blocks');
  // Only substitute the CLI invocation; run the guide's actual shell, files, flags and exit-code handling.
  const script = blocks.join('\n').replace(/^atlas /gm, `${options.command.map(quote).join(' ')} `);
  const output = await must('sh', ['-eu', '-c', script], { cwd: options.cwd, env: { ...process.env, TMPDIR: path.resolve(options.cwd) } });
  const documents = [...output.matchAll(/^\{[\s\S]*?^\}/gm)].map(match => JSON.parse(match[0]));
  if (documents.length !== 8) throw new Error(`quickstart: expected eight JSON command results, got ${documents.length}`);
  const published = [0, 2, 4, 6].map(index => PublishResultSchema.parse(documents[index]));
  const statuses = [1, 3, 5, 7].map(index => ReportStatusSchema.parse(documents[index]));
  if (published[0]!.layer.id !== published[1]!.layer.id) throw new Error('quickstart: repeat publish changed layer identity');
  const expected = [
    { ok: true, passed: 1, failed: 0, layers: 1 },
    { ok: true, passed: 1, failed: 0, layers: 1 },
    { ok: false, passed: 0, failed: 1, layers: 2 },
    { ok: true, passed: 1, failed: 0, layers: 3 }
  ];
  for (const [index, status] of statuses.entries()) {
    const wanted = expected[index]!;
    if (status.ok !== wanted.ok || status.layers !== wanted.layers || status.checks.total !== 1 || status.checks.passed !== wanted.passed || status.checks.failed !== wanted.failed) {
      throw new Error(`quickstart: unexpected status at step ${index + 1}: ${JSON.stringify(status)}`);
    }
  }
  if (statuses[2]!.failing[0]?.check !== 'plumbing') throw new Error('quickstart: intentional failure was not named');
}
