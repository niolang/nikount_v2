import { MAX_TRANSACTION_AMOUNT, type MinorUnits } from './money.js';

/**
 * Moteur de répartition d'une opération entre ses concernés (docs/product.md §6).
 *
 * Invariant absolu : la somme des parts calculées est égale au montant, au centime près.
 * Tous les calculs se font en entiers (BigInt pour les produits intermédiaires) : aucun flottant
 * n'intervient dans un montant. L'ordre des concernés en entrée est conservé en sortie et sert à
 * départager les arrondis (D2) : l'appelant le fournit dans l'ordre d'affichage des participants.
 */

export type DistributionInput =
  | { mode: 'EQUAL'; participantIds: readonly string[] }
  | {
      mode: 'SHARES' | 'PERCENT' | 'AMOUNT';
      shares: readonly { participantId: string; value: number }[];
    };

export interface ComputedShare {
  participantId: string;
  /** Valeur saisie : 1 (égalitaire), nombre de parts, pourcentage, ou montant en unités mineures. */
  inputValue: number;
  /** Montant final attribué, en unités mineures. Stocké tel quel : il fait foi. */
  amount: MinorUnits;
}

export type SplitErrorCode =
  | 'INVALID_AMOUNT'
  | 'NO_PARTICIPANTS'
  | 'DUPLICATE_PARTICIPANT'
  | 'INVALID_VALUE'
  | 'PERCENT_NOT_100'
  | 'AMOUNT_SUM_MISMATCH';

export class SplitError extends Error {
  override readonly name = 'SplitError';

  constructor(
    readonly code: SplitErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

/** Nombre maximal de parts pour un concerné (mode SHARES). */
export const MAX_SHARE_VALUE = 10_000;

/**
 * Convertit une valeur décimale à 2 décimales au plus (parts, pourcentages) en centièmes entiers,
 * sans propager d'erreur flottante (0,07 × 100 = 7,000000000000001). `null` si plus de 2 décimales.
 */
export function toHundredths(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  const scaled = value * 100;
  const rounded = Math.round(scaled);
  return Math.abs(scaled - rounded) < 1e-6 ? rounded : null;
}

/**
 * Méthode des plus forts restes (Hamilton) : chacun reçoit la partie entière de sa part exacte,
 * puis les unités restantes vont aux plus grands restes, à égalité dans l'ordre d'entrée.
 */
export function allocateProportionally(
  amount: MinorUnits,
  weights: readonly number[],
): MinorUnits[] {
  const total = weights.reduce((sum, w) => sum + BigInt(w), 0n);
  if (total <= 0n) throw new SplitError('INVALID_VALUE', 'La somme des poids doit être positive.');

  const big = BigInt(amount);
  const parts = weights.map((weight, index) => {
    const product = big * BigInt(weight);
    return { index, base: product / total, remainder: product % total };
  });

  let leftover = big - parts.reduce((sum, p) => sum + p.base, 0n);
  const byRemainder = [...parts].sort((a, b) =>
    a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1,
  );
  for (const part of byRemainder) {
    if (leftover === 0n) break;
    part.base += 1n;
    leftover -= 1n;
  }
  return parts.map((p) => Number(p.base));
}

function invalidValue(participantId: string, value: number, reason: string): SplitError {
  return new SplitError('INVALID_VALUE', `Valeur invalide pour un concerné : ${reason}.`, {
    participantId,
    value,
  });
}

function assertDistinct(participantIds: readonly string[]): void {
  if (participantIds.length === 0) {
    throw new SplitError('NO_PARTICIPANTS', 'Au moins une personne doit être concernée.');
  }
  const seen = new Set<string>();
  for (const id of participantIds) {
    if (seen.has(id)) {
      throw new SplitError('DUPLICATE_PARTICIPANT', 'Une personne est concernée deux fois.', {
        participantId: id,
      });
    }
    seen.add(id);
  }
}

/** Calcule la part de chaque concerné. Lève une `SplitError` si l'entrée est incohérente. */
export function computeSplit(amount: MinorUnits, distribution: DistributionInput): ComputedShare[] {
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > MAX_TRANSACTION_AMOUNT) {
    throw new SplitError('INVALID_AMOUNT', 'Le montant doit être un nombre de centimes positif.', {
      amount,
    });
  }

  if (distribution.mode === 'EQUAL') {
    assertDistinct(distribution.participantIds);
    const values = allocateProportionally(
      amount,
      distribution.participantIds.map(() => 1),
    );
    return distribution.participantIds.map((participantId, i) => ({
      participantId,
      inputValue: 1,
      amount: values[i] ?? 0,
    }));
  }

  const { shares } = distribution;
  assertDistinct(shares.map((s) => s.participantId));

  switch (distribution.mode) {
    case 'SHARES': {
      const weights = shares.map(({ participantId, value }) => {
        const hundredths = toHundredths(value);
        if (hundredths === null || hundredths <= 0 || value > MAX_SHARE_VALUE) {
          throw invalidValue(
            participantId,
            value,
            `parts > 0, au plus ${String(MAX_SHARE_VALUE)}, 2 décimales`,
          );
        }
        return hundredths;
      });
      const values = allocateProportionally(amount, weights);
      return shares.map((s, i) => ({ ...s, inputValue: s.value, amount: values[i] ?? 0 }));
    }

    case 'PERCENT': {
      const basisPoints = shares.map(({ participantId, value }) => {
        const hundredths = toHundredths(value);
        if (hundredths === null || hundredths <= 0 || hundredths > 10_000) {
          throw invalidValue(
            participantId,
            value,
            'pourcentage entre 0 et 100 exclus 0, 2 décimales',
          );
        }
        return hundredths;
      });
      const total = basisPoints.reduce((a, b) => a + b, 0);
      if (total !== 10_000) {
        throw new SplitError('PERCENT_NOT_100', 'La somme des pourcentages doit faire 100 %.', {
          totalPercent: total / 100,
        });
      }
      const values = allocateProportionally(amount, basisPoints);
      return shares.map((s, i) => ({ ...s, inputValue: s.value, amount: values[i] ?? 0 }));
    }

    case 'AMOUNT': {
      for (const { participantId, value } of shares) {
        if (!Number.isSafeInteger(value) || value < 0) {
          throw invalidValue(participantId, value, 'montant en centimes, entier positif ou nul');
        }
      }
      const total = shares.reduce((sum, s) => sum + s.value, 0);
      if (total !== amount) {
        throw new SplitError(
          'AMOUNT_SUM_MISMATCH',
          'La somme des montants doit être égale au montant de l’opération.',
          { expected: amount, actual: total, difference: amount - total },
        );
      }
      return shares.map((s) => ({
        participantId: s.participantId,
        inputValue: s.value,
        amount: s.value,
      }));
    }
  }
}
