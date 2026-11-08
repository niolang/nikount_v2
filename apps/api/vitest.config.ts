import { defineConfig } from 'vitest/config';

// Résout les paquets du workspace vers leurs sources TypeScript (pas besoin de les compiler pour tester).
// Conditions par défaut de Vite côté serveur, précédées de la nôtre.
const conditions = ['@nikount/source', 'module', 'node', 'development|production'];

export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
