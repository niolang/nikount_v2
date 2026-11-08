import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, count, eq } from 'drizzle-orm';
import {
  ErrorResponse,
  ParticipantListResponse,
  TransactionListResponse,
  TransactionRevisionListResponse,
  TransactionView,
} from '@nikount/contracts';
import {
  auditEvent,
  financialTransaction,
  nikount,
  transactionRevision,
} from '../src/db/schema.js';
import { hashToken } from '../src/lib/tokens.js';
import type { AppInstance } from '../src/lib/types.js';
import {
  bearer,
  buildTestApp,
  createNikountViaApi,
  createTestDatabase,
  type TestDatabase,
} from './helpers.js';

let testDb: TestDatabase;
let app: AppInstance;

beforeAll(async () => {
  testDb = await createTestDatabase();
  app = await buildTestApp(testDb.db);
});

afterAll(async () => {
  await app.close();
  await testDb.close();
});

const errorCode = (body: unknown) => ErrorResponse.parse(body).error.code;

/** Nikount « Weekend » : Nicolas (admin, ordre 0), Alice, Bob, Charlie. */
async function setup() {
  const created = await createNikountViaApi(app, {
    name: 'Weekend',
    adminLabel: 'Nicolas',
    participants: ['Alice', 'Bob', 'Charlie'],
  });
  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/participants',
    headers: bearer(created.adminToken),
  });
  const list = ParticipantListResponse.parse(response.json()).participants;
  const id = (name: string) => {
    const found = list.find((p) => p.name === name);
    if (!found) throw new Error(`${name} introuvable`);
    return found.id;
  };
  return {
    ...created,
    nicolas: id('Nicolas'),
    alice: id('Alice'),
    bob: id('Bob'),
    charlie: id('Charlie'),
  };
}

type Setup = Awaited<ReturnType<typeof setup>>;

function expense(s: Setup, overrides: Record<string, unknown> = {}) {
  return {
    clientRequestId: randomUUID(),
    type: 'EXPENSE',
    amount: 12000,
    description: 'Restaurant',
    category: 'FOOD',
    occurredOn: '2026-09-28',
    payerId: s.alice,
    distribution: { mode: 'EQUAL', participantIds: [s.nicolas, s.alice, s.bob, s.charlie] },
    ...overrides,
  };
}

function post(token: string, payload: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/transactions',
    headers: bearer(token),
    payload,
  });
}

const sharesOf = (view: TransactionView) => view.shares.map((s) => [s.inputValue, s.amount]);

describe('création par un admin', () => {
  it('est validée d’emblée, attribuée à l’admin et répartie à parts égales', async () => {
    const s = await setup();
    const response = await post(s.adminToken, expense(s));

    expect(response.statusCode).toBe(201);
    const view = TransactionView.parse(response.json());
    expect(view).toMatchObject({
      type: 'EXPENSE',
      status: 'VALIDATED',
      amount: 12000,
      description: 'Restaurant',
      category: 'FOOD',
      occurredOn: '2026-09-28',
      payerId: s.alice,
      distributionMode: 'EQUAL',
      createdBy: { kind: 'ADMIN', admin: { id: s.admin.id, label: 'Nicolas' } },
      validatedBy: { id: s.admin.id, label: 'Nicolas' },
      version: 1,
    });
    expect(view.createdBy.declaredParticipantId).toBe(s.nicolas);
    expect(view.validatedAt).not.toBeNull();
    expect(sharesOf(view)).toEqual([
      [1, 3000],
      [1, 3000],
      [1, 3000],
      [1, 3000],
    ]);
  });

  it('enregistre la révision 1 et un événement d’audit', async () => {
    const s = await setup();
    const view = TransactionView.parse((await post(s.adminToken, expense(s))).json());

    const revisions = await testDb.db
      .select()
      .from(transactionRevision)
      .where(eq(transactionRevision.transactionId, view.id));
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({ revision: 1, changedByKind: 'ADMIN' });
    expect(revisions[0]?.snapshot).toMatchObject({ amount: 12000, snapshotVersion: 1 });

    const [event] = await testDb.db
      .select()
      .from(auditEvent)
      .where(and(eq(auditEvent.entityId, view.id), eq(auditEvent.action, 'transaction.created')));
    expect(event).toMatchObject({
      actorKind: 'ADMIN',
      data: { status: 'VALIDATED', amount: 12000 },
    });
  });
});

