import { describe, expect, it } from 'vitest';
import { assertMinorUnits, MoneyError, parseAmountInput } from '../src/index.js';

describe('parseAmountInput', () => {
  it.each([
    ['12', 1200],
    ['12,5', 1250],
    ['12.50', 1250],
    ['0,01', 1],
    ['1 234,56', 123456],
    ['1\u202f234,56', 123456],
    ['0', 0],
  ])('« %s » → %i', (input, expected) => {
    expect(parseAmountInput(input)).toBe(expected);
  });

  it.each(['', 'abc', '-5', '12,345', '12,', ',5', '1e3', '12,5,0', '1234567890'])(
    'rejette « %s »',
    (input) => {
      expect(parseAmountInput(input)).toBeNull();
    },
  );

  it("n'introduit pas d'erreur flottante", () => {
    // 0.1 + 0.2 !== 0.3 en flottant ; ici tout reste entier.
    expect(parseAmountInput('0,29')).toBe(29);
    expect(parseAmountInput('1,15')).toBe(115);
  });
});

describe('assertMinorUnits', () => {
  it('accepte les entiers sûrs', () => {
    expect(() => {
      assertMinorUnits(1250);
    }).not.toThrow();
  });

  it.each([12.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53])('rejette %s', (value) => {
    expect(() => {
      assertMinorUnits(value);
    }).toThrow(MoneyError);
  });
});
