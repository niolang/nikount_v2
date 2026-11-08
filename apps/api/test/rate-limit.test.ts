import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CreateAdminResponse, ErrorResponse, ParticipantListResponse } from '@nikount/contracts';
import { RequestLimiter } from '../src/lib/request-limiter.js';
import type { AppInstance } from '../src/lib/types.js';
import {
  bearer,
  buildTestApp,
  createNikountViaApi,
  createTestDatabase,
  type TestDatabase,
} from './helpers.js';

describe('RequestLimiter', () => {
  it('compte par clé et repart à zéro à la fenêtre suivante', () => {
    let now = 0;
    const limiter = new RequestLimiter({ max: 2, windowMs: 1000, now: () => now });
    expect([limiter.hit('a'), limiter.hit('a'), limiter.hit('a')]).toEqual([true, true, false]);
    expect(limiter.hit('b')).toBe(true);
    now = 1000;
    expect(limiter.hit('a')).toBe(true);
  });

  it('borne la mémoire utilisée', () => {
    let now = 0;
    const limiter = new RequestLimiter({ max: 1, windowMs: 1000, now: () => now, maxEntries: 3 });
    for (const key of ['a', 'b', 'c', 'd', 'e']) limiter.hit(key);
    now = 500;
    // « e » est toujours suivie (dernière entrée) : sa limite reste appliquée.
    expect(limiter.hit('e')).toBe(false);
  });
});

describe('limites par lien d’accès', () => {
  let testDb: TestDatabase;
  let app: AppInstance;
  let now = 0;

  beforeAll(async () => {
    testDb = await createTestDatabase();
    app = await buildTestApp(testDb.db, {
      config: { RATE_LIMIT_WRITES_PER_MINUTE: 3, RATE_LIMIT_READS_PER_MINUTE: 5 },
      now: () => now,
    });
  });

  afterAll(async () => {
    await app.close();
    await testDb.close();
  });

  const errorCode = (body: unknown) => ErrorResponse.parse(body).error.code;
  const read = (token: string) =>
    app.inject({ method: 'GET', url: '/api/v1/me', headers: bearer(token) });

  it('limite les lectures par minute, puis les rétablit', async () => {
    now = 0;
    const { adminToken } = await createNikountViaApi(app);
    for (let i = 0; i < 5; i += 1) expect((await read(adminToken)).statusCode).toBe(200);
    const blocked = await read(adminToken);
    expect(blocked.statusCode).toBe(429);
    expect(errorCode(blocked.json())).toBe('RATE_LIMITED');

    now = 60_000;
    expect((await read(adminToken)).statusCode).toBe(200);
  });

  it('limite les écritures séparément des lectures, et chaque admin séparément', async () => {
    now = 120_000;
    const created = await createNikountViaApi(app, {
      name: 'Limites',
      adminLabel: 'Nicolas',
      participants: ['Alice'],
    });
    const other = CreateAdminResponse.parse(
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/admins',
          headers: bearer(created.adminToken),
          payload: { label: 'Léa' },
        })
      ).json(),
    );
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
    const write = (token: string) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/transactions',
        headers: bearer(token),
        payload: {
          clientRequestId: randomUUID(),
          type: 'EXPENSE',
          amount: 1000,
          description: 'Pain',
          occurredOn: '2026-11-01',
          payerId: ids[0],
          distribution: { mode: 'EQUAL', participantIds: ids },
        },
      });

    // 1 écriture déjà faite (création de Léa) : 2 restantes.
    expect((await write(created.adminToken)).statusCode).toBe(201);
    expect((await write(created.adminToken)).statusCode).toBe(201);
    expect((await write(created.adminToken)).statusCode).toBe(429);
    // Les lectures du même lien restent permises.
    expect((await read(created.adminToken)).statusCode).toBe(200);
    // L'autre admin et le lien participant ont leur propre compteur.
    expect((await write(other.adminToken)).statusCode).toBe(201);
    expect((await write(created.participantToken)).statusCode).toBe(201);
  });

  it('le lien participant, partagé par le groupe, est compté par IP', async () => {
    now = 240_000;
    const { participantToken } = await createNikountViaApi(app, {
      name: 'Groupe',
      adminLabel: 'Nicolas',
    });
    const readFrom = (remoteAddress: string) =>
      app.inject({
        method: 'GET',
        url: '/api/v1/me',
        headers: bearer(participantToken),
        remoteAddress,
      });
    for (let i = 0; i < 5; i += 1) expect((await readFrom('10.0.0.1')).statusCode).toBe(200);
    expect((await readFrom('10.0.0.1')).statusCode).toBe(429);
    expect((await readFrom('10.0.0.2')).statusCode).toBe(200);
  });
});
