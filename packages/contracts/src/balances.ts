import { z } from 'zod';

export const BalancesResponse = z.object({
  /** Un solde par participant (actifs et désactivés), dans l'ordre d'affichage. */
  balances: z.array(z.object({ participantId: z.uuid(), balance: z.number().int() })),
  /** « Qui paie la prochaine ? » — aide UX, ne modifie jamais les comptes. */
  nextPayerId: z.uuid().nullable(),
  /** Virements suggérés pour solder les comptes (aide UX). */
  settlementSuggestions: z.array(
    z.object({ from: z.uuid(), to: z.uuid(), amount: z.number().int().positive() }),
  ),
  /** Opérations en attente de validation : non comptées dans les soldes. */
  pending: z.object({ count: z.number().int(), amount: z.number().int() }),
});
export type BalancesResponse = z.infer<typeof BalancesResponse>;
