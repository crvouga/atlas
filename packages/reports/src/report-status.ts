import { REPORT_STATUS_SCHEMA_VERSION, type ReportStatus } from '../../schema/src/layer';
import { countResults, type CombinedReport } from './compose';
import { normalizeEnvironment } from './layer-axes';
import { isDiagnosticKind, type EvidenceResult } from './layer-merge';

export type StatusOptions = {
  /** Environments that must have at least one check, such as `ios,android`. A missing one fails the gate. */
  readonly requireEnvironments?: readonly string[];
  /** Fail when any spec of the outline has no result at all. */
  readonly requireAllSpecs?: boolean;
};

/**
 * The gate. A report passes only when it has checks, none failed, none is still running, every
 * layer and backend could be read, and every required environment is present. Unknown never passes.
 */
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function reportStatus(report: CombinedReport, options: StatusOptions = {}): ReportStatus {
  const results: EvidenceResult[] = [...report.combined.specs.flatMap(entry => entry.results), ...report.combined.unassigned];
  const outcomes = results.some(result => !isDiagnosticKind(result.row.kind)) ? results.filter(result => !isDiagnosticKind(result.row.kind)) : results;
  const failing = outcomes
    .filter(result => result.row.status === 'failed' || result.row.status === 'running')
    .map(result => ({
      spec: result.row.specPath,
      check: result.row.id,
      title: result.row.title,
      status: result.row.status as 'failed' | 'running',
      environment: result.layer.environment,
      producer: result.layer.producer,
      branch: result.layer.branch,
      sha: result.layer.sha,
      layer: result.layer.id,
      backend: result.layer.backend,
      runUrl: result.layer.runUrl,
      detail: result.row.detail
    }))
    // Total, so the output never depends on the order layers were read in.
    .sort((a, b) => compare(a.spec ?? '', b.spec ?? '') || compare(a.check, b.check) || compare(a.environment ?? '', b.environment ?? '') || compare(a.producer, b.producer) || compare(a.layer, b.layer) || compare(a.backend, b.backend));
  const reasons: string[] = [];
  const { checks, byEnvironment } = report.summary;
  if (checks.total === 0) reasons.push('No checks were found in any layer');
  else if (checks.passed + checks.failed === 0 && checks.running === 0) reasons.push('No check has completed: everything was skipped or not run');
  if (checks.failed) reasons.push(`${checks.failed} check${checks.failed === 1 ? '' : 's'} failed`);
  if (checks.running) reasons.push(`${checks.running} check${checks.running === 1 ? ' is' : 's are'} still running`);
  const missing = report.summary.specsWithoutEvidence;
  if (options.requireAllSpecs && missing.length) reasons.push(`${missing.length} spec${missing.length === 1 ? ' has' : 's have'} no results: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ', …' : ''}`);
  for (const required of options.requireEnvironments ?? []) {
    // Layers carry normalized environments (`iOS` is `ios`), so a requirement is normalized the same way.
    const environment = normalizeEnvironment(required) ?? required;
    if (!byEnvironment[environment]?.total) reasons.push(`No checks on required environment "${required}"`);
  }
  reasons.push(...report.notices);
  return {
    schemaVersion: REPORT_STATUS_SCHEMA_VERSION,
    ok: reasons.length === 0,
    reasons,
    checks,
    byEnvironment: { ...byEnvironment },
    layers: report.layers.length,
    backends: report.backends.map(({ id, label, available }) => ({ id, label, available })),
    notices: [...report.notices],
    specsWithoutEvidence: [...missing],
    specs: [
      ...report.combined.specs.map(entry => specOutcome(entry.spec.path, entry.spec.title, entry.spec.kind, entry.results)),
      ...(report.combined.unassigned.length ? [specOutcome(null, 'No spec', 'unassigned', report.combined.unassigned)] : [])
    ],
    failing
  };
}

/** `spec › check`, unless the check's id already starts with its spec. */
const label = (item: { spec: string | null; check: string }) => (item.spec && !item.check.startsWith(item.spec) ? `${item.spec} › ${item.check}` : item.check);

function specOutcome(path: string | null, title: string, kind: string, results: readonly EvidenceResult[]) {
  const environments = new Map<string, EvidenceResult[]>();
  for (const result of results) {
    const key = result.layer.environment ?? 'unspecified';
    const group = environments.get(key);
    if (group) group.push(result);
    else environments.set(key, [result]);
  }
  return {
    path, title, kind,
    checks: countResults(results),
    byEnvironment: Object.fromEntries([...environments].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([key, value]) => [key, countResults(value)]))
  };
}

const row = (counts: { passed: number; failed: number; running: number; 'not-run': number; total: number }) => `${counts.passed} passed, ${counts.failed} failed, ${counts.running} running, ${counts['not-run']} not run`;

export function formatStatusText(status: ReportStatus): string {
  const lines = [`${status.ok ? 'PASS' : 'FAIL'}  ${row(status.checks)} — ${status.layers} layer${status.layers === 1 ? '' : 's'} from ${status.backends.length} backend${status.backends.length === 1 ? '' : 's'}`];
  for (const [environment, counts] of Object.entries(status.byEnvironment)) lines.push(`  ${environment.padEnd(14)} ${row(counts)}`);
  for (const item of status.failing) {
    const where = [item.environment, item.branch, item.sha?.slice(0, 7)].filter(Boolean).join(' · ');
    lines.push(`✗ ${item.status === 'running' ? '[running] ' : ''}${label(item)}${where ? `  (${where})` : ''}${item.detail ? `\n    ${item.detail.split('\n')[0]}` : ''}`);
  }
  for (const notice of status.notices) lines.push(`! ${notice}`);
  for (const reason of status.reasons) if (!status.notices.includes(reason)) lines.push(`→ ${reason}`);
  if (status.specsWithoutEvidence.length && !status.reasons.some(reason => reason.includes('no results'))) lines.push(`· ${status.specsWithoutEvidence.length} spec${status.specsWithoutEvidence.length === 1 ? '' : 's'} with no results yet: ${status.specsWithoutEvidence.slice(0, 5).join(', ')}${status.specsWithoutEvidence.length > 5 ? ', …' : ''}`);
  return `${lines.join('\n')}\n`;
}

const cell = (value: string) => value.replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** For a pull request comment or `$GITHUB_STEP_SUMMARY`. */
export function formatStatusMarkdown(status: ReportStatus): string {
  const lines = [`### ${status.ok ? '✅' : '❌'} Atlas report: ${row(status.checks)}`, '', `${status.layers} layer${status.layers === 1 ? '' : 's'} from ${status.backends.length} backend${status.backends.length === 1 ? '' : 's'}.`, ''];
  const environments = Object.entries(status.byEnvironment);
  if (environments.length) {
    lines.push('| Environment | Passed | Failed | Running | Not run |', '| --- | ---: | ---: | ---: | ---: |');
    for (const [environment, counts] of environments) lines.push(`| ${cell(environment)} | ${counts.passed} | ${counts.failed} | ${counts.running} | ${counts['not-run']} |`);
    lines.push('');
  }
  if (status.failing.length) {
    lines.push('| Check | Environment | Branch | Detail |', '| --- | --- | --- | --- |');
    for (const item of status.failing) lines.push(`| ${cell(label(item))} | ${cell(item.environment ?? '')} | ${cell(item.branch ?? '')} | ${cell(item.status === 'running' ? 'still running' : item.detail.split('\n')[0] ?? '')} |`);
    lines.push('');
  }
  for (const reason of status.reasons) lines.push(`- ${reason}`);
  return `${lines.join('\n')}\n`;
}
