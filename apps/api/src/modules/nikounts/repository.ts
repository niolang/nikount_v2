import { and, asc, count, eq, isNull, lt, or, sql } from 'drizzle-orm';
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

/**
 * Verrou de ligne sur le nikount, pris dans une transaction :
 * - `update` par les changements d'état et la gestion des admins (sérialisés entre eux) ;
 * - `share` par les écritures qui dépendent de l'état (opérations, participants), pour qu'une
 *   clôture ne puisse pas se glisser entre leur vérification d'état et leur écriture.
 */
export type NikountLock = 'update' | 'share';

export async function findNikount(
  db: Database,
  nikountId: string,
  lock?: NikountLock,
): Promise<NikountRow | null> {
  const query = db.select().from(nikount).where(eq(nikount.id, nikountId));
  const [row] = lock ? await query.for(lock) : await query;
  return row ?? null;
}

/** Met à jour le nikount si sa version n'a pas changé ; `null` sinon (conflit). */
export async function updateNikount(
  db: Database,
  nikountId: string,
  version: number,
  changes: Partial<Pick<NikountRow, 'name' | 'state'>> & { stateChanged?: boolean },
): Promise<NikountRow | null> {
  const { stateChanged, ...values } = changes;
  const [row] = await db
    .update(nikount)
    .set({
      ...values,
      ...(stateChanged ? { stateChangedAt: sql`now()` } : {}),
      version: sql`${nikount.version} + 1`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(nikount.id, nikountId), eq(nikount.version, version)))
    .returning();
  return row ?? null;
}

/** Remplace le lien participant : l'ancien token ne résout plus rien dès la validation. */
export async function replaceParticipantToken(
  db: Database,
  nikountId: string,
  values: { participantTokenHash: Uint8Array; participantTokenCiphertext: Uint8Array },
): Promise<void> {
  await db
    .update(nikount)
    .set({ ...values, participantTokenRotatedAt: sql`now()`, updatedAt: sql`now()` })
    .where(eq(nikount.id, nikountId));
}

export async function listAdmins(db: Database, nikountId: string): Promise<AdminAccessRow[]> {
  return db
    .select()
    .from(adminAccess)
    .where(eq(adminAccess.nikountId, nikountId))
    .orderBy(asc(adminAccess.createdAt), asc(adminAccess.id));
}

export async function countActiveAdmins(db: Database, nikountId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(adminAccess)
    .where(and(eq(adminAccess.nikountId, nikountId), isNull(adminAccess.revokedAt)));
  return row?.n ?? 0;
}

export async function revokeAdmin(
  db: Database,
  nikountId: string,
  adminId: string,
): Promise<AdminAccessRow | null> {
  const [row] = await db
    .update(adminAccess)
    .set({ revokedAt: sql`now()` })
    .where(
      and(
        eq(adminAccess.nikountId, nikountId),
        eq(adminAccess.id, adminId),
        isNull(adminAccess.revokedAt),
      ),
    )
    .returning();
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
