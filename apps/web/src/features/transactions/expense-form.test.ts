import { describe, expect, it } from 'vitest';
import { buildDistribution, parseDecimal, previewSplit } from './expense-form';

const plain = (value: string) => value.replace(/[\u00a0\u202f]/g, ' ');

describe('parseDecimal', () => {
  it.each([
    ['1', 1],
    ['1,5', 1.5],
    ['33.33', 33.33],
    [' 2 ', 2],
  ])('« %s » → %s', (text, expected) => {
    expect(parseDecimal(text)).toBe(expected);
  });

  it.each(['', 'abc', '-1', '1,555', '1,2,3'])('refuse « %s »', (text) => {
    expect(parseDecimal(text)).toBeNull();
  });
});

describe('buildDistribution', () => {
  it('égalitaire : liste des concernés', () => {
    expect(buildDistribution({ mode: 'EQUAL', concerned: ['a', 'b'], values: {} })).toEqual({
      ok: true,
      distribution: { mode: 'EQUAL', participantIds: ['a', 'b'] },
    });
  });

  it('montants : saisies converties en centimes', () => {
    expect(
      buildDistribution({ mode: 'AMOUNT', concerned: ['a', 'b'], values: { a: '20', b: '46,5' } }),
    ).toEqual({
      ok: true,
      distribution: {
        mode: 'AMOUNT',
        shares: [
          { participantId: 'a', value: 2000 },
          { participantId: 'b', value: 4650 },
        ],
      },
    });
  });

  it('signale une saisie manquante ou aucun concerné', () => {
    expect(buildDistribution({ mode: 'SHARES', concerned: ['a'], values: {} })).toMatchObject({
      ok: false,
      message: expect.stringContaining('nombre de parts') as unknown,
    });
    expect(buildDistribution({ mode: 'EQUAL', concerned: [], values: {} })).toMatchObject({
      ok: false,
    });
  });
});

describe('previewSplit', () => {
  it('rien à afficher sans montant', () => {
    expect(previewSplit(null, { mode: 'EQUAL', concerned: ['a'], values: {} }, 'EUR')).toEqual({
      status: 'empty',
    });
  });

  it('calcule comme le serveur (même moteur)', () => {
    const preview = previewSplit(
      10000,
      { mode: 'EQUAL', concerned: ['a', 'b', 'c'], values: {} },
      'EUR',
    );
    expect(preview.status === 'ok' && preview.shares.map((s) => s.amount)).toEqual([
      3334, 3333, 3333,
    ]);
  });

  it('explique un total de pourcentages incorrect', () => {
    const preview = previewSplit(
      10000,
      { mode: 'PERCENT', concerned: ['a', 'b'], values: { a: '60', b: '30,5' } },
      'EUR',
    );
    expect(preview).toEqual({ status: 'error', message: 'Total : 90,5 % — il faut 100 %.' });
  });

  it('indique ce qu’il reste à répartir, ou ce qui est en trop', () => {
    const missing = previewSplit(
      10000,
      { mode: 'AMOUNT', concerned: ['a', 'b'], values: { a: '50', b: '20' } },
      'EUR',
    );
    expect(missing.status === 'error' && plain(missing.message)).toBe(
      'Il reste 30,00 € à répartir.',
    );

    const tooMuch = previewSplit(
      10000,
      { mode: 'AMOUNT', concerned: ['a', 'b'], values: { a: '80', b: '20,01' } },
      'EUR',
    );
    expect(tooMuch.status === 'error' && plain(tooMuch.message)).toBe('0,01 € de trop.');
  });
});
