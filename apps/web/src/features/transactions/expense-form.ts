import type { DistributionMode, DistributionRequest } from '@nikount/contracts';
import {
  computeSplit,
  parseAmountInput,
  SplitError,
  type ComputedShare,
  type MinorUnits,
} from '@nikount/core';
import { formatMoney, toAmountInput } from '../../lib/format';

/*
 * Logique pure du formulaire de dépense : lecture des saisies, construction de la répartition
 * envoyée à l'API et aperçu calculé avec le MÊME moteur que le serveur (@nikount/core).
 */

export interface DistributionDraft {
  mode: DistributionMode;
  /** Concernés, dans l'ordre d'affichage des participants. */
  concerned: string[];
  /** Saisie brute par participant (parts, pourcentage ou montant selon le mode). */
  values: Record<string, string>;
}

/** « 1,5 » → 1.5 ; 2 décimales au plus ; `null` si la saisie n'est pas un nombre positif. */
export function parseDecimal(text: string): number | null {
  const normalized = text.trim().replace(',', '.');
  return /^\d{1,6}(\.\d{1,2})?$/.test(normalized) ? Number(normalized) : null;
}

export type DraftResult =
  { ok: true; distribution: DistributionRequest } | { ok: false; message: string };

/** Construit la répartition à partir des saisies, ou explique ce qui manque. */
export function buildDistribution(draft: DistributionDraft): DraftResult {
  if (draft.concerned.length === 0) return { ok: false, message: 'Cochez au moins une personne.' };
  if (draft.mode === 'EQUAL') {
    return { ok: true, distribution: { mode: 'EQUAL', participantIds: draft.concerned } };
  }

  const shares: { participantId: string; value: number }[] = [];
  for (const participantId of draft.concerned) {
    const text = draft.values[participantId] ?? '';
    const value = draft.mode === 'AMOUNT' ? parseAmountInput(text) : parseDecimal(text);
    if (value === null) {
      const what =
        draft.mode === 'SHARES'
          ? 'un nombre de parts'
          : draft.mode === 'PERCENT'
            ? 'un pourcentage'
            : 'un montant';
      return { ok: false, message: `Indiquez ${what} pour chaque personne cochée.` };
    }
    shares.push({ participantId, value });
  }
  return { ok: true, distribution: { mode: draft.mode, shares } };
}

/** Message lisible pour une incohérence détectée par le moteur. */
export function splitErrorMessage(error: SplitError, currency: string): string {
  switch (error.code) {
    case 'PERCENT_NOT_100':
      return `Total : ${String(Number(error.details?.['totalPercent'])).replace('.', ',')} % — il faut 100 %.`;
    case 'AMOUNT_SUM_MISMATCH': {
      const difference = Number(error.details?.['difference'] ?? 0);
      return difference > 0
        ? `Il reste ${formatMoney(difference, currency)} à répartir.`
        : `${formatMoney(-difference, currency)} de trop.`;
    }
    case 'NO_PARTICIPANTS':
      return 'Cochez au moins une personne.';
    case 'INVALID_VALUE':
      return 'Une valeur saisie est invalide (nombre positif, 2 décimales au plus).';
    case 'DUPLICATE_PARTICIPANT':
    case 'INVALID_AMOUNT':
      return error.message;
  }
}

export type Preview =
  | { status: 'empty' }
  | { status: 'ok'; distribution: DistributionRequest; shares: ComputedShare[] }
  | { status: 'error'; message: string };

/** Aperçu en direct : exactement le calcul que fera le serveur. */
export function previewSplit(
  amount: MinorUnits | null,
  draft: DistributionDraft,
  currency: string,
): Preview {
  if (amount === null || amount <= 0) return { status: 'empty' };
  const built = buildDistribution(draft);
  if (!built.ok) return { status: 'error', message: built.message };
  try {
    return {
      status: 'ok',
      distribution: built.distribution,
      shares: computeSplit(amount, built.distribution),
    };
  } catch (error) {
    if (error instanceof SplitError)
      return { status: 'error', message: splitErrorMessage(error, currency) };
    throw error;
  }
}

/** Brouillon de répartition reprenant une opération existante (modification). */
export function draftFromShares(
  mode: DistributionMode,
  shares: { participantId: string; inputValue: number }[],
): { concerned: Set<string>; values: Record<string, string> } {
  const decimal = (value: number) => String(value).replace('.', ',');
  return {
    concerned: new Set(shares.map((s) => s.participantId)),
    values:
      mode === 'EQUAL'
        ? {}
        : Object.fromEntries(
            shares.map((s) => [
              s.participantId,
              mode === 'AMOUNT' ? toAmountInput(s.inputValue) : decimal(s.inputValue),
            ]),
          ),
  };
}
