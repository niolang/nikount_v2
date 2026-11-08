import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  allocateProportionally,
  computeSplit,
  MAX_TRANSACTION_AMOUNT,
  SplitError,
  toHundredths,
  type DistributionInput,
} from '../src/index.js';

const ids = ['alice', 'bob', 'charlie', 'david'];
const amounts = (shares: { amount: number }[]) => shares.map((s) => s.amount);

function expectSplitError(run: () => unknown, code: string) {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(SplitError);
    expect((error as SplitError).code).toBe(code);
    return;
  }
  expect.fail(`SplitError ${code} attendue`);
}

describe('exemples du cahier des charges (docs/product.md §6)', () => {
  it('égalitaire : 120 € / 4 → 30 € chacun', () => {
    const shares = computeSplit(12000, { mode: 'EQUAL', participantIds: ids });
    expect(shares).toEqual(
      ids.map((participantId) => ({ participantId, inputValue: 1, amount: 3000 })),
    );
  });

  it('par parts : 1, 1, 2, 2 sur 120 € → 20, 20, 40, 40', () => {
    const shares = computeSplit(12000, {
      mode: 'SHARES',
      shares: [
        { participantId: 'alice', value: 1 },
        { participantId: 'bob', value: 1 },
        { participantId: 'charlie', value: 2 },
        { participantId: 'david', value: 2 },
      ],
    });
    expect(amounts(shares)).toEqual([2000, 2000, 4000, 4000]);
    expect(shares.map((s) => s.inputValue)).toEqual([1, 1, 2, 2]);
  });

  it('par pourcentage : 25, 25, 30, 20 % de 120 € → 30, 30, 36, 24', () => {
    const shares = computeSplit(12000, {
      mode: 'PERCENT',
      shares: [
        { participantId: 'alice', value: 25 },
        { participantId: 'bob', value: 25 },
        { participantId: 'charlie', value: 30 },
        { participantId: 'david', value: 20 },
      ],
    });
    expect(amounts(shares)).toEqual([3000, 3000, 3600, 2400]);
  });

  it('par montant : 20 + 20 + 46 = 86 €, repris tels quels', () => {
    const shares = computeSplit(8600, {
      mode: 'AMOUNT',
      shares: [
        { participantId: 'alice', value: 2000 },
        { participantId: 'bob', value: 2000 },
        { participantId: 'charlie', value: 4600 },
      ],
    });
    expect(amounts(shares)).toEqual([2000, 2000, 4600]);
    expect(shares.map((s) => s.inputValue)).toEqual([2000, 2000, 4600]);
  });
});

describe('arrondis (plus forts restes, D2)', () => {
  it('100 € / 3 → 33,34 / 33,33 / 33,33 : le centime va au premier dans l’ordre', () => {
    expect(
      amounts(computeSplit(10000, { mode: 'EQUAL', participantIds: ids.slice(0, 3) })),
    ).toEqual([3334, 3333, 3333]);
  });

  it('0,02 € / 3 → 1, 1, 0 centime', () => {
    expect(amounts(computeSplit(2, { mode: 'EQUAL', participantIds: ids.slice(0, 3) }))).toEqual([
      1, 1, 0,
    ]);
  });

  it('donne le centime au plus grand reste, pas forcément au premier', () => {
    // 10,00 € en parts 1 / 2 : exact 333,33… / 666,66… → le reste le plus grand est le second.
    const shares = computeSplit(1000, {
      mode: 'SHARES',
      shares: [
        { participantId: 'alice', value: 1 },
        { participantId: 'bob', value: 2 },
      ],
    });
    expect(amounts(shares)).toEqual([333, 667]);
  });

  it('pourcentages à décimales : 33,33 / 33,33 / 33,34 % de 1 €', () => {
    const shares = computeSplit(100, {
      mode: 'PERCENT',
      shares: [
        { participantId: 'alice', value: 33.33 },
        { participantId: 'bob', value: 33.33 },
        { participantId: 'charlie', value: 33.34 },
      ],
    });
    expect(amounts(shares)).toEqual([33, 33, 34]);
  });

  it('parts décimales : 0,5 / 1 / 1,5', () => {
    const shares = computeSplit(3000, {
      mode: 'SHARES',
      shares: [
        { participantId: 'alice', value: 0.5 },
        { participantId: 'bob', value: 1 },
        { participantId: 'charlie', value: 1.5 },
      ],
    });
    expect(amounts(shares)).toEqual([500, 1000, 1500]);
  });
});

