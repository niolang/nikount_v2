import { describe, expect, it } from 'vitest';
import { formatMoney } from './format';

// Intl insère des espaces insécables (U+00A0 / U+202F) : on les normalise pour comparer.
const plain = (value: string) => value.replace(/[\u00a0\u202f]/g, ' ');

describe('formatMoney', () => {
  it('formate en euros à la française', () => {
    expect(plain(formatMoney(12450))).toBe('124,50 €');
    expect(plain(formatMoney(123456789))).toBe('1 234 567,89 €');
    expect(plain(formatMoney(1))).toBe('0,01 €');
  });

  it('affiche le signe des soldes', () => {
    expect(plain(formatMoney(12450, 'EUR', { signed: true }))).toBe('+124,50 €');
    expect(plain(formatMoney(-4200, 'EUR', { signed: true }))).toBe('-42,00 €');
    expect(plain(formatMoney(0, 'EUR', { signed: true }))).toBe('0,00 €');
  });
});
