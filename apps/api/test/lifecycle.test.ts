import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  AdminListItem,
  AdminListResponse,
  CreateAdminResponse,
  ErrorResponse,
  NikountView,
  ParticipantLinkResponse,
  ParticipantListResponse,
  TransactionView,
  type NikountState,
} from '@nikount/contracts';
import { adminAccess, auditEvent } from '../src/db/schema.js';
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
  const ids = participants.map((p) => p.id);
  return { ...created, nicolas: ids[0] ?? '', alice: ids[1] ?? '', bob: ids[2] ?? '' };
}
type Setup = Awaited<ReturnType<typeof setup>>;

const getNikount = async (token: string) =>
  NikountView.parse(
    (await app.inject({ method: 'GET', url: '/api/v1/nikount', headers: bearer(token) })).json(),
  );

async function changeState(
  token: string,
  to: NikountState,
  extra: { reason?: string; version?: number } = {},
) {
  const version = extra.version ?? (await getNikount(token)).version;
  return app.inject({
    method: 'POST',
    url: '/api/v1/nikount/state',
    headers: bearer(token),
    payload: { to, version, ...(extra.reason ? { reason: extra.reason } : {}) },
  });
}

async function moveTo(s: Setup, target: NikountState) {
  const path: Record<NikountState, NikountState[]> = {
    OPEN: [],
    SETTLEMENT: ['SETTLEMENT'],
    CLOSED: ['SETTLEMENT', 'CLOSED'],
  };
  for (const to of path[target]) {
    const response = await changeState(s.adminToken, to);
    expect(response.statusCode, response.body).toBe(200);
  }
}

function createTransaction(s: Setup, token: string, type: 'EXPENSE' | 'REIMBURSEMENT') {
  return app.inject({
    method: 'POST',
    url: '/api/v1/transactions',
    headers: bearer(token),
    payload: {
      clientRequestId: randomUUID(),
      type,
      amount: 1000,
      description: type === 'EXPENSE' ? 'Courses' : 'Remboursement',
      occurredOn: '2026-11-08',
      payerId: s.alice,
      distribution:
        type === 'EXPENSE'
          ? { mode: 'EQUAL', participantIds: [s.alice, s.bob] }
          : { mode: 'EQUAL', participantIds: [s.bob] },
      ...(token === s.participantToken ? { declaredByParticipantId: s.alice } : {}),
    },
  });
}

async function auditActions(nikountId: string) {
  const rows = await testDb.db
    .select({ action: auditEvent.action, data: auditEvent.data })
    .from(auditEvent)
    .where(eq(auditEvent.nikountId, nikountId));
  return rows;
}

/** Identifiant interne du nikount, retrouvé par l'empreinte de son lien admin. */
async function nikountIdOf(s: Setup) {
  const [row] = await testDb.db
    .select({ id: adminAccess.nikountId })
    .from(adminAccess)
    .where(eq(adminAccess.tokenHash, hashToken(s.adminToken)));
  return row?.id ?? '';
}

