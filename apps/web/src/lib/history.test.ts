import { describe, expect, it } from 'vitest';
import type { TransactionView } from '@nikount/contracts';
import { makeTransaction } from '../test/utils';
import { dayLabel, groupByDay, matchesFilter, parseFilter, previousDay } from './history';

const tx = (overrides: Record<string, unknown>) => makeTransaction(overrides) as TransactionView;

describe('dayLabel', () => {
  const today = '2026-09-28';

  it('aujourd’hui, hier', () => {
    expect(dayLabel('2026-09-28', today)).toBe('Aujourd’hui');
    expect(dayLabel('2026-09-27', today)).toBe('Hier');
  });

  it('jour de la semaine et date, sans l’année si c’est la même', () => {
    expect(dayLabel('2026-09-25', today)).toBe('Vendredi 25 septembre');
    expect(dayLabel('2025-12-31', today)).toBe('Mercredi 31 décembre 2025');
  });

  it('« hier » au passage d’un mois et d’une année', () => {
    expect(previousDay('2026-03-01')).toBe('2026-02-28');
    expect(dayLabel('2025-12-31', '2026-01-01')).toBe('Hier');
  });
});

describe('groupByDay', () => {
  it('regroupe les opérations consécutives du même jour, dans l’ordre reçu', () => {
    const groups = groupByDay(
      [
        tx({ id: 'a', occurredOn: '2026-09-28' }),
        tx({ id: 'b', occurredOn: '2026-09-28' }),
        tx({ id: 'c', occurredOn: '2026-09-27' }),
        tx({ id: 'd', occurredOn: '2026-09-20' }),
      ],
      '2026-09-28',
    );
    expect(groups.map((g) => [g.label, g.transactions.map((t) => t.id)])).toEqual([
      ['Aujourd’hui', ['a', 'b']],
      ['Hier', ['c']],
      ['Dimanche 20 septembre', ['d']],
    ]);
  });

  it('liste vide → aucun groupe', () => {
    expect(groupByDay([], '2026-09-28')).toEqual([]);
  });
});

describe('filtres', () => {
  const expense = tx({ type: 'EXPENSE', status: 'VALIDATED' });
  const refund = tx({ type: 'REIMBURSEMENT', status: 'VALIDATED' });
  const pending = tx({ type: 'EXPENSE', status: 'PENDING' });
  const cancelled = tx({ type: 'EXPENSE', status: 'CANCELLED' });
  const rejected = tx({ type: 'REIMBURSEMENT', status: 'REJECTED' });
  const all = [expense, refund, pending, cancelled, rejected];

  it.each([
    ['ALL', [expense, refund, pending, cancelled, rejected]],
    ['EXPENSE', [expense, pending, cancelled]],
    ['REIMBURSEMENT', [refund, rejected]],
    ['PENDING', [pending]],
    ['CLOSED', [cancelled, rejected]],
  ] as const)('%s', (filter, expected) => {
    expect(all.filter((t) => matchesFilter(t, filter))).toEqual(expected);
  });

  it('un filtre inconnu retombe sur « Tout »', () => {
    expect(parseFilter('HACK')).toBe('ALL');
    expect(parseFilter(null)).toBe('ALL');
    expect(parseFilter('PENDING')).toBe('PENDING');
  });
});
