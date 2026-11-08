import { describe, expect, it } from 'vitest';
import {
  allowedSourceStatuses,
  isStatusActionAllowedInState,
  nextStatus,
  type StatusAction,
  type TransactionLifecycleStatus,
} from '../src/index.js';

/** Matrice attendue (docs/product.md §10), exhaustive : toute autre transition est interdite. */
const expected: Record<
  StatusAction,
  Record<TransactionLifecycleStatus, TransactionLifecycleStatus | null>
> = {
  VALIDATE: { PENDING: 'VALIDATED', VALIDATED: null, REJECTED: null, CANCELLED: null },
  REJECT: { PENDING: 'REJECTED', VALIDATED: null, REJECTED: null, CANCELLED: null },
  CANCEL: { PENDING: 'CANCELLED', VALIDATED: 'CANCELLED', REJECTED: null, CANCELLED: null },
};

describe('nextStatus', () => {
  const cases = Object.entries(expected).flatMap(([action, row]) =>
    Object.entries(row).map(
      ([from, to]) => [action as StatusAction, from as TransactionLifecycleStatus, to] as const,
    ),
  );

  it.each(cases)('%s depuis %s → %s', (action, from, to) => {
    expect(nextStatus(from, action)).toBe(to);
  });

  it('REJECTED et CANCELLED sont terminaux', () => {
    for (const action of ['VALIDATE', 'REJECT', 'CANCEL'] as const) {
      expect(nextStatus('REJECTED', action)).toBeNull();
      expect(nextStatus('CANCELLED', action)).toBeNull();
    }
  });

  it('les statuts sources correspondent à la matrice', () => {
    expect(allowedSourceStatuses('VALIDATE')).toEqual(['PENDING']);
    expect(allowedSourceStatuses('CANCEL')).toEqual(['PENDING', 'VALIDATED']);
  });
});

describe('isStatusActionAllowedInState', () => {
  it.each([
    ['VALIDATE', 'OPEN', true],
    ['VALIDATE', 'SETTLEMENT', true],
    ['VALIDATE', 'CLOSED', false],
    ['REJECT', 'SETTLEMENT', true],
    ['REJECT', 'CLOSED', false],
    ['CANCEL', 'OPEN', true],
    ['CANCEL', 'SETTLEMENT', true],
    ['CANCEL', 'CLOSED', false],
  ] as const)('%s en %s → %s', (action, state, allowed) => {
    expect(isStatusActionAllowedInState(action, state)).toBe(allowed);
  });
});
