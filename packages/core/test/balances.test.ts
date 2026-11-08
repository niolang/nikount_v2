import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  computeBalances,
  computeSplit,
  nextPayer,
  settlementSuggestions,
  type LedgerEntry,
} from '../src/index.js';

const people = ['alice', 'bob', 'charlie', 'david'];

function expense(
  payerId: string,
  amount: number,
  concerned: string[],
  status = 'VALIDATED',
): LedgerEntry {
  return {
    status,
    payerId,
    amount,
    shares: computeSplit(amount, { mode: 'EQUAL', participantIds: concerned }),
  };
}

const asObject = (balances: { participantId: string; balance: number }[]) =>
  Object.fromEntries(balances.map((b) => [b.participantId, b.balance]));

describe('computeBalances — exemples du cahier des charges (docs/product.md §7)', () => {
  it('120 € payés par Alice pour 4 → Alice +90, les autres −30', () => {
    const balances = computeBalances([expense('alice', 12000, people)], people);
    expect(asObject(balances)).toEqual({ alice: 9000, bob: -3000, charlie: -3000, david: -3000 });
  });

  it('puis remboursement Bob → Alice 30 € → Alice +60, Bob 0, la dépense reste intacte', () => {
    const ledger = [expense('alice', 12000, people), expense('bob', 3000, ['alice'])];
    expect(asObject(computeBalances(ledger, people))).toEqual({
      alice: 6000,
      bob: 0,
      charlie: -3000,
      david: -3000,
    });
  });

  it('seules les opérations VALIDÉES comptent', () => {
    const ledger = ['PENDING', 'REJECTED', 'CANCELLED'].map((status) =>
      expense('alice', 12000, people, status),
    );
    expect(asObject(computeBalances(ledger, people))).toEqual({
      alice: 0,
      bob: 0,
      charlie: 0,
      david: 0,
    });
  });

  it('conserve l’ordre des participants et inclut ceux sans opération', () => {
    const balances = computeBalances([expense('bob', 1000, ['bob', 'charlie'])], people);
    expect(balances.map((b) => b.participantId)).toEqual(people);
    expect(balances[0]).toEqual({ participantId: 'alice', balance: 0 });
  });

  it('ajoute un participant inconnu de la liste (ex. données incohérentes) plutôt que de le perdre', () => {
    const balances = computeBalances([expense('zoe', 1000, ['alice'])], ['alice']);
    expect(asObject(balances)).toEqual({ alice: -1000, zoe: 1000 });
  });
});

describe('nextPayer — « Qui paie la prochaine ? »', () => {
  it('propose le participant actif le plus en retard', () => {
    const balances = computeBalances(
      [expense('alice', 12000, people), expense('bob', 2000, people)],
      people,
    );
    // alice +9000-500 ; bob +2000-3500 = -1500 ; charlie -3500 ; david -3500
    expect(nextPayer(balances, people)).toBe('charlie');
  });

  it('ignore les participants inactifs', () => {
    const balances = computeBalances([expense('alice', 12000, people)], people);
    expect(nextPayer(balances, ['alice', 'david'])).toBe('david');
  });

  it('ne propose personne quand tout le monde est à l’équilibre', () => {
    expect(nextPayer(computeBalances([], people), people)).toBeNull();
  });
});

describe('settlementSuggestions — virements pour solder', () => {
  it('120 € d’Alice pour 4 → trois virements de 30 € vers Alice', () => {
    const balances = computeBalances([expense('alice', 12000, people)], people);
    expect(settlementSuggestions(balances)).toEqual([
      { from: 'bob', to: 'alice', amount: 3000 },
      { from: 'charlie', to: 'alice', amount: 3000 },
      { from: 'david', to: 'alice', amount: 3000 },
    ]);
  });

  it('associe en priorité les plus grosses dettes aux plus grosses créances', () => {
    const balances = [
      { participantId: 'a', balance: 5000 },
      { participantId: 'b', balance: 1000 },
      { participantId: 'c', balance: -4000 },
      { participantId: 'd', balance: -2000 },
    ];
    expect(settlementSuggestions(balances)).toEqual([
      { from: 'c', to: 'a', amount: 4000 },
      { from: 'd', to: 'a', amount: 1000 },
      { from: 'd', to: 'b', amount: 1000 },
    ]);
  });

  it('rien à suggérer quand tout est soldé', () => {
    expect(settlementSuggestions(computeBalances([], people))).toEqual([]);
  });
});

