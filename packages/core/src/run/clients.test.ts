import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Driver, StateImplementation, Timeline } from './types';
import { defineConfig, runConfig } from '../config';
import { combineDrivers, combineImplementations } from './clients';
import { type HttpClient, httpDriver } from './http';

/** A request that a customer sends, an operator approves on another device, and a partner system confirms over HTTP. */
const REQUEST = {
  id: 'Request',
  initial: 'Drafting',
  meta: { description: 'A request that crosses three clients.' },
  states: {
    Drafting: { meta: { description: 'The customer is writing it.' }, on: { 'Sends the request': 'Waiting for review' } },
    'Waiting for review': { meta: { description: 'In the operator queue.' }, on: { 'Operator approves': 'Approved' } },
    Approved: { meta: { description: 'The customer sees it approved.' }, on: { 'Partner confirms': 'Confirmed' } },
    Confirmed: { type: 'final', meta: { description: 'The operator sees the partner confirmation.' } }
  }
};

type Backend = { status: 'draft' | 'sent' | 'approved' | 'confirmed' };

/** A fake device: its screen is a line of text rendered from the shared backend. */
class Device {
  constructor(
    readonly backend: Backend,
    readonly view: (b: Backend) => string,
    readonly timeline: Timeline
  ) {}
  screen() {
    return this.view(this.backend);
  }
  tap(label: string, action: () => void) {
    this.timeline.add({ kind: 'tap', label });
    action();
  }
}

const opened: string[] = [];
const closed: string[] = [];

function deviceDriver(name: string, backend: Backend, view: (b: Backend) => string, fail = false): Driver<Device> {
  return {
    name,
    async open({ timeline }) {
      if (fail) throw new Error('no simulator booted');
      opened.push(name);
      return new Device(backend, view, timeline);
    },
    async close() {
      closed.push(name);
    },
    async screenshot(device, file) {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, device.screen());
      return { png: file };
    },
    text: async (device) => device.screen()
  };
}

const shows = (text: string): StateImplementation<Device> => ({
  recognize: async (d) => ({ matched: d.screen().includes(text), signals: [{ signal: text, expected: 'visible', visible: d.screen().includes(text) }] })
});

let specs: string;
let server: Server;
let partnerUrl: string;
const backend: Backend = { status: 'draft' };

