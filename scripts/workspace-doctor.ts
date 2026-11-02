/** @module Workspace doctor
 * Read-only readiness report for running Atlas on a new machine: what is present, what the first Dev run will
 * download, and how to view it from another machine. It installs nothing and changes no settings.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { sharedLinks, sshHint, tailnet, tailscaleBinary } from './workspace-share';

/** One readiness finding. `fail` blocks Dev; `warn` is fixed automatically or only limits remote viewing. */
export type Finding = { check: string; level: 'ok' | 'warn' | 'fail'; detail: string; fix?: string };

/** Inspect this checkout and machine. `running` lists the loopback ports of this checkout's live targets. */
export async function diagnoseWorkspace(root: string, running: number[], dependenciesCurrent: boolean): Promise<Finding[]> {
  const findings: Finding[] = [];
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const bun = String(pkg.packageManager).replace(/^bun@/, '');
  findings.push(
    Bun.version === bun
      ? { check: 'bun', level: 'ok', detail: `Bun ${Bun.version}` }
      : { check: 'bun', level: 'fail', detail: `Bun ${Bun.version}; Atlas pins ${bun}`, fix: `curl -fsSL https://bun.sh/install | bash -s "bun-v${bun}"` }
  );
  findings.push(
    Bun.which('git')
      ? { check: 'git', level: 'ok', detail: 'git found' }
      : { check: 'git', level: 'fail', detail: 'git is not on PATH', fix: 'Install git.' }
  );
  findings.push(
    dependenciesCurrent
      ? { check: 'dependencies', level: 'ok', detail: 'Installed and matching bun.lock' }
      : { check: 'dependencies', level: 'warn', detail: 'Missing or out of date; Dev installs them', fix: 'bun run dev --setup' }
  );
  const external = Object.entries(process.env).some(([key, value]) => key.startsWith('ATLAS_S3_') && value);
  findings.push({
    check: 'storage',
    level: 'ok',
    detail: external ? 'External S3 from ATLAS_S3_* (must be reachable)' : 'Local S3 emulator in .atlas-workspace/s3, started by Dev'
  });
  let chromium = '';
  try {
    chromium = (await import('playwright')).chromium.executablePath();
  } catch {}
  findings.push(
    chromium && existsSync(chromium)
      ? { check: 'chromium', level: 'ok', detail: 'Playwright Chromium installed' }
      : { check: 'chromium', level: 'warn', detail: 'Not downloaded yet; the first Dev run downloads it', fix: 'bun node_modules/playwright/cli.js install chromium' }
  );
  if (!tailscaleBinary()) {
    findings.push({
      check: 'remote viewing',
      level: 'warn',
      detail: 'Tailscale is not installed, so "dev --share" cannot make a private link',
      fix: `Install Tailscale (https://tailscale.com/download), or from the viewing machine: ${sshHint(5180)}`
    });
  } else {
    const state = await tailnet();
    if ('problem' in state) findings.push({ check: 'remote viewing', level: 'warn', detail: state.problem, fix: 'tailscale up' });
    else if (!state.https)
      findings.push({
        check: 'remote viewing',
        level: 'warn',
        detail: `Tailnet name ${state.host}, but HTTPS certificates are off`,
        fix: 'Turn on MagicDNS and HTTPS on the DNS page of the Tailscale admin console.'
      });
    else findings.push({ check: 'remote viewing', level: 'ok', detail: `"bun run dev --share" serves https://${state.host}:<port>/ on the tailnet` });
  }
  const links = await sharedLinks(running);
  for (const port of running)
    findings.push({ check: `port ${port}`, level: 'ok', detail: links.has(port) ? `Running, shared at ${links.get(port)}` : 'Running, not shared' });
  return findings;
}

/** Human-readable report lines. */
export function formatFindings(findings: Finding[]): string {
  const mark = { ok: '✓', warn: '!', fail: '✗' } as const;
  return findings.map((item) => `${mark[item.level]} ${item.check}: ${item.detail}${item.fix ? `\n    fix: ${item.fix}` : ''}`).join('\n');
}
