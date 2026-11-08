import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  PUBLIC_BASE_URL: 'http://localhost:5173',
};

describe('loadConfig', () => {
  it('applique les valeurs par défaut', () => {
    const config = loadConfig(base);
    expect(config).toMatchObject({
      NODE_ENV: 'development',
      API_PORT: 3000,
      LOG_LEVEL: 'info',
      TRUST_PROXY: 0,
    });
  });

  it('convertit les nombres fournis en texte', () => {
    expect(loadConfig({ ...base, API_PORT: '8080', TRUST_PROXY: '1' })).toMatchObject({
      API_PORT: 8080,
      TRUST_PROXY: 1,
    });
  });

  it('refuse une configuration sans base de données', () => {
    expect(() => loadConfig({ PUBLIC_BASE_URL: base.PUBLIC_BASE_URL })).toThrow(/DATABASE_URL/);
  });

  it('refuse une URL de base qui n’est pas PostgreSQL', () => {
    expect(() => loadConfig({ ...base, DATABASE_URL: 'mysql://u:p@h/db' })).toThrow(/DATABASE_URL/);
  });

  it('exige HTTPS pour l’URL publique en production', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production' })).toThrow(/HTTPS/);
    expect(
      loadConfig({ ...base, NODE_ENV: 'production', PUBLIC_BASE_URL: 'https://nikount.app' }),
    ).toMatchObject({ NODE_ENV: 'production' });
  });
});
