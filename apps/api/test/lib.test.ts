import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { tokenRole } from '@nikount/contracts';
import { FailureLimiter } from '../src/lib/failure-limiter.js';
import { SecretBox } from '../src/lib/secret-box.js';
import { generateToken, hashToken, parseBearerToken } from '../src/lib/tokens.js';
import { uuidv7 } from '../src/lib/uuid.js';

describe('tokens', () => {
  it('génère des tokens au bon format, avec l’entropie attendue', () => {
    const participant = generateToken('PARTICIPANT');
    const admin = generateToken('ADMIN');
    expect(tokenRole(participant)).toBe('PARTICIPANT');
    expect(tokenRole(admin)).toBe('ADMIN');
    expect(Buffer.from(participant.slice(2), 'base64url')).toHaveLength(16);
    expect(Buffer.from(admin.slice(2), 'base64url')).toHaveLength(32);
  });

  it('ne génère jamais deux fois le même token', () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => generateToken('PARTICIPANT')));
    expect(tokens.size).toBe(1000);
  });

  it('calcule une empreinte SHA-256 de 32 octets, stable', () => {
    const token = generateToken('ADMIN');
    expect(hashToken(token)).toHaveLength(32);
    expect(hashToken(token).equals(hashToken(token))).toBe(true);
  });

  it('lit un en-tête Bearer bien formé', () => {
    const token = generateToken('ADMIN');
    expect(parseBearerToken(`Bearer ${token}`)).toEqual({ role: 'ADMIN', token });
  });

  it.each([
    undefined,
    '',
    'Bearer',
    'Bearer ',
    'Basic abc',
    'bearer p_AAAAAAAAAAAAAAAAAAAAAA',
    'Bearer p_court',
    'Bearer p_AAAAAAAAAAAAAAAAAAAAAA extra',
  ])('refuse l’en-tête « %s »', (header) => {
    expect(parseBearerToken(header)).toBeNull();
  });
});

describe('uuidv7', () => {
  it('produit un UUID v7 valide', () => {
    expect(uuidv7()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('encode l’horodatage : les UUID sont triables dans le temps', () => {
    const earlier = uuidv7(1_700_000_000_000);
    const later = uuidv7(1_700_000_000_001);
    expect(earlier < later).toBe(true);
    expect(earlier.replace(/-/g, '').slice(0, 12)).toBe(
      (1_700_000_000_000).toString(16).padStart(12, '0'),
    );
  });
});

describe('SecretBox', () => {
  const box = new SecretBox(randomBytes(32));

  it('chiffre puis déchiffre', () => {
    const sealed = box.seal('p_secret', 'nikount-1');
    expect(sealed.toString('utf8')).not.toContain('p_secret');
    expect(box.open(sealed, 'nikount-1')).toBe('p_secret');
  });

  it('produit un chiffré différent à chaque fois (IV aléatoire)', () => {
    expect(box.seal('x', 'c').equals(box.seal('x', 'c'))).toBe(false);
  });

  it('refuse un chiffré recopié sur une autre ligne (contexte lié)', () => {
    const sealed = box.seal('p_secret', 'nikount-1');
    expect(() => box.open(sealed, 'nikount-2')).toThrow();
  });

  it('refuse un chiffré altéré ou une autre clé', () => {
    const sealed = box.seal('p_secret', 'n');
    const tampered = Buffer.from(sealed);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1] ?? 0) ^ 1;
    expect(() => box.open(tampered, 'n')).toThrow();
    expect(() => new SecretBox(randomBytes(32)).open(sealed, 'n')).toThrow();
  });

  it('exige une clé de 32 octets', () => {
    expect(() => new SecretBox(randomBytes(16))).toThrow();
  });
});

describe('FailureLimiter', () => {
  function limiter() {
    let now = 0;
    const instance = new FailureLimiter({
      maxFailures: 3,
      windowMs: 1000,
      blockMs: 5000,
      now: () => now,
      maxEntries: 2,
    });
    return { instance, advance: (ms: number) => (now += ms) };
  }

  it('bloque après le nombre d’échecs autorisé, puis débloque', () => {
    const { instance, advance } = limiter();
    instance.recordFailure('ip');
    instance.recordFailure('ip');
    expect(instance.isBlocked('ip')).toBe(false);
    instance.recordFailure('ip');
    expect(instance.isBlocked('ip')).toBe(true);
    advance(5001);
    expect(instance.isBlocked('ip')).toBe(false);
  });

  it('repart de zéro quand la fenêtre est écoulée', () => {
    const { instance, advance } = limiter();
    instance.recordFailure('ip');
    instance.recordFailure('ip');
    advance(1001);
    instance.recordFailure('ip');
    expect(instance.isBlocked('ip')).toBe(false);
  });

  it('isole les adresses', () => {
    const { instance } = limiter();
    for (let i = 0; i < 3; i++) instance.recordFailure('a');
    expect(instance.isBlocked('a')).toBe(true);
    expect(instance.isBlocked('b')).toBe(false);
  });

  it('borne la mémoire utilisée', () => {
    const { instance } = limiter();
    instance.recordFailure('a');
    instance.recordFailure('b');
    instance.recordFailure('c');
    // Au plus 2 entrées suivies : la plus ancienne a été oubliée.
    for (let i = 0; i < 2; i++) instance.recordFailure('a');
    expect(instance.isBlocked('a')).toBe(false);
  });
});