// --- Propriétés ----------------------------------------------------------------------------

const participantsArb = fc
  .integer({ min: 1, max: 30 })
  .map((n) => Array.from({ length: n }, (_, i) => `p${String(i)}`));

const ledgerArb = participantsArb.chain((ids) =>
  fc.record({
    ids: fc.constant(ids),
    ledger: fc.array(
      fc.record({
        status: fc.constantFrom('VALIDATED', 'VALIDATED', 'PENDING', 'REJECTED', 'CANCELLED'),
        payer: fc.constantFrom(...ids),
        amount: fc.integer({ min: 1, max: 1_000_000 }),
        concerned: fc.subarray(ids, { minLength: 1 }),
      }),
      { maxLength: 60 },
    ),
  }),
);

function toLedger(
  entries: { status: string; payer: string; amount: number; concerned: string[] }[],
) {
  return entries.map((e) => expense(e.payer, e.amount, e.concerned, e.status));
}

describe('propriétés des soldes', () => {
  it('Σ des soldes = 0, toujours', () => {
    fc.assert(
      fc.property(ledgerArb, ({ ids, ledger }) => {
        const total = computeBalances(toLedger(ledger), ids).reduce((sum, b) => sum + b.balance, 0);
        expect(total).toBe(0);
      }),
      { numRuns: 500 },
    );
  });

  it('ajouter une opération non validée ne change aucun solde', () => {
    fc.assert(
      fc.property(ledgerArb, ({ ids, ledger }) => {
        const before = computeBalances(toLedger(ledger), ids);
        const extra = expense(ids[0] ?? 'p0', 12345, ids, 'PENDING');
        expect(computeBalances([...toLedger(ledger), extra], ids)).toEqual(before);
      }),
    );
  });

  it('l’ordre des opérations n’a aucune influence', () => {
    fc.assert(
      fc.property(ledgerArb, ({ ids, ledger }) => {
        const entries = toLedger(ledger);
        expect(computeBalances([...entries].reverse(), ids)).toEqual(computeBalances(entries, ids));
      }),
    );
  });

  it('appliquer les virements suggérés solde tous les comptes, en au plus n − 1 virements', () => {
    fc.assert(
      fc.property(ledgerArb, ({ ids, ledger }) => {
        const balances = computeBalances(toLedger(ledger), ids);
        const transfers = settlementSuggestions(balances);
        const after = new Map(balances.map((b) => [b.participantId, b.balance]));
        for (const t of transfers) {
          expect(t.amount).toBeGreaterThan(0);
          expect(after.get(t.from) ?? 0).toBeLessThan(0);
          expect(after.get(t.to) ?? 0).toBeGreaterThan(0);
          after.set(t.from, (after.get(t.from) ?? 0) + t.amount);
          after.set(t.to, (after.get(t.to) ?? 0) - t.amount);
        }
        expect([...after.values()].every((v) => v === 0)).toBe(true);
        const nonZero = balances.filter((b) => b.balance !== 0).length;
        expect(transfers.length).toBeLessThanOrEqual(Math.max(0, nonZero - 1));
      }),
      { numRuns: 500 },
    );
  });

  it('la suggestion « qui paie » a toujours le solde minimal parmi les actifs', () => {
    fc.assert(
      fc.property(ledgerArb, ({ ids, ledger }) => {
        const balances = computeBalances(toLedger(ledger), ids);
        const suggestion = nextPayer(balances, ids);
        const min = Math.min(...balances.map((b) => b.balance));
        if (balances.every((b) => b.balance === 0)) expect(suggestion).toBeNull();
        else expect(balances.find((b) => b.participantId === suggestion)?.balance).toBe(min);
      }),
    );
  });
});
