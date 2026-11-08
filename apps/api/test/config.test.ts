import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

const base = {
  DATABASE_URL: 'postgres://u:p@localhost:5432/db',
  PUBLIC_BASE_URL: 'http://localhost:5173',
  TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
};

describe('loadConfig', () => {
  it('applique les valeurs par défaut', () => {
    const config = loadConfig(base);
    expect(config).toMatchObject({
      NODE_ENV: 'development',
      API_PORT: 3000,
      LOG_LEVEL: 'info',
      TRUST_PROXY: 0,
      RATE_LIMIT_CREATE_PER_HOUR: 10,
      AUTH_FAILURE_MAX: 20,
    });
    expect(config.TOKEN_ENCRYPTION_KEY).toHaveLength(32);
  });

  it('convertit les nombres fournis en texte', () => {
    expect(loadConfig({ ...base, API_PORT: '8080', TRUST_PROXY: '1' })).toMatchObject({
      API_PORT: 8080,
      TRUST_PROXY: 1,
    });
  });

  it('refuse une configuration sans base de données', () => {
    const { DATABASE_URL: _omitted, ...withoutDb } = base;
    expect(() => loadConfig(withoutDb)).toThrow(/DATABASE_URL/);
  });

  it('refuse une URL de base qui n’est pas PostgreSQL', () => {
    expect(() => loadConfig({ ...base, DATABASE_URL: 'mysql://u:p@h/db' })).toThrow(/DATABASE_URL/);
  });

  it('exige une clé de chiffrement de 32 octets', () => {
    const { TOKEN_ENCRYPTION_KEY: _omitted, ...withoutKey } = base;
    expect(() => loadConfig(withoutKey)).toThrow(/TOKEN_ENCRYPTION_KEY/);
    expect(() =>
      loadConfig({ ...base, TOKEN_ENCRYPTION_KEY: randomBytes(16).toString('base64') }),
    ).toThrow(/32 octets/);
  });

  it('exige HTTPS pour l’URL publique en production', () => {
    expect(() => loadConfig({ ...base, NODE_ENV: 'production' })).toThrow(/HTTPS/);
    expect(
      loadConfig({ ...base, NODE_ENV: 'production', PUBLIC_BASE_URL: 'https://nikount.app' }),
    ).toMatchObject({ NODE_ENV: 'production' });
  });
});
