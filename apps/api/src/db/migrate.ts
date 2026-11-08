import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { loadConfig } from '../config.js';
import type { Database } from './client.js';

/**
 * Applique les migrations en attente. Lancé explicitement au déploiement
 * (`pnpm --filter @nikount/api db:migrate`), jamais implicitement au démarrage de l'API.
 */
export const migrationsFolder = fileURLToPath(new URL('./migrations', import.meta.url));

const ROLE_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

/**
 * Droits du rôle applicatif (docs/security.md §10) : lecture et écriture des données, sans
 * aucun droit DDL (il ne possède ni le schéma ni les tables). Moindre privilège :
 * - aucune suppression, sauf des parts (remplacées lors d'une modification d'opération) ;
 * - journal d'audit et révisions en ajout seul (les triggers l'imposent aussi).
 * Réappliqué après chaque migration, pour couvrir les tables nouvelles.
 */
export async function grantApplicationRole(db: Database, role: string): Promise<void> {
  if (!ROLE_NAME.test(role)) throw new Error(`Nom de rôle invalide : ${role}`);
  const r = sql.identifier(role);
  await db.execute(sql`grant usage on schema public to ${r}`);
  await db.execute(sql`grant select, insert, update on all tables in schema public to ${r}`);
  await db.execute(sql`revoke update on audit_event, transaction_revision from ${r}`);
  await db.execute(sql`revoke delete, truncate on all tables in schema public from ${r}`);
  await db.execute(sql`grant delete on transaction_share to ${r}`);
  await db.execute(sql`grant usage, select on all sequences in schema public to ${r}`);
}

async function main(): Promise<void> {
  const config = loadConfig();
  const client = new pg.Client({ connectionString: config.DATABASE_URL });
  await client.connect();
  try {
    const db = drizzle({ client });
    await migrate(db, { migrationsFolder });
    console.log('Migrations appliquées.');
    const appRole = process.env['DATABASE_APP_ROLE'];
    if (appRole) {
      await grantApplicationRole(db as unknown as Database, appRole);
      console.log(`Droits du rôle applicatif « ${appRole} » appliqués.`);
    }
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