describe('validation', () => {
  it.each([0, -1, 1.5, MAX_TRANSACTION_AMOUNT + 1, Number.NaN])(
    'montant invalide : %s',
    (amount) => {
      expectSplitError(
        () => computeSplit(amount, { mode: 'EQUAL', participantIds: ['a'] }),
        'INVALID_AMOUNT',
      );
    },
  );

  it('au moins un concerné', () => {
    expectSplitError(
      () => computeSplit(100, { mode: 'EQUAL', participantIds: [] }),
      'NO_PARTICIPANTS',
    );
    expectSplitError(() => computeSplit(100, { mode: 'SHARES', shares: [] }), 'NO_PARTICIPANTS');
  });

  it('pas de doublon', () => {
    expectSplitError(
      () => computeSplit(100, { mode: 'EQUAL', participantIds: ['a', 'a'] }),
      'DUPLICATE_PARTICIPANT',
    );
  });

  it.each([
    ['part nulle', { mode: 'SHARES', shares: [{ participantId: 'a', value: 0 }] }],
    ['part négative', { mode: 'SHARES', shares: [{ participantId: 'a', value: -1 }] }],
    ['part à 3 décimales', { mode: 'SHARES', shares: [{ participantId: 'a', value: 1.005 }] }],
    ['part trop grande', { mode: 'SHARES', shares: [{ participantId: 'a', value: 10_000.01 }] }],
    [
      'pourcentage nul',
      {
        mode: 'PERCENT',
        shares: [
          { participantId: 'a', value: 0 },
          { participantId: 'b', value: 100 },
        ],
      },
    ],
    ['pourcentage > 100', { mode: 'PERCENT', shares: [{ participantId: 'a', value: 100.01 }] }],
    ['montant non entier', { mode: 'AMOUNT', shares: [{ participantId: 'a', value: 99.5 }] }],
    [
      'montant négatif',
      {
        mode: 'AMOUNT',
        shares: [
          { participantId: 'a', value: -1 },
          { participantId: 'b', value: 101 },
        ],
      },
    ],
  ] as [string, DistributionInput][])('valeur invalide : %s', (_label, distribution) => {
    expectSplitError(() => computeSplit(100, distribution), 'INVALID_VALUE');
  });

  it('pourcentages dont la somme n’est pas 100 %', () => {
    expectSplitError(
      () =>
        computeSplit(100, {
          mode: 'PERCENT',
          shares: [
            { participantId: 'a', value: 50 },
            { participantId: 'b', value: 49.99 },
          ],
        }),
      'PERCENT_NOT_100',
    );
  });

  it('montants dont la somme diffère du total', () => {
    expectSplitError(
      () =>
        computeSplit(100, {
          mode: 'AMOUNT',
          shares: [
            { participantId: 'a', value: 50 },
            { participantId: 'b', value: 49 },
          ],
        }),
      'AMOUNT_SUM_MISMATCH',
    );
  });

  it('le détail de l’erreur indique l’écart', () => {
    try {
      computeSplit(100, {
        mode: 'PERCENT',
        shares: [
          { participantId: 'a', value: 60 },
          { participantId: 'b', value: 30 },
        ],
      });
    } catch (error) {
      expect((error as SplitError).details).toEqual({ totalPercent: 90 });
    }
  });
});

describe('toHundredths', () => {
  it.each([
    [1, 100],
    [0.5, 50],
    [33.33, 3333],
    [0.07, 7],
    [1.1, 110],
    [10_000, 1_000_000],
  ])('%s → %i centièmes', (value, expected) => {
    expect(toHundredths(value)).toBe(expected);
  });

  it.each([1.005, 0.001, Number.NaN, Number.POSITIVE_INFINITY])('refuse %s', (value) => {
    expect(toHundredths(value)).toBeNull();
  });
});

// --- Propriétés : quelle que soit l'entrée valide ------------------------------------------

const amountArb = fc.integer({ min: 1, max: MAX_TRANSACTION_AMOUNT });
const participantsArb = fc
  .integer({ min: 1, max: 200 })
  .map((n) => Array.from({ length: n }, (_, i) => `p${String(i)}`));

