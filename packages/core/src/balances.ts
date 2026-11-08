import type { MinorUnits } from './money.js';

/**
 * Soldes et aides au règlement (docs/product.md §7).
 *
 *   solde(p) = Σ montants des opérations VALIDÉES payées par p
 *            − Σ parts de p dans les opérations VALIDÉES
 *
 * Invariant : Σ des soldes = 0. Dépense et remboursement sont traités exactement de la même façon.
 * Les suggestions ne modifient jamais les comptes : ce sont des aides d'affichage.
 */

/** Opération telle que le moteur la voit : seuls statut, payeur, montant et parts comptent. */
export interface LedgerEntry {
  status: string;
  payerId: string;
  amount: MinorUnits;
  shares: readonly { participantId: string; amount: MinorUnits }[];
}

export interface Balance {
  participantId: string;
  /** > 0 : à recevoir ; < 0 : à payer ; 0 : à l'équilibre. */
  balance: MinorUnits;
}

export interface Transfer {
  from: string;
  to: string;
  amount: MinorUnits;
}

const COUNTED_STATUS = 'VALIDATED';

/**
 * Soldes de tous les participants, dans l'ordre fourni (y compris ceux sans opération).
 * Un participant présent dans les opérations mais absent de la liste est ajouté à la fin :
 * un montant n'est jamais perdu silencieusement.
 */
export function computeBalances(
  entries: readonly LedgerEntry[],
  participantIds: readonly string[],
): Balance[] {
  const totals = new Map<string, number>(participantIds.map((id) => [id, 0]));
  const add = (id: string, delta: number) => {
    totals.set(id, (totals.get(id) ?? 0) + delta);
  };

  for (const entry of entries) {
    if (entry.status !== COUNTED_STATUS) continue;
    add(entry.payerId, entry.amount);
    for (const share of entry.shares) add(share.participantId, -share.amount);
  }

  return [...totals].map(([participantId, balance]) => ({ participantId, balance }));
}

/**
 * « Qui paie la prochaine ? » : le participant actif au solde le plus bas (à égalité, le premier
 * dans l'ordre). `null` si tout le monde est à l'équilibre.
 */
export function nextPayer(
  balances: readonly Balance[],
  activeParticipantIds: readonly string[],
): string | null {
  if (balances.every((b) => b.balance === 0)) return null;
  const active = new Set(activeParticipantIds);
  let best: Balance | null = null;
  for (const candidate of balances) {
    if (!active.has(candidate.participantId)) continue;
    if (best === null || candidate.balance < best.balance) best = candidate;
  }
  return best?.participantId ?? null;
}

/**
 * Virements suggérés pour tout solder : appariement glouton de la plus grosse dette avec la plus
 * grosse créance (à égalité, ordre des participants). Au plus n − 1 virements pour n soldes non nuls.
 * Les participants désactivés y figurent : leur dette ou leur créance existe toujours.
 */
export function settlementSuggestions(balances: readonly Balance[]): Transfer[] {
  const order = new Map(balances.map((b, index) => [b.participantId, index]));
  const byOrder = (a: Balance, b: Balance) =>
    (order.get(a.participantId) ?? 0) - (order.get(b.participantId) ?? 0);

  const debtors = balances
    .filter((b) => b.balance < 0)
    .map((b) => ({ ...b, balance: -b.balance }))
    .sort((a, b) => b.balance - a.balance || byOrder(a, b));
  const creditors = balances
    .filter((b) => b.balance > 0)
    .map((b) => ({ ...b }))
    .sort((a, b) => b.balance - a.balance || byOrder(a, b));

  const transfers: Transfer[] = [];
  let d = 0;
  let c = 0;
  while (d < debtors.length && c < creditors.length) {
    const debtor = debtors[d];
    const creditor = creditors[c];
    if (!debtor || !creditor) break;
    const amount = Math.min(debtor.balance, creditor.balance);
    transfers.push({ from: debtor.participantId, to: creditor.participantId, amount });
    debtor.balance -= amount;
    creditor.balance -= amount;
    if (debtor.balance === 0) d += 1;
    if (creditor.balance === 0) c += 1;
  }
  return transfers;
}
