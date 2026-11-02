/** @module Workspace sharing
 * View a checkout's dev server from another machine (a T3 Code client, a laptop, a phone) without exposing it
 * publicly. Atlas binds 127.0.0.1 only; `tailscale serve` puts each running target behind HTTPS on the machine's
 * private tailnet name. Nothing here starts a public tunnel.
 */
import { existsSync } from 'node:fs';

/** Where the Tailscale CLI lives: on PATH, or inside the macOS app bundle. */
export function tailscaleBinary(): string | null {
  const app = '/Applications/Tailscale.app/Contents/MacOS/Tailscale';
  return Bun.which('tailscale', { PATH: process.env.PATH ?? '' }) ?? (existsSync(app) ? app : null);
}

async function tailscale(args: string[]): Promise<{ code: number; out: string; err: string }> {
  const binary = tailscaleBinary();
  if (!binary) return { code: 127, out: '', err: 'Tailscale is not installed.' };
  const child = Bun.spawn([binary, ...args], { stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' });
  const timer = setTimeout(() => child.kill(), 10_000);
  const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  clearTimeout(timer);
  // The CLI warns about client/daemon version skew on stderr; that is not a failure.
  return { code, out, err: err.split('\n').filter((line) => line && !line.startsWith('Warning: client version')).join('\n') };
}

/** This machine's tailnet state, or why it cannot share. */
export async function tailnet(): Promise<{ host: string; https: boolean } | { problem: string }> {
  const status = await tailscale(['status', '--json']);
  if (status.code === 127) return { problem: 'Tailscale is not installed. Install it from https://tailscale.com/download and sign in.' };
  let parsed: { BackendState?: string; Self?: { DNSName?: string }; CertDomains?: string[] | null };
  try {
    parsed = JSON.parse(status.out);
  } catch {
    return { problem: `Tailscale did not report its status${status.err ? `: ${status.err}` : ''}. Is the Tailscale app running?` };
  }
  const host = parsed.Self?.DNSName?.replace(/\.$/, '');
  if (parsed.BackendState !== 'Running' || !host) return { problem: `Tailscale is ${parsed.BackendState ?? 'not running'}. Sign in with "tailscale up".` };
  return { host, https: (parsed.CertDomains ?? []).includes(host) };
}

/**
 * Hostnames the dev viewer should accept: `ATLAS_DEV_ALLOWED_HOSTS` when set, else this machine's own tailnet name
 * when Tailscale is up. Only that exact name is added; it resolves only inside the tailnet.
 */
export async function devAllowedHosts(env = process.env): Promise<string | undefined> {
  if (env.ATLAS_DEV_ALLOWED_HOSTS !== undefined) return env.ATLAS_DEV_ALLOWED_HOSTS;
  if (!tailscaleBinary()) return undefined;
  const state = await tailnet();
  return 'host' in state ? state.host : undefined;
}

/** How to reach a port when Tailscale cannot be used: an SSH forward from the viewing machine. */
export function sshHint(port: number): string {
  const user = process.env.USER ?? 'you';
  const machine = process.env.HOSTNAME || (Bun.spawnSync(['hostname']).stdout.toString().trim() || 'this-machine');
  return `ssh -N -L ${port}:127.0.0.1:${port} ${user}@${machine}  then open http://127.0.0.1:${port}`;
}

type ServeStatus = { Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }> };

/** Tailnet links currently serving these loopback ports, keyed by port. */
export async function sharedLinks(ports: number[]): Promise<Map<number, string>> {
  const links = new Map<number, string>();
  if (!ports.length || !tailscaleBinary()) return links;
  const result = await tailscale(['serve', 'status', '--json']);
  let status: ServeStatus = {};
  try {
    status = JSON.parse(result.out || '{}');
  } catch {
    return links;
  }
  for (const [address, web] of Object.entries(status.Web ?? {})) {
    const proxy = web.Handlers?.['/']?.Proxy;
    const port = ports.find((item) => proxy === `http://127.0.0.1:${item}`);
    if (port !== undefined && address.endsWith(`:${port}`)) links.set(port, `https://${address.replace(/:443$/, '')}/`);
  }
  return links;
}

/** Serve each port on the tailnet under the same port number; returns the private links. */
export async function sharePorts(ports: number[]): Promise<string[]> {
  const state = await tailnet();
  if ('problem' in state) throw new Error(`${state.problem}\nWithout Tailscale, forward the port over SSH instead:\n  ${ports.map(sshHint).join('\n  ')}`);
  if (!state.https)
    throw new Error('Tailscale HTTPS certificates are off for this tailnet. Turn on MagicDNS and HTTPS in the Tailscale admin console (DNS page), then retry.');
  const links: string[] = [];
  for (const port of ports) {
    const result = await tailscale(['serve', '--bg', `--https=${port}`, `http://127.0.0.1:${port}`]);
    if (result.code !== 0) throw new Error(`tailscale serve failed for port ${port}: ${result.err || result.out}`);
    links.push(`https://${state.host}:${port}/`);
  }
  return links;
}

/** Stop serving these ports, but only where the tailnet entry still points at the same loopback port. */
export async function unsharePorts(ports: number[]): Promise<number[]> {
  const shared = await sharedLinks(ports);
  for (const port of shared.keys()) await tailscale(['serve', `--https=${port}`, 'off']);
  return [...shared.keys()];
}
