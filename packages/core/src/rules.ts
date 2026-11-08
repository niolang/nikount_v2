/**
 * Règles métier liées à l'état du nikount (docs/product.md §4).
 * Centralisées ici et testées exhaustivement ; l'API les applique, le front s'en sert pour
 * masquer les actions impossibles.
 */
export type NikountLifecycleState = 'OPEN' | 'SETTLEMENT' | 'CLOSED';

export type NikountAction =
  | 'MANAGE_PARTICIPANTS'
  | 'CREATE_EXPENSE'
  | 'CREATE_REIMBURSEMENT'
  | 'REVIEW_PENDING'
  | 'EDIT_OR_CANCEL';

const ALLOWED: Record<NikountAction, readonly NikountLifecycleState[]> = {
  MANAGE_PARTICIPANTS: ['OPEN', 'SETTLEMENT'],
  CREATE_EXPENSE: ['OPEN'],
  CREATE_REIMBURSEMENT: ['OPEN', 'SETTLEMENT'],
  REVIEW_PENDING: ['OPEN', 'SETTLEMENT'],
  // D8 : corrections encore possibles en phase de règlement.
  EDIT_OR_CANCEL: ['OPEN', 'SETTLEMENT'],
};

/** L'action est-elle permise dans cet état du nikount ? */
export function isActionAllowed(action: NikountAction, state: NikountLifecycleState): boolean {
  return ALLOWED[action].includes(state);
}