beforeAll(async () => {
  specs = mkdtempSync(path.join(tmpdir(), 'atlas-clients-'));
  writeFileSync(path.join(specs, 'request.machine.json'), JSON.stringify(REQUEST));
  writeFileSync(path.join(specs, 'journeys.yaml'), 'journeys:\n  Gets approved:\n    events: [Sends the request, Operator approves, Partner confirms]\n    endsIn: [Confirmed]\n');
  server = createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/confirm') {
      backend.status = 'confirmed';
      res.writeHead(200, { 'content-type': 'application/json', 'set-cookie': 'session=abc; Path=/' }).end('{"ok":true}');
    } else res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const address = server.address();
  partnerUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

afterAll(async () => {
  rmSync(specs, { recursive: true, force: true });
  await new Promise((r) => server.close(r));
});

type Clients = { customer: Device; operator: Device; partner: HttpClient };

const implementation = combineImplementations<Clients>(
  {
    customer: {
      events: { 'Sends the request': { kind: 'user', how: 'Taps Send.', run: async (d) => d.tap('Send', () => (d.backend.status = 'sent')) } },
      states: { Drafting: shows('Draft'), 'Waiting for review': shows('Sent'), Approved: shows('Approved') }
    },
    operator: {
      events: { 'Operator approves': { kind: 'user', how: 'Taps Approve in the queue.', run: async (d) => d.tap('Approve', () => (d.backend.status = 'approved')) } },
      states: { Confirmed: shows('Partner confirmed') }
    },
    partner: {
      events: {
        'Partner confirms': {
          kind: 'system',
          how: 'POSTs /confirm as the partner.',
          async run(http) {
            const response = await http.post('/confirm', { id: 1 });
            if (!response.ok) throw new Error(`/confirm answered ${response.status}`);
          }
        }
      }
    }
  },
  {
    async setup() {
      backend.status = 'draft';
    }
  }
);

const config = (options: { failOperator?: boolean; screens?: 'focused' | 'all' } = {}) =>
  defineConfig<Clients>({
    specs: '.',
    driver: combineDrivers<Clients>(
      {
        customer: deviceDriver('phone', backend, (b) => (b.status === 'draft' ? 'Draft' : b.status === 'sent' ? 'Sent' : 'Approved')),
        operator: deviceDriver('desk', backend, (b) => (b.status === 'confirmed' ? 'Partner confirmed' : `Queue: ${b.status}`), options.failOperator),
        partner: httpDriver(() => partnerUrl, { name: 'partner-api' })
      },
      { screens: options.screens }
    ),
    implementation,
    targets: []
  });

describe('a run across several clients', () => {
  it('drives each event on its client and shoots each state on the client that shows it', async () => {
    const output = mkdtempSync(path.join(tmpdir(), 'atlas-clients-out-'));
    const { manifest, ok } = await runConfig(config({ screens: 'all' }), { output, retry: false, log: () => undefined }, specs);
    expect(ok).toBe(true);
    expect(manifest.run.environment).toMatchObject({ driver: 'customer:phone + operator:desk + partner:partner-api', clients: { customer: 'phone', operator: 'desk', partner: 'partner-api' } });

    const approved = manifest.states['Approved']!;
    expect(approved).toMatchObject({ status: 'passed', client: 'customer' });
    expect(approved.screenshot).toMatchObject({ client: 'customer', also: [{ client: 'operator' }] });
    expect(readFileSync(path.join(output, manifest.run.id, approved.screenshot!.png), 'utf8')).toBe('Approved');
    expect(approved.screenshot!.also![0]!.png).toMatch(/\/operator\/\d+\.png$/);
    expect(manifest.states['Confirmed']!.screenshot).toMatchObject({ client: 'operator', also: [{ client: 'customer' }] });

    const approve = manifest.transitions['Waiting for review :: Operator approves']!;
    expect(approve).toMatchObject({ status: 'passed', client: 'operator' });
    const confirm = manifest.transitions['Approved :: Partner confirms']!;
    expect(confirm.client).toBe('partner');
    expect(manifest.paths.every((p) => p.status === 'passed')).toBe(true);
    rmSync(output, { recursive: true, force: true });
  });

  it('closes the clients that opened when one cannot, and names it', async () => {
    opened.length = 0;
    closed.length = 0;
    const output = mkdtempSync(path.join(tmpdir(), 'atlas-clients-out-'));
    const { manifest } = await runConfig(config({ failOperator: true }), { output, retry: false, log: () => undefined }, specs);
    const attempt = manifest.paths[0]!.attempts[0]!;
    expect(attempt.error).toContain('The "operator" client could not open: no simulator booted');
    expect(closed).toEqual(opened);
    rmSync(output, { recursive: true, force: true });
  });

  it('tags timeline entries with the client that made them', async () => {
    const output = mkdtempSync(path.join(tmpdir(), 'atlas-clients-out-'));
    const { manifest } = await runConfig(config(), { output, retry: false, mode: 'fast', log: () => undefined }, specs);
    const clients = Object.values(manifest.transitions).map((t) => t.timeline.map((e) => e.client));
    expect(clients.flat()).toEqual(expect.arrayContaining(['customer', 'operator', 'partner']));
    rmSync(output, { recursive: true, force: true });
  });

  it('refuses an event implemented by two clients', () => {
    const run = { kind: 'user' as const, how: 'x', run: async () => undefined };
    expect(() => combineImplementations<{ a: unknown; b: unknown }>({ a: { events: { Taps: run } }, b: { events: { Taps: run } } })).toThrow(
      'event "Taps" is implemented by both "a" and "b"'
    );
  });
});
