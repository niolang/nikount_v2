import { describe, expect, it } from 'vitest';
import { ErrorResponse, NikountState, TransactionStatus } from '../src/index.js';

describe('contracts', () => {
  it('expose les états du nikount figés', () => {
    expect(NikountState.options).toEqual(['OPEN', 'SETTLEMENT', 'CLOSED']);
  });

  it('expose les statuts d’opération figés', () => {
    expect(TransactionStatus.options).toEqual(['PENDING', 'VALIDATED', 'REJECTED', 'CANCELLED']);
  });

  it('valide le format d’erreur', () => {
    const parsed = ErrorResponse.safeParse({
      error: { code: 'NOT_FOUND', message: 'Introuvable' },
      requestId: 'req-1',
    });
    expect(parsed.success).toBe(true);
  });
});
