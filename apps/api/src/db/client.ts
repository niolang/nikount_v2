import pg from 'pg';
import { sql, type SQL } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import * as schema from './schema.js';

/**
 * Type de base commun au driver de production (node-postgres) et au driver de test (PGlite) :
 * les repositories ne dépendent que de lui.
 */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DatabaseHandle {
  db: Database;
  close: () => Promise<void>;
}

export function createDatabase(databaseUrl: string): DatabaseHandle {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
  const db = drizzle({ client: pool, schema });
  return { db, close: () => pool.end() };
}

/**
 * Exécute une requête SQL brute et renvoie ses lignes. node-postgres et PGlite exposent tous
 * deux `rows` ; le type générique `Database` ne le sait pas, d'où cette vérification.
 */
export async function queryRows<T>(db: Database, query: SQL): Promise<T[]> {
  const result: unknown = await db.execute(query);
  if (
    typeof result === 'object' &&
    result !== null &&
    Array.isArray((result as { rows?: unknown }).rows)
  ) {
    return (result as { rows: T[] }).rows;
  }
  throw new Error('Résultat SQL inattendu (pas de champ rows)');
}

export async function isDatabaseUp(db: Database): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}
