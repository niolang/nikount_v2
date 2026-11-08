import { describe, expect, it } from 'vitest';
import type { TransactionView } from '@nikount/contracts';
import { makeTransaction, people } from '../test/utils';
import {
  activeFilterCount,
  bulkAvailability,
  DEFAULT_SORT,
  EMPTY_FILTERS,
  filterOperations,
  nextSort,
  normalize,
  sortOperations,
  updateBodyFrom,
} from './operations';

const tx = (id: string, overrides: Record<string, unknown> = {}) =>
  makeTransaction({ id, ...overrides }) as TransactionView;

const names = new Map(Object.values(people).map((p) => [p.id, p.name]));
const share = (participantId: string, amount: number, inputValue = 1) => ({
  participantId,
  inputValue,
  amount,
});

const list = [
  tx('a', {
    description: 'Restaurant à Évian',
    payerId: people.alice.id,
    shares: [share(people.alice.id, 6000), share(people.bob.id, 6000)],
    occurredOn: '2026-09-28',
    amount: 12000,
  }),
  tx('b', {
    description: 'Essence',
    category: 'TRANSPORT',
    status: 'PENDING',
    payerId: people.bob.id,
    shares: [share(people.nicolas.id, 3400), share(people.bob.id, 3400)],
    occurredOn: '2026-09-27',
    amount: 6800,
  }),
  tx('c', {
    type: 'REIMBURSEMENT',
    description: 'Remboursement',
    category: null,
    payerId: people.bob.id,
    shares: [share(people.alice.id, 3000)],
    occurredOn: '2026-09-29',
    amount: 3000,
    status: 'CANCELLED',
  }),
];
const ids = (result: TransactionView[]) => result.map((t) => t.id);

describe('filterOperations', () => {
  it('sans filtre, garde tout dans l’ordre', () => {
    expect(ids(filterOperations(list, EMPTY_FILTERS, names))).toEqual(['a', 'b', 'c']);
  });

  it('recherche sans accents ni casse, sur la description et les personnes', () => {
    const q = (text: string) => ids(filterOperations(list, { ...EMPTY_FILTERS, q: text }, names));
    expect(q('evian')).toEqual(['a']);
    expect(q('ESSENCE')).toEqual(['b']);
    expect(q('nicolas')).toEqual(['b']);
    expect(q('bob restau')).toEqual(['a']);
    expect(q('zzz')).toEqual([]);
  });

  it('filtre par type, statut, payeur, concerné, catégorie et dates', () => {
    const f = (filters: Partial<typeof EMPTY_FILTERS>) =>
      ids(filterOperations(list, { ...EMPTY_FILTERS, ...filters }, names));
    expect(f({ type: 'REIMBURSEMENT' })).toEqual(['c']);
    expect(f({ status: 'PENDING' })).toEqual(['b']);
    expect(f({ payerId: people.bob.id })).toEqual(['b', 'c']);
    expect(f({ participantId: people.alice.id })).toEqual(['a', 'c']);
    expect(f({ category: 'TRANSPORT' })).toEqual(['b']);
    expect(f({ category: 'NONE' })).toEqual(['c']);
    expect(f({ from: '2026-09-28' })).toEqual(['a', 'c']);
    expect(f({ to: '2026-09-28' })).toEqual(['a', 'b']);
    expect(f({ from: '2026-09-28', to: '2026-09-28', payerId: people.alice.id })).toEqual(['a']);
  });

  it('compte les filtres actifs', () => {
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0);
    expect(activeFilterCount({ ...EMPTY_FILTERS, q: 'x', status: 'PENDING' })).toBe(2);
  });

  it('normalise le texte', () => {
    expect(normalize('  Été Ça ')).toBe('ete ca');
  });
});

describe('sortOperations', () => {
  it('par date, plus récente d’abord par défaut', () => {
    expect(ids(sortOperations(list, DEFAULT_SORT, names))).toEqual(['c', 'a', 'b']);
  });

  it('par montant, description, payeur ou statut, dans les deux sens', () => {
    const s = (key: 'amount' | 'description' | 'payer' | 'status', direction: 'asc' | 'desc') =>
      ids(sortOperations(list, { key, direction }, names));
    expect(s('amount', 'asc')).toEqual(['c', 'b', 'a']);
    expect(s('description', 'asc')).toEqual(['b', 'c', 'a']);
    expect(s('payer', 'asc')).toEqual(['a', 'b', 'c']);
    expect(s('status', 'asc')).toEqual(['b', 'a', 'c']);
    expect(s('status', 'desc')).toEqual(['c', 'a', 'b']);
  });

  it('garde l’ordre d’arrivée à égalité', () => {
    const same = [tx('x', { amount: 100 }), tx('y', { amount: 100 }), tx('z', { amount: 50 })];
    expect(ids(sortOperations(same, { key: 'amount', direction: 'desc' }, names))).toEqual([
      'x',
      'y',
      'z',
    ]);
  });

  it('nextSort inverse le sens sur la même colonne', () => {
    expect(nextSort(DEFAULT_SORT, 'date')).toEqual({ key: 'date', direction: 'asc' });
    expect(nextSort(DEFAULT_SORT, 'description')).toEqual({ key: 'description', direction: 'asc' });
    expect(nextSort(DEFAULT_SORT, 'amount')).toEqual({ key: 'amount', direction: 'desc' });
  });
});

describe('updateBodyFrom', () => {
  it('reprend une répartition égale et applique les changements', () => {
    expect(updateBodyFrom(list[0] as TransactionView, { description: 'Resto' })).toEqual({
      amount: 12000,
      description: 'Resto',
      category: 'FOOD',
      occurredOn: '2026-09-28',
      payerId: people.alice.id,
      distribution: { mode: 'EQUAL', participantIds: [people.alice.id, people.bob.id] },
      version: 1,
    });
  });

  it('reprend les saisies d’origine pour les parts', () => {
    const t = tx('p', {
      distributionMode: 'SHARES',
      shares: [share(people.alice.id, 8000, 2), share(people.bob.id, 4000, 1)],
      version: 3,
    });
    expect(updateBodyFrom(t, { category: null })).toMatchObject({
      category: null,
      distribution: {
        mode: 'SHARES',
        shares: [
          { participantId: people.alice.id, value: 2 },
          { participantId: people.bob.id, value: 1 },
        ],
      },
      version: 3,
    });
  });
});

describe('bulkAvailability', () => {
  it('valider et refuser : des opérations en attente ; annuler : des validées', () => {
    expect(bulkAvailability([list[1] as TransactionView])).toEqual({
      validate: true,
      reject: true,
      cancel: false,
    });
    expect(bulkAvailability([list[0] as TransactionView, list[1] as TransactionView])).toEqual({
      validate: false,
      reject: false,
      cancel: false,
    });
    expect(bulkAvailability([list[0] as TransactionView]).cancel).toBe(true);
  });

  it('rien sur une sélection vide ou contenant une opération annulée', () => {
    expect(bulkAvailability([])).toEqual({ validate: false, reject: false, cancel: false });
    expect(bulkAvailability([list[2] as TransactionView]).cancel).toBe(false);
  });
});
