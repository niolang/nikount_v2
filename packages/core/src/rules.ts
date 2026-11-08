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
  | 'EDIT_OR_CANCEL'
  | 'RENAME_NIKOUNT'
  | 'MANAGE_ADMINS'
  | 'ROTATE_PARTICIPANT_LINK';

const ALL_STATES = ['OPEN', 'SETTLEMENT', 'CLOSED'] as const;

const ALLOWED: Record<NikountAction, readonly NikountLifecycleState[]> = {
  MANAGE_PARTICIPANTS: ['OPEN', 'SETTLEMENT'],
  CREATE_EXPENSE: ['OPEN'],
  CREATE_REIMBURSEMENT: ['OPEN', 'SETTLEMENT'],
  REVIEW_PENDING: ['OPEN', 'SETTLEMENT'],
  // D8 : corrections encore possibles en phase de règlement.
  EDIT_OR_CANCEL: ['OPEN', 'SETTLEMENT'],
  // Clôturé : « admins & nom seulement » (product.md §4). Changer le lien du groupe reste
  // possible : c'est une mesure de sécurité (lien divulgué), pas une modification comptable.
  RENAME_NIKOUNT: ALL_STATES,
  MANAGE_ADMINS: ALL_STATES,
  ROTATE_PARTICIPANT_LINK: ALL_STATES,
};

/** L'action est-elle permise dans cet état du nikount ? */
export function isActionAllowed(action: NikountAction, state: NikountLifecycleState): boolean {
  return ALLOWED[action].includes(state);
}

/** Changements d'état du nikount (docs/product.md §4, D7). */
export type NikountTransition = 'FINISH' | 'UNLOCK' | 'CLOSE' | 'REOPEN';

export interface NikountTransitionRule {
  transition: NikountTransition;
  from: NikountLifecycleState;
  to: NikountLifecycleState;
  /** Réouverture d'un nikount clos : action exceptionnelle, motif obligatoire. */
  reasonRequired: boolean;
  /** Clôture : refusée tant qu'il reste des opérations en attente. */
  requiresNoPending: boolean;
}

export const NIKOUNT_TRANSITIONS: readonly NikountTransitionRule[] = [
  {
    transition: 'FINISH',
    from: 'OPEN',
    to: 'SETTLEMENT',
    reasonRequired: false,
    requiresNoPending: false,
  },
  {
    transition: 'UNLOCK',
    from: 'SETTLEMENT',
    to: 'OPEN',
    reasonRequired: false,
    requiresNoPending: false,
  },
  {
    transition: 'CLOSE',
    from: 'SETTLEMENT',
    to: 'CLOSED',
    reasonRequired: false,
    requiresNoPending: true,
  },
  {
    transition: 'REOPEN',
    from: 'CLOSED',
    to: 'SETTLEMENT',
    reasonRequired: true,
    requiresNoPending: false,
  },
];

/** Règle du passage `from → to`, ou `null` si ce changement d'état n'existe pas. */
export function nikountTransition(
  from: NikountLifecycleState,
  to: NikountLifecycleState,
): NikountTransitionRule | null {
  return NIKOUNT_TRANSITIONS.find((t) => t.from === from && t.to === to) ?? null;
}

/** Changements d'état possibles depuis `from`, dans l'ordre d'affichage. */
export function transitionsFrom(from: NikountLifecycleState): NikountTransitionRule[] {
  return NIKOUNT_TRANSITIONS.filter((t) => t.from === from);
}
