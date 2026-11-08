import type {
  TransactionCategory,
  TransactionStatus,
  TransactionType,
  TransactionView,
  UpdateTransactionRequest,
} from '@nikount/contracts';

/*
 * Logique pure de la table des opérations (admin desktop) : filtres, recherche et tri.
 * Tout se fait dans le navigateur, sur la liste complète déjà chargée : le volume attendu
 * (< 1 000 opérations par nikount, docs/data-model.md) ne justifie pas de requêtes dédiées.
 */

export interface OperationFilters {
  q: string;
  type: TransactionType | 'ALL';
  status: TransactionStatus | 'ALL';
  payerId: string;
  /** Participant concerné (une part dans l'opération). */
  participantId: string;
  category: TransactionCategory | 'NONE' | 'ALL';
  from: string;
  to: string;
}

export const EMPTY_FILTERS: OperationFilters = {
  q: '',
  type: 'ALL',
  status: 'ALL',
  payerId: '',
  participantId: '',
  category: 'ALL',
  from: '',
  to: '',
};

export function activeFilterCount(filters: OperationFilters): number {
  return (Object.keys(EMPTY_FILTERS) as (keyof OperationFilters)[]).filter(
    (key) => filters[key] !== EMPTY_FILTERS[key],
  ).length;
}

/** Minuscules, sans accents ni espaces superflus : « Évian » se trouve avec « evian ». */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

/**
 * Opérations correspondant à TOUS les filtres. La recherche porte sur la description, le payeur
 * et les concernés ; chaque mot doit apparaître quelque part.
 */
export function filterOperations(
  list: TransactionView[],
  filters: OperationFilters,
  names: Map<string, string>,
): TransactionView[] {
  const words = normalize(filters.q).split(/\s+/).filter(Boolean);
  return list.filter((t) => {
    if (filters.type !== 'ALL' && t.type !== filters.type) return false;
    if (filters.status !== 'ALL' && t.status !== filters.status) return false;
    if (filters.payerId && t.payerId !== filters.payerId) return false;
    if (filters.participantId && !t.shares.some((s) => s.participantId === filters.participantId))
      return false;
    if (filters.category === 'NONE' && t.category !== null) return false;
    if (
      filters.category !== 'ALL' &&
      filters.category !== 'NONE' &&
      t.category !== filters.category
    )
      return false;
    if (filters.from && t.occurredOn < filters.from) return false;
    if (filters.to && t.occurredOn > filters.to) return false;
    if (words.length > 0) {
      const haystack = normalize(
        [
          t.description,
          names.get(t.payerId) ?? '',
          ...t.shares.map((s) => names.get(s.participantId) ?? ''),
        ].join(' '),
      );
      if (!words.every((word) => haystack.includes(word))) return false;
    }
    return true;
  });
}

export type SortKey = 'date' | 'description' | 'payer' | 'amount' | 'status';
export interface SortState {
  key: SortKey;
  direction: 'asc' | 'desc';
}

export const DEFAULT_SORT: SortState = { key: 'date', direction: 'desc' };

const STATUS_ORDER: Record<TransactionStatus, number> = {
  PENDING: 0,
  VALIDATED: 1,
  REJECTED: 2,
  CANCELLED: 3,
};

const collator = new Intl.Collator('fr', { sensitivity: 'base', numeric: true });

/**
 * Tri stable. À égalité, l'ordre d'arrivée (date métier puis saisie, plus récente d'abord)
 * départage, quel que soit le sens du tri principal.
 */
export function sortOperations(
  list: TransactionView[],
  sort: SortState,
  names: Map<string, string>,
): TransactionView[] {
  const sign = sort.direction === 'asc' ? 1 : -1;
  const compare = (a: TransactionView, b: TransactionView): number => {
    switch (sort.key) {
      case 'date':
        return a.occurredOn.localeCompare(b.occurredOn) || a.createdAt.localeCompare(b.createdAt);
      case 'description':
        return collator.compare(a.description, b.description);
      case 'payer':
        return collator.compare(names.get(a.payerId) ?? '', names.get(b.payerId) ?? '');
      case 'amount':
        return a.amount - b.amount;
      case 'status':
        return STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    }
  };
  return list
    .map((t, index) => ({ t, index }))
    .sort((a, b) => sign * compare(a.t, b.t) || a.index - b.index)
    .map(({ t }) => t);
}

/** Clic sur un en-tête : même colonne → inverse le sens ; autre colonne → sens naturel. */
export function nextSort(current: SortState, key: SortKey): SortState {
  if (current.key === key) {
    return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
  }
  return { key, direction: key === 'date' || key === 'amount' ? 'desc' : 'asc' };
}

/** Une opération peut être modifiée tant qu'elle n'est ni refusée ni annulée. */
export function isEditable(t: TransactionView): boolean {
  return t.status === 'PENDING' || t.status === 'VALIDATED';
}

/**
 * Corps de `PUT /transactions/:id` reprenant l'opération telle quelle, avec quelques champs
 * changés (édition en ligne : description, date, catégorie). La répartition est reconstruite à
 * partir des saisies d'origine, ce qui redonne exactement les mêmes parts.
 */
export function updateBodyFrom(
  t: TransactionView,
  changes: Partial<Pick<UpdateTransactionRequest, 'description' | 'occurredOn' | 'category'>>,
): UpdateTransactionRequest {
  return {
    amount: t.amount,
    description: t.description,
    category: t.category,
    occurredOn: t.occurredOn,
    payerId: t.payerId,
    distribution:
      t.distributionMode === 'EQUAL'
        ? { mode: 'EQUAL', participantIds: t.shares.map((s) => s.participantId) }
        : {
            mode: t.distributionMode,
            shares: t.shares.map((s) => ({ participantId: s.participantId, value: s.inputValue })),
          },
    version: t.version,
    ...changes,
  };
}

/**
 * Actions en masse possibles sur une sélection (toutes les opérations doivent s'y prêter).
 * Comme sur une opération seule : une opération en attente se refuse, une validée s'annule.
 */
export function bulkAvailability(selected: TransactionView[]): {
  validate: boolean;
  reject: boolean;
  cancel: boolean;
} {
  const any = selected.length > 0;
  const allPending = any && selected.every((t) => t.status === 'PENDING');
  return {
    validate: allPending,
    reject: allPending,
    cancel: any && selected.every((t) => t.status === 'VALIDATED'),
  };
}
