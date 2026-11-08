import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import {
  BalancesResponse,
  ErrorResponse,
  ParticipantListResponse,
  TransactionListResponse,
  TransactionView,
} from '@nikount/contracts';
import { auditEvent, nikount } from '../src/db/schema.js';
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

async function setup() {
  const created = await createNikountViaApi(app, {
    name: 'Weekend',
    adminLabel: 'Nicolas',
    adminIsParticipant: false,
    participants: ['Alice', 'Bob'],
  });
  const { participants } = ParticipantListResponse.parse(
    (
      await app.inject({
        method: 'GET',
        url: '/api/v1/participants',
        headers: bearer(created.adminToken),
      })
    ).json(),
  );
  const [alice, bob] = participants.map((p) => p.id);
  return { ...created, alice: alice ?? '', bob: bob ?? '' };
}

type Setup = Awaited<ReturnType<typeof setup>>;

/** Dépense de 10 € payée par Alice pour Alice et Bob ; en attente si saisie par un participant. */
async function expense(s: Setup, token: string, amount = 1000) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/transactions',
    headers: bearer(token),
    payload: {
      clientRequestId: randomUUID(),
      type: 'EXPENSE',
      amount,
      description: 'Test',
      occurredOn: '2026-09-28',
      payerId: s.alice,
      distribution: { mode: 'EQUAL', participantIds: [s.alice, s.bob] },
    },
  });
  return TransactionView.parse(response.json());
}

function act(token: string, id: string, action: string, payload?: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: `/api/v1/transactions/${id}/${action}`,
    headers: bearer(token),
    ...(payload === undefined ? {} : { payload }),
  });
}

function bulk(token: string, payload: Record<string, unknown>) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/transactions/bulk',
    headers: bearer(token),
    payload,
  });
}

async function balanceOf(s: Setup, participantId: string) {
  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/balances',
    headers: bearer(s.adminToken),
  });
  return BalancesResponse.parse(response.json()).balances.find(
    (b) => b.participantId === participantId,
  )?.balance;
}

async function statusOf(s: Setup, id: string) {
  const response = await app.inject({
    method: 'GET',
    url: `/api/v1/transactions/${id}`,
    headers: bearer(s.adminToken),
  });
  return TransactionView.parse(response.json()).status;
}

describe('valider une opération en attente', () => {
  it('la passe en VALIDATED, l’attribue à l’admin et la fait compter dans les soldes', async () => {
    const s = await setup();
    const pending = await expense(s, s.participantToken);
    expect(await balanceOf(s, s.alice)).toBe(0);

    // Corps absent : accepté (aucune option nécessaire pour valider).
    const response = await act(s.adminToken, pending.id, 'validate');
    expect(response.statusCode).toBe(200);
    const view = TransactionView.parse(response.json());
    expect(view).toMatchObject({
      status: 'VALIDATED',
      validatedBy: { id: s.admin.id, label: 'Nicolas' },
      version: 2,
    });
    expect(view.validatedAt).not.toBeNull();
    expect(await balanceOf(s, s.alice)).toBe(500);

    const [event] = await testDb.db
      .select()
      .from(auditEvent)
      .where(
        and(eq(auditEvent.entityId, pending.id), eq(auditEvent.action, 'transaction.validated')),
      );
    expect(event).toMatchObject({
      actorAdminId: s.admin.id,
      data: { from: 'PENDING', to: 'VALIDATED' },
    });
  });

  it('est possible en phase de règlement', async () => {
    const s = await setup();
    const pending = await expense(s, s.participantToken);
    await testDb.db
      .update(nikount)
      .set({ state: 'SETTLEMENT' })
      .where(eq(nikount.participantTokenHash, hashToken(s.participantToken)));
    expect((await act(s.adminToken, pending.id, 'validate', {})).statusCode).toBe(200);
  });
});

describe('refuser', () => {
  it('passe en REJECTED avec motif ; les soldes ne bougent pas ; l’opération reste visible', async () => {
    const s = await setup();
    const pending = await expense(s, s.participantToken);
    const response = await act(s.adminToken, pending.id, 'reject', {
      reason: '  Pas pour ce séjour ',
    });

    expect(response.statusCode).toBe(200);
    expect(TransactionView.parse(response.json())).toMatchObject({
      status: 'REJECTED',
      rejectedBy: { id: s.admin.id },
      rejectionReason: 'Pas pour ce séjour',
      validatedAt: null,
    });
    expect(await balanceOf(s, s.alice)).toBe(0);
    const list = TransactionListResponse.parse(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/transactions',
          headers: bearer(s.participantToken),
        })
      ).json(),
    );
    expect(list.transactions.map((t) => t.id)).toContain(pending.id);
  });
});

