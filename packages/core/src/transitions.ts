import { isActionAllowed, type NikountAction, type NikountLifecycleState } from './rules.js';

/**
 * Cycle de vie d'une opération (docs/product.md §10) :
 *
 *   PENDING ──valider──► VALIDATED ──annuler──► CANCELLED
 *      ├──refuser──► REJECTED
 *      └──annuler──► CANCELLED
 *
 * REJECTED et CANCELLED sont terminaux. Rien d'autre n'est possible.
 */
export type TransactionLifecycleStatus = 'PENDING' | 'VALIDATED' | 'REJECTED' | 'CANCELLED';
export type StatusAction = 'VALIDATE' | 'REJECT' | 'CANCEL';

const TRANSITIONS: Record<
  StatusAction,
  { from: readonly TransactionLifecycleStatus[]; to: TransactionLifecycleStatus }
> = {
  VALIDATE: { from: ['PENDING'], to: 'VALIDATED' },
  REJECT: { from: ['PENDING'], to: 'REJECTED' },
  CANCEL: { from: ['PENDING', 'VALIDATED'], to: 'CANCELLED' },
};

/** Règle d'état du nikount qui encadre chaque action (docs/product.md §4). */
const STATE_RULE: Record<StatusAction, NikountAction> = {
  VALIDATE: 'REVIEW_PENDING',
  REJECT: 'REVIEW_PENDING',
  CANCEL: 'EDIT_OR_CANCEL',
};

/** Statut d'arrivée, ou `null` si la transition est interdite depuis ce statut. */
export function nextStatus(
  current: TransactionLifecycleStatus,
  action: StatusAction,
): TransactionLifecycleStatus | null {
  const transition = TRANSITIONS[action];
  return transition.from.includes(current) ? transition.to : null;
}

/** L'état du nikount permet-il cette action ? (ex. rien n'est possible une fois clôturé). */
export function isStatusActionAllowedInState(
  action: StatusAction,
  state: NikountLifecycleState,
): boolean {
  return isActionAllowed(STATE_RULE[action], state);
}

/** Statuts depuis lesquels l'action est possible (utile pour une mise à jour conditionnelle). */
export function allowedSourceStatuses(action: StatusAction): readonly TransactionLifecycleStatus[] {
  return TRANSITIONS[action].from;
}
