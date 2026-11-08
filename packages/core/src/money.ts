/**
 * Tous les montants sont des entiers en unités mineures (centimes pour l'EUR).
 * Jamais de nombres flottants pour représenter de l'argent.
 */
export type MinorUnits = number;

/** Montant maximal d'une opération : 1 000 000,00 (docs/product.md §5). */
export const MAX_TRANSACTION_AMOUNT: MinorUnits = 100_000_000;

export class MoneyError extends Error {
  override readonly name = 'MoneyError';
}

/** Vérifie qu'une valeur est un montant en unités mineures exploitable (entier sûr). */
export function assertMinorUnits(value: number): asserts value is MinorUnits {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`Montant invalide (entier attendu) : ${String(value)}`);
  }
}

const AMOUNT_INPUT = /^(\d{1,9})(?:[.,](\d{1,2}))?$/;

/**
 * Convertit une saisie utilisateur (« 12 », « 12,5 », « 12.50 », « 1 234,56 ») en unités mineures,
 * sans passer par un flottant. Retourne `null` si la saisie n'est pas un montant positif valide
 * à 2 décimales maximum.
 */
export function parseAmountInput(input: string): MinorUnits | null {
  const normalized = input.replace(/[\s\u00a0\u202f]/g, '');
  const match = AMOUNT_INPUT.exec(normalized);
  if (!match) return null;
  const units = Number(match[1]);
  const cents = Number((match[2] ?? '').padEnd(2, '0'));
  return units * 100 + cents;
}
