import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { isDatabaseUp } from '../src/db/client.js';
import { nikount } from '../src/db/schema.js';
import { createTestDatabase } from './helpers.js';

let testDb: Awaited<ReturnType<typeof createTestDatabase>>;

beforeAll(async () => {
  testDb = await createTestDatabase();
});

afterAll(async () => {
  await testDb.close();
});

const tokenHash = () => createHash('sha256').update(randomUUID()).digest();

describe('migrations (PostgreSQL via PGlite)', () => {
  it('s’appliquent et la base répond', async () => {
    expect(await isDatabaseUp(testDb.db)).toBe(true);
  });

  it('crée un nikount avec les valeurs par défaut attendues', async () => {
    const id = randomUUID();
    await testDb.db
      .insert(nikount)
      .values({ id, name: 'Weekend Chamonix', participantTokenHash: tokenHash() });

    const [row] = await testDb.db.select().from(nikount).where(eq(nikount.id, id));
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
    await expect(
      testDb.db
        .insert(nikount)
        .values({ id: randomUUID(), name: 'Test', participantTokenHash: tokenHash(), ...override }),
    ).rejects.toThrow();
  });

  it('refuse deux nikounts avec le même token participant', async () => {
    const hash = tokenHash();
    await testDb.db
      .insert(nikount)
      .values({ id: randomUUID(), name: 'A', participantTokenHash: hash });
    await expect(
      testDb.db.insert(nikount).values({ id: randomUUID(), name: 'B', participantTokenHash: hash }),
    ).rejects.toThrow();
  });
});
