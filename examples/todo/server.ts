import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * The todo example's server: it serves the static app, keeps the list, and announces business
 * events as CloudEvents (structured mode) to `eventSink`, the way a product's event bus or webhook
 * relay would. `/control/*` endpoints exist for tests only: they reset the server and make the next
 * sync checks fail (one, or `{ "checks": n }`), so a test can trigger a system event through a real HTTP call.
 */

/** Business event name (as written in the charts' `meta.events`) → CloudEvent `type`. */
export const EVENT_TYPES = {
  'List created': 'example.todo.list.created',
  'Todo added': 'example.todo.item.added',
  'Todos completed': 'example.todo.items.completed',
  'Completed todos cleared': 'example.todo.items.cleared',
  'Sync interrupted': 'example.todo.sync.interrupted',
  'Changes synced': 'example.todo.sync.completed',
  'List discarded': 'example.todo.list.discarded'
} as const;

export const DEFAULT_LIST_NAME = 'My todos';
export const RETRY_AFTER_MS = 30_000;

type BusinessEvent = keyof typeof EVENT_TYPES;
type Todo = { title: string; done: boolean };
type Op = { type: 'add'; title: string } | { type: 'complete-all' } | { type: 'clear-completed' };

export type TodoServer = { url: string; close(): Promise<void> };

const here = path.dirname(fileURLToPath(import.meta.url));
const STATIC: Record<string, { file: string; type: string }> = {
  '/': { file: 'index.html', type: 'text/html; charset=utf-8' },
  '/app.js': { file: 'app.js', type: 'text/javascript; charset=utf-8' },
  '/styles.css': { file: 'styles.css', type: 'text/css; charset=utf-8' }
};

function readJson(req: IncomingMessage) {
  return new Promise<unknown>((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => (body += chunk));
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body?: unknown) {
  if (body === undefined) return void res.writeHead(status).end();
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

function isOp(value: unknown): value is Op {
  if (!value || typeof value !== 'object') return false;
  const op = value as Record<string, unknown>;
  return (op.type === 'add' && typeof op.title === 'string') || op.type === 'complete-all' || op.type === 'clear-completed';
}

export async function startTodoServer(options: { port?: number; host?: string; eventSink?: string } = {}): Promise<TodoServer> {
  const host = options.host ?? '127.0.0.1';
  let listName: string | null = null;
  let todos: Todo[] = [];
  let syncFailuresArmed = 0;

  const emit = async (event: BusinessEvent, data: Record<string, unknown> = {}) => {
    if (!options.eventSink) return;
    const cloudEvent = {
      specversion: '1.0',
      id: randomUUID(),
      source: '/examples/todo',
      type: EVENT_TYPES[event],
      time: new Date().toISOString(),
      datacontenttype: 'application/json',
      data
    };
    await fetch(options.eventSink, {
      method: 'POST',
      headers: { 'content-type': 'application/cloudevents+json' },
      body: JSON.stringify(cloudEvent)
    }).catch(() => undefined);
  };

  const apply = async (op: Op) => {
    if (op.type === 'add') {
      todos.push({ title: op.title, done: false });
      await emit('Todo added', { open: todos.filter((t) => !t.done).length });
    } else if (op.type === 'complete-all') {
      todos = todos.map((t) => ({ ...t, done: true }));
      await emit('Todos completed', { count: todos.length });
    } else {
      const before = todos.length;
      todos = todos.filter((t) => !t.done);
      await emit('Completed todos cleared', { cleared: before - todos.length });
    }
  };

  const reset = () => {
    listName = null;
    todos = [];
    syncFailuresArmed = 0;
  };

  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const route = `${req.method} ${url.pathname}`;
    const asset = req.method === 'GET' ? STATIC[url.pathname] : undefined;
    if (asset) {
      res.writeHead(200, { 'content-type': asset.type, 'cache-control': 'no-store' });
      return void res.end(await readFile(path.join(here, 'app', asset.file)));
    }
    switch (route) {
      case 'GET /api/list':
        return send(res, 200, { listName, todos });
      case 'POST /api/setup': {
        const body = (await readJson(req)) as { name?: unknown };
        listName = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : DEFAULT_LIST_NAME;
        todos = [];
        await emit('List created', { named: listName !== DEFAULT_LIST_NAME });
        return send(res, 200, { listName, todos });
      }
      case 'POST /api/ops': {
        const body = (await readJson(req)) as { ops?: unknown; retry?: unknown };
        const ops = Array.isArray(body.ops) ? body.ops.filter(isOp) : [];
        for (const op of ops) await apply(op);
        if (body.retry === true) await emit('Changes synced', { applied: ops.length });
        return send(res, 200, { todos });
      }
      case 'GET /api/sync-status': {
        if (syncFailuresArmed === 0) return send(res, 200, { ok: true });
        syncFailuresArmed -= 1;
        await emit('Sync interrupted');
        return send(res, 503, { ok: false, retryAfterMs: RETRY_AFTER_MS });
      }
      case 'POST /api/reset':
        reset();
        await emit('List discarded');
        return send(res, 204);
      case 'POST /control/reset':
        reset();
        return send(res, 204);
      case 'POST /control/sync-failure': {
        const body = (await readJson(req)) as { checks?: unknown };
        syncFailuresArmed = typeof body.checks === 'number' && body.checks > 0 ? Math.floor(body.checks) : 1;
        return send(res, 202);
      }
      default:
        return send(res, 404, { error: 'not found' });
    }
  };

  const server = createServer((req, res) => {
    handle(req, res).catch(() => {
      if (!res.headersSent) send(res, 400, { error: 'bad request' });
      else res.end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, host, resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : options.port;
  return {
    url: `http://${host}:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      })
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = await startTodoServer({ port: Number(process.env.PORT ?? 4317), eventSink: process.env.EVENT_SINK });
  process.stdout.write(`Todo example at ${server.url}\n`);
}
