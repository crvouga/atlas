import { afterEach, beforeEach, expect, test } from 'bun:test';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { devAllowedHosts, sharedLinks, sharePorts, unsharePorts } from './workspace-share';

// A fake `tailscale` on PATH: it answers from state files and logs every call, so no tailnet is touched.
let dir = '';
let savedPath: string | undefined;
let savedHosts: string | undefined;
const host = 'devbox.example-tailnet.ts.net';

async function fake(status: object, serve: object) {
  await writeFile(path.join(dir, 'status.json'), JSON.stringify(status));
  await writeFile(path.join(dir, 'serve.json'), JSON.stringify(serve));
}
const calls = async () => (await readFile(path.join(dir, 'calls.log'), 'utf8').catch(() => '')).trim().split('\n').filter(Boolean);
const running = (https = true) => ({ BackendState: 'Running', Self: { DNSName: `${host}.` }, CertDomains: https ? [host] : null });

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'atlas-share-'));
  const script = `#!/bin/sh
echo "$*" >> "${dir}/calls.log"
case "$1 $2" in
  "status --json") cat "${dir}/status.json" ;;
  "serve status") cat "${dir}/serve.json" ;;
esac
`;
  await writeFile(path.join(dir, 'tailscale'), script);
  await chmod(path.join(dir, 'tailscale'), 0o755);
  savedPath = process.env.PATH;
  savedHosts = process.env.ATLAS_DEV_ALLOWED_HOSTS;
  process.env.PATH = `${dir}${path.delimiter}${savedPath ?? ''}`;
  delete process.env.ATLAS_DEV_ALLOWED_HOSTS;
});

afterEach(async () => {
  process.env.PATH = savedPath;
  if (savedHosts === undefined) delete process.env.ATLAS_DEV_ALLOWED_HOSTS;
  else process.env.ATLAS_DEV_ALLOWED_HOSTS = savedHosts;
  await rm(dir, { recursive: true, force: true });
});

test('the viewer accepts exactly this machine\'s tailnet name, unless the hosts are set explicitly', async () => {
  await fake(running(), {});
  expect(await devAllowedHosts()).toBe(host);
  expect(await devAllowedHosts({ ATLAS_DEV_ALLOWED_HOSTS: 'example.test' })).toBe('example.test');
  await fake({ BackendState: 'NeedsLogin' }, {});
  expect(await devAllowedHosts()).toBeUndefined();
});

test('sharing serves each loopback port on the same tailnet port and returns private links', async () => {
  await fake(running(), {});
  expect(await sharePorts([5180, 5181])).toEqual([`https://${host}:5180/`, `https://${host}:5181/`]);
  const serves = (await calls()).filter((line) => line.startsWith('serve --bg'));
  expect(serves).toEqual(['serve --bg --https=5180 http://127.0.0.1:5180', 'serve --bg --https=5181 http://127.0.0.1:5181']);
});

test('sharing explains what to fix instead of half-working', async () => {
  await fake(running(false), {});
  await expect(sharePorts([5180])).rejects.toThrow('HTTPS certificates are off');
  await fake({ BackendState: 'Stopped' }, {});
  await expect(sharePorts([5180])).rejects.toThrow(/Tailscale is Stopped[\s\S]*ssh -N -L 5180:127\.0\.0\.1:5180/);
  expect((await calls()).some((line) => line.startsWith('serve --bg'))).toBe(false);
});

test('unsharing removes only entries that still point at this checkout\'s ports', async () => {
  await fake(running(), {
    Web: {
      [`${host}:443`]: { Handlers: { '/': { Proxy: 'http://127.0.0.1:3773' } } },
      [`${host}:5180`]: { Handlers: { '/': { Proxy: 'http://127.0.0.1:5180' } } },
      // Port 5182 on the tailnet now forwards elsewhere: someone else's entry, never ours to remove.
      [`${host}:5182`]: { Handlers: { '/': { Proxy: 'http://127.0.0.1:9999' } } }
    }
  });
  expect(await sharedLinks([5180, 5182, 3773])).toEqual(new Map([[5180, `https://${host}:5180/`]]));
  expect(await unsharePorts([5180, 5182, 3773])).toEqual([5180]);
  expect((await calls()).filter((line) => line.endsWith(' off'))).toEqual(['serve --https=5180 off']);
});

test('doctor reports what blocks Dev separately from what only limits remote viewing', async () => {
  const { diagnoseWorkspace } = await import('./workspace-doctor');
  const repo = path.resolve(import.meta.dir, '..');
  await fake(running(false), {});
  const findings = await diagnoseWorkspace(repo, [], false);
  expect(findings.find((item) => item.check === 'bun')?.level).toBe('ok');
  expect(findings.find((item) => item.check === 'dependencies')).toMatchObject({ level: 'warn', fix: 'bun run dev --setup' });
  expect(findings.find((item) => item.check === 'remote viewing')).toMatchObject({ level: 'warn', detail: expect.stringContaining('HTTPS certificates are off') });
  expect(findings.some((item) => item.level === 'fail')).toBe(false);
});
