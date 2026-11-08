import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { adminAccess, nikount } from '../../db/schema.js';

/*
 * Accès SQL aux nikounts et aux accès admin.
 * Règle anti-IDOR : toute fonction qui lit une donnée d'un nikount prend le `nikountId`
 * issu du contexte d'authentification, jamais une valeur fournie par le client.
 */

export type NikountRow = typeof nikount.$inferSelect;
export type AdminAccessRow = typeof adminAccess.$inferSelect;

export async function insertNikount(
  db: Database,
  values: typeof nikount.$inferInsert,
): Promise<NikountRow> {
  const [row] = await db.insert(nikount).values(values).returning();
  if (!row) throw new Error('Insertion du nikount sans retour');
  return row;
}

export async function insertAdminAccess(
  db: Database,
  values: typeof adminAccess.$inferInsert,
): Promise<AdminAccessRow> {
  const [row] = await db.insert(adminAccess).values(values).returning();
  if (!row) throw new Error("Insertion de l'accès admin sans retour");
  return row;
}

export async function findNikount(db: Database, nikountId: string): Promise<NikountRow | null> {
  const [row] = await db.select().from(nikount).where(eq(nikount.id, nikountId));
  return row ?? null;
}

export async function findAdminAccess(
  db: Database,
  nikountId: string,
  adminId: string,
): Promise<AdminAccessRow | null> {
  const [row] = await db
    .select()
    .from(adminAccess)
    .where(and(eq(adminAccess.nikountId, nikountId), eq(adminAccess.id, adminId)));
  return row ?? null;
}

export async function findNikountIdByParticipantTokenHash(
  db: Database,
  tokenHash: Uint8Array,
): Promise<string | null> {
  const [row] = await db
    .select({ id: nikount.id })
    .from(nikount)
    .where(eq(nikount.participantTokenHash, tokenHash));
  return row?.id ?? null;
}

/** Accès admin actif (non révoqué) correspondant à l'empreinte du token. */
export async function findActiveAdminByTokenHash(
  db: Database,
  tokenHash: Uint8Array,
): Promise<{ id: string; nikountId: string } | null> {
  const [row] = await db
    .select({ id: adminAccess.id, nikountId: adminAccess.nikountId })
    .from(adminAccess)
    .where(and(eq(adminAccess.tokenHash, tokenHash), isNull(adminAccess.revokedAt)));
  return row ?? null;
}

/** Met à jour `last_used_at` au plus une fois par minute (évite une écriture par requête). */
export async function touchAdminAccess(db: Database, adminId: string): Promise<void> {
  await db
    .update(adminAccess)
    .set({ lastUsedAt: sql`now()` })
    .where(
      and(
        eq(adminAccess.id, adminId),
        or(
          isNull(adminAccess.lastUsedAt),
          lt(adminAccess.lastUsedAt, sql`now() - interval '1 minute'`),
        ),
      ),
    );
}
