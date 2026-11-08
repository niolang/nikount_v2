/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import { defineConfig, defaultClientConditions, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Le fichier .env (racine du monorepo) ne sert qu'au serveur de dev, pour la cible du proxy.
// Il n'est jamais lu au build : son NODE_ENV=development (destiné à l'API) ferait embarquer la
// version de développement de React (3 fois plus lourde).
const envDir = '../..';

/**
 * En-têtes de sécurité de production, relus depuis le Caddyfile : `vite preview` sert le build
 * avec exactement la même CSP, ce qui permet de vérifier localement qu'elle ne casse rien.
 */
function productionHeaders(): Record<string, string> {
  const caddyfile = readFileSync(new URL('../../docker/Caddyfile', import.meta.url), 'utf8');
  const headers: Record<string, string> = {};
  for (const [, name, value] of caddyfile.matchAll(/^\s+([A-Z][\w-]+) "([^"]+)"$/gm)) {
    if (name && value && name !== 'Strict-Transport-Security' && name !== 'Cache-Control') {
      headers[name] = value;
    }
  }
  return headers;
}

export default defineConfig(({ command, mode }) => {
  const env = command === 'serve' ? loadEnv(mode, envDir, 'VITE_') : {};
  const apiTarget = env['VITE_API_PROXY_TARGET'] ?? 'http://localhost:3000';

  return {
    envDir: command === 'serve' ? envDir : false,
    plugins: [react(), tailwindcss()],
    resolve: {
      // Les paquets du workspace sont consommés depuis leurs sources TypeScript.
      conditions: ['@nikount/source', ...defaultClientConditions],
    },
    server: {
      host: true,
      port: 5173,
      strictPort: true,
      // Montage de volume Docker depuis Windows/macOS : les événements fichiers ne remontent pas.
      watch: { usePolling: process.env['CHOKIDAR_USEPOLLING'] === 'true' },
      proxy: { '/api': { target: apiTarget, changeOrigin: false } },
    },
    preview: { port: 4180, headers: productionHeaders() },
    build: {
      sourcemap: true,
      target: 'es2022',
      rolldownOptions: {
        output: {
          // Bibliothèques à part : elles changent rarement et restent en cache entre deux versions.
          codeSplitting: {
            groups: [
              { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
              { name: 'vendor', test: /node_modules[\\/]/ },
            ],
          },
        },
      },
    },
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.{ts,tsx}'],
    },
  };
});
