import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  BalancesResponse,
  ParticipantListResponse,
  TransactionListResponse,
  TransactionView,
} from '@nikount/contracts';
import { computeBalances } from '@nikount/core';
import { financialTransaction } from '../src/db/schema.js';
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

/** Nikount du cahier des charges : Alice, Bob, Charlie, David ; admin non participant. */
async function setup(names = ['Alice', 'Bob', 'Charlie', 'David']) {
  const created = await createNikountViaApi(app, {
    name: 'Chamonix',
    adminLabel: 'Trésorier',
    adminIsParticipant: false,
    participants: names,
  });
  const participants = ParticipantListResponse.parse(
    (
      await app.inject({
        method: 'GET',
        url: '/api/v1/participants',
        headers: bearer(created.adminToken),
      })
    ).json(),
  ).participants;
  const ids = participants.map((p) => p.id);
  const id = (name: string) => participants.find((p) => p.name === name)?.id ?? '';
  return { ...created, ids, id, participants };
}

type Setup = Awaited<ReturnType<typeof setup>>;

async function addTransaction(token: string, body: Record<string, unknown>) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v1/transactions',
    headers: bearer(token),
    payload: {
      clientRequestId: randomUUID(),
      type: 'EXPENSE',
      description: 'Test',
      occurredOn: '2026-09-28',
      ...body,
    },
  });
  if (response.statusCode !== 201) throw new Error(response.body);
  return TransactionView.parse(response.json());
}

async function balances(token: string) {
  const response = await app.inject({
    method: 'GET',
    url: '/api/v1/balances',
    headers: bearer(token),
  });
  expect(response.statusCode).toBe(200);
  return BalancesResponse.parse(response.json());
}

const byName = (s: Setup, result: BalancesResponse): Record<string, number> =>
  Object.fromEntries(
    result.balances.map((b): [string, number] => [
      s.participants.find((p) => p.id === b.participantId)?.name ?? '?',
      b.balance,
    ]),
  );

describe('soldes — exemples du cahier des charges', () => {
  it('120 € d’Alice pour 4, puis remboursement Bob → Alice 30 €', async () => {
    const s = await setup();
    await addTransaction(s.adminToken, {
      amount: 12000,
      payerId: s.id('Alice'),
      distribution: { mode: 'EQUAL', participantIds: s.ids },
    });

    const afterExpense = await balances(s.participantToken);
    expect(byName(s, afterExpense)).toEqual({
      Alice: 9000,
      Bob: -3000,
      Charlie: -3000,
      David: -3000,
    });
    expect(afterExpense.nextPayerId).toBe(s.id('Bob'));
    expect(afterExpense.settlementSuggestions).toEqual([
      { from: s.id('Bob'), to: s.id('Alice'), amount: 3000 },
      { from: s.id('Charlie'), to: s.id('Alice'), amount: 3000 },
      { from: s.id('David'), to: s.id('Alice'), amount: 3000 },
    ]);

    await addTransaction(s.adminToken, {
      type: 'REIMBURSEMENT',
      amount: 3000,
      description: 'Remboursement',
      payerId: s.id('Bob'),
      distribution: { mode: 'EQUAL', participantIds: [s.id('Alice')] },
    });

    const afterRefund = await balances(s.adminToken);
    expect(byName(s, afterRefund)).toEqual({ Alice: 6000, Bob: 0, Charlie: -3000, David: -3000 });
    expect(afterRefund.nextPayerId).toBe(s.id('Charlie'));
  });

  it('un nikount vide : tout à zéro, rien à suggérer', async () => {
    const s = await setup();
    const result = await balances(s.participantToken);
    expect(result.balances.every((b) => b.balance === 0)).toBe(true);
    expect(result).toMatchObject({
      nextPayerId: null,
      settlementSuggestions: [],
      pending: { count: 0, amount: 0 },
    });
  });
});

describe('opérations en attente', () => {
  it('ne modifient pas les soldes tant qu’elles ne sont pas validées, mais sont signalées', async () => {
    const s = await setup();
    const pending = await addTransaction(s.participantToken, {
      amount: 4500,
      payerId: s.id('Charlie'),
      distribution: { mode: 'EQUAL', participantIds: s.ids },
    });
    expect(pending.status).toBe('PENDING');

    const before = await balances(s.participantToken);
    expect(before.balances.every((b) => b.balance === 0)).toBe(true);
    expect(before.pending).toEqual({ count: 1, amount: 4500 });

    // Validation simulée en base (l'écran de validation arrive en Phase 7).
    await testDb.db
      .update(financialTransaction)
      .set({ status: 'VALIDATED', validatedAt: new Date(), validatedByAdminId: s.admin.id })
      .where(eq(financialTransaction.id, pending.id));

    const after = await balances(s.participantToken);
    expect(byName(s, after)).toMatchObject({ Charlie: 4500 - 1125, Alice: -1125 });
    expect(after.pending).toEqual({ count: 0, amount: 0 });
  });
});

