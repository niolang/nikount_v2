import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { isDatabaseUp } from '../src/db/client.js';
import { auditEvent, nikount } from '../src/db/schema.js';
import { createTestDatabase, type TestDatabase } from './helpers.js';

let testDb: TestDatabase;

beforeAll(async () => {
  testDb = await createTestDatabase();
});

afterAll(async () => {
  await testDb.close();
});

/** Drizzle enveloppe l'erreur PostgreSQL : le message du moteur est dans `cause`. */
async function expectDatabaseError(query: PromiseLike<unknown>, pattern: RegExp): Promise<void> {
  try {
    await query;
  } catch (error) {
    const cause = (error as { cause?: { message?: string } }).cause;
    expect(cause?.message ?? String(error)).toMatch(pattern);
    return;
  }
  expect.fail('La requête aurait dû être refusée par la base');
}

const tokenHash = () => createHash('sha256').update(randomUUID()).digest();
const newNikount = (overrides: Partial<typeof nikount.$inferInsert> = {}) => ({
  id: randomUUID(),
  name: 'Test',
  participantTokenHash: tokenHash(),
  participantTokenCiphertext: randomBytes(50),
  ...overrides,
});

describe('migrations (PostgreSQL via PGlite)', () => {
  it('s’appliquent et la base répond', async () => {
    expect(await isDatabaseUp(testDb.db)).toBe(true);
  });

  it('crée un nikount avec les valeurs par défaut attendues', async () => {
    const values = newNikount({ name: 'Weekend Chamonix' });
    await testDb.db.insert(nikount).values(values);

    const [row] = await testDb.db.select().from(nikount).where(eq(nikount.id, values.id));
    expect(row).toMatchObject({
      name: 'Weekend Chamonix',
      currency: 'EUR',
      state: 'OPEN',
      version: 1,
      timezone: 'Europe/Paris',
    });
  });

  it.each([
    ['nom vide', { name: '' }],
    ['nom trop long', { name: 'x'.repeat(61) }],
    ['devise invalide', { currency: 'eur' }],
    ['hash de token de mauvaise taille', { participantTokenHash: new Uint8Array(16) }],
  ])('refuse : %s', async (_label, override) => {
    await expect(testDb.db.insert(nikount).values(newNikount(override))).rejects.toThrow();
  });

  it('refuse deux nikounts avec le même token participant', async () => {
    const hash = tokenHash();
    await testDb.db.insert(nikount).values(newNikount({ participantTokenHash: hash }));
    await expect(
      testDb.db.insert(nikount).values(newNikount({ participantTokenHash: hash })),
    ).rejects.toThrow();
  });
});

describe('journal d’audit append-only', () => {
  it('refuse toute modification, suppression ou vidage', async () => {
    const values = newNikount();
    await testDb.db.insert(nikount).values(values);
    await testDb.db.insert(auditEvent).values({
      nikountId: values.id,
      actorKind: 'SYSTEM',
      action: 'test.done',
    });

    await expectDatabaseError(
      testDb.db
        .update(auditEvent)
        .set({ action: 'falsifié' })
        .where(eq(auditEvent.nikountId, values.id)),
      /ajout seul \(UPDATE interdit\)/,
    );
    await expectDatabaseError(
      testDb.db.delete(auditEvent).where(eq(auditEvent.nikountId, values.id)),
      /ajout seul \(DELETE interdit\)/,
    );
    await expectDatabaseError(
      testDb.db.execute(sql`truncate audit_event`),
      /ajout seul \(TRUNCATE interdit\)/,
    );
  });

  it('exige un admin pour une action d’admin', async () => {
    const values = newNikount();
    await testDb.db.insert(nikount).values(values);
    await expect(
      testDb.db
        .insert(auditEvent)
        .values({ nikountId: values.id, actorKind: 'ADMIN', action: 'x.y' }),
    ).rejects.toThrow();
  });
});
