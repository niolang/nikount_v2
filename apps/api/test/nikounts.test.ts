import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  CreateNikountResponse,
  ErrorResponse,
  MeResponse,
  NikountView,
  ParticipantLinkResponse,
} from '@nikount/contracts';
import { adminAccess, auditEvent, nikount } from '../src/db/schema.js';
import type { AppInstance } from '../src/lib/types.js';
import { generateToken, hashToken } from '../src/lib/tokens.js';
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

describe('POST /api/v1/nikounts', () => {
  it('crée un nikount et renvoie les deux liens une seule fois', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/nikounts',
      payload: { name: '  Weekend   Chamonix ', adminLabel: ' Nicolas ' },
    });

    expect(response.statusCode).toBe(201);
    const body = CreateNikountResponse.parse(response.json());
    expect(body.nikount).toMatchObject({
      name: 'Weekend Chamonix',
      currency: 'EUR',
      state: 'OPEN',
      timezone: 'Europe/Paris',
    });
    expect(body.admin.label).toBe('Nicolas');
    expect(body.participantToken).not.toBe(body.adminToken);
    // L'identifiant interne du nikount n'est pas exposé.
    expect(JSON.stringify(body.nikount)).not.toMatch(/"id"/);
  });

  it('ne stocke que des empreintes et un chiffré, jamais les tokens en clair', async () => {
    const created = await createNikountViaApi(app);
    const [row] = await testDb.db
      .select()
      .from(nikount)
      .where(eq(nikount.participantTokenHash, hashToken(created.participantToken)));
    expect(row).toBeDefined();

    const [admin] = await testDb.db
      .select()
      .from(adminAccess)
      .where(eq(adminAccess.tokenHash, hashToken(created.adminToken)));
    expect(admin?.label).toBe('Nicolas');

    // Ni en clair, ni sous forme d'octets UTF-8, nulle part dans les tables.
    for (const table of ['nikount', 'admin_access', 'audit_event']) {
      const { rows } = await testDb.client.query(`select * from ${table}`);
      const dump = JSON.stringify(rows, (_key, value: unknown) =>
        value instanceof Uint8Array ? Buffer.from(value).toString('latin1') : value,
      );
      expect(dump).not.toContain(created.participantToken);
      expect(dump).not.toContain(created.adminToken);
    }
  });

  it('écrit un événement d’audit attribué à l’admin créateur', async () => {
    const created = await createNikountViaApi(app, { name: 'Audit', adminLabel: 'Alice' });
    const events = await testDb.db
      .select()
      .from(auditEvent)
      .where(eq(auditEvent.actorAdminId, created.admin.id));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: 'nikount.created',
      actorKind: 'ADMIN',
      data: { name: 'Audit', currency: 'EUR', adminLabel: 'Alice' },
    });
    expect(events[0]?.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('accepte une autre devise connue', async () => {
    const created = await createNikountViaApi(app, {
      name: 'Londres',
      adminLabel: 'Bob',
      currency: 'GBP',
    });
    expect(created.nikount.currency).toBe('GBP');
  });

  it.each([
    ['nom manquant', { adminLabel: 'Nicolas' }],
    ['nom vide après normalisation', { name: ' \u0000 ', adminLabel: 'Nicolas' }],
    ['nom trop long', { name: 'x'.repeat(61), adminLabel: 'Nicolas' }],
    ['admin manquant', { name: 'Weekend' }],
    ['devise inconnue', { name: 'Weekend', adminLabel: 'Nicolas', currency: 'XXZ' }],
    ['champ inconnu (nikountId)', { name: 'Weekend', adminLabel: 'Nicolas', nikountId: 'x' }],
  ])('refuse : %s → 400', async (_label, payload) => {
    const response = await app.inject({ method: 'POST', url: '/api/v1/nikounts', payload });
    expect(response.statusCode).toBe(400);
    expect(errorCode(response.json())).toBe('VALIDATION_ERROR');
  });

  it('limite le nombre de créations par IP', async () => {
    const limitedDb = await createTestDatabase();
    const limited = await buildTestApp(limitedDb.db, { config: { RATE_LIMIT_CREATE_PER_HOUR: 2 } });
    try {
      await createNikountViaApi(limited);
      await createNikountViaApi(limited);
      const response = await limited.inject({
        method: 'POST',
        url: '/api/v1/nikounts',
        payload: { name: 'Un de trop', adminLabel: 'Nicolas' },
      });
      expect(response.statusCode).toBe(429);
      expect(errorCode(response.json())).toBe('RATE_LIMITED');
    } finally {
      await limited.close();
      await limitedDb.close();
    }
  });
});

