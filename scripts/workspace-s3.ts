/** @module Workspace S3 service
 * Local development storage speaks the real S3 protocol. Mockingbird owns its file-backed
 * database; Atlas still reads and writes only through its existing S3 store.
 */
import { Database, type SQLQueryBindings } from 'bun:sqlite';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from '@crvouga/mockingbird-service-s3/server';
import type { S3RuntimeOptions } from '@crvouga/mockingbird-service-s3';

type Sqlite = NonNullable<S3RuntimeOptions['sqlite']>;

/** Adapt Bun's synchronous SQLite transactions and bind values to Mockingbird's documented port. */
function sqlitePort(db: Database): Sqlite {
  return {
    exec: (sql) => { db.exec(sql); },
    transaction: (fn) => db.transaction(fn)(),
    prepare(sql) {
      const statement = db.prepare(sql);
      const bind = (values: Parameters<ReturnType<Sqlite['prepare']>['run']>) => values.map((value) => typeof value === 'boolean' ? Number(value) : value) as SQLQueryBindings[];
      return {
        run: (...values) => statement.run(...bind(values)),
        all: <T>(...values: Parameters<ReturnType<Sqlite['prepare']>['run']>) => statement.all(...bind(values)) as T[],
        get: <T>(...values: Parameters<ReturnType<Sqlite['prepare']>['run']>) => (statement.get(...bind(values)) ?? undefined) as T | undefined
      };
    }
  };
}

/** Start a checkout-private persistent S3 emulator; closing it never deletes its bucket or objects. */
export async function startWorkspaceS3(root: string) {
  const directory = path.join(root, '.atlas-workspace', 's3');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const dataFile = path.join(directory, 'storage.sqlite');
  const db = new Database(dataFile, { create: true });
  let server: Awaited<ReturnType<typeof createServer>> | undefined;
  try {
    db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; PRAGMA busy_timeout = 5000;');
    server = await createServer({
      host: '127.0.0.1', port: 0, sqlite: sqlitePort(db), buckets: ['atlas-workspace'],
      credentials: { fixture: 'fixture' }, authentication: 'strict', region: 'us-east-1', virtualHosts: []
    });
    return {
      storage: { kind: 'mockingbird' as const, endpoint: server.url, bucket: 'atlas-workspace', dataFile },
      env: {
        ATLAS_S3_ENDPOINT: server.url,
        ATLAS_S3_BUCKET: 'atlas-workspace',
        ATLAS_S3_REGION: 'us-east-1',
        ATLAS_S3_ACCESS_KEY_ID: 'fixture',
        ATLAS_S3_SECRET_ACCESS_KEY: 'fixture',
        ATLAS_S3_PATH_STYLE: '1'
      },
      async close() {
        try { await server!.close(); } finally { db.close(); }
      }
    };
  } catch (error) {
    await server?.close();
    db.close();
    throw error;
  }
}