describe('POST /nikount/state', () => {
  it('parcourt OPEN → SETTLEMENT → OPEN → SETTLEMENT → CLOSED → SETTLEMENT (motif)', async () => {
    const s = await setup();
    const steps: [NikountState, string | undefined][] = [
      ['SETTLEMENT', undefined],
      ['OPEN', undefined],
      ['SETTLEMENT', undefined],
      ['CLOSED', undefined],
      ['SETTLEMENT', 'Oubli du ticket de péage'],
    ];
    let previous = await getNikount(s.adminToken);
    for (const [to, reason] of steps) {
      const response = await changeState(s.adminToken, to, reason ? { reason } : {});
      expect(response.statusCode, response.body).toBe(200);
      const view = NikountView.parse(response.json());
      expect(view.state).toBe(to);
      expect(view.version).toBe(previous.version + 1);
      expect(Date.parse(view.stateChangedAt)).toBeGreaterThanOrEqual(
        Date.parse(previous.stateChangedAt),
      );
      previous = view;
    }
  });

  it('refuse les changements absents du diagramme', async () => {
    const s = await setup();
    const direct = await changeState(s.adminToken, 'CLOSED');
    expect(direct.statusCode).toBe(409);
    expect(errorCode(direct.json())).toBe('INVALID_STATE_TRANSITION');

    const same = await changeState(s.adminToken, 'OPEN');
    expect(same.statusCode).toBe(409);
    expect(errorCode(same.json())).toBe('INVALID_STATE_TRANSITION');

    await moveTo(s, 'CLOSED');
    const reopenToOpen = await changeState(s.adminToken, 'OPEN', { reason: 'x' });
    expect(errorCode(reopenToOpen.json())).toBe('INVALID_STATE_TRANSITION');
  });

  it('exige un motif pour réouvrir un nikount clos', async () => {
    const s = await setup();
    await moveTo(s, 'CLOSED');
    const response = await changeState(s.adminToken, 'SETTLEMENT');
    expect(response.statusCode).toBe(400);
    expect(errorCode(response.json())).toBe('REASON_REQUIRED');

    const blank = await changeState(s.adminToken, 'SETTLEMENT', { reason: '   ' });
    expect(blank.statusCode).toBe(400);
    expect((await getNikount(s.adminToken)).state).toBe('CLOSED');
  });

  it('refuse la clôture tant qu’une opération est en attente, puis l’accepte', async () => {
    const s = await setup();
    const pending = TransactionView.parse(
      (await createTransaction(s, s.participantToken, 'EXPENSE')).json(),
    );
    expect(pending.status).toBe('PENDING');
    await moveTo(s, 'SETTLEMENT');

    const refused = await changeState(s.adminToken, 'CLOSED');
    expect(refused.statusCode).toBe(409);
    const body = ErrorResponse.parse(refused.json());
    expect(body.error.code).toBe('PENDING_REMAINING');
    expect(body.error.details).toEqual({ pendingCount: 1 });

    const validate = await app.inject({
      method: 'POST',
      url: `/api/v1/transactions/${pending.id}/validate`,
      headers: bearer(s.adminToken),
    });
    expect(validate.statusCode, validate.body).toBe(200);
    // Soldes non nuls : avertissement côté interface, pas de blocage (D9).
    expect((await changeState(s.adminToken, 'CLOSED')).statusCode).toBe(200);
  });

  it('applique le verrouillage optimiste', async () => {
    const s = await setup();
    const { version } = await getNikount(s.adminToken);
    expect((await changeState(s.adminToken, 'SETTLEMENT', { version })).statusCode).toBe(200);
    const stale = await changeState(s.adminToken, 'OPEN', { version });
    expect(stale.statusCode).toBe(409);
    expect(ErrorResponse.parse(stale.json()).error).toMatchObject({
      code: 'VERSION_CONFLICT',
      details: { currentVersion: version + 1 },
    });
  });

  it('est réservé aux admins', async () => {
    const s = await setup();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/nikount/state',
      headers: bearer(s.participantToken),
      payload: { to: 'SETTLEMENT', version: 1 },
    });
    expect(response.statusCode).toBe(403);
  });

  it('trace chaque changement dans l’audit, motif compris', async () => {
    const s = await setup();
    await moveTo(s, 'CLOSED');
    await changeState(s.adminToken, 'SETTLEMENT', { reason: 'Erreur de montant' });
    const events = (await auditActions(await nikountIdOf(s))).filter(
      (e) => e.action === 'nikount.state_changed',
    );
    expect(events).toContainEqual({
      action: 'nikount.state_changed',
      data: { transition: 'REOPEN', from: 'CLOSED', to: 'SETTLEMENT', reason: 'Erreur de montant' },
    });
  });
});

describe('matrice état × action appliquée par l’API', () => {
  it('SETTLEMENT : remboursement oui, dépense non', async () => {
    const s = await setup();
    await moveTo(s, 'SETTLEMENT');
    expect((await createTransaction(s, s.adminToken, 'REIMBURSEMENT')).statusCode).toBe(201);
    const expense = await createTransaction(s, s.adminToken, 'EXPENSE');
    expect(expense.statusCode).toBe(409);
    expect(errorCode(expense.json())).toBe('INVALID_STATE');
  });

  it('CLOSED : plus d’opération ni de participant, mais renommage, admins et lien possibles', async () => {
    const s = await setup();
    await moveTo(s, 'CLOSED');
    for (const type of ['EXPENSE', 'REIMBURSEMENT'] as const) {
      const response = await createTransaction(s, s.adminToken, type);
      expect(errorCode(response.json())).toBe('INVALID_STATE');
    }
    const participant = await app.inject({
      method: 'POST',
      url: '/api/v1/participants',
      headers: bearer(s.adminToken),
      payload: { name: 'Zoé' },
    });
    expect(errorCode(participant.json())).toBe('INVALID_STATE');

    const { version } = await getNikount(s.adminToken);
    const rename = await app.inject({
      method: 'PATCH',
      url: '/api/v1/nikount',
      headers: bearer(s.adminToken),
      payload: { name: 'Weekend (archivé)', version },
    });
    expect(rename.statusCode, rename.body).toBe(200);

    const admin = await app.inject({
      method: 'POST',
      url: '/api/v1/admins',
      headers: bearer(s.adminToken),
      payload: { label: 'Trésorière' },
    });
    expect(admin.statusCode, admin.body).toBe(201);

    const rotate = await app.inject({
      method: 'POST',
      url: '/api/v1/nikount/participant-link/rotate',
      headers: bearer(s.adminToken),
    });
    expect(rotate.statusCode).toBe(200);
  });
});

