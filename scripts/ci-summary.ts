/** Render the CI run's results and only the image references its publisher confirmed. */
import { appendFileSync } from 'node:fs';

/** A completed dependency job, including the outputs it managed to write before stopping. */
export interface JobResult {
  result: string;
  outputs?: Record<string, string>;
}

const code = (value: string) => `<code>${value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('|', '&#124;').replace(/[\r\n]/g, ' ')}</code>`;
const block = (value: string) => `\n\n\`\`\`text\n${value}\n\`\`\`\n`;

/** Produce Markdown for success, failure, PR, scheduled and superseded runs without implying publication. */
export function renderSummary(needs: Record<string, JobResult>, env: Record<string, string | undefined>): string {
  const server = env.GITHUB_SERVER_URL ?? 'https://github.com';
  const repo = `${server}/${env.GITHUB_REPOSITORY}`;
  const run = `${repo}/actions/runs/${env.GITHUB_RUN_ID}`;
  const sha = env.GITHUB_SHA ?? '';
  const rows = [
    ['commitlint', 'Commit conventions', 'PR commits and title'],
    ['check', 'Repository checks', 'Docs, schemas, types, tests, build and Bun/Node consumer smoke'],
    ['s3', 'S3 integration', 'Store and report flow against real SeaweedFS'],
    ['example', 'Browser examples', 'Both run and clients matrix jobs; recordings in artifacts'],
    ['image', 'Server image', 'Linux AMD64 build, Railway container smoke and eligible publication'],
    ['insecure-image', 'Insecure server image', 'Same server and viewer; anonymous read, publish and admin container smoke'],
    ['release', 'npm release', 'Publish/reconcile npm versions, tags, GitHub releases and issue notices']
  ];
  const lines = [
    '# Atlas CI',
    '',
    `[Run #${env.GITHUB_RUN_NUMBER} (attempt ${env.GITHUB_RUN_ATTEMPT ?? '1'})](${run}) · ` +
      `[Commit ${sha.slice(0, 7)}](${repo}/commit/${sha}) · ${code(env.GITHUB_REF_NAME ?? '')} · ${code(env.GITHUB_EVENT_NAME ?? '')}`,
    '',
    '## Results',
    '',
    '| Job | Result | Coverage |',
    '| --- | --- | --- |',
    ...rows.map(([id, label, description]) => `| ${label} | ${code(needs[id!]?.result ?? 'unknown')} | ${description} |`),
    '',
    `[Logs and timings](${run}) · [Artifacts: example recordings and Docker build record](${run}#artifacts)`,
    '',
  ];
  for (const [job, label, image] of [
    ['image', 'Docker image for Railway', 'ghcr.io/crvouga/atlas'],
    ['insecure-image', 'Insecure Docker image for Railway', 'ghcr.io/crvouga/atlas-insecure']
  ]) {
    lines.push(`## ${label}`, '');
    const output = needs[job!]?.outputs ?? {};
    lines.push(`Build: ${code(output.built || 'unknown')} · Container smoke: ${code(output.smoke || 'unknown')} · Platform: ${code('linux/amd64')}`, '');
    if (output.published) {
      if (output.latest === 'updated') {
        lines.push('**Copy into Railway → New service → Docker image** (tracks the newest published main image):', block(`${image}:latest`));
        lines.push('This run updated `latest`.');
      } else if (output.latest === 'superseded') {
        lines.push('A newer main commit owns `latest`; this run published its commit tag and did not update `latest`.');
      } else {
        lines.push('This run published its commit tag, but did not confirm updating `latest`. Check the image job logs.');
      }
      lines.push('', '**This run’s commit image** (paste into Railway to deploy this revision):', block(output.published));
      if (output.digest) lines.push('**Exact registry digest** (immutable reference):', block(output.digest));
    } else {
      lines.push('**No image publication confirmed for this run.** Pull requests build and test without publishing; failed or skipped jobs may not produce a deployable image.');
      lines.push('', 'For the newest image from a previous successful main publication:', block(`${image}:latest`));
    }
    lines.push(
      '',
      `[GHCR package](https://github.com/users/crvouga/packages/container/${job === 'image' ? 'atlas' : 'atlas-insecure'}) · [Railway deployment guide](${repo}/blob/${sha}/docs/deploying.md#run-it)`,
      '',
      '### Railway settings (no code or checkout required)',
      '',
      '| Setting | Value |',
      '| --- | --- |',
      '| Start command | Leave unset; server and viewer are included |',
      job === 'image' ? '| Variable | `ATLAS_TOKEN`: a random secret of at least 12 characters; use 48 or more |' : '| Authentication | No tokens needed. Leave `ATLAS_TOKEN`, `ATLAS_PUBLISH_TOKEN`, `ATLAS_READ_TOKEN` and config auth tokens unset |',
      '| Variable | `RAILWAY_RUN_UID=0` for Railway volume permissions |',
      '| Persistent volume | Mount at `/data`; one replica |',
      '| Healthcheck | `/readyz` |',
      '| Networking | Generate a public domain; Railway supplies `PORT`, leave `ATLAS_PORT` unset |',
      '| Auto updates (with `:latest`) | Settings → Source → Configure Auto Updates → Anytime |',
      '',
      job === 'image' ? 'Open the domain and sign in with the token as the password (any username). Image update detection can take a few hours.' : 'Open the domain directly. Anyone who discovers the URL can read, upload and change settings; an unlisted URL is not access control. Image update detection can take a few hours.',
      ''
    );
  }
  lines.push('## npm release', '');
  const release = needs.release;
  if (release?.outputs?.planned) {
    const planned = JSON.parse(release.outputs.planned) as { name: string; version: string }[];
    if (planned.length) {
      lines.push(release.result === 'success' ? 'Release job completed for:' : 'Planned versions (publication is not confirmed; inspect the Release logs):', '');
      for (const item of planned) lines.push(`- [${code(`${item.name}@${item.version}`)}](https://www.npmjs.com/package/${item.name}/v/${item.version})`);
    } else {
      lines.push(release.result === 'success' ? 'No new npm version planned; release reconciliation completed.' : 'No new npm version planned; release reconciliation did not complete successfully.');
    }
  } else {
    lines.push(`Release: ${code(release?.result ?? 'unknown')}. No release plan available.`);
  }
  lines.push('', `[GitHub releases](${repo}/releases) · [npm package](https://www.npmjs.com/package/@crvouga/atlas)`, '');
  return lines.join('\n');
}

if (import.meta.main) {
  const summary = renderSummary(JSON.parse(process.env.CI_NEEDS ?? '{}'), process.env);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  else console.log(summary);
}
