import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { loadConfig } from '../config.js';

/**
 * Applique les migrations en attente. Lancé explicitement au déploiement
 * (`pnpm --filter @nikount/api db:migrate`), jamais implicitement au démarrage de l'API.
 */
export const migrationsFolder = fileURLToPath(new URL('./migrations', import.meta.url));

async function main(): Promise<void> {
  const config = loadConfig();
  const client = new pg.Client({ connectionString: config.DATABASE_URL });
  await client.connect();
  try {
    await migrate(drizzle({ client }), { migrationsFolder });
    console.log('Migrations appliquées.');
  } finally {
    await client.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
