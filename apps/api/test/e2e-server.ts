/**
 * API pour les tests de bout en bout (Playwright) : base PostgreSQL embarquée en mémoire
 * (PGlite, toutes migrations appliquées), effacée à l'arrêt. Aucune dépendance à Docker.
 *   pnpm --filter @nikount/api e2e:server
 */
import { buildApp } from '../src/app.js';
import { createTestDatabase, testConfig } from './helpers.js';

const port = Number(process.env['E2E_API_PORT'] ?? 3200);
const { db, close } = await createTestDatabase();
const app = await buildApp({
  config: testConfig({ LOG_LEVEL: 'warn', API_PORT: port }),
  db,
});

await app.listen({ host: '127.0.0.1', port });
console.log(`API e2e prête sur http://127.0.0.1:${String(port)}`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void app
      .close()
      .then(close)
      .finally(() => process.exit(0));
  });
}
