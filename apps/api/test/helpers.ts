import { randomBytes } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { buildApp, type AppDependencies } from '../src/app.js';
import type { Config } from '../src/config.js';
import type { Database } from '../src/db/client.js';
import { migrationsFolder } from '../src/db/migrate.js';
import * as schema from '../src/db/schema.js';
import type { AppInstance } from '../src/lib/types.js';

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    NODE_ENV: 'test',
    API_HOST: '127.0.0.1',
    API_PORT: 0,
    DATABASE_URL: 'postgres://test:test@localhost:5432/test',
    LOG_LEVEL: 'silent',
    TRUST_PROXY: 0,
    PUBLIC_BASE_URL: 'http://localhost:5173',
    TOKEN_ENCRYPTION_KEY: randomBytes(32),
    RATE_LIMIT_CREATE_PER_HOUR: 1000,
    AUTH_FAILURE_MAX: 1000,
    AUTH_FAILURE_WINDOW_MINUTES: 10,
    AUTH_FAILURE_BLOCK_MINUTES: 15,
    ...overrides,
  };
}

export interface TestDatabase {
  db: Database;
  client: PGlite;
  close: () => Promise<void>;
}

/**
 * Base PostgreSQL réelle (PGlite, en mémoire) avec toutes les migrations appliquées.
 * Mêmes contraintes, triggers et types que la production, sans Docker.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const client = new PGlite();
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder });
  return { db, client, close: () => client.close() };
}

export function buildTestApp(
  db: Database,
  options: { config?: Partial<Config> } & Omit<Partial<AppDependencies>, 'config' | 'db'> = {},
): Promise<AppInstance> {
  const { config, ...rest } = options;
  return buildApp({ config: testConfig(config), db, ...rest });
}

export const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

/** Crée un nikount via l'API et renvoie la réponse (tokens compris). */
export async function createNikountViaApi(
  app: AppInstance,
  body: Record<string, unknown> = { name: 'Weekend Chamonix', adminLabel: 'Nicolas' },
) {
  const response = await app.inject({ method: 'POST', url: '/api/v1/nikounts', payload: body });
  if (response.statusCode !== 201) {
    throw new Error(`Création échouée : ${String(response.statusCode)} ${response.body}`);
  }
  return response.json<{
    nikount: { name: string; currency: string; state: string };
    admin: { id: string; label: string; participantId: string | null };
    participantToken: string;
    adminToken: string;
  }>();
}