describe('création par un participant', () => {
  it('est EN ATTENTE, avec l’auteur déclaré', async () => {
    const s = await setup();
    const response = await post(
      s.participantToken,
      expense(s, { payerId: s.bob, declaredByParticipantId: s.bob }),
    );

    expect(response.statusCode).toBe(201);
    const view = TransactionView.parse(response.json());
    expect(view).toMatchObject({
      status: 'PENDING',
      validatedAt: null,
      validatedBy: null,
      createdBy: { kind: 'PARTICIPANT', admin: null, declaredParticipantId: s.bob },
    });
  });

  it('accepte une saisie sans auteur déclaré', async () => {
    const s = await setup();
    const view = TransactionView.parse((await post(s.participantToken, expense(s))).json());
    expect(view.createdBy.declaredParticipantId).toBeNull();
  });

  it('refuse un auteur déclaré qui n’est pas un participant actif', async () => {
    const s = await setup();
    const response = await post(
      s.participantToken,
      expense(s, { declaredByParticipantId: randomUUID() }),
    );
    expect(response.statusCode).toBe(400);
    expect(errorCode(response.json())).toBe('DECLARED_PARTICIPANT_INVALID');
  });

  it('ne peut pas imposer un statut (champ refusé)', async () => {
    const s = await setup();
    const response = await post(s.participantToken, expense(s, { status: 'VALIDATED' }));
    expect(response.statusCode).toBe(400);
  });
});

describe('modes de répartition (exemples du cahier des charges)', () => {
  it('par parts : 1, 1, 2, 2 → 20, 20, 40, 40 €', async () => {
    const s = await setup();
    const view = TransactionView.parse(
      (
        await post(
          s.adminToken,
          expense(s, {
            distribution: {
              mode: 'SHARES',
              shares: [
                { participantId: s.nicolas, value: 1 },
                { participantId: s.alice, value: 1 },
                { participantId: s.bob, value: 2 },
                { participantId: s.charlie, value: 2 },
              ],
            },
          }),
        )
      ).json(),
    );
    expect(sharesOf(view)).toEqual([
      [1, 2000],
      [1, 2000],
      [2, 4000],
      [2, 4000],
    ]);
  });

  it('par pourcentage : 25, 25, 30, 20 % → 30, 30, 36, 24 €', async () => {
    const s = await setup();
    const view = TransactionView.parse(
      (
        await post(
          s.adminToken,
          expense(s, {
            distribution: {
              mode: 'PERCENT',
              shares: [
                { participantId: s.nicolas, value: 25 },
                { participantId: s.alice, value: 25 },
                { participantId: s.bob, value: 30 },
                { participantId: s.charlie, value: 20 },
              ],
            },
          }),
        )
      ).json(),
    );
    expect(sharesOf(view)).toEqual([
      [25, 3000],
      [25, 3000],
      [30, 3600],
      [20, 2400],
    ]);
  });

  it('par montant : valeurs reprises telles quelles', async () => {
    const s = await setup();
    const view = TransactionView.parse(
      (
        await post(
          s.adminToken,
          expense(s, {
            amount: 8600,
            distribution: {
              mode: 'AMOUNT',
              shares: [
                { participantId: s.alice, value: 2000 },
                { participantId: s.bob, value: 2000 },
                { participantId: s.charlie, value: 4600 },
              ],
            },
          }),
        )
      ).json(),
    );
    expect(sharesOf(view)).toEqual([
      [2000, 2000],
      [2000, 2000],
      [4600, 4600],
    ]);
  });

  it('le centime d’arrondi suit l’ordre des participants, pas l’ordre envoyé', async () => {
    const s = await setup();
    const view = TransactionView.parse(
      (
        await post(
          s.adminToken,
          expense(s, {
            amount: 10000,
            distribution: { mode: 'EQUAL', participantIds: [s.charlie, s.bob, s.alice] },
          }),
        )
      ).json(),
    );
    expect(view.shares.map((share) => [share.participantId, share.amount])).toEqual([
      [s.alice, 3334],
      [s.bob, 3333],
      [s.charlie, 3333],
    ]);
  });
});