describe('PATCH /nikount', () => {
  it('renomme avec verrouillage optimiste et audit', async () => {
    const s = await setup();
    const before = await getNikount(s.adminToken);
    const response = await app.inject({
      method: 'PATCH',
      url: '/api/v1/nikount',
      headers: bearer(s.adminToken),
      payload: { name: '  Week-end   Annecy ', version: before.version },
    });
    expect(response.statusCode, response.body).toBe(200);
    const view = NikountView.parse(response.json());
    expect(view).toMatchObject({ name: 'Week-end Annecy', version: before.version + 1 });
    expect(view.stateChangedAt).toBe(before.stateChangedAt);

    const stale = await app.inject({
      method: 'PATCH',
      url: '/api/v1/nikount',
      headers: bearer(s.adminToken),
      payload: { name: 'Autre', version: before.version },
    });
    expect(errorCode(stale.json())).toBe('VERSION_CONFLICT');

    const events = await auditActions(await nikountIdOf(s));
    expect(events).toContainEqual({
      action: 'nikount.renamed',
      data: { from: 'Weekend', to: 'Week-end Annecy' },
    });
  });

  it('refuse un nom vide et les participants', async () => {
    const s = await setup();
    const empty = await app.inject({
      method: 'PATCH',
      url: '/api/v1/nikount',
      headers: bearer(s.adminToken),
      payload: { name: '   ', version: 1 },
    });
    expect(empty.statusCode).toBe(400);
    const participant = await app.inject({
      method: 'PATCH',
      url: '/api/v1/nikount',
      headers: bearer(s.participantToken),
      payload: { name: 'Pirate', version: 1 },
    });
    expect(participant.statusCode).toBe(403);
  });
});

describe('POST /nikount/participant-link/rotate', () => {
  it('invalide l’ancien lien et renvoie le nouveau, réaffichable', async () => {
    const s = await setup();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/nikount/participant-link/rotate',
      headers: bearer(s.adminToken),
    });
    expect(response.statusCode).toBe(200);
    const { participantToken } = ParticipantLinkResponse.parse(response.json());
    expect(participantToken).not.toBe(s.participantToken);

    const old = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: bearer(s.participantToken),
    });
    expect(old.statusCode).toBe(401);
    const fresh = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: bearer(participantToken),
    });
    expect(fresh.statusCode).toBe(200);

    const shown = await app.inject({
      method: 'GET',
      url: '/api/v1/nikount/participant-link',
      headers: bearer(s.adminToken),
    });
    expect(ParticipantLinkResponse.parse(shown.json()).participantToken).toBe(participantToken);
  });

  it('n’affecte pas les liens admin et est réservé aux admins', async () => {
    const s = await setup();
    const denied = await app.inject({
      method: 'POST',
      url: '/api/v1/nikount/participant-link/rotate',
      headers: bearer(s.participantToken),
    });
    expect(denied.statusCode).toBe(403);
    await app.inject({
      method: 'POST',
      url: '/api/v1/nikount/participant-link/rotate',
      headers: bearer(s.adminToken),
    });
    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: bearer(s.adminToken),
    });
    expect(me.statusCode).toBe(200);
  });
});

