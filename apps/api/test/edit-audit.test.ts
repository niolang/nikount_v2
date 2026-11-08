import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AUDIT_PAGE_SIZE,
  AuditListResponse,
  BalancesResponse,
  ErrorResponse,
  NikountView,
  ParticipantListResponse,
  TransactionRevisionListResponse,
  TransactionView,
  type NikountState,
} from '@nikount/contracts';
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

async function setup(participants = ['Alice', 'Bob', 'Charlie']) {
  const created = await createNikountViaApi(app, {
    name: 'Weekend',
    adminLabel: 'Nicolas',
    participants,
  });
  const list = ParticipantListResponse.parse(
    (
      await app.inject({
        method: 'GET',
        url: '/api/v1/participants',
        headers: bearer(created.adminToken),
      })
    ).json(),
  ).participants;
  const id = (name: string) => list.find((p) => p.name === name)?.id ?? '';
  return {
    ...created,
    nicolas: id('Nicolas'),
    alice: id('Alice'),
    bob: id('Bob'),
    charlie: id('Charlie'),
  };
}
type Setup = Awaited<ReturnType<typeof setup>>;

async function createExpense(s: Setup, token = s.adminToken) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/transactions',
    headers: bearer(token),
    payload: {
      clientRequestId: randomUUID(),
      type: 'EXPENSE',
      amount: 9000,
      description: 'Courses',
      category: 'GROCERIES',
      occurredOn: '2026-11-01',
      payerId: s.alice,
      distribution: { mode: 'EQUAL', participantIds: [s.alice, s.bob, s.charlie] },
      ...(token === s.participantToken ? { declaredByParticipantId: s.bob } : {}),
    },
  });
  expect(response.statusCode, response.body).toBe(201);
  return TransactionView.parse(response.json());
}

/** Corps de modification reprenant l'opération telle quelle, avec des changements. */
function bodyFrom(tx: TransactionView, changes: Record<string, unknown> = {}) {
  return {
    amount: tx.amount,
    description: tx.description,
    category: tx.category,
    occurredOn: tx.occurredOn,
    payerId: tx.payerId,
    distribution: { mode: 'EQUAL', participantIds: tx.shares.map((sh) => sh.participantId) },
    version: tx.version,
    ...changes,
  };
}

const put = (token: string, id: string, payload: Record<string, unknown>) =>
  app.inject({ method: 'PUT', url: `/api/v1/transactions/${id}`, headers: bearer(token), payload });

async function balances(s: Setup) {
  const { balances: list } = BalancesResponse.parse(
    (
      await app.inject({ method: 'GET', url: '/api/v1/balances', headers: bearer(s.adminToken) })
    ).json(),
  );
  return Object.fromEntries(list.map((b) => [b.participantId, b.balance]));
}

async function moveTo(s: Setup, target: NikountState, steps?: NikountState[]) {
  const path: NikountState[] = steps ?? (target === 'CLOSED' ? ['SETTLEMENT', 'CLOSED'] : [target]);
  for (const to of path) {
    const { version } = NikountView.parse(
      (
        await app.inject({ method: 'GET', url: '/api/v1/nikount', headers: bearer(s.adminToken) })
      ).json(),
    );
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/nikount/state',
      headers: bearer(s.adminToken),
      payload: { to, version },
    });
    expect(response.statusCode, response.body).toBe(200);
  }
}

const audit = async (token: string, query = '') => {
  const response = await app.inject({
    method: 'GET',
    url: `/api/v1/audit${query}`,
    headers: bearer(token),
  });
  return response;
};

