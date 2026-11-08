import type { TransactionView } from '@nikount/contracts';

/*
 * Historique : filtres et regroupement par jour (docs/product.md §8). Fonctions pures, testées.
 */

export const HISTORY_FILTERS = ['ALL', 'EXPENSE', 'REIMBURSEMENT', 'PENDING', 'CLOSED'] as const;
export type HistoryFilter = (typeof HISTORY_FILTERS)[number];

export const FILTER_LABELS: Record<HistoryFilter, string> = {
  ALL: 'Tout',
  EXPENSE: 'Dépenses',
  REIMBURSEMENT: 'Remboursements',
  PENDING: 'En attente',
  CLOSED: 'Annulées / refusées',
};

export function parseFilter(value: string | null): HistoryFilter {
  return HISTORY_FILTERS.find((f) => f === value) ?? 'ALL';
}

export function matchesFilter(transaction: TransactionView, filter: HistoryFilter): boolean {
  switch (filter) {
    case 'ALL':
      return true;
    case 'EXPENSE':
    case 'REIMBURSEMENT':
      return transaction.type === filter;
    case 'PENDING':
      return transaction.status === 'PENDING';
    case 'CLOSED':
      return transaction.status === 'CANCELLED' || transaction.status === 'REJECTED';
  }
}

function utcDate(isoDate: string): Date {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(year ?? 1970, (month ?? 1) - 1, day ?? 1));
}

/** Veille d'une date AAAA-MM-JJ. */
export function previousDay(isoDate: string): string {
  const date = utcDate(isoDate);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/** « Aujourd'hui », « Hier », sinon « lundi 28 septembre » (avec l'année si elle diffère). */
export function dayLabel(isoDate: string, today: string): string {
  if (isoDate === today) return 'Aujourd’hui';
  if (isoDate === previousDay(today)) return 'Hier';
  const sameYear = isoDate.slice(0, 4) === today.slice(0, 4);
  const label = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
    timeZone: 'UTC',
  }).format(utcDate(isoDate));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export interface DayGroup {
  date: string;
  label: string;
  transactions: TransactionView[];
}

/**
 * Regroupe par date métier, en conservant l'ordre reçu (l'API trie déjà : date décroissante,
 * puis saisie la plus récente d'abord).
 */
export function groupByDay(transactions: readonly TransactionView[], today: string): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const transaction of transactions) {
    const last = groups.at(-1);
    if (last?.date === transaction.occurredOn) {
      last.transactions.push(transaction);
    } else {
      groups.push({
        date: transaction.occurredOn,
        label: dayLabel(transaction.occurredOn, today),
        transactions: [transaction],
      });
    }
  }
  return groups;
}