describe('authentification par token', () => {
  it('participant : accès en lecture, rôle PARTICIPANT, aucun admin', async () => {
    const created = await createNikountViaApi(app);
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: bearer(created.participantToken),
    });

    expect(response.statusCode).toBe(200);
    const me = MeResponse.parse(response.json());
    expect(me.role).toBe('PARTICIPANT');
    expect(me.admin).toBeNull();
    expect(me.nikount.name).toBe('Weekend Chamonix');
  });

  it('admin : rôle ADMIN et identité de l’admin', async () => {
    const created = await createNikountViaApi(app);
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: bearer(created.adminToken),
    });

    const me = MeResponse.parse(response.json());
    expect(me.role).toBe('ADMIN');
    expect(me.admin).toEqual(created.admin);
  });

  it('GET /nikount renvoie le nikount du token', async () => {
    const created = await createNikountViaApi(app, { name: 'Rando', adminLabel: 'Zoé' });
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/nikount',
      headers: bearer(created.participantToken),
    });
    expect(NikountView.parse(response.json()).name).toBe('Rando');
  });

  it('met à jour la date de dernière utilisation de l’accès admin', async () => {
    const created = await createNikountViaApi(app);
    await app.inject({ method: 'GET', url: '/api/v1/me', headers: bearer(created.adminToken) });
    const [row] = await testDb.db
      .select()
      .from(adminAccess)
      .where(eq(adminAccess.id, created.admin.id));
    expect(row?.lastUsedAt).toBeInstanceOf(Date);
  });

  it.each([
    ['sans en-tête', {}],
    ['schéma autre que Bearer', { authorization: 'Basic abc' }],
    ['token mal formé', bearer('p_court')],
    ['token participant inconnu', bearer(generateToken('PARTICIPANT'))],
    ['token admin inconnu', bearer(generateToken('ADMIN'))],
  ])('refuse : %s → 401 générique', async (_label, headers) => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/me', headers });
    expect(response.statusCode).toBe(401);
    expect(errorCode(response.json())).toBe('INVALID_TOKEN');
  });

  it('refuse un accès admin révoqué', async () => {
    const created = await createNikountViaApi(app);
    await testDb.db
      .update(adminAccess)
      .set({ revokedAt: new Date() })
      .where(eq(adminAccess.id, created.admin.id));

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: bearer(created.adminToken),
    });
    expect(response.statusCode).toBe(401);
  });

  it('un token participant présenté comme admin (préfixe changé) ne donne aucun accès', async () => {
    const created = await createNikountViaApi(app);
    const forged = `a_${created.participantToken.slice(2)}${'A'.repeat(21)}`;
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/me',
      headers: bearer(forged),
    });
    expect(response.statusCode).toBe(401);
  });

  it('bloque une IP après trop de tokens invalides, même avec un token valide ensuite', async () => {
    const limitedDb = await createTestDatabase();
    let now = 0;
    const limited = await buildTestApp(limitedDb.db, {
      config: { AUTH_FAILURE_MAX: 3, AUTH_FAILURE_BLOCK_MINUTES: 15 },
      now: () => now,
    });
    try {
      const created = await createNikountViaApi(limited);
      for (let i = 0; i < 3; i++) {
        const r = await limited.inject({
          method: 'GET',
          url: '/api/v1/me',
          headers: bearer(generateToken('PARTICIPANT')),
        });
        expect(r.statusCode).toBe(401);
      }
      const blocked = await limited.inject({
        method: 'GET',
        url: '/api/v1/me',
        headers: bearer(created.participantToken),
      });
      expect(blocked.statusCode).toBe(429);
      expect(errorCode(blocked.json())).toBe('RATE_LIMITED');

      now += 15 * 60_000 + 1;
      const unblocked = await limited.inject({
        method: 'GET',
        url: '/api/v1/me',
        headers: bearer(created.participantToken),
      });
      expect(unblocked.statusCode).toBe(200);
    } finally {
      await limited.close();
      await limitedDb.close();
    }
  });
});

describe('séparation des rôles et isolation entre nikounts', () => {
  it('le lien participant ne permet pas d’obtenir le lien à partager (route admin) → 403', async () => {
    const created = await createNikountViaApi(app);
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/nikount/participant-link',
      headers: bearer(created.participantToken),
    });
    expect(response.statusCode).toBe(403);
    expect(errorCode(response.json())).toBe('ADMIN_REQUIRED');
  });

  it('un admin réaffiche le lien participant de SON nikount', async () => {
    const created = await createNikountViaApi(app);
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/nikount/participant-link',
      headers: bearer(created.adminToken),
    });
    expect(response.statusCode).toBe(200);
    expect(ParticipantLinkResponse.parse(response.json()).participantToken).toBe(
      created.participantToken,
    );
  });

  it('chaque token ne voit que son propre nikount', async () => {
    const a = await createNikountViaApi(app, { name: 'Nikount A', adminLabel: 'Alice' });
    const b = await createNikountViaApi(app, { name: 'Nikount B', adminLabel: 'Bob' });

    for (const [token, expected] of [
      [a.participantToken, 'Nikount A'],
      [a.adminToken, 'Nikount A'],
      [b.participantToken, 'Nikount B'],
      [b.adminToken, 'Nikount B'],
    ] as const) {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/me',
        headers: bearer(token),
      });
      expect(MeResponse.parse(response.json()).nikount.name).toBe(expected);
    }

    const linkB = await app.inject({
      method: 'GET',
      url: '/api/v1/nikount/participant-link',
      headers: bearer(b.adminToken),
    });
    expect(ParticipantLinkResponse.parse(linkB.json()).participantToken).toBe(b.participantToken);
  });

  it('ignore les paramètres de requête qui tenteraient de désigner un autre nikount', async () => {
    const a = await createNikountViaApi(app, { name: 'Nikount A', adminLabel: 'Alice' });
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/me?nikountId=00000000-0000-7000-8000-000000000000',
      headers: bearer(a.participantToken),
    });
    expect(MeResponse.parse(response.json()).nikount.name).toBe('Nikount A');
  });
});