describe('PUT /transactions/:id', () => {
  it('remplace le contenu, recalcule les parts et met à jour les soldes', async () => {
    const s = await setup();
    const tx = await createExpense(s);
    expect((await balances(s))[s.bob]).toBe(-3000);

    const response = await put(
      s.adminToken,
      tx.id,
      bodyFrom(tx, {
        amount: 6000,
        description: 'Courses du samedi',
        payerId: s.bob,
        distribution: {
          mode: 'SHARES',
          shares: [
            { participantId: s.alice, value: 2 },
            { participantId: s.charlie, value: 1 },
          ],
        },
        reason: 'Ticket corrigé',
      }),
    );
    expect(response.statusCode, response.body).toBe(200);
    const updated = TransactionView.parse(response.json());
    expect(updated).toMatchObject({
      amount: 6000,
      description: 'Courses du samedi',
      payerId: s.bob,
      distributionMode: 'SHARES',
      status: 'VALIDATED',
      version: tx.version + 1,
    });
    expect(updated.shares).toEqual([
      { participantId: s.alice, inputValue: 2, amount: 4000 },
      { participantId: s.charlie, inputValue: 1, amount: 2000 },
    ]);

    const after = await balances(s);
    expect(after[s.alice]).toBe(-4000);
    expect(after[s.bob]).toBe(6000);
    expect(after[s.charlie]).toBe(-2000);

    const { revisions } = TransactionRevisionListResponse.parse(
      (
        await app.inject({
          method: 'GET',
          url: `/api/v1/transactions/${tx.id}/revisions`,
          headers: bearer(s.adminToken),
        })
      ).json(),
    );
    expect(revisions.map((r) => [r.revision, r.reason, r.changedBy.admin?.label])).toEqual([
      [1, null, 'Nicolas'],
      [2, 'Ticket corrigé', 'Nicolas'],
    ]);
  });

  it('garde le statut d’une opération en attente', async () => {
    const s = await setup();
    const tx = await createExpense(s, s.participantToken);
    expect(tx.status).toBe('PENDING');
    const response = await put(s.adminToken, tx.id, bodyFrom(tx, { description: 'Corrigée' }));
    expect(response.statusCode).toBe(200);
    expect(TransactionView.parse(response.json()).status).toBe('PENDING');
  });

  it('ne crée ni révision ni événement si rien ne change', async () => {
    const s = await setup();
    const tx = await createExpense(s);
    const response = await put(s.adminToken, tx.id, bodyFrom(tx));
    expect(response.statusCode).toBe(200);
    expect(TransactionView.parse(response.json()).version).toBe(tx.version);
    const { events } = AuditListResponse.parse(
      (await audit(s.adminToken, '?action=transaction.updated')).json(),
    );
    expect(events).toHaveLength(0);
  });

  it('refuse une version périmée (409 VERSION_CONFLICT)', async () => {
    const s = await setup();
    const tx = await createExpense(s);
    expect((await put(s.adminToken, tx.id, bodyFrom(tx, { description: 'Une' }))).statusCode).toBe(
      200,
    );
    const stale = await put(s.adminToken, tx.id, bodyFrom(tx, { description: 'Deux' }));
    expect(stale.statusCode).toBe(409);
    expect(errorCode(stale.json())).toBe('VERSION_CONFLICT');
  });

  it('refuse une opération refusée ou annulée (409 NOT_EDITABLE)', async () => {
    const s = await setup();
    const tx = await createExpense(s);
    const cancelled = TransactionView.parse(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/transactions/${tx.id}/cancel`,
          headers: bearer(s.adminToken),
          payload: {},
        })
      ).json(),
    );
    const response = await put(s.adminToken, tx.id, bodyFrom(cancelled, { description: 'Non' }));
    expect(response.statusCode).toBe(409);
    expect(errorCode(response.json())).toBe('NOT_EDITABLE');
  });

  it('est réservée aux admins (403)', async () => {
    const s = await setup();
    const tx = await createExpense(s);
    const response = await put(s.participantToken, tx.id, bodyFrom(tx, { description: 'Pirate' }));
    expect(response.statusCode).toBe(403);
  });

  it('ne touche pas l’opération d’un autre nikount (404)', async () => {
    const s = await setup();
    const other = await setup();
    const tx = await createExpense(other);
    const response = await put(s.adminToken, tx.id, bodyFrom(tx, { description: 'IDOR' }));
    expect(response.statusCode).toBe(404);
  });

  it('reste possible en règlement, plus une fois clôturé', async () => {
    const s = await setup();
    const tx = await createExpense(s);
    await moveTo(s, 'SETTLEMENT');
    const ok = await put(s.adminToken, tx.id, bodyFrom(tx, { description: 'Tardive' }));
    expect(ok.statusCode).toBe(200);
    const updated = TransactionView.parse(ok.json());
    await moveTo(s, 'CLOSED', ['CLOSED']);
    const closed = await put(s.adminToken, tx.id, bodyFrom(updated, { description: 'Trop tard' }));
    expect(closed.statusCode).toBe(409);
    expect(errorCode(closed.json())).toBe('INVALID_STATE');
  });

  it('accepte un participant désactivé déjà présent, pas un nouveau', async () => {
    const s = await setup(['Alice', 'Bob', 'Charlie', 'David']);
    const david = ParticipantListResponse.parse(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/participants',
          headers: bearer(s.adminToken),
        })
      ).json(),
    ).participants.find((p) => p.name === 'David');
    const tx = await createExpense(s);
    // Charlie (présent) et David (absent) sont désactivés.
    for (const p of [
      { id: s.charlie, version: 1 },
      { id: david?.id ?? '', version: david?.version ?? 1 },
    ]) {
      const r = await app.inject({
        method: 'PATCH',
        url: `/api/v1/participants/${p.id}`,
        headers: bearer(s.adminToken),
        payload: { isActive: false, version: p.version },
      });
      expect(r.statusCode, r.body).toBe(200);
    }

    const kept = await put(s.adminToken, tx.id, bodyFrom(tx, { amount: 6000 }));
    expect(kept.statusCode, kept.body).toBe(200);
    const updated = TransactionView.parse(kept.json());

    const added = await put(
      s.adminToken,
      tx.id,
      bodyFrom(updated, {
        distribution: { mode: 'EQUAL', participantIds: [s.alice, david?.id ?? ''] },
      }),
    );
    expect(added.statusCode).toBe(400);
    expect(errorCode(added.json())).toBe('PARTICIPANT_INVALID');
  });

  it('garde les règles d’un remboursement (un seul bénéficiaire, différent du payeur)', async () => {
    const s = await setup();
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions',
      headers: bearer(s.adminToken),
      payload: {
        clientRequestId: randomUUID(),
        type: 'REIMBURSEMENT',
        amount: 1500,
        description: 'Remboursement',
        occurredOn: '2026-11-02',
        payerId: s.bob,
        distribution: { mode: 'EQUAL', participantIds: [s.alice] },
      },
    });
    const tx = TransactionView.parse(created.json());
    const bad = await put(
      s.adminToken,
      tx.id,
      bodyFrom(tx, { distribution: { mode: 'EQUAL', participantIds: [s.bob] } }),
    );
    expect(bad.statusCode).toBe(400);
    expect(errorCode(bad.json())).toBe('REIMBURSEMENT_INVALID');
    const good = await put(s.adminToken, tx.id, bodyFrom(tx, { amount: 2000 }));
    expect(good.statusCode).toBe(200);
    expect(TransactionView.parse(good.json()).type).toBe('REIMBURSEMENT');
  });

  it('écrit un événement d’audit avec les champs modifiés', async () => {
    const s = await setup();
    const tx = await createExpense(s);
    await put(
      s.adminToken,
      tx.id,
      bodyFrom(tx, { amount: 3000, description: 'Pain', reason: 'Erreur' }),
    );
    const { events } = AuditListResponse.parse(
      (await audit(s.adminToken, `?entityId=${tx.id}`)).json(),
    );
    expect(events.map((e) => e.action)).toEqual(['transaction.updated', 'transaction.created']);
    expect(events[0]?.data).toMatchObject({
      changed: ['amount', 'description', 'shares'],
      before: { amount: 9000, description: 'Courses' },
      after: { amount: 3000, description: 'Pain' },
      reason: 'Erreur',
    });
  });
});

describe('GET /audit', () => {
  it('liste les événements du nikount, du plus récent au plus ancien, avec l’auteur', async () => {
    const s = await setup();
    await createExpense(s);
    await createExpense(s, s.participantToken);
    const response = await audit(s.adminToken);
    expect(response.statusCode).toBe(200);
    const { events, nextBefore } = AuditListResponse.parse(response.json());
    expect(events.map((e) => e.action)).toEqual([
      'transaction.created',
      'transaction.created',
      'nikount.created',
    ]);
    expect(nextBefore).toBeNull();
    expect(events[0]?.actor).toEqual({ kind: 'PARTICIPANT', admin: null, participantId: s.bob });
    expect(events[1]?.actor.admin?.label).toBe('Nicolas');
  });

  it('filtre par famille ou par action exacte', async () => {
    const s = await setup();
    const tx = await createExpense(s, s.participantToken);
    await app.inject({
      method: 'POST',
      url: `/api/v1/transactions/${tx.id}/validate`,
      headers: bearer(s.adminToken),
      payload: {},
    });
    const family = AuditListResponse.parse(
      (await audit(s.adminToken, '?action=transaction')).json(),
    );
    expect(family.events.map((e) => e.action)).toEqual([
      'transaction.validated',
      'transaction.created',
    ]);
    const exact = AuditListResponse.parse(
      (await audit(s.adminToken, '?action=transaction.validated')).json(),
    );
    expect(exact.events).toHaveLength(1);
  });

  it('pagine par curseur', async () => {
    const s = await setup([]);
    for (let i = 0; i < AUDIT_PAGE_SIZE; i++) await createExpenseFor(s, i);
    const first = AuditListResponse.parse((await audit(s.adminToken)).json());
    expect(first.events).toHaveLength(AUDIT_PAGE_SIZE);
    expect(first.nextBefore).not.toBeNull();
    const second = AuditListResponse.parse(
      (await audit(s.adminToken, `?before=${String(first.nextBefore)}`)).json(),
    );
    expect(second.events.map((e) => e.action)).toEqual(['nikount.created']);
    expect(second.nextBefore).toBeNull();
  });

  it('est réservé aux admins et borné au nikount', async () => {
    const s = await setup();
    const other = await setup();
    await createExpense(other);
    expect((await audit(s.participantToken)).statusCode).toBe(403);
    const { events } = AuditListResponse.parse((await audit(s.adminToken)).json());
    expect(events.map((e) => e.action)).toEqual(['nikount.created']);
  });

  it('rejette un filtre mal formé (400)', async () => {
    const s = await setup();
    expect((await audit(s.adminToken, '?action=DROP%20TABLE')).statusCode).toBe(400);
    expect((await audit(s.adminToken, '?entityId=pas-un-uuid')).statusCode).toBe(400);
  });
});

/** Dépense minimale payée par l'admin pour lui-même (nikount sans autre participant). */
async function createExpenseFor(s: Setup, i: number) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/transactions',
    headers: bearer(s.adminToken),
    payload: {
      clientRequestId: randomUUID(),
      type: 'EXPENSE',
      amount: 100 + i,
      description: `Dépense ${String(i)}`,
      occurredOn: '2026-11-01',
      payerId: s.nicolas,
      distribution: { mode: 'EQUAL', participantIds: [s.nicolas] },
    },
  });
  expect(response.statusCode, response.body).toBe(201);
}