describe('annuler', () => {
  it('une opération validée : retirée des soldes, gardée dans l’historique avec sa validation', async () => {
    const s = await setup();
    const validated = await expense(s, s.adminToken);
    expect(await balanceOf(s, s.alice)).toBe(500);

    const response = await act(s.adminToken, validated.id, 'cancel', { reason: 'Doublon' });
    expect(response.statusCode).toBe(200);
    expect(TransactionView.parse(response.json())).toMatchObject({
      status: 'CANCELLED',
      cancellationReason: 'Doublon',
      cancelledBy: { id: s.admin.id },
      validatedBy: { id: s.admin.id },
    });
    expect(await balanceOf(s, s.alice)).toBe(0);
  });

  it('une opération en attente', async () => {
    const s = await setup();
    const pending = await expense(s, s.participantToken);
    expect((await act(s.adminToken, pending.id, 'cancel', {})).statusCode).toBe(200);
    expect(await statusOf(s, pending.id)).toBe('CANCELLED');
  });
});

describe('transitions interdites', () => {
  it.each([
    ['valider une opération déjà validée', 'VALIDATED', 'validate'],
    ['refuser une opération validée', 'VALIDATED', 'reject'],
    ['valider une opération refusée', 'REJECTED', 'validate'],
    ['annuler une opération refusée', 'REJECTED', 'cancel'],
    ['valider une opération annulée', 'CANCELLED', 'validate'],
    ['annuler deux fois', 'CANCELLED', 'cancel'],
  ])('%s → 409', async (_label, startStatus, action) => {
    const s = await setup();
    const tx = await expense(s, startStatus === 'VALIDATED' ? s.adminToken : s.participantToken);
    if (startStatus === 'REJECTED') await act(s.adminToken, tx.id, 'reject', {});
    if (startStatus === 'CANCELLED') await act(s.adminToken, tx.id, 'cancel', {});

    const response = await act(s.adminToken, tx.id, action, {});
    expect(response.statusCode).toBe(409);
    expect(errorCode(response.json())).toBe('INVALID_STATUS_TRANSITION');
    expect(await statusOf(s, tx.id)).toBe(startStatus);
  });

  it('nikount clôturé → 409 INVALID_STATE', async () => {
    const s = await setup();
    const pending = await expense(s, s.participantToken);
    await testDb.db
      .update(nikount)
      .set({ state: 'CLOSED' })
      .where(eq(nikount.participantTokenHash, hashToken(s.participantToken)));
    const response = await act(s.adminToken, pending.id, 'validate', {});
    expect(errorCode(response.json())).toBe('INVALID_STATE');
  });
});

describe('droits, isolation et concurrence', () => {
  it.each(['validate', 'reject', 'cancel'])(
    'un participant ne peut pas « %s » → 403',
    async (action) => {
      const s = await setup();
      const pending = await expense(s, s.participantToken);
      const response = await act(s.participantToken, pending.id, action, {});
      expect(response.statusCode).toBe(403);
      expect(await statusOf(s, pending.id)).toBe('PENDING');
    },
  );

  it('un admin d’un autre nikount obtient 404, sans effet', async () => {
    const a = await setup();
    const b = await setup();
    const pending = await expense(a, a.participantToken);
    expect((await act(b.adminToken, pending.id, 'validate', {})).statusCode).toBe(404);
    expect(await statusOf(a, pending.id)).toBe('PENDING');
  });

  it('version périmée → 409 VERSION_CONFLICT ; version courante → OK', async () => {
    const s = await setup();
    const pending = await expense(s, s.participantToken);
    const stale = await act(s.adminToken, pending.id, 'validate', { version: 7 });
    expect(errorCode(stale.json())).toBe('VERSION_CONFLICT');
    expect((await act(s.adminToken, pending.id, 'validate', { version: 1 })).statusCode).toBe(200);
  });

  it('deux validations simultanées : une seule réussit', async () => {
    const s = await setup();
    const pending = await expense(s, s.participantToken);
    const responses = await Promise.all([
      act(s.adminToken, pending.id, 'validate', {}),
      act(s.adminToken, pending.id, 'validate', {}),
    ]);
    expect(responses.map((r) => r.statusCode).sort()).toEqual([200, 409]);
  });

  it('motif trop long ou champ inconnu → 400', async () => {
    const s = await setup();
    const pending = await expense(s, s.participantToken);
    expect(
      (await act(s.adminToken, pending.id, 'reject', { reason: 'x'.repeat(201) })).statusCode,
    ).toBe(400);
    expect(
      (await act(s.adminToken, pending.id, 'reject', { status: 'VALIDATED' })).statusCode,
    ).toBe(400);
  });
});

