import { defineConfig } from 'drizzle-kit';

// Génération des migrations SQL à partir de src/db/schema.ts.
// Les triggers et contraintes non exprimables en Drizzle sont ajoutés via des migrations SQL
// manuelles (`drizzle-kit generate --custom`).
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  strict: true,
  verbose: true,
});
