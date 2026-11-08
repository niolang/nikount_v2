import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { buildApp } from '../src/app.js';
import type { Config } from '../src/config.js';
import type { Database } from '../src/db/client.js';
import { migrationsFolder } from '../src/db/migrate.js';
import * as schema from '../src/db/schema.js';

export const testConfig: Config = {
  NODE_ENV: 'test',
  API_HOST: '127.0.0.1',
  API_PORT: 0,
  DATABASE_URL: 'postgres://test:test@localhost:5432/test',
  LOG_LEVEL: 'silent',
  TRUST_PROXY: 0,
  PUBLIC_BASE_URL: 'http://localhost:5173',
};

export function buildTestApp(overrides: { checkDatabase?: () => Promise<boolean> } = {}) {
  return buildApp({
    config: testConfig,
    checkDatabase: overrides.checkDatabase ?? (() => Promise.resolve(true)),
  });
}

/**
 * Base PostgreSQL réelle (PGlite, en mémoire) avec toutes les migrations appliquées.
 * Mêmes contraintes, triggers et types que la production, sans Docker.
 */
export async function createTestDatabase(): Promise<{
  db: Database;
  client: PGlite;
  close: () => Promise<void>;
}> {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder });
  return { db, client, close: () => client.close() };
}
