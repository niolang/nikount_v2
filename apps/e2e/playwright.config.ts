import { defineConfig, devices } from '@playwright/test';

/**
 * Parcours clés sur mobile, contre le build de production du front (servi avec les en-têtes
 * et la CSP du Caddyfile) et une API sur base embarquée en mémoire.
 *   pnpm e2e            (depuis la racine)
 */
const API_PORT = 3200;
const WEB_PORT = 4190;

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: Boolean(process.env['CI']),
  retries: process.env['CI'] ? 1 : 0,
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${String(WEB_PORT)}`,
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'mobile', use: { ...devices['Pixel 7'] } }],
  webServer: [
    {
      command: 'pnpm --filter @nikount/api e2e:server',
      url: `http://127.0.0.1:${String(API_PORT)}/api/v1/health`,
      env: { E2E_API_PORT: String(API_PORT) },
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: `pnpm --filter @nikount/web exec vite build && pnpm --filter @nikount/web exec vite preview --port ${String(WEB_PORT)} --strictPort`,
      url: `http://localhost:${String(WEB_PORT)}`,
      env: { VITE_API_PROXY_TARGET: `http://127.0.0.1:${String(API_PORT)}` },
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
