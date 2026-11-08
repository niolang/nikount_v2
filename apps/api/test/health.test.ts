import { afterEach, describe, expect, it } from 'vitest';
import { ErrorResponse, HealthResponse } from '@nikount/contracts';
import type { AppInstance } from '../src/lib/types.js';
import { buildTestApp } from './helpers.js';

let app: AppInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe('GET /api/v1/health', () => {
  it('répond 200 quand la base est disponible', async () => {
    app = await buildTestApp({ checkDatabase: () => Promise.resolve(true) });
    const response = await app.inject({ method: 'GET', url: '/api/v1/health' });

    expect(response.statusCode).toBe(200);
    expect(HealthResponse.parse(response.json())).toEqual({ status: 'ok', database: 'up' });
  });

  it('répond 503 quand la base est indisponible', async () => {
    app = await buildTestApp({ checkDatabase: () => Promise.resolve(false) });
    const response = await app.inject({ method: 'GET', url: '/api/v1/health' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'degraded', database: 'down' });
  });

  it('répond 503 si la vérification de la base lève une exception', async () => {
    app = await buildTestApp({ checkDatabase: () => Promise.reject(new Error('boom')) });
    const response = await app.inject({ method: 'GET', url: '/api/v1/health' });

    expect(response.statusCode).toBe(503);
  });

  it('renvoie un identifiant de requête généré par le serveur, jamais celui du client', async () => {
    app = await buildTestApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/health',
      headers: { 'request-id': 'forged-by-client' },
    });

    const requestId = response.headers['x-request-id'];
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(requestId).not.toBe('forged-by-client');
  });

  it('pose les en-têtes de sécurité', async () => {
    app = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/health' });

    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['content-security-policy']).toContain("default-src 'none'");
  });
});

describe('gestion des erreurs', () => {
  it('répond 404 au format standard sur une route inconnue', async () => {
    app = await buildTestApp();
    const response = await app.inject({ method: 'GET', url: '/api/v1/inexistant' });

    expect(response.statusCode).toBe(404);
    const body = ErrorResponse.parse(response.json());
    expect(body.error.code).toBe('NOT_FOUND');
    expect(body.requestId).toBe(response.headers['x-request-id']);
  });

  it('répond 400 au format standard sur un JSON invalide', async () => {
    app = await buildTestApp();
    app.post('/api/v1/echo', async () => ({ ok: true }));
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{ invalide',
    });

    expect(response.statusCode).toBe(400);
    expect(ErrorResponse.parse(response.json()).error.code).toBe('FST_ERR_CTP_INVALID_JSON_BODY');
  });

  it('masque le détail des erreurs inattendues', async () => {
    app = await buildTestApp();
    app.get('/api/v1/boom', async () => {
      throw new Error('secret interne');
    });
    const response = await app.inject({ method: 'GET', url: '/api/v1/boom' });

    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('secret interne');
    expect(ErrorResponse.parse(response.json()).error.code).toBe('INTERNAL_ERROR');
  });
});
