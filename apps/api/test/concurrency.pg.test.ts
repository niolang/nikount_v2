/**
 * Concurrence réelle sur PostgreSQL (pas PGlite, qui n'a qu'une connexion) : la clôture ne doit
 * jamais laisser passer une opération en attente créée au même moment (docs/product.md §4).
 *
 * Exécuté seulement si TEST_POSTGRES_URL pointe vers une base PostgreSQL jetable (la CI fournit
 * un conteneur postgres:17) ; ignoré sinon.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { NikountView, ParticipantListResponse, TransactionListResponse } from '@nikount/contracts';
import { createDatabase, type DatabaseHandle } from '../src/db/client.js';
import { migrationsFolder } from '../src/db/migrate.js';
import type { AppInstance } from '../src/lib/types.js';
import { bearer, buildTestApp, createNikountViaApi } from './helpers.js';

const url = process.env['TEST_POSTGRES_URL'];

describe.skipIf(!url)('clôture concurrente (PostgreSQL réel)', () => {
  let handle: DatabaseHandle | undefined;
  let app: AppInstance;

  beforeAll(async () => {
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      await migrate(drizzle({ client }), { migrationsFolder });
    } finally {
      await client.end();
    }
    handle = createDatabase(url ?? '');
    app = await buildTestApp(handle.db);
  });

  afterAll(async () => {
    // Base injoignable : beforeAll a échoué avant de créer l'application.
    if (!handle) return;
    await app.close();
    await handle.close();
  });

  const json = async <T>(
    promise: Promise<{ json: () => unknown }>,
    schema: { parse: (v: unknown) => T },
  ) => schema.parse((await promise).json());

  /** Nikount en phase de règlement, sans opération en attente : prêt à être clôturé. */
  async function readyToClose() {
    const name = `Course ${randomUUID().slice(0, 8)}`;
    const created = await createNikountViaApi(app, {
      name,
      adminLabel: 'Nicolas',
      adminIsParticipant: false,
      participants: ['Alice', 'Bob'],
    });
    const admin = bearer(created.adminToken);
    const { participants } = await json(
      app.inject({ method: 'GET', url: '/api/v1/participants', headers: admin }),
      ParticipantListResponse,
    );
    const settlement = await json(
      app.inject({
        method: 'POST',
        url: '/api/v1/nikount/state',
        headers: admin,
        payload: { to: 'SETTLEMENT', version: 1 },
      }),
      NikountView,
    );
    const [alice, bob] = participants.map((p) => p.id);
    return { ...created, name, admin, alice: alice ?? '', bob: bob ?? '', settlement };
  }

  type Ready = Awaited<ReturnType<typeof readyToClose>>;

  const close = (n: Ready) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/nikount/state',
      headers: n.admin,
      payload: { to: 'CLOSED', version: n.settlement.version },
    });

  const declareRefund = (n: Ready) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/transactions',
      headers: bearer(n.participantToken),
      payload: {
        clientRequestId: randomUUID(),
        type: 'REIMBURSEMENT',
        amount: 1500,
        description: 'Virement',
        occurredOn: '2026-11-01',
        payerId: n.alice,
        distribution: { mode: 'EQUAL', participantIds: [n.bob] },
      },
    });

  it('une clôture attend la fin d’une écriture en cours sur le même nikount', async () => {
    const n = await readyToClose();
    const client = new pg.Client({ connectionString: url });
    await client.connect();
    try {
      // Simule une création en cours : même verrou que le service des opérations.
      await client.query('begin');
      await client.query('select id from nikount where name = $1 for share', [n.name]);

      let settled = false;
      const closing = close(n).then((response) => {
        settled = true;
        return response;
      });
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(settled).toBe(false);

      await client.query('commit');
      expect((await closing).statusCode).toBe(200);
    } finally {
      await client.end();
    }
  });

  it('jamais de nikount clôturé avec une opération en attente, quel que soit l’ordre', async () => {
    const outcomes = { closed: 0, refused: 0 };

    for (let round = 0; round < 25; round += 1) {
      const n = await readyToClose();
      const [closing, ...refunds] = await Promise.all([
        close(n),
        ...Array.from({ length: 4 }, () => declareRefund(n)),
      ]);

      const state = await json(
        app.inject({ method: 'GET', url: '/api/v1/nikount', headers: n.admin }),
        NikountView,
      );
      const { transactions } = await json(
        app.inject({ method: 'GET', url: '/api/v1/transactions', headers: n.admin }),
        TransactionListResponse,
      );
      const pending = transactions.filter((t) => t.status === 'PENDING').length;
      const accepted = refunds.filter((r) => r.statusCode === 201).length;

      // Chaque requête a une issue nette : succès, ou refus métier explicite.
      expect([200, 409]).toContain(closing.statusCode);
      for (const r of refunds) expect([201, 409]).toContain(r.statusCode);
      expect(pending).toBe(accepted);

      if (state.state === 'CLOSED') {
        outcomes.closed += 1;
        expect(pending, `tour ${String(round)}`).toBe(0);
      } else {
        outcomes.refused += 1;
        expect(closing.json<{ error: { code: string } }>().error.code).toBe('PENDING_REMAINING');
      }
    }

    expect(outcomes.closed + outcomes.refused).toBe(25);
  });
});
