import { describe, expect, it } from 'vitest';
import { isActionAllowed, type NikountAction, type NikountLifecycleState } from '../src/index.js';

/** Matrice attendue, recopiée de docs/product.md §4 (un changement doit être délibéré). */
const expected: Record<NikountAction, Record<NikountLifecycleState, boolean>> = {
  MANAGE_PARTICIPANTS: { OPEN: true, SETTLEMENT: true, CLOSED: false },
  CREATE_EXPENSE: { OPEN: true, SETTLEMENT: false, CLOSED: false },
  CREATE_REIMBURSEMENT: { OPEN: true, SETTLEMENT: true, CLOSED: false },
  REVIEW_PENDING: { OPEN: true, SETTLEMENT: true, CLOSED: false },
  EDIT_OR_CANCEL: { OPEN: true, SETTLEMENT: true, CLOSED: false },
};

describe('isActionAllowed', () => {
  const cases = Object.entries(expected).flatMap(([action, byState]) =>
    Object.entries(byState).map(
      ([state, allowed]) =>
        [action as NikountAction, state as NikountLifecycleState, allowed] as const,
    ),
  );

  it.each(cases)('%s en %s → %s', (action, state, allowed) => {
    expect(isActionAllowed(action, state)).toBe(allowed);
  });

  it('un nikount clôturé n’autorise plus rien', () => {
    for (const action of Object.keys(expected) as NikountAction[]) {
      expect(isActionAllowed(action, 'CLOSED')).toBe(false);
    }
  });
});