describe('participants désactivés', () => {
  it('gardent leur solde et figurent dans les virements, mais pas dans « qui paie »', async () => {
    const s = await setup(['Alice', 'Bob']);
    await addTransaction(s.adminToken, {
      amount: 1000,
      payerId: s.id('Alice'),
      distribution: { mode: 'EQUAL', participantIds: [s.id('Bob')] },
    });
    const bob = s.participants.find((p) => p.name === 'Bob');
    await app.inject({
      method: 'PATCH',
      url: `/api/v1/participants/${bob?.id ?? ''}`,
      headers: bearer(s.adminToken),
      payload: { isActive: false, version: bob?.version },
    });

    const result = await balances(s.adminToken);
    expect(byName(s, result)).toEqual({ Alice: 1000, Bob: -1000 });
    expect(result.settlementSuggestions).toEqual([
      { from: s.id('Bob'), to: s.id('Alice'), amount: 1000 },
    ]);
    expect(result.nextPayerId).toBe(s.id('Alice'));
  });
});

describe('isolation', () => {
  it('les soldes d’un nikount ne voient pas les opérations d’un autre', async () => {
    const a = await setup();
    const b = await setup();
    await addTransaction(a.adminToken, {
      amount: 10000,
      payerId: a.id('Alice'),
      distribution: { mode: 'EQUAL', participantIds: a.ids },
    });
    const result = await balances(b.adminToken);
    expect(result.balances.map((x) => x.participantId).sort()).toEqual([...b.ids].sort());
    expect(result.balances.every((x) => x.balance === 0)).toBe(true);
  });

  it('exige un token', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/balances' })).statusCode).toBe(401);
  });
});

/** Générateur pseudo-aléatoire déterministe (reproductible d'une exécution à l'autre). */
function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

describe('calcul SQL ≡ moteur @nikount/core', () => {
  it.each([1, 42, 2026])('graine %i : mêmes soldes, somme nulle', async (seed) => {
    const random = seeded(seed);
    const pick = <T>(items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
    const s = await setup(['A', 'B', 'C', 'D', 'E', 'F', 'G']);

    for (let i = 0; i < 40; i++) {
      const concerned = s.ids.filter(() => random() < 0.6);
      if (concerned.length === 0) concerned.push(pick(s.ids));
      const amount = 1 + Math.floor(random() * 50_000);
      const mode = pick(['EQUAL', 'SHARES', 'PERCENT', 'AMOUNT'] as const);
      let distribution: Record<string, unknown>;
      if (mode === 'EQUAL') {
        distribution = { mode, participantIds: concerned };
      } else if (mode === 'SHARES') {
        distribution = {
          mode,
          shares: concerned.map((participantId) => ({
            participantId,
            value: (1 + Math.floor(random() * 400)) / 100,
          })),
        };
      } else if (mode === 'PERCENT') {
        // Répartit 100,00 % en centièmes entiers, le reste au dernier.
        let left = 10_000;
        const shares = concerned.map((participantId, index) => {
          const isLast = index === concerned.length - 1;
          const cut = isLast ? left : Math.max(1, Math.floor((random() * left) / 2));
          left -= cut;
          return { participantId, value: cut / 100 };
        });
        if (shares.some((sh) => sh.value <= 0)) {
          distribution = { mode: 'EQUAL', participantIds: concerned };
        } else {
          distribution = { mode, shares };
        }
      } else {
        let left = amount;
        distribution = {
          mode,
          shares: concerned.map((participantId, index) => {
            const value = index === concerned.length - 1 ? left : Math.floor(random() * (left + 1));
            left -= value;
            return { participantId, value };
          }),
        };
      }
      // Environ un tiers saisi par des participants : en attente, donc non compté.
      const token = random() < 0.33 ? s.participantToken : s.adminToken;
      await addTransaction(token, { amount, payerId: pick(s.ids), distribution });
    }

    const fromSql = await balances(s.adminToken);
    const { transactions } = TransactionListResponse.parse(
      (
        await app.inject({
          method: 'GET',
          url: '/api/v1/transactions',
          headers: bearer(s.adminToken),
        })
      ).json(),
    );
    const fromEngine = computeBalances(transactions, s.ids);

    expect(fromSql.balances).toEqual(fromEngine);
    expect(fromSql.balances.reduce((sum, b) => sum + b.balance, 0)).toBe(0);
    expect(fromSql.balances.some((b) => b.balance !== 0)).toBe(true);
    expect(fromSql.pending.count).toBe(transactions.filter((t) => t.status === 'PENDING').length);
  });
});
