import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  ErrorResponse,
  MAX_PARTICIPANTS,
  MeResponse,
  ParticipantListResponse,
  ParticipantView,
} from '@nikount/contracts';
import { auditEvent, nikount, participant } from '../src/db/schema.js';
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

async function list(token: string) {
  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/participants',
    headers: bearer(token),
  });
  expect(response.statusCode).toBe(200);
  return ParticipantListResponse.parse(response.json()).participants;
}

function addParticipant(token: string, name: string) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/participants',
    headers: bearer(token),
    payload: { name },
  });
}

function patchParticipant(token: string, id: string, payload: Record<string, unknown>) {
  return app.inject({
    method: 'PATCH',
    url: `/api/v1/participants/${id}`,
    headers: bearer(token),
    payload,
  });
}

function createGroup() {
  return createNikountViaApi(app, {
    name: 'Weekend',
    adminLabel: 'Nicolas',
    participants: ['Alice', 'Bob'],
  });
}

describe('participants à la création du nikount', () => {
  it('crée le créateur puis les participants saisis, dans l’ordre', async () => {
    const created = await createGroup();
    const participants = await list(created.participantToken);

    expect(participants.map((p) => [p.name, p.sortOrder, p.isActive])).toEqual([
      ['Nicolas', 0, true],
      ['Alice', 1, true],
      ['Bob', 2, true],
    ]);
    expect(created.admin.participantId).toBe(participants[0]?.id);
  });

  it('expose le participant de l’admin dans /me', async () => {
    const created = await createGroup();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: bearer(created.adminToken),
    });
    const me = MeResponse.parse(response.json());
    const [nicolas] = await list(created.adminToken);
    expect(me.admin?.participantId).toBe(nicolas?.id);
  });

  it('un admin peut ne pas participer (ex. trésorier)', async () => {
    const created = await createNikountViaApi(app, {
      name: 'Club',
      adminLabel: 'Trésorière',
      adminIsParticipant: false,
      participants: ['Alice'],
    });
    expect(created.admin.participantId).toBeNull();
    expect((await list(created.adminToken)).map((p) => p.name)).toEqual(['Alice']);
  });

  it.each([
    ['doublon entre participants', { participants: ['Alice', 'alice'] }],
    ['doublon avec l’admin participant', { participants: ['NICOLAS'] }],
    ['nom vide', { participants: [' '] }],
    ['nom trop long', { participants: ['x'.repeat(41)] }],
  ])('refuse : %s → 400', async (_label, extra) => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/nikounts',
      payload: { name: 'Weekend', adminLabel: 'Nicolas', ...extra },
    });
    expect(response.statusCode).toBe(400);
  });

  it('accepte le nom de l’admin comme participant s’il ne participe pas lui-même', async () => {
    const created = await createNikountViaApi(app, {
      name: 'Weekend',
      adminLabel: 'Nicolas',
      adminIsParticipant: false,
      participants: ['Nicolas'],
    });
    expect(created.admin.participantId).toBeNull();
  });
});