const distributionArb: fc.Arbitrary<{ amount: number; distribution: DistributionInput }> = fc.oneof(
  fc.record({ amount: amountArb, people: participantsArb }).map(({ amount, people }) => ({
    amount,
    distribution: { mode: 'EQUAL' as const, participantIds: people },
  })),
  fc
    .record({
      amount: amountArb,
      weights: fc.array(fc.integer({ min: 1, max: 1_000_000 }), { minLength: 1, maxLength: 200 }),
    })
    .map(({ amount, weights }) => ({
      amount,
      distribution: {
        mode: 'SHARES' as const,
        shares: weights.map((w, i) => ({ participantId: `p${String(i)}`, value: w / 100 })),
      },
    })),
  fc
    .record({
      amount: amountArb,
      cuts: fc.uniqueArray(fc.integer({ min: 1, max: 9_999 }), { maxLength: 30 }),
    })
    .map(({ amount, cuts }) => {
      // Découpe 100,00 % en morceaux strictement positifs (en centièmes de pourcent).
      const bounds = [0, ...cuts.sort((a, b) => a - b), 10_000];
      const percents = bounds.slice(1).map((b, i) => (b - (bounds[i] ?? 0)) / 100);
      return {
        amount,
        distribution: {
          mode: 'PERCENT' as const,
          shares: percents.map((value, i) => ({ participantId: `p${String(i)}`, value })),
        },
      };
    }),
);

describe('propriétés du moteur', () => {
  it('Σ des parts = montant, au centime, pour tout mode', () => {
    fc.assert(
      fc.property(distributionArb, ({ amount, distribution }) => {
        const total = computeSplit(amount, distribution).reduce((sum, s) => sum + s.amount, 0);
        expect(total).toBe(amount);
      }),
      { numRuns: 500 },
    );
  });

  it('chaque part est un entier ≥ 0, à moins d’un centime de la valeur exacte', () => {
    fc.assert(
      fc.property(distributionArb, ({ amount, distribution }) => {
        const shares = computeSplit(amount, distribution);
        const weights =
          distribution.mode === 'EQUAL'
            ? distribution.participantIds.map(() => 1)
            : distribution.shares.map((s) => s.value);
        const totalWeight = weights.reduce((a, b) => a + b, 0);
        shares.forEach((share, i) => {
          expect(Number.isSafeInteger(share.amount)).toBe(true);
          expect(share.amount).toBeGreaterThanOrEqual(0);
          const exact = (amount * (weights[i] ?? 0)) / totalWeight;
          expect(Math.abs(share.amount - exact)).toBeLessThan(1 + 1e-6);
        });
      }),
      { numRuns: 500 },
    );
  });

  it('égalitaire : deux parts ne diffèrent jamais de plus d’un centime', () => {
    fc.assert(
      fc.property(amountArb, participantsArb, (amount, people) => {
        const values = amounts(computeSplit(amount, { mode: 'EQUAL', participantIds: people }));
        expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1);
      }),
    );
  });

  it('est déterministe et conserve l’ordre des concernés', () => {
    fc.assert(
      fc.property(distributionArb, ({ amount, distribution }) => {
        const first = computeSplit(amount, distribution);
        expect(computeSplit(amount, distribution)).toEqual(first);
        const expectedOrder =
          distribution.mode === 'EQUAL'
            ? distribution.participantIds
            : distribution.shares.map((s) => s.participantId);
        expect(first.map((s) => s.participantId)).toEqual([...expectedOrder]);
      }),
    );
  });

  it('montants libres : repris à l’identique dès que la somme est exacte', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 1_000_000 }), { minLength: 1, maxLength: 50 }),
        (values) => {
          const amount = values.reduce((a, b) => a + b, 0);
          fc.pre(amount > 0);
          const shares = computeSplit(amount, {
            mode: 'AMOUNT',
            shares: values.map((value, i) => ({ participantId: `p${String(i)}`, value })),
          });
          expect(amounts(shares)).toEqual(values);
        },
      ),
    );
  });
});

describe('allocateProportionally', () => {
  it('répartit un montant selon des poids entiers', () => {
    expect(allocateProportionally(10, [1, 1, 1])).toEqual([4, 3, 3]);
    expect(allocateProportionally(0, [1, 2])).toEqual([0, 0]);
  });
});