describe('idempotence', () => {
  it('un double envoi ne crée qu’une opération (201 puis 200, même id)', async () => {
    const s = await setup();
    const body = expense(s);
    const first = await post(s.participantToken, body);
    const second = await post(s.participantToken, body);

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(TransactionView.parse(second.json()).id).toBe(TransactionView.parse(first.json()).id);

    const [row] = await testDb.db
      .select({ total: count() })
      .from(financialTransaction)
      .where(eq(financialTransaction.clientRequestId, body.clientRequestId));
    expect(row?.total).toBe(1);
  });

  it('deux envois simultanés ne créent qu’une opération', async () => {
    const s = await setup();
    const body = expense(s);
    const responses = await Promise.all([
      post(s.adminToken, body),
      post(s.adminToken, body),
      post(s.adminToken, body),
    ]);
    const ids = new Set(responses.map((r) => TransactionView.parse(r.json()).id));
    expect(ids.size).toBe(1);
    expect(responses.filter((r) => r.statusCode === 201)).toHaveLength(1);
  });
});

describe('refus', () => {
  it.each([
    [
      'pourcentages ≠ 100 %',
      (s: Setup) => ({
        distribution: {
          mode: 'PERCENT',
          shares: [
            { participantId: s.alice, value: 60 },
            { participantId: s.bob, value: 30 },
          ],
        },
      }),
      'SPLIT_PERCENT_NOT_100',
    ],
    [
      'montants ≠ total',
      (s: Setup) => ({
        distribution: {
          mode: 'AMOUNT',
          shares: [
            { participantId: s.alice, value: 6000 },
            { participantId: s.bob, value: 5999 },
          ],
        },
      }),
      'SPLIT_AMOUNT_SUM_MISMATCH',
    ],
    [
      'concerné en double',
      (s: Setup) => ({ distribution: { mode: 'EQUAL', participantIds: [s.alice, s.alice] } }),
      'SPLIT_DUPLICATE_PARTICIPANT',
    ],
    ['payeur inconnu', () => ({ payerId: randomUUID() }), 'PAYER_INVALID'],
    [
      'concerné inconnu',
      (s: Setup) => ({ distribution: { mode: 'EQUAL', participantIds: [s.alice, randomUUID()] } }),
      'PARTICIPANT_INVALID',
    ],
  ] as const)('%s', async (_label, override, code) => {
    const s = await setup();
    const response = await post(s.adminToken, expense(s, override(s)));
    expect(response.statusCode).toBe(400);
    expect(errorCode(response.json())).toBe(code);
  });

  it.each([
    ['montant nul', { amount: 0 }],
    ['montant décimal', { amount: 12.5 }],
    ['montant trop grand', { amount: 100_000_001 }],
    ['description vide', { description: '  ' }],
    ['description trop longue', { description: 'x'.repeat(81) }],
    ['date invalide', { occurredOn: '2026-02-30' }],
    ['catégorie inconnue', { category: 'CASINO' }],
    ['type inconnu', { type: 'GIFT' }],
    ['clientRequestId manquant', { clientRequestId: undefined }],
    ['nikountId fourni', { nikountId: randomUUID() }],
  ])('validation : %s → 400', async (_label, override) => {
    const s = await setup();
    const response = await post(s.adminToken, expense(s, override));
    expect(response.statusCode).toBe(400);
    expect(errorCode(response.json())).toBe('VALIDATION_ERROR');
  });

  it('parts à 3 décimales → 400', async () => {
    const s = await setup();
    const response = await post(
      s.adminToken,
      expense(s, {
        distribution: { mode: 'SHARES', shares: [{ participantId: s.alice, value: 1.005 }] },
      }),
    );
    expect(response.statusCode).toBe(400);
  });

  it('refuse un participant désactivé comme payeur ou concerné', async () => {
    const s = await setup();
    const participants = ParticipantListResponse.parse(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/participants',
          headers: bearer(s.adminToken),
        })
      ).json(),
    ).participants;
    const charlie = participants.find((p) => p.id === s.charlie);
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/participants/${s.charlie}`,
      headers: bearer(s.adminToken),
      payload: { isActive: false, version: charlie?.version },
    });

    const asPayer = await post(s.adminToken, expense(s, { payerId: s.charlie }));
    expect(errorCode(asPayer.json())).toBe('PAYER_INVALID');
    const asConcerned = await post(s.adminToken, expense(s));
    expect(errorCode(asConcerned.json())).toBe('PARTICIPANT_INVALID');
  });

  it('refuse un participant d’un AUTRE nikount (payeur ou concerné)', async () => {
    const a = await setup();
    const b = await setup();
    const asPayer = await post(a.adminToken, expense(a, { payerId: b.alice }));
    expect(errorCode(asPayer.json())).toBe('PAYER_INVALID');
    const asConcerned = await post(
      a.adminToken,
      expense(a, { distribution: { mode: 'EQUAL', participantIds: [a.alice, b.bob] } }),
    );
    expect(errorCode(asConcerned.json())).toBe('PARTICIPANT_INVALID');
  });
});

describe('remboursements (même moteur)', () => {
  const reimbursement = (s: Setup, overrides: Record<string, unknown> = {}) =>
    expense(s, {
      type: 'REIMBURSEMENT',
      amount: 3000,
      description: 'Remboursement',
      category: null,
      payerId: s.bob,
      distribution: { mode: 'EQUAL', participantIds: [s.alice] },
      ...overrides,
    });

  it('Bob → Alice 30 € : un payeur, un seul bénéficiaire', async () => {
    const s = await setup();
    const response = await post(s.adminToken, reimbursement(s));
    expect(response.statusCode).toBe(201);
    const view = TransactionView.parse(response.json());
    expect(view).toMatchObject({ type: 'REIMBURSEMENT', payerId: s.bob, status: 'VALIDATED' });
    expect(view.shares).toEqual([{ participantId: s.alice, inputValue: 1, amount: 3000 }]);
  });

  it.each([
    ['vers soi-même', (s: Setup) => ({ distribution: { mode: 'EQUAL', participantIds: [s.bob] } })],
    [
      'vers deux personnes',
      (s: Setup) => ({ distribution: { mode: 'EQUAL', participantIds: [s.alice, s.charlie] } }),
    ],
    [
      'réparti par montant',
      (s: Setup) => ({
        distribution: { mode: 'AMOUNT', shares: [{ participantId: s.alice, value: 3000 }] },
      }),
    ],
  ] as const)('refuse un remboursement %s', async (_label, override) => {
    const s = await setup();
    const response = await post(s.adminToken, reimbursement(s, override(s)));
    expect(response.statusCode).toBe(400);
    expect(errorCode(response.json())).toBe('REIMBURSEMENT_INVALID');
  });
});

describe('état du nikount', () => {
  async function setState(s: Setup, state: 'SETTLEMENT' | 'CLOSED') {
    await testDb.db
      .update(nikount)
      .set({ state })
      .where(eq(nikount.participantTokenHash, hashToken(s.participantToken)));
  }

  it('en règlement : plus de dépense, mais les remboursements restent possibles', async () => {
    const s = await setup();
    await setState(s, 'SETTLEMENT');

    const newExpense = await post(s.adminToken, expense(s));
    expect(newExpense.statusCode).toBe(409);
    expect(errorCode(newExpense.json())).toBe('INVALID_STATE');

    const refund = await post(
      s.adminToken,
      expense(s, {
        type: 'REIMBURSEMENT',
        payerId: s.bob,
        distribution: { mode: 'EQUAL', participantIds: [s.alice] },
      }),
    );
    expect(refund.statusCode).toBe(201);
  });

  it('clôturé : plus aucune opération', async () => {
    const s = await setup();
    await setState(s, 'CLOSED');
    expect((await post(s.adminToken, expense(s))).statusCode).toBe(409);
    expect(
      (
        await post(
          s.adminToken,
          expense(s, {
            type: 'REIMBURSEMENT',
            payerId: s.bob,
            distribution: { mode: 'EQUAL', participantIds: [s.alice] },
          }),
        )
      ).statusCode,
    ).toBe(409);
  });
});

describe('lecture', () => {
  it('liste les opérations du nikount, plus récentes d’abord', async () => {
    const s = await setup();
    await post(s.adminToken, expense(s, { description: 'Vendredi', occurredOn: '2026-09-26' }));
    await post(
      s.participantToken,
      expense(s, { description: 'Dimanche', occurredOn: '2026-09-28' }),
    );
    await post(s.adminToken, expense(s, { description: 'Samedi', occurredOn: '2026-09-27' }));

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/transactions',
      headers: bearer(s.participantToken),
    });
    const { transactions } = TransactionListResponse.parse(response.json());
    expect(transactions.map((t) => [t.description, t.status])).toEqual([
      ['Dimanche', 'PENDING'],
      ['Samedi', 'VALIDATED'],
      ['Vendredi', 'VALIDATED'],
    ]);
    expect(transactions.every((t) => t.shares.length === 4)).toBe(true);
  });

  it('détail d’une opération ; 404 depuis un autre nikount ; 400 si id mal formé', async () => {
    const a = await setup();
    const b = await setup();
    const view = TransactionView.parse((await post(a.adminToken, expense(a))).json());

    const own = await app.inject({
      method: 'GET',
      url: `/api/v1/transactions/${view.id}`,
      headers: bearer(a.participantToken),
    });
    expect(TransactionView.parse(own.json())).toEqual(view);

    for (const token of [b.participantToken, b.adminToken]) {
      const other = await app.inject({
        method: 'GET',
        url: `/api/v1/transactions/${view.id}`,
        headers: bearer(token),
      });
      expect(other.statusCode).toBe(404);
    }
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/transactions',
      headers: bearer(b.adminToken),
    });
    expect(TransactionListResponse.parse(list.json()).transactions).toEqual([]);

    const malformed = await app.inject({
      method: 'GET',
      url: '/api/v1/transactions/abc',
      headers: bearer(a.adminToken),
    });
    expect(malformed.statusCode).toBe(400);
  });

  it('exige un token', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/transactions' });
    expect(response.statusCode).toBe(401);
  });
});

describe('historique d’une opération', () => {
  it('expose les traces d’annulation (qui, quand, motif)', async () => {
    const s = await setup();
    const view = TransactionView.parse((await post(s.adminToken, expense(s))).json());
    expect(view).toMatchObject({ cancelledAt: null, cancelledBy: null, rejectedAt: null });

    // L'annulation par l'interface arrive en Phase 7 : on la simule en base.
    await testDb.db
      .update(financialTransaction)
      .set({
        status: 'CANCELLED',
        cancelledAt: new Date('2026-09-28T20:14:00Z'),
        cancelledByAdminId: s.admin.id,
        cancellationReason: 'Doublon',
      })
      .where(eq(financialTransaction.id, view.id));

    const detail = TransactionView.parse(
      (
        await app.inject({
          method: 'GET',
          url: `/api/v1/transactions/${view.id}`,
          headers: bearer(s.participantToken),
        })
      ).json(),
    );
    expect(detail).toMatchObject({
      status: 'CANCELLED',
      cancelledAt: '2026-09-28T20:14:00.000Z',
      cancelledBy: { id: s.admin.id, label: 'Nicolas' },
      cancellationReason: 'Doublon',
    });
  });

  it('liste les versions : la création est la version 1', async () => {
    const s = await setup();
    const view = TransactionView.parse(
      (await post(s.participantToken, expense(s, { declaredByParticipantId: s.bob }))).json(),
    );
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/transactions/${view.id}/revisions`,
      headers: bearer(s.participantToken),
    });
    expect(response.statusCode).toBe(200);
    const { revisions } = TransactionRevisionListResponse.parse(response.json());
    expect(revisions).toEqual([
      {
        revision: 1,
        createdAt: expect.any(String) as unknown,
        changedBy: { kind: 'PARTICIPANT', admin: null, declaredParticipantId: s.bob },
        reason: null,
      },
    ]);
  });

  it('versions d’une opération d’un autre nikount → 404', async () => {
    const a = await setup();
    const b = await setup();
    const view = TransactionView.parse((await post(a.adminToken, expense(a))).json());
    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/transactions/${view.id}/revisions`,
      headers: bearer(b.adminToken),
    });
    expect(response.statusCode).toBe(404);
  });
});