describe('gestion des participants', () => {
  it('le lien participant peut lire la liste mais pas la modifier (403)', async () => {
    const created = await createGroup();
    const [alice] = (await list(created.participantToken)).slice(1);

    const add = await addParticipant(created.participantToken, 'Intrus');
    expect(add.statusCode).toBe(403);
    expect(errorCode(add.json())).toBe('ADMIN_REQUIRED');

    const patch = await patchParticipant(created.participantToken, alice?.id ?? '', {
      name: 'Pirate',
      version: 1,
    });
    expect(patch.statusCode).toBe(403);
    expect((await list(created.adminToken)).map((p) => p.name)).not.toContain('Pirate');
  });

  it('un admin ajoute un participant en fin de liste, avec audit', async () => {
    const created = await createGroup();
    const response = await addParticipant(created.adminToken, '  Charlie ');

    expect(response.statusCode).toBe(201);
    const charlie = ParticipantView.parse(response.json());
    expect(charlie).toMatchObject({ name: 'Charlie', sortOrder: 3, isActive: true, version: 1 });

    const [event] = await testDb.db
      .select()
      .from(auditEvent)
      .where(
        and(eq(auditEvent.entityId, charlie.id), eq(auditEvent.action, 'participant.created')),
      );
    expect(event).toMatchObject({ actorAdminId: created.admin.id, data: { name: 'Charlie' } });
  });

  it('refuse un nom déjà porté par un participant actif (casse ignorée) → 409', async () => {
    const created = await createGroup();
    const response = await addParticipant(created.adminToken, 'ALICE');
    expect(response.statusCode).toBe(409);
    expect(errorCode(response.json())).toBe('PARTICIPANT_NAME_TAKEN');
  });

  it('renomme avec la version courante, puis refuse une version périmée (409)', async () => {
    const created = await createGroup();
    const bob = (await list(created.adminToken)).find((p) => p.name === 'Bob');

    const renamed = await patchParticipant(created.adminToken, bob?.id ?? '', {
      name: 'Bobby',
      version: 1,
    });
    expect(renamed.statusCode).toBe(200);
    expect(ParticipantView.parse(renamed.json())).toMatchObject({ name: 'Bobby', version: 2 });

    const stale = await patchParticipant(created.adminToken, bob?.id ?? '', {
      name: 'Robert',
      version: 1,
    });
    expect(stale.statusCode).toBe(409);
    expect(errorCode(stale.json())).toBe('VERSION_CONFLICT');
  });

  it('désactive au lieu de supprimer, libère le nom, et bloque une réactivation en doublon', async () => {
    const created = await createGroup();
    const alice = (await list(created.adminToken)).find((p) => p.name === 'Alice');
    if (!alice) throw new Error('Alice introuvable');

    const off = await patchParticipant(created.adminToken, alice.id, {
      isActive: false,
      version: alice.version,
    });
    expect(ParticipantView.parse(off.json()).isActive).toBe(false);
    // Toujours listée (elle pourra figurer dans l'historique).
    expect((await list(created.participantToken)).find((p) => p.id === alice.id)?.isActive).toBe(
      false,
    );

    // Le nom est libre pour un participant actif…
    expect((await addParticipant(created.adminToken, 'Alice')).statusCode).toBe(201);

    // …donc réactiver l'ancienne Alice créerait un doublon.
    const back = await patchParticipant(created.adminToken, alice.id, {
      isActive: true,
      version: alice.version + 1,
    });
    expect(back.statusCode).toBe(409);
    expect(errorCode(back.json())).toBe('PARTICIPANT_NAME_TAKEN');
  });

  it('trace les changements dans l’audit (avant / après)', async () => {
    const created = await createGroup();
    const bob = (await list(created.adminToken)).find((p) => p.name === 'Bob');
    await patchParticipant(created.adminToken, bob?.id ?? '', { name: 'Bobby', version: 1 });

    const [event] = await testDb.db
      .select()
      .from(auditEvent)
      .where(
        and(eq(auditEvent.entityId, bob?.id ?? ''), eq(auditEvent.action, 'participant.updated')),
      );
    expect(event?.data).toEqual({ name: { from: 'Bob', to: 'Bobby' } });
  });

  it.each([
    ['aucune modification', { version: 1 }],
    ['version manquante', { name: 'X' }],
    ['champ inconnu', { name: 'X', version: 1, nikountId: randomUUID() }],
    ['ordre négatif', { sortOrder: -1, version: 1 }],
  ])('refuse une modification invalide : %s → 400', async (_label, payload) => {
    const created = await createGroup();
    const [first] = await list(created.adminToken);
    const response = await patchParticipant(created.adminToken, first?.id ?? '', payload);
    expect(response.statusCode).toBe(400);
  });

  it('identifiant mal formé → 400 ; inconnu → 404', async () => {
    const created = await createGroup();
    expect(
      (await patchParticipant(created.adminToken, 'abc', { name: 'X', version: 1 })).statusCode,
    ).toBe(400);
    const unknown = await patchParticipant(created.adminToken, randomUUID(), {
      name: 'X',
      version: 1,
    });
    expect(unknown.statusCode).toBe(404);
  });

  it('refuse toute modification quand le nikount est clôturé', async () => {
    const created = await createGroup();
    await testDb.db
      .update(nikount)
      .set({ state: 'CLOSED' })
      .where(eq(nikount.participantTokenHash, hashToken(created.participantToken)));

    const response = await addParticipant(created.adminToken, 'Tard');
    expect(response.statusCode).toBe(409);
    expect(errorCode(response.json())).toBe('INVALID_STATE');
  });

  it(`limite à ${String(MAX_PARTICIPANTS)} participants par nikount`, async () => {
    const created = await createGroup();
    const [first] = await testDb.db
      .select({ nikountId: participant.nikountId })
      .from(participant)
      .where(eq(participant.id, created.admin.participantId ?? ''));
    const nikountId = first?.nikountId ?? '';
    await testDb.db.insert(participant).values(
      Array.from({ length: MAX_PARTICIPANTS - 3 }, (_, i) => ({
        id: randomUUID(),
        nikountId,
        name: `P${String(i)}`,
        sortOrder: 10 + i,
      })),
    );

    const response = await addParticipant(created.adminToken, 'Un de trop');
    expect(response.statusCode).toBe(409);
    expect(errorCode(response.json())).toBe('PARTICIPANT_LIMIT_REACHED');
  });
});

describe('isolation entre nikounts', () => {
  it('un admin ne peut ni voir ni modifier les participants d’un autre nikount', async () => {
    const a = await createGroup();
    const b = await createNikountViaApi(app, { name: 'Autre', adminLabel: 'Zoé' });
    const aliceOfA = (await list(a.adminToken)).find((p) => p.name === 'Alice');
    if (!aliceOfA) throw new Error('Alice introuvable');

    expect((await list(b.adminToken)).map((p) => p.name)).toEqual(['Zoé']);

    const response = await patchParticipant(b.adminToken, aliceOfA.id, {
      name: 'Volée',
      version: aliceOfA.version,
    });
    expect(response.statusCode).toBe(404);
    expect((await list(a.adminToken)).find((p) => p.id === aliceOfA.id)?.name).toBe('Alice');
  });
});
