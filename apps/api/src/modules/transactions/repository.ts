import { and, asc, desc, eq, inArray } from 'drizzle-orm';
import type { Database } from '../../db/client.js';
import {
  adminAccess,
  financialTransaction,
  participant,
  transactionRevision,
  transactionShare,
} from '../../db/schema.js';

/*
 * Accès SQL aux opérations. Toute lecture est bornée au `nikountId` du contexte d'accès :
 * l'identifiant d'une opération d'un autre nikount ne correspond à aucune ligne.
 */

export type TransactionRow = typeof financialTransaction.$inferSelect;
export type ShareRow = typeof transactionShare.$inferSelect;

export async function findTransaction(
  db: Database,
  nikountId: string,
  transactionId: string,
): Promise<TransactionRow | null> {
  const [row] = await db
    .select()
    .from(financialTransaction)
    .where(
      and(
        eq(financialTransaction.nikountId, nikountId),
        eq(financialTransaction.id, transactionId),
      ),
    );
  return row ?? null;
}

export async function findByClientRequestId(
  db: Database,
  nikountId: string,
  clientRequestId: string,
): Promise<TransactionRow | null> {
  const [row] = await db
    .select()
    .from(financialTransaction)
    .where(
      and(
        eq(financialTransaction.nikountId, nikountId),
        eq(financialTransaction.clientRequestId, clientRequestId),
      ),
    );
  return row ?? null;
}

/** Opérations du nikount, de la plus récente à la plus ancienne (date métier puis saisie). */
export async function listTransactions(db: Database, nikountId: string): Promise<TransactionRow[]> {
  return db
    .select()
    .from(financialTransaction)
    .where(eq(financialTransaction.nikountId, nikountId))
    .orderBy(desc(financialTransaction.occurredOn), desc(financialTransaction.createdAt));
}

/** Parts des opérations données, dans l'ordre d'affichage des participants. */
export async function listShares(
  db: Database,
  nikountId: string,
  transactionIds: string[],
): Promise<ShareRow[]> {
  if (transactionIds.length === 0) return [];
  const rows = await db
    .select({ share: transactionShare })
    .from(transactionShare)
    .innerJoin(
      participant,
      and(
        eq(participant.nikountId, transactionShare.nikountId),
        eq(participant.id, transactionShare.participantId),
      ),
    )
    .where(
      and(
        eq(transactionShare.nikountId, nikountId),
        inArray(transactionShare.transactionId, transactionIds),
      ),
    )
    .orderBy(asc(participant.sortOrder), asc(participant.id));
  return rows.map((row) => row.share);
}

export async function adminLabels(db: Database, nikountId: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: adminAccess.id, label: adminAccess.label })
    .from(adminAccess)
    .where(eq(adminAccess.nikountId, nikountId));
  return new Map(rows.map((row) => [row.id, row.label]));
}

export async function insertTransaction(
  db: Database,
  values: typeof financialTransaction.$inferInsert,
): Promise<TransactionRow> {
  const [row] = await db.insert(financialTransaction).values(values).returning();
  if (!row) throw new Error("Insertion de l'opération sans retour");
  return row;
}

export async function insertShares(
  db: Database,
  values: (typeof transactionShare.$inferInsert)[],
): Promise<ShareRow[]> {
  return db.insert(transactionShare).values(values).returning();
}

export async function insertRevision(
  db: Database,
  values: typeof transactionRevision.$inferInsert,
): Promise<void> {
  await db.insert(transactionRevision).values(values);
}

export async function listRevisions(
  db: Database,
  nikountId: string,
  transactionId: string,
): Promise<(typeof transactionRevision.$inferSelect)[]> {
  return db
    .select()
    .from(transactionRevision)
    .where(
      and(
        eq(transactionRevision.nikountId, nikountId),
        eq(transactionRevision.transactionId, transactionId),
      ),
    )
    .orderBy(asc(transactionRevision.revision));
}

/** Opérations données de CE nikount, verrouillées jusqu'à la fin de la transaction SQL. */
export async function lockTransactions(
  db: Database,
  nikountId: string,
  transactionIds: string[],
): Promise<TransactionRow[]> {
  if (transactionIds.length === 0) return [];
  return db
    .select()
    .from(financialTransaction)
    .where(
      and(
        eq(financialTransaction.nikountId, nikountId),
        inArray(financialTransaction.id, transactionIds),
      ),
    )
    .for('update');
}

/**
 * Change le statut seulement si l'opération est toujours dans l'état lu (statut ET version) :
 * `null` si quelqu'un l'a modifiée entre-temps.
 */
export async function updateStatus(
  db: Database,
  nikountId: string,
  current: Pick<TransactionRow, 'id' | 'status' | 'version'>,
  changes: Partial<typeof financialTransaction.$inferInsert>,
): Promise<TransactionRow | null> {
  const [row] = await db
    .update(financialTransaction)
    .set({ ...changes, version: current.version + 1, updatedAt: new Date() })
    .where(
      and(
        eq(financialTransaction.nikountId, nikountId),
        eq(financialTransaction.id, current.id),
        eq(financialTransaction.status, current.status),
        eq(financialTransaction.version, current.version),
      ),
    )
    .returning();
  return row ?? null;
}

/** Opérations données de CE nikount (lecture simple, sans verrou). */
export async function findTransactions(
  db: Database,
  nikountId: string,
  transactionIds: string[],
): Promise<TransactionRow[]> {
  if (transactionIds.length === 0) return [];
  return db
    .select()
    .from(financialTransaction)
    .where(
      and(
        eq(financialTransaction.nikountId, nikountId),
        inArray(financialTransaction.id, transactionIds),
      ),
    );
}
