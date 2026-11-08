import { sql } from 'drizzle-orm';
import { queryRows, type Database } from '../../db/client.js';

/**
 * Soldes calculés EN SQL, à la lecture, sans table de soldes (rien à désynchroniser) —
 * docs/data-model.md §4. Les tests vérifient que ce calcul est identique à celui de
 * `@nikount/core` (computeBalances) sur des jeux de données variés.
 */
export async function balancesByParticipant(
  db: Database,
  nikountId: string,
): Promise<{ participantId: string; balance: number }[]> {
  const rows = await queryRows<{ participant_id: string; balance: string | number }>(
    db,
    sql`
    with paid as (
      select payer_id as participant_id, sum(amount) as total
      from "transaction"
      where nikount_id = ${nikountId} and status = 'VALIDATED'
      group by payer_id
    ), owed as (
      select s.participant_id, sum(s.amount) as total
      from transaction_share s
      join "transaction" t on t.id = s.transaction_id and t.nikount_id = s.nikount_id
      where s.nikount_id = ${nikountId} and t.status = 'VALIDATED'
      group by s.participant_id
    )
    select p.id as participant_id,
           (coalesce(paid.total, 0) - coalesce(owed.total, 0))::bigint as balance
    from participant p
    left join paid on paid.participant_id = p.id
    left join owed on owed.participant_id = p.id
    where p.nikount_id = ${nikountId}
    order by p.sort_order, p.id
  `,
  );
  return rows.map((row) => ({
    participantId: row.participant_id,
    // bigint arrive en texte selon le driver ; les montants restent des entiers sûrs (≤ 2^53).
    balance: Number(row.balance),
  }));
}

export async function pendingSummary(
  db: Database,
  nikountId: string,
): Promise<{ count: number; amount: number }> {
  const rows = await queryRows<{ count: string | number; amount: string | number }>(
    db,
    sql`
    select count(*) as count, coalesce(sum(amount), 0) as amount
    from "transaction"
    where nikount_id = ${nikountId} and status = 'PENDING'
  `,
  );
  const row = rows[0];
  return { count: Number(row?.count ?? 0), amount: Number(row?.amount ?? 0) };
}