describe('admins', () => {
  const listAdmins = async (token: string) =>
    AdminListResponse.parse(
      (await app.inject({ method: 'GET', url: '/api/v1/admins', headers: bearer(token) })).json(),
    ).admins;

  const createAdmin = (token: string, payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/api/v1/admins', headers: bearer(token), payload });

  const revoke = (token: string, id: string) =>
    app.inject({ method: 'POST', url: `/api/v1/admins/${id}/revoke`, headers: bearer(token) });

  it('liste les admins sans token, avec « vous »', async () => {
    const s = await setup();
    const admins = await listAdmins(s.adminToken);
    expect(admins).toHaveLength(1);
    expect(admins[0]).toMatchObject({
      id: s.admin.id,
      label: 'Nicolas',
      participantId: s.nicolas,
      revokedAt: null,
      isYou: true,
    });
    expect(JSON.stringify(admins)).not.toContain('a_');
  });

  it('crée un admin dont le lien ne s’affiche qu’une fois et fonctionne', async () => {
    const s = await setup();
    const response = await createAdmin(s.adminToken, { label: 'Alice', participantId: s.alice });
    expect(response.statusCode, response.body).toBe(201);
    const created = CreateAdminResponse.parse(response.json());
    expect(created.admin).toMatchObject({ label: 'Alice', participantId: s.alice, isYou: false });

    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: bearer(created.adminToken),
    });
    expect(me.json()).toMatchObject({
      role: 'ADMIN',
      admin: { label: 'Alice', participantId: s.alice },
    });

    const list = await listAdmins(created.adminToken);
    expect(list.map((a) => [a.label, a.isYou])).toEqual([
      ['Nicolas', false],
      ['Alice', true],
    ]);
  });

  it('refuse un participant d’un autre nikount ou désactivé', async () => {
    const s = await setup();
    const other = await setup();
    const foreign = await createAdmin(s.adminToken, {
      label: 'Intrus',
      participantId: other.alice,
    });
    expect(foreign.statusCode).toBe(404);

    const bobVersion = ParticipantListResponse.parse(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/participants',
          headers: bearer(s.adminToken),
        })
      ).json(),
    ).participants.find((p) => p.id === s.bob)?.version;
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/participants/${s.bob}`,
      headers: bearer(s.adminToken),
      payload: { isActive: false, version: bobVersion },
    });
    expect(
      (await createAdmin(s.adminToken, { label: 'Bob', participantId: s.bob })).statusCode,
    ).toBe(404);
  });

  it('révoque un admin : son lien cesse de fonctionner ; audit', async () => {
    const s = await setup();
    const created = CreateAdminResponse.parse(
      (await createAdmin(s.adminToken, { label: 'Trésorière' })).json(),
    );
    const response = await revoke(s.adminToken, created.admin.id);
    expect(response.statusCode, response.body).toBe(200);
    expect(AdminListItem.parse(response.json()).revokedAt).not.toBeNull();

    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: bearer(created.adminToken),
    });
    expect(me.statusCode).toBe(401);

    // Révoquer deux fois : idempotent.
    expect((await revoke(s.adminToken, created.admin.id)).statusCode).toBe(200);

    const nikountId = await nikountIdOf(s);
    expect(nikountId).not.toBe('');
    const rows = await testDb.db
      .select({ action: auditEvent.action })
      .from(auditEvent)
      .where(eq(auditEvent.entityId, created.admin.id));
    expect(rows.map((r) => r.action).sort()).toEqual(['admin.created', 'admin.revoked']);
  });

  it('interdit de révoquer le dernier admin actif, permet de se révoquer soi-même sinon', async () => {
    const s = await setup();
    const last = await revoke(s.adminToken, s.admin.id);
    expect(last.statusCode).toBe(409);
    expect(errorCode(last.json())).toBe('LAST_ADMIN');

    const second = CreateAdminResponse.parse(
      (await createAdmin(s.adminToken, { label: 'Alice' })).json(),
    );
    expect((await revoke(s.adminToken, s.admin.id)).statusCode).toBe(200);
    // Le créateur n'a plus accès ; Alice reste seule et ne peut pas se révoquer.
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/me', headers: bearer(s.adminToken) }))
        .statusCode,
    ).toBe(401);
    expect(errorCode((await revoke(second.adminToken, second.admin.id)).json())).toBe('LAST_ADMIN');
  });

  it('isole les nikounts et refuse les participants', async () => {
    const s = await setup();
    const other = await setup();
    expect((await revoke(s.adminToken, other.admin.id)).statusCode).toBe(404);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/admins',
          headers: bearer(s.participantToken),
        })
      ).statusCode,
    ).toBe(403);
    expect((await createAdmin(s.participantToken, { label: 'Moi' })).statusCode).toBe(403);
  });
});
