/// <reference types="vitest/config" />
import { defineConfig, defaultClientConditions, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Le fichier .env est à la racine du monorepo.
const envDir = '../..';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, envDir, 'VITE_');
  const apiTarget = env['VITE_API_PROXY_TARGET'] ?? 'http://localhost:3000';

  return {
    envDir,
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
    build: {
      sourcemap: true,
      target: 'es2022',
    },
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.{ts,tsx}'],
    },
  };
});
