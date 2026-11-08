import { and, asc, count, eq, max, sql } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import { participant } from '../../db/schema.js';

/*
 * Accès SQL aux participants. Chaque fonction est bornée au `nikountId` du contexte d'accès :
 * un identifiant de participant d'un autre nikount ne correspond simplement à aucune ligne.
 */

export type ParticipantRow = typeof participant.$inferSelect;

export async function listParticipants(db: Database, nikountId: string): Promise<ParticipantRow[]> {
  return db
    .select()
    .from(participant)
    .where(eq(participant.nikountId, nikountId))
    .orderBy(asc(participant.sortOrder), asc(participant.id));
}

export async function findParticipant(
  db: Database,
  nikountId: string,
  participantId: string,
): Promise<ParticipantRow | null> {
  const [row] = await db
    .select()
    .from(participant)
    .where(and(eq(participant.nikountId, nikountId), eq(participant.id, participantId)));
  return row ?? null;
}

export async function countParticipants(db: Database, nikountId: string): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(participant)
    .where(eq(participant.nikountId, nikountId));
  return row?.total ?? 0;
}

export async function nextSortOrder(db: Database, nikountId: string): Promise<number> {
  const [row] = await db
    .select({ highest: max(participant.sortOrder) })
    .from(participant)
    .where(eq(participant.nikountId, nikountId));
  return row?.highest === null || row?.highest === undefined ? 0 : row.highest + 1;
}

export async function insertParticipants(
  db: Database,
  values: (typeof participant.$inferInsert)[],
): Promise<ParticipantRow[]> {
  if (values.length === 0) return [];
  return db.insert(participant).values(values).returning();
}

/**
 * Modification avec verrouillage optimiste : ne s'applique que si `version` correspond encore.
 * Retourne `null` si la ligne n'existe pas dans ce nikount ou si la version a changé.
 */
export async function updateParticipant(
  db: Database,
  nikountId: string,
  participantId: string,
  expectedVersion: number,
  changes: Partial<Pick<ParticipantRow, 'name' | 'isActive' | 'sortOrder'>>,
): Promise<ParticipantRow | null> {
  const [row] = await db
    .update(participant)
    .set({ ...changes, version: sql`${participant.version} + 1`, updatedAt: sql`now()` })
    .where(
      and(
        eq(participant.nikountId, nikountId),
        eq(participant.id, participantId),
        eq(participant.version, expectedVersion),
      ),
    )
    .returning();
  return row ?? null;
}