describe('actions en masse (tout ou rien)', () => {
  it('valide plusieurs opérations, dans l’ordre demandé, avec un audit par opération', async () => {
    const s = await setup();
    const ids = [
      (await expense(s, s.participantToken, 1000)).id,
      (await expense(s, s.participantToken, 2000)).id,
      (await expense(s, s.participantToken, 3000)).id,
    ];
    const response = await bulk(s.adminToken, { action: 'validate', ids: [...ids, ids[0]] });

    expect(response.statusCode).toBe(200);
    const { transactions } = TransactionListResponse.parse(response.json());
    expect(transactions.map((t) => [t.id, t.status])).toEqual(ids.map((id) => [id, 'VALIDATED']));
    expect(await balanceOf(s, s.alice)).toBe(3000);

    const events = await testDb.db
      .select()
      .from(auditEvent)
      .where(
        and(inArray(auditEvent.entityId, ids), eq(auditEvent.action, 'transaction.validated')),
      );
    expect(events).toHaveLength(3);
    expect(events.every((e) => e.data['bulk'] === true && e.data['count'] === 3)).toBe(true);
  });

  it('si une seule opération ne peut pas changer, AUCUNE ne change', async () => {
    const s = await setup();
    const pendingA = await expense(s, s.participantToken);
    const pendingB = await expense(s, s.participantToken);
    const alreadyValidated = await expense(s, s.adminToken);

    const response = await bulk(s.adminToken, {
      action: 'validate',
      ids: [pendingA.id, alreadyValidated.id, pendingB.id],
    });
    expect(response.statusCode).toBe(409);
    const body = ErrorResponse.parse(response.json());
    expect(body.error.code).toBe('INVALID_STATUS_TRANSITION');
    expect(body.error.details).toEqual({
      transactions: [{ id: alreadyValidated.id, status: 'VALIDATED' }],
    });
    expect(await statusOf(s, pendingA.id)).toBe('PENDING');
    expect(await statusOf(s, pendingB.id)).toBe('PENDING');
  });

  it('un identifiant inconnu ou d’un autre nikount : 404, aucun changement', async () => {
    const a = await setup();
    const b = await setup();
    const pendingA = await expense(a, a.participantToken);
    const pendingB = await expense(b, b.participantToken);

    for (const intruder of [randomUUID(), pendingB.id]) {
      const response = await bulk(a.adminToken, { action: 'cancel', ids: [pendingA.id, intruder] });
      expect(response.statusCode).toBe(404);
      expect(ErrorResponse.parse(response.json()).error.details).toEqual({ ids: [intruder] });
    }
    expect(await statusOf(a, pendingA.id)).toBe('PENDING');
    expect(await statusOf(b, pendingB.id)).toBe('PENDING');
  });

  it('refus en masse avec motif commun', async () => {
    const s = await setup();
    const ids = [
      (await expense(s, s.participantToken)).id,
      (await expense(s, s.participantToken)).id,
    ];
    const response = await bulk(s.adminToken, { action: 'reject', ids, reason: 'Hors budget' });
    const { transactions } = TransactionListResponse.parse(response.json());
    expect(
      transactions.every((t) => t.status === 'REJECTED' && t.rejectionReason === 'Hors budget'),
    ).toBe(true);
  });

  it.each([
    ['action inconnue', { action: 'delete', ids: [randomUUID()] }],
    ['liste vide', { action: 'validate', ids: [] }],
    [
      'plus de 200 opérations',
      { action: 'validate', ids: Array.from({ length: 201 }, () => randomUUID()) },
    ],
  ])('refuse : %s → 400', async (_label, payload) => {
    const s = await setup();
    expect((await bulk(s.adminToken, payload)).statusCode).toBe(400);
  });

  it('réservé aux admins', async () => {
    const s = await setup();
    const pending = await expense(s, s.participantToken);
    expect(
      (await bulk(s.participantToken, { action: 'validate', ids: [pending.id] })).statusCode,
    ).toBe(403);
  });
});
