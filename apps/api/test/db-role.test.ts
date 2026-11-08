import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ParticipantListResponse, TransactionView } from '@nikount/contracts';
import { grantApplicationRole } from '../src/db/migrate.js';
import type { AppInstance } from '../src/lib/types.js';
import {
  bearer,
  buildTestApp,
  createNikountViaApi,
  createTestDatabase,
  type TestDatabase,
} from './helpers.js';

/**
 * L'API fonctionne avec le rôle applicatif de production (sans droits DDL), et ce rôle ne peut
 * ni modifier la structure ni effacer l'historique (docs/security.md §10).
 */
let testDb: TestDatabase;
let app: AppInstance;

beforeAll(async () => {
  testDb = await createTestDatabase();
  await testDb.client.exec('create role nikount_app nologin');
  await grantApplicationRole(testDb.db, 'nikount_app');
  // Toute la suite s'exécute sous ce rôle (PGlite : une seule session).
  await testDb.client.exec('set role nikount_app');
  app = await buildTestApp(testDb.db);
});

afterAll(async () => {
  await app.close();
  await testDb.close();
});

const denied = async (statement: string) => {
  await expect(testDb.client.exec(statement)).rejects.toThrow(/permission denied|must be owner/);
};

describe('rôle applicatif', () => {
  it('suffit à tout le cycle : création, saisie, modification (parts remplacées), validation', async () => {
    const created = await createNikountViaApi(app, {
      name: 'Droits',
      adminLabel: 'Nicolas',
      participants: ['Alice'],
    });
    const admin = bearer(created.adminToken);
    const { participants } = ParticipantListResponse.parse(
      (await app.inject({ method: 'GET', url: '/api/v1/participants', headers: admin })).json(),
    );
    const ids = participants.map((p) => p.id);
    const body = {
      amount: 3000,
      description: 'Pizza',
      category: null,
      occurredOn: '2026-11-01',
      payerId: ids[0],
      distribution: { mode: 'EQUAL', participantIds: ids },
    };
    const pending = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions',
      headers: bearer(created.participantToken),
      payload: { ...body, clientRequestId: randomUUID(), type: 'EXPENSE' },
    });
    expect(pending.statusCode).toBe(201);
    const tx = TransactionView.parse(pending.json());

    const edited = await app.inject({
      method: 'PUT',
      url: `/api/v1/transactions/${tx.id}`,
      headers: admin,
      payload: {
        ...body,
        amount: 4500,
        distribution: { mode: 'EQUAL', participantIds: [ids[1]] },
        version: tx.version,
      },
    });
    expect(edited.statusCode).toBe(200);

    const validated = await app.inject({
      method: 'POST',
      url: `/api/v1/transactions/${tx.id}/validate`,
      headers: admin,
      payload: {},
    });
    expect(validated.statusCode).toBe(200);
    const audit = await app.inject({ method: 'GET', url: '/api/v1/audit', headers: admin });
    expect(audit.statusCode).toBe(200);
  });

  it('n’a aucun droit sur la structure', async () => {
    await denied('create table intrus (id int)');
    await denied('alter table nikount add column intrus int');
    await denied('drop table transaction_share');
  });

  it('ne peut ni effacer ni réécrire l’historique', async () => {
    await denied('delete from audit_event');
    await denied('update audit_event set action = action');
    await denied('update transaction_revision set reason = reason');
    await denied('delete from "transaction"');
    await denied('delete from participant');
    await denied('truncate nikount cascade');
  });
});
