import type { BalancesResponse } from '@nikount/contracts';
import { assertMinorUnits, nextPayer, settlementSuggestions } from '@nikount/core';
import type { Database } from '../../db/client.js';
import { listParticipants } from '../participants/repository.js';
import * as repo from './repository.js';

/**
 * Soldes du nikount : calculés en SQL, puis aides UX (« qui paie la prochaine », virements
 * suggérés) calculées par le moteur pur. Lecture seule : rien n'est jamais modifié ici.
 */
export async function getBalances(db: Database, nikountId: string): Promise<BalancesResponse> {
  const [balances, participants, pending] = await Promise.all([
    repo.balancesByParticipant(db, nikountId),
    listParticipants(db, nikountId),
    repo.pendingSummary(db, nikountId),
  ]);

  for (const { balance } of balances) assertMinorUnits(balance);
  const total = balances.reduce((sum, b) => sum + b.balance, 0);
  if (total !== 0) {
    // Impossible si les invariants en base tiennent : on préfère échouer que d'afficher faux.
    throw new Error(`Invariant violé : la somme des soldes vaut ${String(total)}`);
  }

  const active = participants.filter((p) => p.isActive).map((p) => p.id);
  return {
    balances,
    nextPayerId: nextPayer(balances, active),
    settlementSuggestions: settlementSuggestions(balances),
    pending,
  };
}
