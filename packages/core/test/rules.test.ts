import { describe, expect, it } from 'vitest';
import {
  isActionAllowed,
  nikountTransition,
  transitionsFrom,
  type NikountAction,
  type NikountLifecycleState,
} from '../src/index.js';

/** Matrice attendue, recopiée de docs/product.md §4 (un changement doit être délibéré). */
const expected: Record<NikountAction, Record<NikountLifecycleState, boolean>> = {
  MANAGE_PARTICIPANTS: { OPEN: true, SETTLEMENT: true, CLOSED: false },
  CREATE_EXPENSE: { OPEN: true, SETTLEMENT: false, CLOSED: false },
  CREATE_REIMBURSEMENT: { OPEN: true, SETTLEMENT: true, CLOSED: false },
  REVIEW_PENDING: { OPEN: true, SETTLEMENT: true, CLOSED: false },
  EDIT_OR_CANCEL: { OPEN: true, SETTLEMENT: true, CLOSED: false },
  RENAME_NIKOUNT: { OPEN: true, SETTLEMENT: true, CLOSED: true },
  MANAGE_ADMINS: { OPEN: true, SETTLEMENT: true, CLOSED: true },
  ROTATE_PARTICIPANT_LINK: { OPEN: true, SETTLEMENT: true, CLOSED: true },
};

const STATES: NikountLifecycleState[] = ['OPEN', 'SETTLEMENT', 'CLOSED'];

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

  it('un nikount clôturé n’autorise plus aucune action comptable', () => {
    const accounting: NikountAction[] = [
      'MANAGE_PARTICIPANTS',
      'CREATE_EXPENSE',
      'CREATE_REIMBURSEMENT',
      'REVIEW_PENDING',
      'EDIT_OR_CANCEL',
    ];
    for (const action of accounting) expect(isActionAllowed(action, 'CLOSED')).toBe(false);
  });
});

describe('nikountTransition', () => {
  /** Matrice complète from × to : seules les quatre flèches du diagramme existent. */
  const allowed: Record<string, string> = {
    'OPEN→SETTLEMENT': 'FINISH',
    'SETTLEMENT→OPEN': 'UNLOCK',
    'SETTLEMENT→CLOSED': 'CLOSE',
    'CLOSED→SETTLEMENT': 'REOPEN',
  };
  const cases = STATES.flatMap((from) => STATES.map((to) => [from, to] as const));

  it.each(cases)('%s → %s', (from, to) => {
    expect(nikountTransition(from, to)?.transition ?? null).toBe(allowed[`${from}→${to}`] ?? null);
  });

  it('pas de raccourci OPEN → CLOSED ni CLOSED → OPEN', () => {
    expect(nikountTransition('OPEN', 'CLOSED')).toBeNull();
    expect(nikountTransition('CLOSED', 'OPEN')).toBeNull();
  });

  it('seule la réouverture exige un motif, seule la clôture exige zéro attente', () => {
    expect(nikountTransition('CLOSED', 'SETTLEMENT')?.reasonRequired).toBe(true);
    expect(nikountTransition('SETTLEMENT', 'CLOSED')?.requiresNoPending).toBe(true);
    const others = [
      nikountTransition('OPEN', 'SETTLEMENT'),
      nikountTransition('SETTLEMENT', 'OPEN'),
    ];
    for (const rule of others) {
      expect(rule?.reasonRequired).toBe(false);
      expect(rule?.requiresNoPending).toBe(false);
    }
  });

  it('transitionsFrom liste les sorties de chaque état', () => {
    expect(transitionsFrom('OPEN').map((t) => t.transition)).toEqual(['FINISH']);
    expect(transitionsFrom('SETTLEMENT').map((t) => t.transition)).toEqual(['UNLOCK', 'CLOSE']);
    expect(transitionsFrom('CLOSED').map((t) => t.transition)).toEqual(['REOPEN']);
  });
});
